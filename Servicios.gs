/**
 * LAYER 3: SERVICIOS / LÓGICA DE NEGOCIO
 * Contiene funciones de alto nivel que orquestan las operaciones del DAO.
 */

const VENTA_STATES = { INIT: 'INIT', STOCK_VALIDATED: 'STOCK_VALIDATED', INVENTORY_RESERVED: 'INVENTORY_RESERVED', CARTERA_CREATED: 'CARTERA_CREATED', COMPLETED: 'COMPLETED', FAILED: 'FAILED' };

function _createStateMachine() {
  const state = {
    current: VENTA_STATES.INIT,
    transitions: [],
    compensations: [],
    fail(reason) {
      this.current = VENTA_STATES.FAILED;
      for (let i = this.compensations.length - 1; i >= 0; i--) {
        const comp = this.compensations[i];
        try {
          Logger.warn(`Rollback: ${comp.name}`);
          comp.fn();
        } catch (e) {
          Logger.warn(`Rollback error in ${comp.name}: ${e.message}`);
        }
      }
      return _error(reason);
    },
    transition(name, fn, compensation) {
      this.current = VENTA_STATES[name];
      fn();
      this.transitions.push(name);
      if (compensation) {
        this.compensations.push({ name, fn: compensation });
      }
    }
  };
  return state;
}

function _validateCarrito(carrito) {
  const consolidated = [];
  const mapProductos = new Map();
  const errors = [];

  for (const item of carrito) {
    const id = String(item.id || "").trim();
    if (!id) {
      errors.push("ID de producto inválido.");
      return { valid: false, consolidated: [], errors };
    }

    const cantidad = Number(item.cantidad);
    if (isNaN(cantidad) || cantidad <= 0 || cantidad % 1 !== 0) {
      errors.push(`Cantidad inválida para ${id}`);
      return { valid: false, consolidated: [], errors };
    }

    const precio = Number(item.precio);
    if (isNaN(precio) || precio < 0 || precio % 1 !== 0) {
      errors.push(`Precio inválido para ${id}`);
      return { valid: false, consolidated: [], errors };
    }

    if (mapProductos.has(id)) {
      const prodExistente = mapProductos.get(id);
      if (prodExistente.precio !== precio) {
        errors.push(`Precio inconsistente para el producto duplicado ${id}`);
        return { valid: false, consolidated: [], errors };
      }
      prodExistente.cantidad += cantidad;
    } else {
      const prodLimpio = { id, cantidad, precio };
      mapProductos.set(id, prodLimpio);
      consolidated.push(prodLimpio);
    }
  }

  return { valid: true, consolidated, errors: [] };
}

/**
 * Procesa una venta, ya sea al contado o a crédito.
 * @param {Array<Object>} carrito Lista de productos en el carrito.
 * @param {Object} opciones Opciones de la venta (e.g., tipo, idTercero, diasCredito).
 * @returns {Object} Resultado de la operación.
 */
function procesarVentaV2(carrito, opciones) {
  const _startTime = Date.now();

  if (!carrito || !Array.isArray(carrito) || carrito.length === 0) {
    return _error("El carrito no puede estar vacío.");
  }
  if (!opciones || typeof opciones !== 'object') {
    return _error("Opciones de venta inválidas.");
  }
  if (!opciones.tipo) {
    return _error("El tipo de venta es requerido.");
  }

  const esCredito = opciones.tipo === CARTERA_CONFIG.TIPOS.CXC;
  const idTercero = _sanitizeId(opciones.idTercero || "");

  if (esCredito && !idTercero) {
    return _error("ID de tercero es requerido para ventas a crédito.");
  }

  const validation = _validateCarrito(carrito);
  if (!validation.valid) {
    return _error(validation.errors[0]);
  }
  const carritoConsolidado = validation.consolidated;

  const totalVenta = carritoConsolidado.reduce((sum, item) => sum + (item.precio || 0) * item.cantidad, 0);

  // Pre-condition: fast fail-fast check for CXC before acquiring global lock
  if (esCredito && idTercero) {
    CACHE.refresh();
    const tercero = CACHE.getTerceroRAW(idTercero);
    if (!tercero) {
      return _error(`Tercero ${idTercero} no encontrado.`);
    }
    if (tercero.limite_credito > 0) {
      const saldoActual = CACHE.getSaldoTercero(idTercero);
      if ((saldoActual + totalVenta) > tercero.limite_credito) {
        return _error(`Límite de crédito superado. Disponible: ${_formatMoneda(tercero.limite_credito - saldoActual)}`);
      }
    }
  }

  const state = _createStateMachine();
  const lock = LOCK_MANAGER.acquireGlobalLock(15000);

  try {
    AuthService.checkPermission("registrar_venta");

    state.transition('STOCK_VALIDATED', () => {
      const errorStock = _validarStockCarrito(carritoConsolidado);
      if (errorStock) throw new Error(errorStock);
    });

    state.transition('INVENTORY_RESERVED',
      () => _descontarInventario(carritoConsolidado),
      () => _revertirDescuentoInventario(carritoConsolidado)
    );

    state.transition('CARTERA_CREATED', () => {
      if (esCredito && idTercero) {
        const diasCredito = opciones.diasCredito || 30;
        DOMAIN.crearCarteraAtomic(idTercero, "VENTA_" + Date.now(), totalVenta, CARTERA_CONFIG.TIPOS.CXC, diasCredito);
      }
    });

    state.current = VENTA_STATES.COMPLETED;

    LOG_ENGINE.logEvent("VENTA_PROCESADA", "VENTAS", idTercero || "CONTADO",
      { items: carritoConsolidado.length },
      { total: totalVenta, tipo: opciones.tipo },
      "SUCCESS"
    );

    return {
      success: true,
      total: totalVenta,
      tipo: opciones.tipo,
      idTercero: idTercero || null,
      state: {
        transitions: state.transitions,
        durationMs: Date.now() - _startTime,
      },
    };
  } catch (e) {
    const msg = e.message || "Error procesando venta.";
    state.fail(msg);
    LOG_ENGINE.logEvent("ERROR_VENTA", "VENTAS", idTercero || "CONTADO",
      {}, { error: msg }, "FAILED");
    return _error(msg);
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}

/**
 * Persiste físicamente el estado VENCIDA en la hoja Cartera.
 * Barre todas las filas no-CANCELADA y sincroniza COL.estado con la realidad
 * de fecha_vencimiento vs hoy. También revierte VENCIDA stale cuando la fecha
 * de vencimiento fue extendida (infiriendo ABIERTA/PARCIAL del saldo).
 * @returns {Object} { success, marcados, revertidos, timestamp }
 */
function actualizarVencimientos() {
  AuthService.checkPermission("ejecutar_mantenimiento");

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    LOG_ENGINE.logEvent("ERROR_VENCIMIENTOS_LOCK", "CARTERA", "BATCH",
      {}, { error: "No se pudo adquirir el lock" }, "FAILED");
    return _error("No se pudo adquirir el lock para actualizar vencimientos.");
  }

  try {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const numCols = Math.max(...Object.values(COL)) + 1;
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) return { success: true, marcados: 0, revertidos: 0, errores: 0, timestamp: new Date().toISOString() };

    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const hoy = _today();
    const cambios = [];
    let marcados = 0;
    let revertidos = 0;
    let errores = 0;
    const UMBRAL_ERRORES = 5;

    for (let i = 0; i < data.length; i++) {
      if (errores >= UMBRAL_ERRORES) {
        LOG_ENGINE.logEvent("VENCIMIENTOS_ABORTADOS", "CARTERA", "BATCH",
          { procesados: i },
          { error: `Umbral de ${UMBRAL_ERRORES} errores superado.` },
          "FAILED");
        return _error(`Actualización abortada: se superó el umbral de ${UMBRAL_ERRORES} errores.`);
      }

      const row = data[i];
      const estadoActual = String(row[COL.estado] || "").trim();

      if (estadoActual === CARTERA_CONFIG.ESTADOS.CANCELADA) continue;

      const fv = _safeDate(row[COL.fecha_vencimiento]);
      if (fv.getTime() <= 0) {
        errores++;
        continue;
      }

      const estaVencido = fv.getTime() < hoy.getTime();

      if (estaVencido && estadoActual !== CARTERA_CONFIG.ESTADOS.VENCIDA) {
        cambios.push({
          rowIndex: i + 2,
          saldo: _parseMoneda(row[COL.saldo], 0),
          estado: CARTERA_CONFIG.ESTADOS.VENCIDA,
          vencida_timestamp: Utilities.formatDate(new Date(), _getTimeZone(), "yyyy-MM-dd HH:mm:ss"),
        });
        marcados++;
      } else if (!estaVencido && estadoActual === CARTERA_CONFIG.ESTADOS.VENCIDA) {
        const total = _parseMoneda(row[COL.total], 0);
        const saldo = _parseMoneda(row[COL.saldo], 0);
        const nuevoEstado = saldo < total
          ? CARTERA_CONFIG.ESTADOS.PARCIAL
          : CARTERA_CONFIG.ESTADOS.ABIERTA;
        cambios.push({ rowIndex: i + 2, saldo, estado: nuevoEstado, vencida_timestamp: null });
        revertidos++;
      }
    }

    if (cambios.length > 0) {
      try {
        DOMAIN.actualizarCarteraBatch(cambios);
      } catch (e) {
        errores++;
        LOG_ENGINE.logEvent("ERROR_VENCIMIENTOS_BATCH", "CARTERA", "BATCH",
          {}, { error: e.message || e.toString() }, "FAILED");
        if (errores >= UMBRAL_ERRORES) {
          return _error(`Actualización abortada tras error en escritura batch.`);
        }
      }

      LOG_ENGINE.logEvent("VENCIMIENTOS_ACTUALIZADOS", "CARTERA", "BATCH",
        {}, { marcados, revertidos, errores }, errores > 0 ? "WARNING" : "SUCCESS");
    }

    CACHE.invalidateCartera();

    return { success: true, marcados, revertidos, errores, timestamp: new Date().toISOString() };

  } finally {
    lock.releaseLock();
  }
}

/**
 * Crea un trigger diario (2:00 AM) para actualizarVencimientos().
 * Ejecutar UNA vez desde el editor de Apps Script.
 */
function crearTriggerVencimientos() {
  AuthService.checkPermission("configurar_sistema");
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "actualizarVencimientos") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("actualizarVencimientos")
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();

  Logger.log("Trigger diario configurado para actualizarVencimientos() a las 2:00 AM");
  return { success: true, message: "Trigger de vencimientos configurado correctamente" };
}

/**
 * Instala el trigger diario de vencimientos SOLO si no existe.
 * A diferencia de crearTriggerVencimientos(), es idempotente.
 */
function instalarTriggerVencimientos() {
  AuthService.checkPermission("configurar_sistema");
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === "actualizarVencimientos");
  if (exists) {
    return { success: true, message: "Trigger de vencimientos ya instalado." };
  }

  ScriptApp.newTrigger("actualizarVencimientos")
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();

  const msg = "Trigger diario instalado para actualizarVencimientos() a las 2:00 AM";
  Logger.log(msg);
  return { success: true, message: msg };
}

/**
 * Elimina todos los triggers de actualizarVencimientos.
 */
function eliminarTriggerVencimientos() {
  AuthService.checkPermission("configurar_sistema");
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "actualizarVencimientos") {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  return { success: true, eliminados: count };
}

/**
 * Obtiene una lista de terceros con soporte de caché y filtros opcionales.
 * @param {Object} [filtros={}] Filtros opcionales (tipo, busqueda, activo).
 * @returns {Array<Object>} Lista de terceros mapeada sin índices numéricos.
 */
function obtenerTerceros(filtros = {}) {
  AuthService.checkPermission("ver_terceros");

  CACHE.refresh();

  let resultados = CACHE.terceros || [];

  if (filtros.tipo) {
    const tipoFiltro = String(filtros.tipo).toUpperCase();
    resultados = resultados.filter(t => t.tipo === tipoFiltro);
  }

  if (filtros.busqueda) {
    const busqueda = String(filtros.busqueda).toLowerCase();
    resultados = resultados.filter(t =>
      t.id.toLowerCase().includes(busqueda) ||
      t.nombre.toLowerCase().includes(busqueda)
    );
  }

  if (filtros.activo !== false) {
    resultados = resultados.filter(t => t.activo);
  }

  return resultados.map(t => ({
    id: t.id,
    nombre: t.nombre || "S.N.",
    telefono: t.telefono || "",
    tipo: t.tipo,
    limite_credito: t.limite_credito,
    activo: t.activo,
  }));
}

/**
 * @deprecated Usar DOMAIN.registrarAbonoAtomic() directamente.
 * Capa eliminada: toda validación vive en Domain.gs. Se mantiene
 * como alias por compatibilidad; nuevos callers deben llamar a
 * DOMAIN.registrarAbonoAtomic() o API.registrarAbono().
 */
function _registrarAbonoServicio(idTercero, valorAbono, referencia, tipoCartera) {
  AuthService.checkPermission("registrar_abono");
  return DOMAIN.registrarAbonoAtomic(idTercero, valorAbono, referencia, tipoCartera);
}

function _validarStockCarrito(carrito) {
  const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
  const data = sheet.getDataRange().getValues();
  const COL = CONFIG.COLUMNS.PRODUCTOS;

  for (const item of carrito) {
    const id = String(item.id || "").trim();
    const cantidad = Number(item.cantidad) || 0;
    if (!id || cantidad <= 0) continue;

    let encontrado = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][COL.id] || "").trim() === id) {
        const stock = Number(data[i][COL.stock]) || 0;
        if (stock < cantidad) {
          return `Stock insuficiente para ${data[i][COL.nombre] || id}: disponible ${stock}, solicitado ${cantidad}`;
        }
        encontrado = true;
        break;
      }
    }
    if (!encontrado) {
      return `Producto ${id} no encontrado en inventario.`;
    }
  }
  return null;
}

function _descontarInventario(carrito) {
  const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
  const data = sheet.getDataRange().getValues();
  const COL = CONFIG.COLUMNS.PRODUCTOS;
  const updates = [];

  // Index rows by product ID for O(N+M) instead of O(N*M)
  const index = {};
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][COL.id] || "").trim();
    if (id) index[id] = i;
  }

  for (const item of carrito) {
    const id = String(item.id || "").trim();
    const cantidad = Number(item.cantidad) || 0;
    if (!id || cantidad <= 0) continue;

    const i = index[id];
    if (i === undefined) {
      throw new Error(`Producto ${id} no encontrado en inventario.`);
    }

    const stockActual = Number(data[i][COL.stock]) || 0;
    const currentVersion = Number(data[i][COL.version]) || 1;

    if (item.expectedVersion !== undefined && currentVersion !== item.expectedVersion) {
      throw new Error(
        `OptimisticLockError: producto ${id} modificado concurrentemente ` +
        `(esperada v${item.expectedVersion}, actual v${currentVersion}). Reintente la venta.`
      );
    }

    data[i][COL.stock] = Math.max(0, stockActual - cantidad);
    data[i][COL.version] = currentVersion + 1;
    updates.push(i);
  }

  // Single batch write: all changed rows at once
  if (updates.length > 0) {
    const minRow = Math.min(...updates);
    const maxRow = Math.max(...updates);
    const batchData = [];
    for (let r = minRow; r <= maxRow; r++) {
      batchData.push([data[r][COL.stock], data[r][COL.version]]);
    }
    sheet.getRange(minRow + 1, COL.stock + 1, batchData.length, 2).setValues(batchData);
  }
}

function _revertirDescuentoInventario(carrito) {
  const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
  const data = sheet.getDataRange().getValues();
  const COL = CONFIG.COLUMNS.PRODUCTOS;
  const updates = [];

  const index = {};
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][COL.id] || "").trim();
    if (id) index[id] = i;
  }

  for (const item of carrito) {
    const id = String(item.id || "").trim();
    const cantidad = Number(item.cantidad) || 0;
    if (!id || cantidad <= 0) continue;

    const i = index[id];
    if (i === undefined) continue;

    const stockActual = Number(data[i][COL.stock]) || 0;
    data[i][COL.stock] = stockActual + cantidad;
    updates.push(i);
  }

  if (updates.length > 0) {
    const minRow = Math.min(...updates);
    const maxRow = Math.max(...updates);
    const batchData = [];
    for (let r = minRow; r <= maxRow; r++) {
      batchData.push([data[r][COL.stock]]);
    }
    sheet.getRange(minRow + 1, COL.stock + 1, batchData.length, 1).setValues(batchData);
  }
}

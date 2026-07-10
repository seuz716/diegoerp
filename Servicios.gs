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
          Logger.log(`[ROLLBACK] ${comp.name}`);
          comp.fn();
        } catch (e) {
          Logger.log(`[ROLLBACK] Error in ${comp.name}: ${e.message}`);
        }
      }
      return _error(reason);
    },
    transition(name, fn, compensation) {
      this.transitions.push(name);
      if (compensation) {
        this.compensations.push({ name, fn: compensation });
      }
      this.current = VENTA_STATES[name];
      fn();
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
 * Delegate to DOMAIN.registrarVentaAtomic which handles complete transaction.
 * @param {Array<Object>} carrito Lista de productos en el carrito.
 * @param {Object} opciones Opciones de la venta (e.g., tipo, idTercero, diasCredito).
 * @returns {Object} Resultado de la operación.
 */
function procesarVentaV2(carrito, opciones) {
  const _startTime = Date.now();

  // Input validation
  if (!carrito || !Array.isArray(carrito) || carrito.length === 0) {
    return _error("El carrito no puede estar vacío.");
  }
  if (!opciones || typeof opciones !== 'object') {
    return _error("Opciones de venta inválidas.");
  }

  // Validate and consolidate cart
  const validation = _validateCarrito(carrito);
  if (!validation.valid) {
    return _error(validation.errors[0]);
  }
  const carritoConsolidado = validation.consolidated;

  // Determine mode
  const tipoVenta = (opciones.tipo || 'CXC').toUpperCase();
  const idTercero = _sanitizeId(opciones.idTercero || "");
  const esCredito = tipoVenta === CARTERA_CONFIG.TIPOS.CXC;

  // For CxC mode, clienteId is required
  if (esCredito && !idTercero) {
    return _error("ID de tercero es requerido para ventas a crédito.");
  }

  // Check credit limit for CxC sales
  if (esCredito && idTercero) {
    CACHE.refresh();
    const tercero = CACHE.getTerceroRAW(idTercero);
    if (!tercero) {
      return _error("Tercero " + idTercero + " no encontrado.");
    }
    if (!tercero.limite_credito || tercero.limite_credito === 0) {
      return _error("Cliente sin límite de crédito configurado. Configure un límite o use venta de contado.");
    }
    const totalVenta = carritoConsolidado.reduce((sum, item) => sum + (item.precio || 0) * item.cantidad, 0);
    const saldoActual = CACHE.getSaldoTercero(idTercero);
    if ((saldoActual + totalVenta) > tercero.limite_credito) {
      return _error(`Límite de crédito superado. Disponible: ${_formatMoneda(tercero.limite_credito - saldoActual)}`);
    }
  }

  // Delegate to DOMAIN.registrarVentaAtomic with new signature
  const params = {
    clienteId: idTercero || undefined,
    items: carritoConsolidado.map(item => ({
      id: item.id,
      cantidad: item.cantidad,
      precio_unitario: item.precio
    })),
    total: carritoConsolidado.reduce((sum, item) => sum + (item.precio || 0) * item.cantidad, 0),
    modo: esCredito ? 'CXC' : 'CONTADO',
    diasCredito: Number(opciones.diasCredito) || 30,
    correlationId: opciones.correlationId || ('venta_' + Date.now()),
    usuario: SESSION_SERVICE.getCurrentUser()?.getEmail() || "SYSTEM"
  };

  try {
    AuthService.checkPermission("registrar_venta");
    const result = DOMAIN.registrarVentaAtomic(params);

    if (result.success) {
      return {
        success: true,
        total: result.total,
        tipo: tipoVenta,
        idTercero: idTercero || null,
        ventaId: result.id,
        state: {
          transitions: ["VALIDATED", "PROCESSED"],
          durationMs: Date.now() - _startTime,
        },
      };
    }
    return result;
  } catch (e) {
    const msg = e.message || "Error procesando venta.";
    LOG_ENGINE.logEvent("ERROR_VENTA", "VENTAS", idTercero || "CONTADO",
      {}, { error: msg }, "FAILED");
    return _error(msg);
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
  let lock = null;
  try {
    AuthService.checkPermission("ejecutar_mantenimiento");

    try {
      lock = LOCK_MANAGER.acquireGlobalLock(30000);
    } catch (e) {
      LOG_ENGINE.logEvent("ERROR_VENCIMIENTOS_LOCK", "CARTERA", "BATCH",
        {}, { error: "No se pudo adquirir el lock: " + e.message }, "FAILED");
      return _error("No se pudo adquirir el lock para actualizar vencimientos.");
    }

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

      let fv = null;
      try {
        fv = _safeDate(row[COL.fecha_vencimiento]);
      } catch (_) {
        errores++;
        continue;
      }
      if (!fv || fv.getTime() <= 0) {
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
        let nuevoEstado;
        if (saldo === 0) {
          nuevoEstado = CARTERA_CONFIG.ESTADOS.CANCELADA;
        } else if (saldo < total) {
          nuevoEstado = CARTERA_CONFIG.ESTADOS.PARCIAL;
        } else {
          nuevoEstado = CARTERA_CONFIG.ESTADOS.ABIERTA;
        }
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

  } catch (e) {
    _notificarErrorTrigger("actualizarVencimientos", e);
    return _error("Error en actualización de vencimientos: " + e.message);
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
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
  const productos = DAO_PRODUCTOS.listar();
  const index = {};
  for (let i = 0; i < productos.length; i++) {
    index[productos[i].id] = productos[i];
  }

  for (const item of carrito) {
    const id = String(item.id || "").trim();
    const cantidad = Number(item.cantidad) || 0;
    if (!id || cantidad <= 0) continue;

    const prod = index[id];
    if (!prod) {
      return `Producto ${id} no encontrado en inventario.`;
    }

    const stock = Number(prod.stock) || 0;
    if (stock < cantidad) {
      return `Stock insuficiente para ${prod.nombre || id}: disponible ${stock}, solicitado ${cantidad}`;
    }
  }
  return null;
}

function _descontarInventario(carrito) {
  const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
  const COL = CONFIG.COLUMNS.PRODUCTOS;
  const numCols = Math.max(...Object.values(COL)) + 1;
  const updates = [];
  const lock = LOCK_MANAGER.acquireGlobalLock(15000);

  try {
    const data = sheet.getDataRange().getValues();
    const index = {};
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][COL.id] || "").trim();
      if (id) {
        index[id] = { rowIndex: i, version: _parseMoneda(data[i][COL.version], 1) };
      }
    }

    for (const item of carrito) {
      const id = String(item.id || "").trim();
      const cantidad = Number(item.cantidad) || 0;
      if (!id || cantidad <= 0) continue;

      const info = index[id];
      if (!info) {
        throw new Error(`Producto ${id} no encontrado en inventario.`);
      }

      const stockActual = _parseMoneda(data[info.rowIndex][COL.stock], 0);
      const nuevoStock = stockActual - cantidad;
      if (nuevoStock < 0) {
        throw new Error(`Stock insuficiente para ${id}: disponible ${stockActual}, solicitado ${cantidad}`);
      }

      const currentVersion = _parseMoneda(data[info.rowIndex][COL.version], 1);
      if (currentVersion !== info.version) {
        const err = new Error(
          "OptimisticLockError: Producto " + id + " fue modificado concurrentemente " +
          "(esperada v" + info.version + ", actual v" + currentVersion + "). Reintente."
        );
        err.type = 'OPTIMISTIC_LOCK_FAILURE';
        err.productId = id;
        throw err;
      }

      data[info.rowIndex][COL.stock] = nuevoStock;
      data[info.rowIndex][COL.version] = currentVersion + 1;
      updates.push({ rowIndex: info.rowIndex + 1, values: data[info.rowIndex].slice(0, numCols) });
    }

    for (const update of updates) {
      sheet.getRange(update.rowIndex, 1, 1, numCols).setValues([update.values]);
    }
  } finally {
    if (lock) lock.releaseLock();
  }
}

function _revertirDescuentoInventario(carrito) {
  const lock = LOCK_MANAGER.acquireGlobalLock(15000);
  try {
    const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
    const data = sheet.getDataRange().getValues();
    const COL = CONFIG.COLUMNS.PRODUCTOS;
    const numCols = Math.max(...Object.values(COL)) + 1;

    const index = {};
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][COL.id] || "").trim();
      if (id) {
        index[id] = { rowIndex: i, version: _parseMoneda(data[i][COL.version], 1) };
      }
    }

    const updates = [];
    let skipped = 0;
    for (const item of carrito) {
      const id = String(item.id || "").trim();
      const cantidad = Number(item.cantidad) || 0;
      if (!id || cantidad <= 0) continue;

      const info = index[id];
      if (!info) {
        skipped++;
        continue;
      }

      const currentVersion = _parseMoneda(data[info.rowIndex][COL.version], 1);
      if (currentVersion !== info.version) {
        Logger.log("[ROLLBACK] Version mismatch for " + id + ": expected " + info.version + ", actual " + currentVersion);
        skipped++;
        continue;
      }

      const stockActual = _parseMoneda(data[info.rowIndex][COL.stock], 0);
      data[info.rowIndex][COL.stock] = stockActual + cantidad;
      data[info.rowIndex][COL.version] = currentVersion + 1;
      updates.push({ rowIndex: info.rowIndex + 1, values: data[info.rowIndex].slice(0, numCols) });
    }

    for (const update of updates) {
      sheet.getRange(update.rowIndex, 1, 1, numCols).setValues([update.values]);
    }

    if (skipped > 0) {
      Logger.log("[ROLLBACK] " + skipped + " producto(s) saltados por version mismatch o no encontrados");
    }
  } finally {
    if (lock) lock.releaseLock();
  }
}

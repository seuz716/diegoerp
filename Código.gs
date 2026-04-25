/**
 * MICRO ERP - MÓDULO DE CARTERA
 * Extensión de Codigo.gs v2.0
 * Desarrollado por: César Andrés Abadía
 * Archivo: Cartera.gs
 * Versión: 1.1
 * © 2026 Todos los derechos reservados
 *
 * CAMBIOS v1.1:
 *   - [FIX] tipo_mov en CANCELACION corregido (antes usaba ESTADOS.CANCELADA por error)
 *   - [FIX] IDs con UUID parcial para evitar colisiones en concurrencia
 *   - [FIX] deleteTercero usa soft-delete (campo activo col 6) en lugar de borrar la fila
 *   - [NEW] actualizarVencimientos() — trigger diario que persiste estado VENCIDA en la hoja
 *   - [NEW] getTerceros() filtra inactivos por defecto
 *
 * HOJAS REQUERIDAS (agregar al Spreadsheet):
 *   - Terceros          → ID, Nombre, Teléfono, Tipo, Limite_Credito, Activo
 *   - Cartera           → ID, Fecha, ID_Tercero, Origen_ID, Total, Saldo, Tipo, Estado, Fecha_Vencimiento
 *   - Movimientos_Cartera → ID, Fecha, ID_Cartera, ID_Tercero, Valor, Tipo_Mov, Referencia
 *
 * TRIGGER REQUERIDO (configurar una sola vez):
 *   Apps Script → Triggers → actualizarVencimientos → Temporizado → Diario
 *
 * MODIFICACIÓN REQUERIDA EN Codigo.gs:
 *   - procesarVenta() acepta ahora un segundo parámetro: opciones { tipo, idTercero, diasCredito }
 *   - CONFIG.SHEETS y CONFIG.COLUMNS se amplían abajo (copiar al CONFIG existente)
 */

// ─────────────────────────────────────────────
// EXTENSIÓN DEL CONFIG (agregar a CONFIG en Codigo.gs)
// ─────────────────────────────────────────────
// SHEETS nuevas:
//   TERCEROS: "Terceros"
//   CARTERA: "Cartera"
//   MOVIMIENTOS_CARTERA: "Movimientos_Cartera"
//
// COLUMNS nuevas:
//   TERCEROS:  { id:0, nombre:1, telefono:2, tipo:3, limite_credito:4 }
//   CARTERA:   { id:0, fecha:1, id_tercero:2, origen_id:3, total:4, saldo:5, tipo:6, estado:7, fecha_vencimiento:8 }
//   MOV_CARTERA: { id:0, fecha:1, id_cartera:2, id_tercero:3, valor:4, tipo_mov:5, referencia:6 }

const CARTERA_CONFIG = {
  SHEETS: {
    TERCEROS: "Terceros",
    CARTERA: "Cartera",
    MOV_CARTERA: "Movimientos_Cartera",
  },
  COLUMNS: {
    TERCEROS:    { id: 0, nombre: 1, telefono: 2, tipo: 3, limite_credito: 4, activo: 5 },
    CARTERA:     { id: 0, fecha: 1, id_tercero: 2, origen_id: 3, total: 4, saldo: 5, tipo: 6, estado: 7, fecha_vencimiento: 8 },
    MOV_CARTERA: { id: 0, fecha: 1, id_cartera: 2, id_tercero: 3, valor: 4, tipo_mov: 5, referencia: 6 },
  },
  ESTADOS: { ABIERTA: "ABIERTA", PARCIAL: "PARCIAL", CANCELADA: "CANCELADA", VENCIDA: "VENCIDA" },
  TIPOS:   { CXC: "CxC", CXP: "CxP" },
  LOCK_TIMEOUT: 30000,
};

// -------------------------
// Utilidades de validación
// -------------------------
function _sanitizeId(id) {
  return String(id || "").trim();
}

function _parseNumber(v, defaultVal) {
  const n = parseFloat(v);
  return (isNaN(n) ? (typeof defaultVal === 'number' ? defaultVal : NaN) : n);
}

function _isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

function _error(msg) {
  return { success: false, message: String(msg || "Error desconocido") };
}

// ─────────────────────────────────────────────
// TERCEROS
// ─────────────────────────────────────────────

function getTerceros(filtroTipo) {
  try {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
    const data = sheet.getDataRange().getValues();
    if (!data || data.length <= 1) return [];

    const COL = CARTERA_CONFIG.COLUMNS.TERCEROS;
    return data.slice(1)
      .map((row) => {
        if (!row[COL.id]) return null;
        // Columna activo: si está vacía se asume TRUE (registros antiguos sin el campo)
        const activo = row[COL.activo] === false || String(row[COL.activo]).toUpperCase() === "INACTIVO"
          ? false : true;
        return {
          id:             String(row[COL.id]).trim(),
          nombre:         String(row[COL.nombre] || "Sin nombre").trim(),
          telefono:       String(row[COL.telefono] || "").trim(),
          tipo:           String(row[COL.tipo] || "CLIENTE").trim().toUpperCase(),
          limite_credito: Math.max(0, parseFloat(row[COL.limite_credito]) || 0),
          activo:         activo,
        };
      })
      .filter((t) => t !== null)
      .filter((t) => t.activo)                                                          // ocultar inactivos por defecto
      .filter((t) => !filtroTipo || t.tipo === filtroTipo.toUpperCase());
  } catch (e) {
    Logger.log("ERROR getTerceros: " + e.toString());
    return [];
  }
}

function saveTercero(tercero) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(CARTERA_CONFIG.LOCK_TIMEOUT);
    if (!lockAcquired) return _error("Servidor ocupado. Intenta de nuevo.");

    if (!tercero || typeof tercero !== 'object') return _error('Datos de tercero inválidos.');

    const idLimpio      = _sanitizeId(tercero.id).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const nombreLimpio  = String(tercero.nombre || "Tercero").trim().substring(0, 100);
    const telLimpio     = String(tercero.telefono || "").trim().substring(0, 20);
    const tipoLimpioRaw = String(tercero.tipo || "CLIENTE").toUpperCase();
    const tipoLimpio    = ["CLIENTE","PROVEEDOR","OTRO"].includes(tipoLimpioRaw) ? tipoLimpioRaw : "CLIENTE";
    const limiteLimpio  = Math.max(0, _parseNumber(tercero.limite_credito, 0));

    if (!idLimpio) return _error("ID de tercero inválido.");

    const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
    const data  = sheet.getDataRange().getValues();
    const COL   = CARTERA_CONFIG.COLUMNS.TERCEROS;

    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (_sanitizeId(data[i][COL.id]) === idLimpio) { rowIndex = i + 1; break; }
    }

    const rowData = [idLimpio, nombreLimpio, telLimpio, tipoLimpio, limiteLimpio, "ACTIVO"];
    if (rowIndex !== -1) {
      sheet.getRange(rowIndex, 1, 1, 6).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    SpreadsheetApp.flush();
    return { success: true };
  } catch (e) {
    return { success: false, message: String(e && e.message ? e.message : e.toString()) };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function deleteTercero(id) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(CARTERA_CONFIG.LOCK_TIMEOUT);
    if (!lockAcquired) return _error('Sistema ocupado.');

    const idClean = _sanitizeId(id);
    if (!idClean) return _error('ID inválido.');

    // Verificar que no tenga cartera abierta
    const carteraAbierta = getCarteraPorTercero(idClean).filter(
      (c) => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA
    );
    if (carteraAbierta.length > 0)
      return _error('No se puede desactivar: el tercero tiene cartera pendiente.');

    const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
    const data  = sheet.getDataRange().getValues();
    const COL   = CARTERA_CONFIG.COLUMNS.TERCEROS;

    for (let i = 1; i < data.length; i++) {
      if (_sanitizeId(data[i][COL.id]) === idClean) {
        // Soft delete: marcar INACTIVO sin borrar la fila (preserva historial)
        sheet.getRange(i + 1, COL.activo + 1).setValue("INACTIVO");
        SpreadsheetApp.flush();
        return { success: true };
      }
    }
    return _error('Tercero no encontrado.');
  } catch (e) {
    return { success: false, message: String(e && e.message ? e.message : e.toString()) };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

// ─────────────────────────────────────────────
// CARTERA - LECTURA
// ─────────────────────────────────────────────

function getCartera(filtroEstado, filtroTipo) {
  try {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const data  = sheet.getDataRange().getValues();
    if (!data || data.length <= 1) return [];

    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    return data.slice(1)
      .map((row) => {
        if (!row[COL.id]) return null;
        const rawFV = row[COL.fecha_vencimiento];
        const fVenc = rawFV instanceof Date ? rawFV : new Date(rawFV);

        // Actualizar estado a VENCIDA en memoria si aplica
        let estado = String(row[COL.estado] || "ABIERTA").trim();
        if (estado !== CARTERA_CONFIG.ESTADOS.CANCELADA) {
          if (_isValidDate(fVenc)) {
            fVenc.setHours(0, 0, 0, 0);
            if (fVenc < hoy) estado = CARTERA_CONFIG.ESTADOS.VENCIDA;
          }
        }

        return {
          id:               String(row[COL.id]).trim(),
          fecha:            row[COL.fecha] instanceof Date ? row[COL.fecha].toLocaleDateString("es-CO") : row[COL.fecha],
          id_tercero:       String(row[COL.id_tercero]).trim(),
          origen_id:        String(row[COL.origen_id] || "").trim(),
          total:            parseFloat(row[COL.total]) || 0,
          saldo:            parseFloat(row[COL.saldo]) || 0,
          tipo:             String(row[COL.tipo]).trim(),
          estado:           estado,
          fecha_vencimiento: _isValidDate(fVenc) ? fVenc.toLocaleDateString("es-CO") : "",
          dias_vencido:     (_isValidDate(fVenc) && estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
                              ? Math.floor((hoy - fVenc) / 86400000) : 0,
        };
      })
      .filter((c) => c !== null)
      .filter((c) => !filtroEstado || c.estado === filtroEstado)
      .filter((c) => !filtroTipo   || c.tipo === filtroTipo);
  } catch (e) {
    Logger.log("ERROR getCartera: " + e.toString());
    return [];
  }
}

function getCarteraPorTercero(idTercero) {
  return getCartera().filter((c) => c.id_tercero === String(idTercero).trim());
}

function getSaldoTercero(idTercero) {
  // MEJORA: No filtrar canceladas aquí, el llamador decide
  // Pero por compatibilidad, mantenemos el comportamiento
  const cartera = getCarteraPorTercero(idTercero);
  return cartera
    .filter((c) => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
    .reduce((acc, c) => acc + c.saldo, 0);
}

// ─────────────────────────────
// Función interna para obtener saldo directo sin transformar datos
// (evita getCartera que es costoso)
function _getSaldoTerceroDirecto_(idTercero, dataCarteraOpt) {
  // Si no se pasa dataCartera, leerla (para compatibilidad interna)
  const dataCartera = dataCarteraOpt || getSheet(CARTERA_CONFIG.SHEETS.CARTERA).getDataRange().getValues();
  const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
  const idT = String(idTercero).trim();
  
  let saldo = 0;
  for (let i = 1; i < dataCartera.length; i++) {
    const row = dataCartera[i];
    if (
      String(row[COL.id_tercero]).trim() === idT &&
      String(row[COL.estado]).trim() !== CARTERA_CONFIG.ESTADOS.CANCELADA
    ) {
      saldo += _parseNumber(row[COL.saldo], 0);
    }
  }
  return saldo;
}

// ─────────────────────────────────────────────
// CARTERA - CREACIÓN (llamado desde procesarVenta o manualmente para CxP)
// ─────────────────────────────────────────────

/**
 * Crea un registro de cartera.
 * @param {string} idTercero
 * @param {string} origenId    - ID de la venta (CxC) o entrada (CxP)
 * @param {number} total
 * @param {string} tipo        - "CxC" | "CxP"
 * @param {number} diasCredito - días para vencimiento (default 30)
 */
function crearCartera_(idTercero, origenId, total, tipo, diasCredito) {
  // Función interna, llamar siempre dentro de un lock externo
  const tercero = getTerceros().find((t) => t.id === String(idTercero).trim());
  if (!tercero) throw new Error(`Tercero ${idTercero} no existe.`);

  if (tipo === CARTERA_CONFIG.TIPOS.CXC) {
    const saldoActual = getSaldoTercero(idTercero);
    if (tercero.limite_credito > 0 && (saldoActual + total) > tercero.limite_credito) {
      throw new Error(
        `Límite de crédito superado para ${tercero.nombre}. ` +
        `Disponible: $${(tercero.limite_credito - saldoActual).toLocaleString("es-CO")}`
      );
    }
  }

  const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
  const idCartera = (tipo === CARTERA_CONFIG.TIPOS.CXC ? "CXC" : "CXP")
    + Date.now()
    + Utilities.getUuid().replace(/-/g, "").slice(0, 6).toUpperCase();
  const fecha = new Date();
  const fVenc = new Date();
  fVenc.setDate(fVenc.getDate() + (parseInt(diasCredito) || 30));

  sheet.appendRow([
    idCartera,
    fecha,
    idTercero,
    origenId,
    total,
    total,                              // saldo inicial = total
    tipo,
    CARTERA_CONFIG.ESTADOS.ABIERTA,
    fVenc,
  ]);

  return idCartera;
}

// ─────────────────────────────────────────────
// ABONOS (FIFO)
// ─────────────────────────────────────────────

/**
 * Registra un abono de un tercero.
 * Aplica FIFO: primero la deuda más antigua con saldo > 0.
 * REFACTORIZADO v2.0: Evita redeclaraciones internas, lógica FIFO centralizada, atomic writes.
 *
 * @param {string} idTercero
 * @param {number} valorAbono
 * @param {string} referencia  - Descripción del pago (ej: "Transferencia", "Efectivo")
 * @param {string} tipo        - "CxC" (cobrar) | "CxP" (pagar)
 */
function registrarAbono(idTercero, valorAbono, referencia, tipo) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(CARTERA_CONFIG.LOCK_TIMEOUT);
    if (!lockAcquired) return _error('Servidor ocupado. Intenta de nuevo.');

    // ─ VALIDACIONES TEMPRANAS ─
    const valor = _parseNumber(valorAbono, NaN);
    if (isNaN(valor) || valor <= 0) return _error('Valor de abono inválido.');

    const idTerceroLimpio = String(idTercero).trim();
    if (!idTerceroLimpio) return _error('ID de tercero inválido.');

    const tipoLimpio = tipo === CARTERA_CONFIG.TIPOS.CXP
      ? CARTERA_CONFIG.TIPOS.CXP : CARTERA_CONFIG.TIPOS.CXC;
    
    const refLimpia = String(referencia || "Abono").trim().substring(0, 100);

    // ─ LECTURA ÚNICA DE SHEETS ─
    const sheetCartera = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const sheetMov     = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
    const dataCartera  = sheetCartera.getDataRange().getValues();
    const COL          = CARTERA_CONFIG.COLUMNS.CARTERA;

    if (!dataCartera || dataCartera.length <= 1) 
      return _error('Cartera vacía.');

    // ─ CONSTRUIR PENDIENTES EN MEMORY (1 PASS) ─
    const pendientes = [];
    for (let i = 1; i < dataCartera.length; i++) {
      const row = dataCartera[i];
      
      // Validar que la fila tenga datos
      if (!row[COL.id]) continue;

      // Validar que sea del tercero correcto, tipo correcto, y tenga saldo
      if (
        String(row[COL.id_tercero]).trim() !== idTerceroLimpio ||
        String(row[COL.tipo]).trim()       !== tipoLimpio ||
        String(row[COL.estado]).trim()     === CARTERA_CONFIG.ESTADOS.CANCELADA
      ) {
        continue;
      }

      const saldo = _parseNumber(row[COL.saldo], 0);
      if (saldo <= 0) continue;

      // Parsear fecha de forma segura (validar isNaN)
      let fechaRow = row[COL.fecha];
      if (!(fechaRow instanceof Date)) {
        fechaRow = new Date(fechaRow);
      }
      // Si la fecha es inválida, usar epoch (0) para que aparezca first en FIFO
      if (!_isValidDate(fechaRow)) {
        fechaRow = new Date(0);
      }

      pendientes.push({
        rowIndex: i + 1,
        idCartera: String(row[COL.id]).trim(),
        saldo: saldo,
        fecha: fechaRow,
        estado: String(row[COL.estado] || "").trim(),
      });
    }

    if (pendientes.length === 0)
      return _error("Este tercero no tiene cartera pendiente de ese tipo.");

    // ─ ORDENAR FIFO (fecha asc, luego rowIndex asc) ─
    pendientes.sort((a, b) => {
      const cmpFecha = a.fecha.getTime() - b.fecha.getTime();
      return cmpFecha !== 0 ? cmpFecha : a.rowIndex - b.rowIndex;
    });

    // ─ VALIDAR QUE ABONO NO SUPERE TOTAL DEUDA ─
    const totalDeuda = pendientes.reduce((sum, p) => sum + p.saldo, 0);
    if (valor > totalDeuda)
      return _error(
        `Abono ($${valor.toLocaleString("es-CO")}) supera deuda total ` +
        `($${totalDeuda.toLocaleString("es-CO")}).`
      );

    // ─ APLICAR FIFO EN MEMORIA (1 PASS) ─
    const movimientos = [];
    const cambiosSaldosEstados = [];  // Guardar índices y nuevos valores
    let restante = valor;
    const fechaMov = new Date();
    const idPrefijo = "MOV" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 6).toUpperCase();

    for (let idx = 0; idx < pendientes.length && restante > 0; idx++) {
      const p = pendientes[idx];
      const aplicado = Math.min(restante, p.saldo);
      const nuevoSaldo = p.saldo - aplicado;
      const nuevoEstado = nuevoSaldo <= 0
        ? CARTERA_CONFIG.ESTADOS.CANCELADA
        : CARTERA_CONFIG.ESTADOS.PARCIAL;

      // Guardar cambio para batch write
      cambiosSaldosEstados.push({
        rowIndex: p.rowIndex,
        nuevoSaldo: nuevoSaldo,
        nuevoEstado: nuevoEstado,
      });

      // Crear movimiento
      movimientos.push([
        idPrefijo + "_" + idx,  // ID único por movimiento
        fechaMov,
        p.idCartera,
        idTerceroLimpio,
        aplicado,
        aplicado >= p.saldo ? "CANCELACION" : "ABONO",
        refLimpia,
      ]);

      restante -= aplicado;
    }

    // ─ VALIDAR CONSISTENCIA (cantidad de movimientos = cantidad de cambios)
    if (movimientos.length !== cambiosSaldosEstados.length)
      throw new Error("Error interno: inconsistencia en aplicación de FIFO");

    // ─ ESCRITURA BATCH ATÓMICA ─
    // Primero: Movimientos (no afecta cartera vigente)
    if (movimientos.length > 0) {
      const lastRow = sheetMov.getLastRow();
      sheetMov.getRange(lastRow + 1, 1, movimientos.length, 7).setValues(movimientos);
    }

    // Segundo: Saldos y Estados en UNA SOLA OPERACIÓN DE MEMORIA
    // Actualizar dataCartera en memoria
    for (const cambio of cambiosSaldosEstados) {
      dataCartera[cambio.rowIndex - 1][COL.saldo] = cambio.nuevoSaldo;
      dataCartera[cambio.rowIndex - 1][COL.estado] = cambio.nuevoEstado;
    }

    // Escribir AMBAS columnas en batch (2 operaciones relacionadas)
    const rangeSaldosEstados = sheetCartera.getRange(2, COL.saldo + 1, dataCartera.length - 1, 2);
    const valoresSaldosEstados = [];
    for (let i = 1; i < dataCartera.length; i++) {
      valoresSaldosEstados.push([
        dataCartera[i][COL.saldo],
        dataCartera[i][COL.estado]
      ]);
    }
    rangeSaldosEstados.setValues(valoresSaldosEstados);

    SpreadsheetApp.flush();

    return {
      success:  true,
      aplicado: valor - restante,
      restante: Math.max(0, restante),
      movimientos: movimientos.length,
    };

  } catch (e) {
    Logger.log("ERROR registrarAbono: " + e.toString());
    return { success: false, message: String(e && e.message ? e.message : e.toString()) };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}
// ─────────────────────────────────────────────

/**
 * procesarVenta extendida v2.0
 * MEJORAS:
 * - Índice O(1) para búsqueda de stock (evita O(n*m))
 * - Validación de límite de crédito PROTEGIDA por lock
 * - Transacción atómica: stock + venta + cartera
 *
 * @param {Array}  carrito
 * @param {Object} opciones  - { tipo: "contado"|"credito", idTercero: string, diasCredito: number }
 */
function procesarVentaV2(carrito, opciones) {
  if (!carrito || carrito.length === 0)
    return { success: false, message: "Carrito vacío." };

  const opt          = opciones || {};
  const esCredito    = opt.tipo === "credito";
  const idTercero    = String(opt.idTercero || "").trim();
  const diasCredito  = parseInt(opt.diasCredito) || 30;

  if (esCredito && !idTercero)
    return { success: false, message: "Venta a crédito requiere seleccionar un cliente." };

  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(CARTERA_CONFIG.LOCK_TIMEOUT);
    if (!lockAcquired) return _error('Servidor ocupado: error de concurrencia.');

    const sheetVentas  = getSheet(CONFIG.SHEETS.VENTAS);
    const sheetDetalle = getSheet(CONFIG.SHEETS.DETALLE_VENTAS);
    const sheetStock   = getSheet(CONFIG.SHEETS.PRODUCTOS);

    const dataStock = sheetStock.getDataRange().getValues();
    const idVenta   = "V" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 6).toUpperCase();
    const fecha     = new Date();
    let totalVenta  = 0;
    const filasDetalle = [];

    // ─ CREAR ÍNDICE O(1) PARA BÚSQUEDA DE STOCK ─
    const stockIndex = {};
    for (let i = 0; i < dataStock.length; i++) {
      const idProducto = String(dataStock[i][0] || "").trim();
      if (idProducto) {
        stockIndex[idProducto] = i;
      }
    }

    // ─ VALIDAR STOCK Y CALCULAR TOTAL ─
    for (const item of carrito) {
      const keyProducto = String(item.id_producto || "").trim();
      const idxStock = stockIndex[keyProducto];
      
      if (typeof idxStock === 'undefined' || idxStock === -1) {
        throw new Error(`Producto ${item.nombre || keyProducto} ya no existe.`);
      }

      const stockActual = parseInt(dataStock[idxStock][2]) || 0;
      if (stockActual < item.cantidad) {
        throw new Error(`Stock insuficiente para ${item.nombre || keyProducto}.`);
      }

      dataStock[idxStock][2] = stockActual - item.cantidad;
      totalVenta += item.cantidad * item.precio;
      filasDetalle.push([idVenta, item.id_producto, item.cantidad, item.precio]);
    }

    // ─ SI ES CRÉDITO: VALIDAR LÍMITE CON DATOS FRESCOS DENTRO DEL LOCK ─
    if (esCredito) {
      // Re-leer terceros y cartera dentro del lock para datos consistentes
      const tercero = getTerceros().find((t) => t.id === _sanitizeId(idTercero));
      if (!tercero) {
        throw new Error("Cliente no encontrado.");
      }

      if (tercero.limite_credito > 0) {
        const saldoActual = getSaldoTercero(idTercero);
        const saldoNuevo = saldoActual + totalVenta;
        if (saldoNuevo > tercero.limite_credito) {
          throw new Error(
            `Límite de crédito superado para ${tercero.nombre}. ` +
            `Deuda actual: $${saldoActual.toLocaleString("es-CO")}, ` +
            `Venta: $${totalVenta.toLocaleString("es-CO")}, ` +
            `Límite: $${tercero.limite_credito.toLocaleString("es-CO")}.`
          );
        }
      }
    }

    // ─ ESCRITURA BATCH ATÓMICA ─
    // 1. Actualizar stock
    if (dataStock.length > 0 && dataStock[0].length >= 4) {
      sheetStock.getRange(1, 1, dataStock.length, dataStock[0].length).setValues(dataStock);
    }

    // 2. Escribir detalles de venta
    if (filasDetalle.length > 0) {
      sheetDetalle.getRange(sheetDetalle.getLastRow() + 1, 1, filasDetalle.length, 4).setValues(filasDetalle);
    }

    // 3. Escribir venta
    sheetVentas.appendRow([idVenta, fecha, totalVenta]);

    // 4. Si es crédito: crear registro en Cartera
    if (esCredito) {
      crearCartera_(idTercero, idVenta, totalVenta, CARTERA_CONFIG.TIPOS.CXC, diasCredito);
    }

    SpreadsheetApp.flush();
    return { success: true, id: idVenta, total: totalVenta, credito: esCredito };

  } catch (e) {
    Logger.log("ERROR procesarVentaV2: " + e.toString());
    return { success: false, message: String(e && e.message ? e.message : e.toString()) };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

// ─────────────────────────────────────────────
// CxP MANUAL (compras a crédito con proveedor)
// ─────────────────────────────────────────────

/**
 * Registra una deuda con proveedor (CxP).
 * Llamar después de registrar la entrada de inventario.
 * @param {string} idProveedor
 * @param {string} origenId      - ID de la entrada en hoja Entradas
 * @param {number} total
 * @param {number} diasCredito
 */
function registrarCxP(idProveedor, origenId, total, diasCredito) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(CARTERA_CONFIG.LOCK_TIMEOUT);
    if (!lockAcquired) return _error('Servidor ocupado.');

    const totalLimpio = _parseNumber(total, NaN);
    if (isNaN(totalLimpio) || totalLimpio <= 0) return _error('Monto inválido.');

    const idCartera = crearCartera_(
      _sanitizeId(idProveedor),
      String(origenId).trim(),
      totalLimpio,
      CARTERA_CONFIG.TIPOS.CXP,
      parseInt(diasCredito) || 30,
    );

    SpreadsheetApp.flush();
    return { success: true, id: idCartera };
  } catch (e) {
    return { success: false, message: String(e && e.message ? e.message : e.toString()) };
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

// ─────────────────────────────────────────────
// TRIGGER DIARIO — PERSISTIR ESTADO VENCIDA EN HOJA
// Configurar: Apps Script → Triggers → actualizarVencimientos → Temporizado → Cada día
// ─────────────────────────────────────────────

/**
 * Recorre la hoja Cartera y persiste el estado VENCIDA en las filas que correspondan.
 * Antes el estado solo se calculaba en memoria → reportes externos veían datos incorrectos.
 * Con este trigger el estado queda guardado en Sheets y es consistente siempre.
 */
function actualizarVencimientos() {
  try {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const data  = sheet.getDataRange().getValues();
    if (!data || data.length <= 1) return;

    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    let updatedCount = 0;
    // Actualizar en memoria y escribir en batch
    // Preparar nuevo estado para cada fila en memoria y escribir la columna en batch
    const nuevosEstados = [];
    let cambios = 0;
    for (let i = 1; i < data.length; i++) {
      let estado = String(data[i][COL.estado] || "").trim();
      if (estado === CARTERA_CONFIG.ESTADOS.CANCELADA) {
        nuevosEstados.push([estado]);
        continue;
      }

      const saldo = parseFloat(data[i][COL.saldo]) || 0;
      if (saldo <= 0) {
        nuevosEstados.push([estado]);
        continue;
      }

      let fVenc = data[i][COL.fecha_vencimiento];
      fVenc = fVenc instanceof Date ? fVenc : new Date(fVenc);
      if (isNaN(fVenc.getTime())) {
        nuevosEstados.push([estado]);
        continue;
      }

      fVenc.setHours(0, 0, 0, 0);
      if (fVenc < hoy && estado !== CARTERA_CONFIG.ESTADOS.VENCIDA) {
        nuevosEstados.push([CARTERA_CONFIG.ESTADOS.VENCIDA]);
        cambios++;
      } else {
        nuevosEstados.push([estado]);
      }
    }

    if (cambios > 0) {
      sheet.getRange(2, COL.estado + 1, nuevosEstados.length, 1).setValues(nuevosEstados);
      SpreadsheetApp.flush();
      Logger.log(`actualizarVencimientos: ${cambios} registros marcados como VENCIDA.`);
    }
  } catch (e) {
    Logger.log("ERROR actualizarVencimientos: " + e.toString());
  }
}



function getDashboardCartera() {
  try {
    const hoy       = new Date(); hoy.setHours(0, 0, 0, 0);
    const cartera   = getCartera();

    const cxc       = cartera.filter((c) => c.tipo === CARTERA_CONFIG.TIPOS.CXC);
    const cxp       = cartera.filter((c) => c.tipo === CARTERA_CONFIG.TIPOS.CXP);

    const porCobrar = cxc
      .filter((c) => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
      .reduce((a, c) => a + c.saldo, 0);

    const porPagar  = cxp
      .filter((c) => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
      .reduce((a, c) => a + c.saldo, 0);

    const vencidaCxC = cxc
      .filter((c) => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
      .reduce((a, c) => a + c.saldo, 0);

    const vencidaCxP = cxp
      .filter((c) => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
      .reduce((a, c) => a + c.saldo, 0);

    // Alertas: CxC vencidas
    const alertas = cxc
      .filter((c) => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
      .sort((a, b) => b.dias_vencido - a.dias_vencido)
      .slice(0, 10)
      .map((c) => ({
        id_tercero: c.id_tercero,
        saldo:      c.saldo,
        dias:       c.dias_vencido,
        origen:     c.origen_id,
      }));

    return {
      porCobrar,
      porPagar,
      vencidaCxC,
      vencidaCxP,
      alertas,
      totalObligaciones: cxc.length + cxp.length,
    };
  } catch (e) {
    Logger.log("ERROR getDashboardCartera: " + e.toString());
    return { porCobrar: 0, porPagar: 0, vencidaCxC: 0, vencidaCxP: 0, alertas: [], totalObligaciones: 0 };
  }
}

// ─────────────────────────────────────────────
// EXTENSIÓN DEL ANÁLISIS GEMINI
// Reemplaza analizarVentasConGemini() en Codigo.gs
// ─────────────────────────────────────────────

function analizarConGeminiCompleto() {
  try {
    const dashboard        = getDashboard();
    const dashboardCartera = getDashboardCartera();
    const props  = PropertiesService.getScriptProperties();
    const apiKey = (props.getProperty("GEMINI_API_KEY") || "").trim();

    if (!apiKey)
      return { success: false, message: "Configura la API Key de Gemini en las Propiedades del Script." };

    const prompt = `
Actúa como un asesor financiero y operativo para una microempresa en Latinoamérica.

Analiza la información y entrega un diagnóstico claro, accionable y sin relleno.

DATOS:

VENTAS DEL DÍA:
- Total: $${dashboard.ventasHoy}
- Transacciones: ${dashboard.transaccionesHoy}
- Utilidad estimada: $${dashboard.utilidad} (${dashboard.margenPorcentaje}%)

INVENTARIO:
- Unidades en stock: ${dashboard.stockTotal}
- Valor inventario: $${dashboard.valorStock}

CARTERA:
- Por cobrar (CxC): $${dashboardCartera.porCobrar}
- CxC vencida: $${dashboardCartera.vencidaCxC}
- Por pagar (CxP): $${dashboardCartera.porPagar}
- CxP vencida: $${dashboardCartera.vencidaCxP}

ALERTAS:
${JSON.stringify(dashboardCartera.alertas.slice(0, 5))}

PRODUCTOS TOP:
${JSON.stringify(getProductos().slice(0, 10))}

RESPONDE EXACTAMENTE EN ESTE FORMATO:

📊 Diagnóstico general (máx 3 líneas):
- ...

⚠️ Riesgos críticos:
- ...

💡 Acciones recomendadas (máx 3):
- ...

📈 Oportunidades:
- ...

REGLAS INTERNAS:
- Prioriza problemas de flujo de caja
- Detecta cartera vencida como riesgo principal
- Si utilidad es baja, menciona costos o precios a revisar
- Si hay mucha cartera vencida, enfócate en cobranza
- Sin relleno, máximo 2 líneas por punto
- Lenguaje claro, directo y accionable para un vendedor/admin
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
    const res = UrlFetchApp.fetch(url, {
      method:      "post",
      contentType: "application/json",
      payload:     JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() === 429)
      return { success: false, message: "Límite de cuota IA. Reintenta en breve." };
    if (res.getResponseCode() !== 200)
      return { success: false, message: "Error de conexión con IA." };

    const json = JSON.parse(res.getContentText());
    return { success: true, analisis: json.candidates[0].content.parts[0].text };
  } catch (e) {
    return { success: false, message: "Error en el servicio de IA." };
  }
}

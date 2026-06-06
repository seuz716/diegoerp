/**
 * LAYER 3: SERVICIOS / LÓGICA DE NEGOCIO
 * Contiene funciones de alto nivel que orquestan las operaciones del DAO.
 */

/**
 * Procesa una venta, ya sea al contado o a crédito.
 * @param {Array<Object>} carrito Lista de productos en el carrito.
 * @param {Object} opciones Opciones de la venta (e.g., tipo, idTercero, diasCredito).
 * @returns {Object} Resultado de la operación.
 */
function procesarVentaV2(carrito, opciones) {
  // TODO: Implementar lógica real de procesamiento de venta
  console.warn("procesarVentaV2: Función no implementada completamente. Retornando éxito simulado.");
  return { success: true, message: "Venta procesada (simulado)" };
}

/**
 * Persiste físicamente el estado VENCIDA en la hoja Cartera.
 * Barre todas las filas no-CANCELADA y sincroniza COL.estado con la realidad
 * de fecha_vencimiento vs hoy. También revierte VENCIDA stale cuando la fecha
 * de vencimiento fue extendida (infiriendo ABIERTA/PARCIAL del saldo).
 * @returns {Object} { success, marcados, revertidos, timestamp }
 */
function actualizarVencimientos() {
  const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
  const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
  const numCols = Math.max(...Object.values(COL)) + 1;
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return { success: true, marcados: 0, revertidos: 0, timestamp: new Date().toISOString() };

  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const hoy = _today();
  const cambios = [];
  let marcados = 0;
  let revertidos = 0;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const estadoActual = String(row[COL.estado] || "").trim();

    if (estadoActual === CARTERA_CONFIG.ESTADOS.CANCELADA) continue;

    const fv = _safeDate(row[COL.fecha_vencimiento]);
    if (fv.getTime() <= 0) continue;

    const estaVencido = fv.getTime() < hoy.getTime();

    if (estaVencido && estadoActual !== CARTERA_CONFIG.ESTADOS.VENCIDA) {
      cambios.push({
        rowIndex: i + 2,
        saldo: _parseMoneda(row[COL.saldo], 0),
        estado: CARTERA_CONFIG.ESTADOS.VENCIDA,
      });
      marcados++;
    } else if (!estaVencido && estadoActual === CARTERA_CONFIG.ESTADOS.VENCIDA) {
      const total = _parseMoneda(row[COL.total], 0);
      const saldo = _parseMoneda(row[COL.saldo], 0);
      const nuevoEstado = saldo < total
        ? CARTERA_CONFIG.ESTADOS.PARCIAL
        : CARTERA_CONFIG.ESTADOS.ABIERTA;
      cambios.push({ rowIndex: i + 2, saldo, estado: nuevoEstado });
      revertidos++;
    }
  }

  if (cambios.length > 0) {
    DOMAIN.actualizarCarteraBatch(cambios);
    LOG_ENGINE.logEvent("VENCIMIENTOS_ACTUALIZADOS", "CARTERA", "BATCH",
      {}, { marcados, revertidos }, "SUCCESS");
  }

  return { success: true, marcados, revertidos, timestamp: new Date().toISOString() };
}

/**
 * Crea un trigger diario (2:00 AM) para actualizarVencimientos().
 * Ejecutar UNA vez desde el editor de Apps Script.
 */
function crearTriggerVencimientos() {
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
 * Elimina todos los triggers de actualizarVencimientos.
 */
function eliminarTriggerVencimientos() {
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
 * Obtiene una lista de todos los terceros.
 * @returns {Array<Object>} Lista de terceros.
 */
function getTerceros() {
  // TODO: Implementar lógica real para obtener terceros del DAO/CACHE
  console.warn("getTerceros: Función no implementada completamente. Retornando array vacío simulado.");
  // Para que el test_crearTercero pase el mock global getTerceros se usa en el test
  // Esta implementación real debería buscar en el CACHE o DAO.
  return []; 
}

/**
 * Registra un abono a la cartera de un tercero.
 * @param {string} idTercero ID del tercero.
 * @param {number} valorAbono Valor del abono.
 * @param {string} referencia Referencia del abono.
 * @param {string} tipoCartera Tipo de cartera (CxC o CxP).
 * @returns {Object} Resultado de la operación.
 */
function _registrarAbonoServicio(idTercero, valorAbono, referencia, tipoCartera) {
  // TODO: Implementar lógica real de registro de abono
  console.warn("_registrarAbonoServicio: Función no implementada completamente. Retornando éxito simulado.");
  return { success: true, message: "Abono registrado (simulado)" };
}

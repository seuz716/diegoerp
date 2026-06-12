/**
 * LAYER 2: LOGGING ENGINE — AUDITORÍA INMUTABLE
 */

const MAX_LOG_ROWS = 5000;

const LOG_ENGINE = {
  /**
   * Registra cambio en hoja.
   * INMUTABLE: append-only
   */
  logEvent(operacion, tabla, idRegistro, datosPrevios, datosNuevos, estado = "SUCCESS") {
    try {
      const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);

      const usuario = Session.getActiveUser().getEmail();
      const timestamp = new Date();
      const id = "LOG_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);

      const rowData = [
        _sanitizeCell(id),
        timestamp,
        _sanitizeCell(operacion),
        _sanitizeCell(tabla),
        _sanitizeCell(idRegistro),
        _sanitizeCell(usuario),
        _sanitizeCell(JSON.stringify(_sanitizeForLog(datosPrevios || {}))),
        _sanitizeCell(JSON.stringify(_sanitizeForLog(datosNuevos || {}))),
        _sanitizeCell(estado),
      ];

      // BATCH: no appendRow, sino getLastRow + setValues
      const lastRow = sheetAudit.getLastRow() || 0;
      if (lastRow === 0) {
        sheetAudit.appendRow(["ID", "Timestamp", "Operacion", "Tabla", "ID_Registro", "Usuario", "Datos_Previos", "Datos_Nuevos", "Estado"]);
      }
      sheetAudit.getRange(sheetAudit.getLastRow() + 1, 1, 1, 9).setValues([rowData]);

      // === INICIO FIX C-03 ===
      // Purge con lock para evitar race condition
      const totalRows = sheetAudit.getLastRow();
      if (totalRows > MAX_LOG_ROWS + 100) {
        let lock = null;
        try {
          lock = LOCK_MANAGER.acquireGlobalLock(5000);
          Logger.log("[FIX-C-03] Lock adquirido para purge de AuditLog");
          const currentTotal = sheetAudit.getLastRow();
          if (currentTotal > MAX_LOG_ROWS + 100) {
            const rowsToDelete = currentTotal - MAX_LOG_ROWS;
            sheetAudit.deleteRows(2, rowsToDelete);
            Logger.log("[FIX-C-03] Purge completado: " + rowsToDelete + " filas borradas");
          }
        } catch (lockErr) {
          Logger.log("[FIX-C-03] WARNING: No se pudo adquirir lock para purge: " + lockErr.message);
        } finally {
          if (lock) lock.releaseLock();
        }
      }
      // === FIN FIX C-03 ===

      return true;
    } catch (e) {
      Logger.log("ERROR LOG_ENGINE:" + e.toString());
      return false;
    }
  },

  /**
   * Obtiene log de un registro
   */
  getHistory(tabla, idRegistro, limit = 50) {
    try {
      const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
      if (!sheetAudit) return [];

      const data = sheetAudit.getDataRange().getValues();
      const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;

      return data.slice(1)
        .filter(r => String(r[COL.tabla]).trim() === tabla && String(r[COL.id_registro]).trim() === idRegistro)
        .map(r => ({
          id: String(r[COL.id]).trim(),
          timestamp: r[COL.timestamp],
          operacion: String(r[COL.operacion]).trim(),
          usuario: String(r[COL.usuario]).trim(),
          previos: JSON.parse(r[COL.datos_previos] || "{}"),
          nuevos: JSON.parse(r[COL.datos_nuevos] || "{}"),
          estado: String(r[COL.estado]).trim(),
        }))
        .slice(-limit)
        .reverse();
    } catch (e) {
      Logger.log("ERROR LOG_ENGINE.getHistory:" + e.toString());
      return [];
    }
  },
};

function _sanitizeForLog(obj) {
  if (obj === null || obj === undefined) return {};
  const sensitiveKeys = ['api_key', 'password', 'token', 'secret', 'authorization'];
  let safe;
  try {
    safe = JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return { error: "[SERIALIZATION_FAILED]" };
  }
  const sanitize = (o) => {
    if (!o || typeof o !== 'object') return;
    for (let key in o) {
      if (Object.prototype.hasOwnProperty.call(o, key)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
          o[key] = '[REDACTED]';
        } else if (o[key] && typeof o[key] === 'object') {
          sanitize(o[key]);
        }
      }
    }
  };
  sanitize(safe);
  return safe;
}

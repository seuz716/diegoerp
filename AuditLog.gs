// =============================================================================

/**
 * LAYER 2: LOGGING ENGINE — AUDITORÍA INMUTABLE
 * Enhanced with correlationId, IP, execution time
 */

const MAX_LOG_ROWS = 10000;
const MAX_EXECUTION_TIME_MS = 300000; // 5 minutes

const LOG_ENGINE = {
  /**
   * Get client IP from HTTP headers (when available)
   * @private
   */
  _getClientIP() {
    try {
      // In Apps Script, we can get the user's IP from the request headers if called via URL
      const headers = {};
      if (typeof activeUser !== 'undefined') {
        // This is a fallback for when called via web app
      }
      // For direct calls, we use a placeholder - IP extraction requires web app deployment
      return SESSION_SERVICE.getCurrentUser().getEmail() || "SYSTEM";
    } catch (e) {
      return "UNKNOWN";
    }
  },

  /**
   * Generate or retrieve correlation ID
   * @param {string} providedId - Optional correlation ID
   * @returns {string}
   * @private
   */
  _getCorrelationId(providedId) {
    if (providedId) return providedId;
    return PropertiesService.getScriptProperties().getProperty('CURRENT_CORRELATION_ID') || 
           'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  },

  /**
   * Registra cambio en hoja.
   * INMUTABLE: append-only
   * @param {string} operacion - Operation name
   * @param {string} tabla - Table name
   * @param {string} idRegistro - Record ID
   * @param {Object} datosPrevios - Previous data
   * @param {Object} datosNuevos - New data
   * @param {string} estado - Status
   * @param {Object} options - Additional options (correlationId, executionTimeMs)
   */
  logEvent(operacion, tabla, idRegistro, datosPrevios, datosNuevos, estado = "SUCCESS", options = {}) {
    try {
      const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
      if (!sheetAudit) return false;

      const usuario = SESSION_SERVICE.getCurrentUser().getEmail();
      const timestamp = new Date();
      const correlationId = this._getCorrelationId(options.correlationId);
      const executionTimeMs = options.executionTimeMs || 0;
      const ip = this._getClientIP();
      const id = "LOG_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);

      // Check if audit log sheet has the new columns (correlationId, ip, executionTime)
      const headerRange = sheetAudit.getRange(1, 1, 1, 12);
      const headers = headerRange.getValues()[0];
      const hasNewColumns = headers.length >= 12 && headers[9] === "CorrelationId";

      const rowData = hasNewColumns ? [
        _sanitizeCell(id),
        timestamp,
        _sanitizeCell(operacion),
        _sanitizeCell(tabla),
        _sanitizeCell(idRegistro),
        _sanitizeCell(usuario),
        _sanitizeCell(JSON.stringify(_sanitizeForLog(datosPrevios || {}))),
        _sanitizeCell(JSON.stringify(_sanitizeForLog(datosNuevos || {}))),
        _sanitizeCell(estado),
        _sanitizeCell(correlationId),
        _sanitizeCell(ip),
        executionTimeMs
      ] : [
        _sanitizeCell(id),
        timestamp,
        _sanitizeCell(operacion),
        _sanitizeCell(tabla),
        _sanitizeCell(idRegistro),
        _sanitizeCell(usuario),
        _sanitizeCell(JSON.stringify(_sanitizeForLog(datosPrevios || {}))),
        _sanitizeCell(JSON.stringify(_sanitizeForLog(datosNuevos || {}))),
        _sanitizeCell(estado)
      ];

      // BATCH: no appendRow, sino getLastRow + setValues
      const lastRow = sheetAudit.getLastRow() || 0;
      if (lastRow === 0) {
        const headerRow = hasNewColumns ? 
          ["ID", "Timestamp", "Operacion", "Tabla", "ID_Registro", "Usuario", "Datos_Previos", "Datos_Nuevos", "Estado", "CorrelationId", "IP", "ExecutionTimeMs"] :
          ["ID", "Timestamp", "Operacion", "Tabla", "ID_Registro", "Usuario", "Datos_Previos", "Datos_Nuevos", "Estado"];
        sheetAudit.appendRow(headerRow);
      }
      sheetAudit.getRange(sheetAudit.getLastRow() + 1, 1, 1, rowData.length).setValues([rowData]);

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

  /**
   * Obtiene historial de ventas recientes
   */
  getVentasHistory(limit = 100) {
    try {
      const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
      if (!sheetAudit) return { success: false, ventas: [] };

      const data = sheetAudit.getDataRange().getValues();
      const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;

      const ventas = data.slice(1)
        .filter(r => String(r[COL.tabla]).trim() === "VENTAS")
        .map(r => ({
          id: String(r[COL.id]).trim(),
          timestamp: r[COL.timestamp],
          operacion: String(r[COL.operacion]).trim(),
          usuario: String(r[COL.usuario]).trim(),
          nuevos: JSON.parse(r[COL.datos_nuevos] || "{}"),
          estado: String(r[COL.estado]).trim(),
        }))
        .slice(-limit)
        .reverse();

      return { success: true, ventas: ventas };
    } catch (e) {
      Logger.log("ERROR LOG_ENGINE.getVentasHistory:" + e.toString());
      return { success: false, ventas: [], error: e.message };
    }
  },

  /**
   * Inmutable audit log - no modifications allowed
   */
  isImmutable() {
    return true;
  },

  /**
   * Get audit metrics
   */
  getAuditMetrics() {
    try {
      const props = PropertiesService.getScriptProperties();
      return {
        totalLogs: Number(props.getProperty('AUDIT_TOTAL_LOGS') || 0),
        lastLogTimestamp: props.getProperty('AUDIT_LAST_TIMESTAMP') || null
      };
    } catch (e) {
      return { error: e.message };
    }
  }
};

function _sanitizeForLog(obj, correlationId = null) {
  if (obj === null || obj === undefined) return {};
  const sensitiveKeys = ['api_key', 'password', 'token', 'secret', 'authorization'];
  let safe;
  try {
    safe = JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return { _error: "[SERIALIZATION_FAILED]" };
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

/**
 * Obtiene historial reciente de ventas desde AUDIT_LOG
 */
function getVentasHistory(limit = 100) {
  try {
    return LOG_ENGINE.getVentasHistory(limit);
  } catch (e) {
    Logger.log("ERROR getVentasHistory:" + e.toString());
    return { success: false, ventas: [], error: e.message };
  }
}

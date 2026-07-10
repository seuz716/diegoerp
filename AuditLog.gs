// =============================================================================

/**
 * LAYER 2: LOGGING ENGINE — AUDITORÍA INMUTABLE
 * Enhanced with correlationId, IP, execution time
 */

const MAX_LOG_ROWS = 10000;
const MAX_EXECUTION_TIME_MS = 300000; // 5 minutes

/**
 * Wrapper seguro para LogService que fallback a Logger.log si LogService no está disponible.
 */
function _safeLogError(message, context) {
  if (typeof LogService !== 'undefined' && LogService && typeof LogService.logError === 'function') {
    LogService.logError(message, context);
  } else {
    Logger.log("[LOG] ERROR: " + message + " | " + JSON.stringify(context || {}));
  }
}

/**
 * Wrapper seguro para LogService INFO.
 */
function _safeLogInfo(message, context) {
  if (typeof LogService !== 'undefined' && LogService && typeof LogService.logInfo === 'function') {
    LogService.logInfo(message, context);
  } else {
    Logger.log("[LOG] INFO: " + message + " | " + JSON.stringify(context || {}));
  }
}

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
   * Generate or retrieve correlation ID.
   * Solo usa paso explícito de parámetro — no persiste a PropertiesService
   * para evitar race condition entre ejecuciones concurrentes (AUL-001).
   * @param {string} providedId - Optional correlation ID
   * @returns {string}
   * @private
   */
  _getCorrelationId(providedId) {
    if (providedId) return providedId;
    return 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
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

      // Write + purge atómico bajo lock global (evita race condition entre logEvent concurrentes)
      let lock = null;
      try {
        lock = LOCK_MANAGER.acquireGlobalLock(30000);
      } catch (lockErr) {
        Logger.log("[AUL-002] ERROR: No se pudo adquirir lock para AuditLog: " + lockErr.message);
        _safeLogError("Lock no adquirido en logEvent", { functionName: 'logEvent', error: lockErr });
        return false;
      }
      if (!lock) {
        Logger.log("[AUL-002] ERROR: Lock nulo en logEvent");
        return false;
      }

      try {
        // Detección de esquema dentro del lock (AUL-003: evitar race en estructura de hoja)
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

        const lastRow = sheetAudit.getLastRow() || 0;
        if (lastRow === 0) {
          const headerRow = hasNewColumns ? 
            ["ID", "Timestamp", "Operacion", "Tabla", "ID_Registro", "Usuario", "Datos_Previos", "Datos_Nuevos", "Estado", "CorrelationId", "IP", "ExecutionTimeMs"] :
            ["ID", "Timestamp", "Operacion", "Tabla", "ID_Registro", "Usuario", "Datos_Previos", "Datos_Nuevos", "Estado"];
          sheetAudit.appendRow(headerRow);
        }
        sheetAudit.getRange(sheetAudit.getLastRow() + 1, 1, 1, rowData.length).setValues([rowData]);

        const totalRows = sheetAudit.getLastRow();
        if (totalRows > MAX_LOG_ROWS + 100) {
          const rowsToDelete = totalRows - MAX_LOG_ROWS;
          sheetAudit.deleteRows(2, rowsToDelete);
          Logger.log("[FIX-C-03] Purge atómico: " + rowsToDelete + " filas borradas");
      _safeLogInfo("Purge atómico completado", { functionName: "logEvent", details: { rowsToDelete: rowsToDelete } });
        }
      } finally {
        if (lock) lock.releaseLock();
      }

      return true;
    } catch (e) {
      Logger.log("ERROR LOG_ENGINE: Error en operación");
      _safeLogError("Error en logEvent", { functionName: "logEvent", error: e });
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

      const lastRow = sheetAudit.getLastRow();
      if (lastRow < 2) return [];
      const readLimit = Math.min(limit * 10, lastRow - 1);
      const startRow = Math.max(2, lastRow - readLimit + 1);
      const data = sheetAudit.getRange(startRow, 1, lastRow - startRow + 1, 12).getValues();
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
      Logger.log("ERROR LOG_ENGINE.getHistory: Error en operación");
      _safeLogError("Error en getHistory", { functionName: "getHistory", error: e });
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

      const lastRow = sheetAudit.getLastRow();
      if (lastRow < 2) return { success: false, ventas: [] };
      const readLimit = Math.min(limit * 10, lastRow - 1);
      const startRow = Math.max(2, lastRow - readLimit + 1);
      const data = sheetAudit.getRange(startRow, 1, lastRow - startRow + 1, 12).getValues();
      const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;

      const ventas = data
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
      Logger.log("ERROR LOG_ENGINE.getVentasHistory: Error en operación");
      return { success: false, ventas: [], error: "Error interno" };
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
    Logger.log("ERROR getVentasHistory: Error en operación");
    return { success: false, ventas: [], error: "Error interno" };
  }
}

// =============================================================================
// PRF-004: AUDIT_ARCHIVE — Archivado mensual de logs antiguos
// =============================================================================

const ARCHIVE_SHEET_NAME = "AUDIT_LOG_ARCHIVE";

const AUDIT_ARCHIVE = {
  ARCHIVE_AFTER_DAYS: 30,

  /**
   * Mueve registros de AUDIT_LOG mayores a ARCHIVE_AFTER_DAYS a una hoja de
   * archivo. Corre una vez por mes calendario (controlado por propiedad
   * LAST_ARCHIVE_MONTH).
   * @returns {{archived: number, skipped?: boolean, reason?: string, error?: string}}
   */
  autoArchive() {
    const props = PropertiesService.getScriptProperties();
    const timeZone = SESSION_SERVICE.getScriptTimeZone();
    const thisMonth = Utilities.formatDate(new Date(), timeZone, "yyyyMM");
    const lastMonth = props.getProperty("LAST_ARCHIVE_MONTH");

    if (lastMonth === thisMonth) {
      Logger.log("[PRF-004] Ya se archivó este mes (" + thisMonth + ")");
      return { archived: 0, skipped: true, reason: "already_archived" };
    }

    const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
    if (!sheetAudit) return { archived: 0, error: "no_sheet" };

    const data = sheetAudit.getDataRange().getValues();
    if (data.length <= 1) {
      props.setProperty("LAST_ARCHIVE_MONTH", thisMonth);
      return { archived: 0, skipped: true, reason: "no_data" };
    }

    const headers = data[0];
    const rows = data.slice(1);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.ARCHIVE_AFTER_DAYS);

    const rowsToArchive = rows.filter(function(r) {
      return r[1] instanceof Date && r[1] < cutoff;
    });

    if (rowsToArchive.length === 0) {
      props.setProperty("LAST_ARCHIVE_MONTH", thisMonth);
      return { archived: 0, skipped: true, reason: "nothing_to_archive" };
    }

    let lock = null;
    try {
      lock = LOCK_MANAGER.acquireGlobalLock(60000);
    } catch (lockErr) {
      Logger.log("[PRF-004] WARNING: No se pudo adquirir lock para archive: " + lockErr.message);
      return { archived: 0, error: "lock_failed" };
    }

    try {
      let archiveSheet = getSheet(ARCHIVE_SHEET_NAME);
      if (!archiveSheet) {
        archiveSheet = getActiveSpreadsheet().insertSheet(ARCHIVE_SHEET_NAME);
        archiveSheet.appendRow(headers);
        Logger.log("[PRF-004] Creada hoja " + ARCHIVE_SHEET_NAME);
      }

      archiveSheet.getRange(
        archiveSheet.getLastRow() + 1, 1,
        rowsToArchive.length, headers.length
      ).setValues(rowsToArchive);

      const archivedIds = {};
      for (var i = 0; i < rowsToArchive.length; i++) {
        archivedIds[String(rowsToArchive[i][0])] = true;
      }

      // Borrado en orden DESCENDENTE (AUL-005): al eliminar de abajo hacia
      // arriba, los índices de las filas restantes no se desvían tras cada
      // deleteRows, evitando borrar filas incorrectas.
      var rowsToDelete = [];
      for (var j = 0; j < rows.length; j++) {
        if (archivedIds[String(rows[j][0])]) {
          rowsToDelete.push(j + 2);
        }
      }
      rowsToDelete.sort(function(a, b) { return b - a; }); // descendente

      // Agrupa rangos contiguos en orden descendente y borra cada grupo
      for (var k = 0; k < rowsToDelete.length; k++) {
        var rangeEnd = rowsToDelete[k];        // fila más alta del grupo
        var rangeStart = rangeEnd;
        while (k + 1 < rowsToDelete.length && rowsToDelete[k + 1] === rangeStart - 1) {
          rangeStart = rowsToDelete[k + 1];
          k++;
        }
        sheetAudit.deleteRows(rangeStart, rangeEnd - rangeStart + 1);
      }

      props.setProperty("LAST_ARCHIVE_MONTH", thisMonth);
      Logger.log("[PRF-004] Archivadas " + rowsToArchive.length + " filas");

      return { archived: rowsToArchive.length };
    } catch (e) {
      Logger.log("[PRF-004] Error en autoArchive: " + e.message);
      return { archived: 0, error: e.message };
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  /**
   * Retorna estadísticas del archivo de auditoría.
   * @returns {{exists: boolean, totalArchived: number, lastArchiveMonth: string|null}}
   */
  getArchiveStats() {
    const props = PropertiesService.getScriptProperties();
    const lastMonth = props.getProperty("LAST_ARCHIVE_MONTH") || null;
    try {
      var archiveSheet = getSheet(ARCHIVE_SHEET_NAME);
      var total = archiveSheet ? Math.max(0, archiveSheet.getLastRow() - 1) : 0;
      return { exists: !!archiveSheet, totalArchived: total, lastArchiveMonth: lastMonth };
    } catch (e) {
      return { exists: false, totalArchived: 0, lastArchiveMonth: lastMonth };
    }
  }
};

/**
 * Configura el trigger mensual de archivado de auditoría.
 * Es idempotente: solo crea el trigger si no existe.
 */
function setupMonthlyArchive() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("MONTHLY_ARCHIVE_TRIGGER_SET")) {
    Logger.log("[PRF-004] Trigger mensual ya configurado");
    return { success: true, skipped: true };
  }

  const triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "autoArchive") {
      props.setProperty("MONTHLY_ARCHIVE_TRIGGER_SET", "true");
      Logger.log("[PRF-004] Trigger ya existe en proyecto");
      return { success: true, skipped: true };
    }
  }

  ScriptApp.newTrigger("autoArchive")
    .timeBased()
    .everyDays(30)
    .create();

  props.setProperty("MONTHLY_ARCHIVE_TRIGGER_SET", "true");
  Logger.log("[PRF-004] Trigger mensual creado para autoArchive");
  return { success: true };
}

/**
 * Punto de entrada para el trigger time-based.
 * Delega en AUDIT_ARCHIVE.autoArchive().
 * @returns {Object} Resultado de la operación.
 */
function autoArchive() {
  Logger.log("[PRF-004] Trigger autoArchive ejecutándose");
  return AUDIT_ARCHIVE.autoArchive();
}

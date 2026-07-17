/**
 * LOG SERVICE - Structured logging for observability
 * L-01: Writes logs to 'Logs' sheet with all required columns
 * L-02: Handles log levels correctly (INFO, WARN, ERROR)
 * L-03: Falls silently if sheet unavailable (uses console.log as fallback)
 */

const LogService = {
  LOG_SHEET_NAME: 'Logs',
  MAX_MESSAGE_LENGTH: 500,
  MAX_ROWS: 10000,
  COLUMNS: {
    TIMESTAMP: 0,
    LEVEL: 1,
    CORRELATION_ID: 2,
    FUNCTION: 3,
    USER: 4,
    MESSAGE: 5,
    DETAILS: 6
  },

  /**
   * Truncates message to MAX_MESSAGE_LENGTH, adding '...' suffix
   * @param {string} message - Message to truncate
   * @returns {string} Truncated message
   */
  _truncateMessage: function(message) {
    if (!message || message.length <= this.MAX_MESSAGE_LENGTH) {
      return message || '';
    }
    return message.substring(0, this.MAX_MESSAGE_LENGTH - 3) + '...';
  },

  /**
   * Sanitiza datos antes de escribirlos en logs, redactando secretos.
   * C3: Previene exposición de API keys, HMACs, tokens en logs.
   * @param {*} data - Valor a sanitizar (string, object, array).
   * @returns {*} Datos con secretos redactados.
   */
  _sanitizeForLog: function(data) {
    var secretPatterns = [
      /AIza[0-9A-Za-z_-]{20,}/g,           // Gemini API keys
      /Bearer\s+\S+/gi,                     // Bearer tokens
      /[0-9a-f]{64}(?!"|\]|')/gi,         // HMAC SHA-256 (64 hex chars)
    ];
    
    function sanitizeValue(val) {
      if (typeof val === 'string') {
        var sanitized = val;
        for (var i = 0; i < secretPatterns.length; i++) {
          sanitized = sanitized.replace(secretPatterns[i], '[REDACTED]');
        }
        // Remove URLs with embedded tokens
        sanitized = sanitized.replace(/https?:\/\/[^\s\]]+/g, '[URL_REDACTED]');
        return sanitized;
      }
      if (Array.isArray(val)) {
        return val.map(sanitizeValue);
      }
      if (val && typeof val === 'object') {
        var result = {};
        for (var key in val) {
          if (val.hasOwnProperty(key)) {
            var lowerKey = key.toLowerCase();
            if (lowerKey.indexOf('key') >= 0 || lowerKey.indexOf('secret') >= 0 || 
                lowerKey.indexOf('token') >= 0 || lowerKey.indexOf('authorization') >= 0) {
              result[key] = '[REDACTED]';
            } else {
              result[key] = sanitizeValue(val[key]);
            }
          }
        }
        return result;
      }
      return val;
    }
    
    return sanitizeValue(data);
  },

  /**
   * Ensures Logs sheet exists with proper headers
   * L-01: Auto-creates sheet if missing
   */
  _ensureSheet: function() {
    try {
      var ss = getActiveSpreadsheet();
      var sheet = ss.getSheetByName(this.LOG_SHEET_NAME);
      if (!sheet) {
        sheet = ss.insertSheet(this.LOG_SHEET_NAME);
        var headers = ['Timestamp', 'Level', 'CorrelationId', 'Function', 'User', 'Message', 'Details'];
        sheet.appendRow(headers);
      }
      return sheet;
    } catch (e) {
      return null;
    }
  },

  /**
   * Internal write method - handles failures silently
   * L-03: Fallback to console.log on write failure
   */
  _write: function(level, message, context) {
    try {
      var sheet = this._ensureSheet();
      if (!sheet) {
        console.log('[LogService] Fallback: ' + level + ' - ' + message);
        return false;
      }

      var totalRows = sheet.getLastRow();
      if (totalRows > this.MAX_ROWS + 5) {
        sheet.deleteRows(1, totalRows - this.MAX_ROWS);
      }

      var correlationId = (context && context.correlationId) ? context.correlationId : '';
      var functionName = (context && context.functionName) ? context.functionName : '';
      var user = '';
      try {
        user = SESSION_SERVICE.getCurrentUser().getEmail();
      } catch (e) {
        user = 'SYSTEM';
      }

      var details = '';
      if (context && context.details) {
        var sanitized = this._sanitizeForLog(context.details);
        details = typeof sanitized === 'object' ? JSON.stringify(sanitized) : String(sanitized);
        details = this._truncateMessage(details);
      }

      // Handle error object differently - C3: sanitize stack traces
      if (context && context.error) {
        var errDetails = this._sanitizeForLog({
          message: context.error.message,
          stack: context.error.stack
        });
        details = JSON.stringify(errDetails);
      }

      var row = [
        new Date(),
        level,
        correlationId,
        functionName,
        user,
        this._truncateMessage(message),
        details
      ];

      sheet.appendRow(row);
      return true;
    } catch (e) {
      console.log('[LogService] Silent fallback: ' + level + ' - ' + message);
      return false;
    }
  },

  /**
   * Logs INFO level message
   * L-01, L-02: Writes to sheet with all columns
   */
  logInfo: function(message, context) {
    this._write('INFO', message, context);
  },

  /**
   * Logs WARN level message
   * L-01, L-02: Writes to sheet with all columns
   */
  logWarn: function(message, context) {
    this._write('WARN', message, context);
  },

  /**
   * Logs ERROR level message
   * L-01, L-02: Writes to sheet with all columns, includes error details
   */
  logError: function(message, context) {
    this._write('ERROR', message, context);
  }
};

// Wrapper function for time-driven trigger
function writeLogToSheet(level, message, context) {
  LogService._write(level, message, context);
}
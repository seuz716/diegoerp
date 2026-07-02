/**
 * LOG SERVICE - Structured logging for observability
 * L-01: Writes logs to 'Logs' sheet with all required columns
 * L-02: Handles log levels correctly (INFO, WARN, ERROR)
 * L-03: Falls silently if sheet unavailable (uses console.log as fallback)
 */

const LogService = {
  LOG_SHEET_NAME: 'Logs',
  MAX_MESSAGE_LENGTH: 500,
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
        details = typeof context.details === 'object' ? JSON.stringify(context.details) : String(context.details);
        details = this._truncateMessage(details);
      }

      // Handle error object differently
      if (context && context.error) {
        var errDetails = {
          message: context.error.message,
          stack: context.error.stack
        };
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
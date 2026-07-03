/**
 * QUOTA MONITOR - Proactive quota monitoring for GAS
 * Q-01: Detects quota thresholds (80% by default)
 * Q-02: Sends email alerts with 24h deduplication
 * Q-03: Runs via time-driven trigger
 */

const QuotaMonitor = {
  THRESHOLDS: {
    runtime: 0.80,
    properties: 0.85,
    mail: 0.75
  },
  QUOTA_CHECK_PREFIX: 'QUOTA_CHECK_',
  LAST_ALERT_KEY_BASE: 'LAST_QUOTA_ALERT_',
  RUNTIME_START_KEY: 'RUNTIME_EXEC_START_',

  // Known GAS limits (in milliseconds for runtime)
  LIMITS: {
    scriptRuntimeDaily: 6 * 60 * 1000, // 6 minutes per day (free tier)
    propertiesSize: 500 * 1024,        // 500 KB
    mailPerDay: 100                      // emails per day
  },

  /**
   * Starts runtime tracking for a named execution context
   */
  startExecution: function(context) {
    var key = this.RUNTIME_START_KEY + (context || 'default');
    PropertiesService.getScriptProperties().setProperty(key, String(Date.now()));
    return key;
  },

  /**
   * Ends runtime tracking and accumulates daily total
   */
  endExecution: function(context) {
    try {
      var key = this.RUNTIME_START_KEY + (context || 'default');
      var startStr = PropertiesService.getScriptProperties().getProperty(key);
      if (!startStr) return;
      
      var start = Number(startStr);
      var elapsed = Date.now() - start;
      
      var totalStr = PropertiesService.getScriptProperties().getProperty('SCRIPT_RUNTIME_USAGE_MS');
      var total = totalStr ? Number(totalStr) : 0;
      total += elapsed;
      
      PropertiesService.getScriptProperties().setProperty('SCRIPT_RUNTIME_USAGE_MS', String(total));
      PropertiesService.getScriptProperties().deleteProperty(key);
    } catch (e) {
      console.log('[QuotaMonitor] Error ending execution tracking:', e.message);
    }
  },

  /**
   * Gets current runtime usage from PropertiesService
   * Q-01: Returns numeric value in milliseconds
   */
  _getRuntimeUsage: function() {
    try {
      var props = PropertiesService.getScriptProperties();
      var usage = props.getProperty('SCRIPT_RUNTIME_USAGE_MS');
      return usage ? Number(usage) : 0;
    } catch (e) {
      console.log('[QuotaMonitor] Error reading runtime usage:', e.message);
      return { error: e.message, value: 0 };
    }
  },

  /**
   * Calculates Properties storage usage in bytes (UTF-8)
   */
  _getPropertiesUsage: function() {
    try {
      var props = PropertiesService.getScriptProperties();
      var allProps = props.getProperties();
      var totalBytes = 0;
      for (var key in allProps) {
        if (Object.prototype.hasOwnProperty.call(allProps, key)) {
          totalBytes += (key.length + String(allProps[key]).length) * 2;
        }
      }
      return totalBytes;
    } catch (e) {
      console.log('[QuotaMonitor] Error reading properties usage:', e.message);
      return { error: e.message, value: 0 };
    }
  },

  /**
   * Gets remaining email quota
   */
  _getMailQuota: function() {
    try {
      return MailApp.getRemainingDailyQuota();
    } catch (e) {
      console.log('[QuotaMonitor] Error reading mail quota:', e.message);
      return { error: e.message, value: 0 };
    }
  },

  /**
   * Prevents duplicate alerts within 24 hours per quota type
   * Q-02: Uses PropertiesService to track last alert
   */
  _shouldSendAlert: function(quotaName) {
    try {
      var props = PropertiesService.getScriptProperties();
      var key = this.LAST_ALERT_KEY_BASE + quotaName;
      var lastAlertStr = props.getProperty(key);
      if (!lastAlertStr) return true;
      
      var lastAlert = Number(lastAlertStr);
      var hoursSince = (Date.now() - lastAlert) / (1000 * 60 * 60);
      return hoursSince >= 24;
    } catch (e) {
      return true;
    }
  },

  /**
   * Sends alert email (or simulates for testing)
   * Q-02: Builds proper email with quota details
   */
  _sendAlert: function(quotaName, currentUsage, limit) {
    try {
      if (typeof TEST_MODE !== 'undefined' && TEST_MODE) {
        console.log('[QuotaMonitor] TEST MODE - Would send alert:', quotaName, currentUsage, limit);
        return true;
      }

      if (!this._shouldSendAlert(quotaName)) {
        return false;
      }

      var subject = '[ALERTA] Cuota de GAS excedida: ' + quotaName;
      var body = 'Cuota: ' + quotaName + '\n' +
                 'Uso actual: ' + currentUsage + '\n' +
                 'Límite: ' + limit + '\n' +
                 'Porcentaje: ' + Math.round((currentUsage / limit) * 100) + '%\n' +
                 '\nSistema MicroERP · Cartera Pro';

      var key = this.LAST_ALERT_KEY_BASE + quotaName;
      PropertiesService.getScriptProperties().setProperty(key, String(Date.now()));
      
      if (Session.getEffectiveUser().getEmail()) {
        MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
      }
      return true;
    } catch (e) {
      console.log('[QuotaMonitor] Failed to send alert:', e.message);
      return false;
    }
  },

  /**
   * Checks all quotas and sends alerts if threshold exceeded
   * Q-01, Q-03: Main function called by trigger
   */
  checkQuotas: function() {
    var alerts = [];
    var usage = {};
    var errors = {};

    try {
      // Check runtime usage
      var runtimeResult = this._getRuntimeUsage();
      usage.runtime = typeof runtimeResult === 'object' && runtimeResult.error ? 0 : runtimeResult;
      errors.runtime = typeof runtimeResult === 'object' && runtimeResult.error ? runtimeResult.error : null;
      
      if (usage.runtime > this.LIMITS.scriptRuntimeDaily * this.THRESHOLDS.runtime) {
        alerts.push({
          quota: 'scriptRuntime',
          usage: usage.runtime,
          limit: this.LIMITS.scriptRuntimeDaily,
          percentage: Math.round((usage.runtime / this.LIMITS.scriptRuntimeDaily) * 100)
        });
        this._sendAlert('Runtime Diario', usage.runtime, this.LIMITS.scriptRuntimeDaily);
      }

      // Check Properties storage
      var propsResult = this._getPropertiesUsage();
      usage.properties = typeof propsResult === 'object' && propsResult.error ? 0 : propsResult;
      errors.properties = typeof propsResult === 'object' && propsResult.error ? propsResult.error : null;
      
      if (usage.properties > this.LIMITS.propertiesSize * this.THRESHOLDS.properties) {
        alerts.push({
          quota: 'propertiesSize',
          usage: usage.properties,
          limit: this.LIMITS.propertiesSize,
          percentage: Math.round((usage.properties / this.LIMITS.propertiesSize) * 100)
        });
        this._sendAlert('Properties Storage', usage.properties, this.LIMITS.propertiesSize);
      }

      // Check mail quota
      var mailResult = this._getMailQuota();
      usage.mail = typeof mailResult === 'object' && mailResult.error ? 0 : mailResult;
      errors.mail = typeof mailResult === 'object' && mailResult.error ? mailResult.error : null;
      
      if (usage.mail < this.LIMITS.mailPerDay * this.THRESHOLDS.mail) {
        alerts.push({
          quota: 'mailService',
          usage: usage.mail,
          limit: this.LIMITS.mailPerDay,
          percentage: Math.round((usage.mail / this.LIMITS.mailPerDay) * 100)
        });
        this._sendAlert('Mail Service', usage.mail, this.LIMITS.mailPerDay);
      }

      // Log the check
      try {
        var logMsg = 'Quota check completed. Alerts: ' + alerts.length;
        if (typeof LogService !== 'undefined' && typeof LogService.logInfo === 'function') {
          LogService.logInfo(logMsg, { functionName: 'checkQuotas' });
        }
      } catch (e) {
        // Silent fail
      }

    } catch (e) {
      console.log('[QuotaMonitor] Error during check:', e.message);
    }

    return { usage: usage, alerts: alerts, errors: errors };
  }
};

// Wrapper for time-driven trigger
function checkQuotas() {
  QuotaMonitor.checkQuotas();
}
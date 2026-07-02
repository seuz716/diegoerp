/**
 * QUOTA MONITOR - Proactive quota monitoring for GAS
 * Q-01: Detects quota thresholds (80% by default)
 * Q-02: Sends email alerts with 24h deduplication
 * Q-03: Runs via time-driven trigger
 */

const QuotaMonitor = {
  THRESHOLD: 0.80,
  QUOTA_CHECK_PREFIX: 'QUOTA_CHECK_',
  LAST_ALERT_KEY: 'LAST_QUOTA_ALERT',

  // Known GAS limits (in milliseconds for runtime)
  LIMITS: {
    scriptRuntimeDaily: 6 * 60 * 1000, // 6 minutes per day (free tier)
    propertiesSize: 500 * 1024,        // 500 KB
    mailPerDay: 100                      // emails per day
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
      return 0;
    }
  },

  /**
   * Calculates Properties storage usage
   */
  _getPropertiesUsage: function() {
    try {
      var props = PropertiesService.getScriptProperties();
      var allProps = props.getProperties();
      var totalBytes = 0;
      for (var key in allProps) {
        if (Object.prototype.hasOwnProperty.call(allProps, key)) {
          totalBytes += (key.length + String(allProps[key]).length);
        }
      }
      return totalBytes;
    } catch (e) {
      return 0;
    }
  },

  /**
   * Prevents duplicate alerts within 24 hours
   * Q-02: Uses PropertiesService to track last alert
   */
  _shouldSendAlert: function() {
    try {
      var props = PropertiesService.getScriptProperties();
      var lastAlertStr = props.getProperty(this.LAST_ALERT_KEY);
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
      // Skip actual email in test mode
      if (typeof TEST_MODE !== 'undefined' && TEST_MODE) {
        console.log('[QuotaMonitor] TEST MODE - Would send alert:', quotaName, currentUsage, limit);
        return true;
      }

      if (!this._shouldSendAlert()) {
        return false; // Already sent within 24h
      }

      var subject = '[ALERTA] Cuota de GAS excedida: ' + quotaName;
      var body = 'Cuota: ' + quotaName + '\n' +
                 'Uso actual: ' + currentUsage + '\n' +
                 'Límite: ' + limit + '\n' +
                 'Porcentaje: ' + Math.round((currentUsage / limit) * 100) + '%\n' +
                 '\nSistema MicroERP · Cartera Pro';

      // Record that we sent an alert (avoid spam)
      PropertiesService.getScriptProperties().setProperty(this.LAST_ALERT_KEY, String(Date.now()));
      
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
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

    try {
      // Check runtime usage
      var runtimeUsage = this._getRuntimeUsage();
      usage.runtime = runtimeUsage;
      
      if (runtimeUsage > this.LIMITS.scriptRuntimeDaily * this.THRESHOLD) {
        alerts.push({
          quota: 'scriptRuntime',
          usage: runtimeUsage,
          limit: this.LIMITS.scriptRuntimeDaily,
          percentage: Math.round((runtimeUsage / this.LIMITS.scriptRuntimeDaily) * 100)
        });
        this._sendAlert('Runtime Diario', runtimeUsage, this.LIMITS.scriptRuntimeDaily);
      }

      // Check Properties storage
      var propsUsage = this._getPropertiesUsage();
      usage.properties = propsUsage;
      
      if (propsUsage > this.LIMITS.propertiesSize * this.THRESHOLD) {
        alerts.push({
          quota: 'propertiesSize',
          usage: propsUsage,
          limit: this.LIMITS.propertiesSize,
          percentage: Math.round((propsUsage / this.LIMITS.propertiesSize) * 100)
        });
        this._sendAlert('Properties Storage', propsUsage, this.LIMITS.propertiesSize);
      }

      // Log the check (without causing infinite loop if logs exceed quota)
      try {
        var logMsg = 'Quota check completed. Alerts: ' + alerts.length;
        if (LogService && LogService.logInfo) {
          LogService.logInfo(logMsg, { functionName: 'checkQuotas' });
        }
      } catch (e) {
        // Silent fail
      }

    } catch (e) {
      // Don't use LogService here to avoid infinite loop
      console.log('[QuotaMonitor] Error during check:', e.message);
    }

    return { usage: usage, alerts: alerts };
  }
};

// Wrapper for time-driven trigger
function checkQuotas() {
  QuotaMonitor.checkQuotas();
}
/**
 * Servicio de Backup de Configuración.
 * Respaldar PropertiesService, triggers, y settings del script.
 *
 * SEGURIDAD (F3):
 * - No se respaldan claves sensibles (secretos, tokens, API keys, HMAC).
 * - El backup incluye una firma HMAC-SHA256; restoreProperties la verifica
 *   y aborta si fue manipulado o le falta firma.
 */

var ConfigBackup = {
  // Patrones de claves que NUNCA deben respaldarse ni restaurarse (secretos/PII)
  _SENSITIVE_KEY_PATTERNS: ['SECRET', 'API_KEY', 'KEY', 'TOKEN', 'PASSWORD', 'HMAC', 'AUTH_SEC_'],

  _isSensitiveKey: function(key) {
    if (!key) return false;
    var upper = String(key).toUpperCase();
    return this._SENSITIVE_KEY_PATTERNS.some(function(p) { return upper.indexOf(p) !== -1; });
  },

  /**
   * Deriva una clave de integridad estable a partir del ScriptId.
   * No es secreto criptográfico fuerte, pero vincula el backup al script
   * y detecta manipulación de Drive.
   * @returns {string} Hex HMAC key.
   */
  _getIntegritySecret: function() {
    var scriptId = ScriptApp.getScriptId();
    var raw = Utilities.computeHmacSha256Signature(scriptId, "CONFIG_BACKUP_INTEGRITY_V1");
    return raw.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  },

  _sign: function(canonicalJson) {
    var sig = Utilities.computeHmacSha256Signature(canonicalJson, this._getIntegritySecret());
    return sig.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  },

  _canonicalJson: function(data) {
    return JSON.stringify({
      timestamp: data.timestamp,
      properties: data.properties,
      triggers: data.triggers,
      scriptId: data.scriptId
    });
  },

  /**
   * Respaldar propiedades NO sensibles del script en un archivo JSON en Drive.
   * @returns {string} ID del archivo creado.
   */
  backupProperties: function() {
    var all = PropertiesService.getScriptProperties().getProperties();
    var props = {};
    for (var k in all) {
      if (this._isSensitiveKey(k)) continue; // excluir secretos
      props[k] = all[k];
    }
    var triggers = ScriptApp.getProjectTriggers().map(function(t) {
      return {
        handler: t.getHandlerFunction(),
        source: t.getTriggerSource().toString(),
        type: t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK ?
              t.getTimeBasedTriggerType().toString() : 'unknown'
      };
    });

    var backupData = {
      timestamp: new Date().toISOString(),
      properties: props,
      triggers: triggers,
      scriptId: ScriptApp.getScriptId()
    };

    // Firma de integridad (F3)
    backupData.signature = this._sign(this._canonicalJson(backupData));

    var json = JSON.stringify(backupData, null, 2);
    var blob = Utilities.newBlob(json, 'application/json',
      'config_backup_' + Utilities.formatDate(new Date(), SESSION_SERVICE.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss') + '.json');

    var folder = this._getBackupFolder();
    var file = folder.createFile(blob);
    return file.getId();
  },

  /**
   * Restaurar propiedades desde un archivo de backup.
   * Exige firma HMAC válida y nunca restaura claves sensibles.
   * @param {string} fileId - ID del archivo JSON de backup.
   * @throws {Error} Si la firma es inválida/faltante o el archivo es inválido.
   */
  restoreProperties: function(fileId) {
    var file = DriveApp.getFileById(fileId);
    var content = file.getBlob().getDataAsString();
    var data = JSON.parse(content);

    if (!data || typeof data !== 'object' || !data.properties || typeof data.properties !== 'object') {
      throw new Error('Archivo de backup inválido: no contiene "properties"');
    }

    // Verificación de integridad (F3)
    if (!data.signature) {
      throw new Error('Backup sin firma de integridad - restauración abortada (posible manipulación)');
    }
    var expected = this._sign(this._canonicalJson(data));
    if (expected !== data.signature) {
      throw new Error('Firma de integridad inválida - backup manipulado; restauración abortada');
    }

    // Limpiar propiedades existentes (excepto las críticas que no deben restaurarse)
    var excludeKeys = ['LAST_SMOKE_ALERT', 'SCHEMA_VERSION'];
    var currentProps = PropertiesService.getScriptProperties().getProperties();
    for (var key in currentProps) {
      if (excludeKeys.indexOf(key) === -1) {
        PropertiesService.getScriptProperties().deleteProperty(key);
      }
    }

    // Restaurar propiedades del backup (nunca las sensibles)
    var restored = 0;
    for (var propKey in data.properties) {
      if (excludeKeys.indexOf(propKey) !== -1) continue;
      if (this._isSensitiveKey(propKey)) continue; // nunca restaurar secretos
      PropertiesService.getScriptProperties().setProperty(propKey, data.properties[propKey]);
      restored++;
    }

    return { success: true, restored: restored };
  },

  /**
   * Obtener o crear la carpeta de backups de configuración.
   */
  _getBackupFolder: function() {
    var folderName = 'MicroERP_ConfigBackups';
    var folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) {
      return folders.next();
    }
    return DriveApp.createFolder(folderName);
  },

  /**
   * Limpiar backups antiguos (mantener últimos 10).
   */
  cleanupOldBackups: function() {
    var folder = this._getBackupFolder();
    var files = folder.getFilesByType('application/json');
    var fileList = [];
    while (files.hasNext()) {
      var file = files.next();
      fileList.push({ id: file.getId(), date: file.getDateCreated() });
    }
    fileList.sort(function(a, b) { return b.date - a.date; });
    var keep = 10;
    var deleted = 0;
    for (var i = keep; i < fileList.length; i++) {
      DriveApp.getFileById(fileList[i].id).setTrashed(true);
      deleted++;
    }
    return deleted;
  }
};

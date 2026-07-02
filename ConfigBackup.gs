/**
 * Servicio de Backup de Configuración.
 * Respaldar PropertiesService, triggers, y settings del script.
 */

var ConfigBackup = {
  /**
   * Respaldar todas las propiedades del script en un archivo JSON en Drive.
   * @returns {string} ID del archivo creado.
   */
  backupProperties: function() {
    var props = PropertiesService.getScriptProperties().getProperties();
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
    
    var json = JSON.stringify(backupData, null, 2);
    var blob = Utilities.newBlob(json, 'application/json', 
      'config_backup_' + Utilities.formatDate(new Date(), SESSION_SERVICE.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss') + '.json');
    
    var folder = this._getBackupFolder();
    var file = folder.createFile(blob);
    return file.getId();
  },
  
  /**
   * Restaurar propiedades desde un archivo de backup.
   * @param {string} fileId - ID del archivo JSON de backup.
   */
  restoreProperties: function(fileId) {
    var file = DriveApp.getFileById(fileId);
    var content = file.getBlob().getDataAsString();
    var data = JSON.parse(content);
    
    if (!data.properties || typeof data.properties !== 'object') {
      throw new Error('Archivo de backup inválido: no contiene "properties"');
    }
    
    // Limpiar propiedades existentes (excepto las críticas que no deben restaurarse)
    var excludeKeys = ['LAST_SMOKE_ALERT', 'SCHEMA_VERSION'];
    var currentProps = PropertiesService.getScriptProperties().getProperties();
    for (var key in currentProps) {
      if (excludeKeys.indexOf(key) === -1) {
        PropertiesService.getScriptProperties().deleteProperty(key);
      }
    }
    
    // Restaurar propiedades del backup
    for (var propKey in data.properties) {
      if (excludeKeys.indexOf(propKey) === -1) {
        PropertiesService.getScriptProperties().setProperty(propKey, data.properties[propKey]);
      }
    }
    
    return { success: true, restored: Object.keys(data.properties).length };
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
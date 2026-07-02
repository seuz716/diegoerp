/**
 * LAYER 5: BACKUP SERVICE
 * Automated daily backup with retention of 7 backups
 */

var BackupService = {
  /**
   * Creates a complete backup of all data sheets to a new spreadsheet.
   * @returns {Object} { success: boolean, backupFileId: string, backupFileName: string, message: string }
   */
  createBackup: function() {
    try {
      const ss = getActiveSpreadsheet();
      const backupFolder = this._getBackupFolder();
      
      // Generate backup name
      const now = new Date();
      const timestamp = Utilities.formatDate(now, _getTimeZone(), 'yyyy-MM-dd_HHmmss');
      const backupName = 'Backup_' + timestamp + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
      
      // Create new spreadsheet
      const backupSS = SpreadsheetApp.create(backupName);
      
      // Copy each sheet
      const copiedSheets = [];
      for (let i = 0; i < BACKUP_CONFIG.BACKUP_SHEETS.length; i++) {
        const sheetName = BACKUP_CONFIG.BACKUP_SHEETS[i];
        const sourceSheet = ss.getSheetByName(sheetName);
        if (sourceSheet) {
          this._copySheet(sourceSheet, backupSS);
          copiedSheets.push(sheetName);
        }
      }
      
      // Move to backup folder
      const backupFile = DriveApp.getFileById(backupSS.getId());
      backupFolder.addFile(backupFile);
      
      // Cleanup old backups
      this.cleanupOldBackups();
      
      // Store in properties for traceability
      PropertiesService.getScriptProperties().setProperty(
        'LAST_BACKUP_' + Utilities.formatDate(now, _getTimeZone(), 'yyyyMMdd'),
        backupSS.getId()
      );
      
      LOG_ENGINE.logEvent('CREATE_BACKUP', 'BACKUPS', backupSS.getId(), 
        {}, { sheets: copiedSheets.join(','), fileName: backupName }, 'SUCCESS');
      
      return { 
        success: true, 
        backupFileId: backupSS.getId(), 
        backupFileName: backupName,
        sheetsCopied: copiedSheets.length,
        message: 'Backup creado exitosamente'
      };
    } catch (e) {
      LOG_ENGINE.logEvent('ERROR_BACKUP', 'BACKUPS', 'N/A', {}, { error: e.message }, 'FAILED');
      return { success: false, error: e.message };
    }
  },

  /**
   * Removes old backups, keeping only MAX_BACKUPS most recent.
   */
  cleanupOldBackups: function() {
    try {
      const backupFolder = this._getBackupFolder();
      const files = backupFolder.getFiles();
      const backups = [];
      
      while (files.hasNext()) {
        const file = files.next();
        if (file.getName().startsWith('Backup_')) {
          backups.push({
            id: file.getId(),
            name: file.getName(),
            date: file.getDateCreated()
          });
        }
      }
      
      // Sort by date descending
      backups.sort(function(a, b) { return b.date.getTime() - a.date.getTime(); });
      
      // Delete if more than MAX_BACKUPS
      if (backups.length > BACKUP_CONFIG.MAX_BACKUPS) {
        for (let i = BACKUP_CONFIG.MAX_BACKUPS; i < backups.length; i++) {
          DriveApp.getFileById(backups[i].id).setTrashed(true);
        }
      }
    } catch (e) {
      Logger.log('Backup cleanup error: ' + e.message);
    }
  },

  /**
   * Gets or creates the backup folder.
   */
  _getBackupFolder: function() {
    const folders = DriveApp.getFoldersByName(BACKUP_CONFIG.FOLDER_NAME);
    if (folders.hasNext()) {
      return folders.next();
    }
    return DriveApp.createFolder(BACKUP_CONFIG.FOLDER_NAME);
  },

  /**
   * Copies a sheet to target spreadsheet.
   */
  _copySheet: function(sourceSheet, targetSS) {
    const data = sourceSheet.getDataRange().getValues();
    const targetSheet = targetSS.insertSheet(sourceSheet.getName());
    
    if (data.length > 0) {
      targetSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
    }
    
    // Copy column widths
    for (let col = 1; col <= sourceSheet.getLastColumn(); col++) {
      targetSheet.setColumnWidth(col, sourceSheet.getColumnWidth(col));
    }
  }
};

// Wrapper for trigger
function createBackup() {
  return BackupService.createBackup();
}

// Setup triggers
function setupBackupAndExports() {
  const triggers = ScriptApp.getProjectTriggers();
  
  // Daily backup at 2 AM
  const backupExists = triggers.some(function(t) {
    return t.getHandlerFunction() === 'createBackup' && 
           t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK;
  });
  
  if (!backupExists) {
    ScriptApp.newTrigger('createBackup')
      .timeBased()
      .everyDays(1)
      .atHour(2)
      .create();
  }
  
  // Weekly exports on Monday at 8 AM
  const exportExists = triggers.some(function(t) {
    return t.getHandlerFunction() === 'runScheduledExports' && 
           t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK;
  });
  
  if (!exportExists) {
    ScriptApp.newTrigger('runScheduledExports')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.MONDAY)
      .atHour(8)
      .create();
  }
}

/**
 * LAYER 5: EXPORT SERVICE
 * Scheduled export of critical data to CSV/JSON for audit purposes
 */

var ExportService = {
  /**
   * Gets or creates the export folder.
   */
  _getExportFolder: function() {
    const folders = DriveApp.getFoldersByName(BACKUP_CONFIG.EXPORT_FOLDER_NAME);
    if (folders.hasNext()) {
      return folders.next();
    }
    return DriveApp.createFolder(BACKUP_CONFIG.EXPORT_FOLDER_NAME);
  },

  /**
   * Formats date for filenames.
   */
  _getDateStr: function(date) {
    date = date || new Date();
    return Utilities.formatDate(date, _getTimeZone(), 'yyyy-MM-dd');
  },

  /**
   * Saves CSV content to Drive.
   */
  _saveCSVToDrive: function(csvContent, fileName) {
    const folder = this._getExportFolder();
    const file = folder.createFile(fileName, '\uFEFF' + csvContent, MimeType.CSV);
    return file.getId();
  },

  /**
   * Exports cartera to CSV.
   */
  exportCarteraCSV: function() {
    try {
      const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
      const data = sheet.getDataRange().getValues();
      const headers = CONFIG.SCHEMA_definitions.CARTERA;
      
      const csv = this._arrayToCSV(data, headers);
      const fileName = 'cartera_' + this._getDateStr() + '.csv';
      const fileId = this._saveCSVToDrive(csv, fileName);
      
      return { success: true, fileId: fileId, fileName: fileName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Exports terceros to CSV.
   */
  exportTercerosCSV: function() {
    try {
      const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
      const data = sheet.getDataRange().getValues();
      const headers = CONFIG.SCHEMA_definitions.TERCEROS;
      
      const csv = this._arrayToCSV(data, headers);
      const fileName = 'terceros_' + this._getDateStr() + '.csv';
      const fileId = this._saveCSVToDrive(csv, fileName);
      
      return { success: true, fileId: fileId, fileName: fileName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Exports productos to CSV.
   */
  exportProductosCSV: function() {
    try {
      const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
      const data = sheet.getDataRange().getValues();
      const headers = CONFIG.SCHEMA_definitions.PRODUCTOS;
      
      const csv = this._arrayToCSV(data, headers);
      const fileName = 'productos_' + this._getDateStr() + '.csv';
      const fileId = this._saveCSVToDrive(csv, fileName);
      
      return { success: true, fileId: fileId, fileName: fileName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Runs all scheduled exports (weekly).
   */
  runScheduledExports: function() {
    const results = { cartera: this.exportCarteraCSV(), terceros: this.exportTercerosCSV(), productos: this.exportProductosCSV() };
    
    // Also export libro diario and flujo caja
    const libroResult = exportarLibroDiario(null, null);
    if (libroResult && libroResult.csv) {
      const libroFileId = this._saveCSVToDrive(libroResult.csv, 'libro_diario_' + this._getDateStr() + '.csv');
      results.libroDiario = { success: true, fileId: libroFileId };
    }
    
    const flujoResult = exportarFlujoCaja(null, null);
    if (flujoResult && flujoResult.csv) {
      const flujoFileId = this._saveCSVToDrive(flujoResult.csv, 'flujo_caja_' + this._getDateStr() + '.csv');
      results.flujoCaja = { success: true, fileId: flujoFileId };
    }
    
    LOG_ENGINE.logEvent('SCHEDULED_EXPORTS', 'EXPORTS', 'weekly', {}, results, 'SUCCESS');
    
    return results;
  },

  /**
   * Converts array to CSV with BOM.
   */
  _arrayToCSV: function(data, headers) {
    if (!data || data.length === 0) {
      // Return headers only
      const headerNames = Object.values(headers);
      return headerNames.join(',') + '\n';
    }
    
    const headerNames = Object.values(headers);
    const rows = [headerNames];
    
    for (let i = 0; i < data.length; i++) {
      const row = [];
      for (let j = 0; j < headerNames.length; j++) {
        let val = data[i][j] || '';
        // Escape commas and quotes
        if (val && (String(val).indexOf(',') > -1 || String(val).indexOf('"') > -1)) {
          val = '"' + String(val).replace(/"/g, '""') + '"';
        }
        row.push(val);
      }
      rows.push(row);
    }
    
    return rows.map(r => r.join(',')).join('\n');
  }
};

// Wrapper for trigger
function runScheduledExports() {
  return ExportService.runScheduledExports();
}

// Helper to export libro diario
function exportarLibroDiario(fechaInicio, fechaFin) {
  const sheet = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
  const data = sheet.getDataRange().getValues();
  const headers = CONFIG.SCHEMA_definitions.LIBRO_DIARIO;
  
  const csv = ExportService._arrayToCSV(data, headers);
  return { csv: csv };
}

// Helper to export flujo caja
function exportarFlujoCaja(fechaInicio, fechaFin) {
  const sheet = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
  const data = sheet.getDataRange().getValues();
  const headers = CONFIG.SCHEMA_definitions.FLUJO_CAJA;
  
  const csv = ExportService._arrayToCSV(data, headers);
  return { csv: csv };
}

/**
 * Servicio de Versionado y Migración de Esquemas.
 * Gestiona cambios estructurales en las hojas de datos.
 */

var SchemaManager = {
  /**
   * Versión actual del esquema (actualizar en cada cambio estructural).
   */
  CURRENT_VERSION: '1.2',
  
  /**
   * Obtener la versión actual del esquema desde Properties.
   * @returns {string} Versión (ej: '1.2')
   */
  getCurrentSchemaVersion: function() {
    return PropertiesService.getScriptProperties().getProperty('SCHEMA_VERSION') || '1.0';
  },
  
  /**
   * Verificar si el esquema necesita migración y ejecutar migraciones pendientes.
   * Llamar al inicio de cada doGet o en inicialización.
   */
  ensureSchemaVersion: function() {
    var current = this.getCurrentSchemaVersion();
    if (current === this.CURRENT_VERSION) {
      return { success: true, message: 'Schema up to date', version: current };
    }
    
    // Ejecutar migraciones pendientes
    var migrations = [
      { from: '1.0', to: '1.1', fn: this._migrate_1_0_to_1_1 },
      { from: '1.1', to: '1.2', fn: this._migrate_1_1_to_1_2 }
    ];
    
    var executed = [];
    for (var i = 0; i < migrations.length; i++) {
      var m = migrations[i];
      if (current === m.from || current < m.from) {
        m.fn.call(this);
        executed.push({ from: m.from, to: m.to });
        current = m.to;
        PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', current);
      }
    }
    
    // Registrar en log
    this._logMigration(executed);
    
    return {
      success: true,
      message: 'Migración completada de ' + this.getCurrentSchemaVersion() + ' a ' + this.CURRENT_VERSION,
      version: this.CURRENT_VERSION,
      executed: executed
    };
  },
  
  /**
   * Migración: v1.0 → v1.1 (ej: agregar columna "categoria" a Productos).
   */
  _migrate_1_0_to_1_1: function() {
    Logger.log('🔄 Migrando esquema de 1.0 a 1.1');
    var ss = this._getSpreadsheet();
    
    var sheet = ss.getSheetByName(CONFIG.SHEETS.PRODUCTOS);
    if (!sheet) return;
    
    var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var hasCategoria = headerRow.some(function(h) { return h && h.toString().toLowerCase() === 'categoria'; });
    if (!hasCategoria) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue('categoria');
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, sheet.getLastColumn(), lastRow - 1, 1).setValue('General');
      }
      Logger.log('✅ Columna "categoria" agregada a Productos');
    }
  },
  
  /**
   * Migración: v1.1 → v1.2 (ej: agregar columna "total_pagado" a Compras).
   */
  _migrate_1_1_to_1_2: function() {
    Logger.log('🔄 Migrando esquema de 1.1 a 1.2');
    var ss = this._getSpreadsheet();
    
    var sheet = ss.getSheetByName(CONFIG.SHEETS.COMPRAS);
    if (!sheet) return;
    
    var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var hasTotalPagado = headerRow.some(function(h) { return h && h.toString().toLowerCase() === 'total_pagado'; });
    if (!hasTotalPagado) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue('total_pagado');
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, sheet.getLastColumn(), lastRow - 1, 1).setValue(0);
      }
      Logger.log('✅ Columna "total_pagado" agregada a Compras');
    }
  },
  
  /**
   * Obtener hoja de cálculo principal.
   */
  _getSpreadsheet: function() {
    var ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!ssId) throw new Error('SPREADSHEET_ID no configurado');
    return SpreadsheetApp.openById(ssId);
  },
  
  /**
   * Registrar migraciones en hoja de log.
   */
  _logMigration: function(executed) {
    var ss = this._getSpreadsheet();
    var sheet = ss.getSheetByName('SchemaLog');
    if (!sheet) {
      sheet = ss.insertSheet('SchemaLog');
      sheet.appendRow(['Timestamp', 'From Version', 'To Version', 'Details']);
    }
    
    for (var i = 0; i < executed.length; i++) {
      sheet.appendRow([
        new Date().toISOString(),
        executed[i].from,
        executed[i].to,
        'Migración automática'
      ]);
    }
  }
};
/**
 * SETUP SERVICE - Inicialización y verificación del sistema
 * Ejecutar: setupService.runSetup() o desde web app: ?ssid=<ID>
 */

const SETUP_SERVICE = {
  SHEETS_REQUIRED: [
    { name: 'Terceros', columns: ['ID','Nombre','Telefono','Tipo','Limite_Credito','Activo'] },
    { name: 'Cartera', columns: ['ID','Fecha','ID_Tercero','Origen_ID','Total','Saldo','Tipo','Estado','Fecha_Vencimiento','Vencida_Timestamp','Version'] },
    { name: 'Movimientos_Cartera', columns: ['ID','Fecha','ID_Cartera','ID_Tercero','Valor','Tipo_Mov','Referencia'] },
    { name: 'Productos', columns: ['ID','Nombre','Stock','Precio_Compra','Precio_Venta','Categoria','Activo','Fecha_Creacion','Version'] },
    { name: 'Compras', columns: ['ID','Fecha','ID_Proveedor','ID_Factura','Total','Saldo','Estado','Fecha_Vencimiento','Vencida_Timestamp','Version'] },
    { name: 'Detalle_Compras', columns: ['ID','ID_Compra','ID_Producto','Cantidad','Precio_Unitario','Subtotal'] },
    { name: 'Pagos_Proveedores', columns: ['ID','Fecha','ID_Compra','ID_Proveedor','Valor','Referencia','Metodo_Pago'] },
    { name: 'Kardex_Movilizaciones', columns: ['ID','Fecha','ID_Producto','Tipo_Mov','Cantidad','Stock_Anterior','Stock_Nuevo','Referencia','Origen','Usuario'] },
    { name: 'Libro_Diario', columns: ['ID','Fecha','Tipo','ID_Referencia','Tercero','Monto','Usuario','Descripcion'] },
    { name: 'Flujo_Caja', columns: ['ID','Fecha','Tipo','Concepto','Monto','Referencia','Usuario'] },
    { name: 'AUDIT_LOG', columns: ['ID','Timestamp','Operacion','Tabla','ID_Registro','Usuario','Datos_Previos','Datos_Nuevos','Estado'] }
  ],

  runSetup: function() {
    const results = {
      sheetsCreated: [],
      sheetsVerified: [],
      errors: [],
      timestamp: new Date().toISOString()
    };

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const existingSheets = ss.getSheets().map(s => s.getName());

      for (const sheetConfig of this.SHEETS_REQUIRED) {
        if (!existingSheets.includes(sheetConfig.name)) {
          try {
            const sheet = ss.insertSheet(sheetConfig.name);
            this._createHeaders(sheet, sheetConfig.columns);
            results.sheetsCreated.push(sheetConfig.name);
          } catch (e) {
            results.errors.push(sheetConfig.name + ': ' + e.message);
          }
        } else {
          // Verificar headers existentes
          const sheet = ss.getSheetByName(sheetConfig.name);
          const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          if (existingHeaders.length < sheetConfig.columns.length) {
            // Actualizar headers si faltan columnas
            this._createHeaders(sheet, sheetConfig.columns);
            results.sheetsVerified.push(sheetConfig.name + ' (actualizado)');
          } else {
            results.sheetsVerified.push(sheetConfig.name);
          }
        }
      }

      // Configurar SPREADSHEET_ID automáticamente
      const props = PropertiesService.getScriptProperties();
      if (!props.getProperty('SPREADSHEET_ID')) {
        props.setProperty('SPREADSHEET_ID', ss.getId());
        results.spreadsheetIdSet = ss.getId();
      }

      results.success = results.errors.length === 0;
      return results;
    } catch (e) {
      results.errors.push('Setup error: ' + e.message);
      results.success = false;
      return results;
    }
  },

  _createHeaders: function(sheet, columns) {
    const range = sheet.getRange(1, 1, 1, columns.length);
    range.setValues([columns]);
    range.setFontWeight('bold');
  },

  verifyConfig: function() {
    const config = {
      spreadsheetId: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
      timezone: Session.getScriptTimeZone(),
      version: '2.5',
      checks: []
    };

    config.checks.push({
      name: 'SPREADSHEET_ID',
      status: !!config.spreadsheetId
    });

    config.checks.push({
      name: 'TIMEZONE',
      status: !!config.timezone
    });

    // Verificar hojas críticas
    for (const sheetConfig of this.SHEETS_REQUIRED) {
      try {
        const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(sheetConfig.name);
        config.checks.push({
          name: 'HOJA_' + sheetConfig.name,
          status: !!sheet
        });
      } catch (e) {
        config.checks.push({
          name: 'HOJA_' + sheetConfig.name,
          status: false
        });
      }
    }

    config.allPassed = config.checks.every(c => c.status);
    return config;
  },

  migrateLegacy: function() {
    const legacy = PropertiesService.getScriptProperties().getProperty('LEGACY_MIGRATED');
    if (legacy) return { status: 'already_migrated' };

    const operations = [];
    
    operations.push({
      name: 'migrateKardexFormat',
      execute: function() {
        const sheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
        if (!sheet || sheet.getLastRow() < 2) return false;
        
        const data = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (!data[i][0]) {
            data[i][0] = 'KDX-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + ('0000' + i).slice(-5);
          }
        }
        sheet.getRange(2, 1, data.length - 1, data[0].length).setValues(data.slice(1));
        return true;
      }
    });

    for (const op of operations) {
      try { op.execute(); } catch (e) {}
    }

    PropertiesService.getScriptProperties().setProperty('LEGACY_MIGRATED', 'true');
    return { status: 'migrated', operations: operations.length };
  },

  setSpreadsheetIdFromSsid: function(ssid) {
    if (ssid) {
      PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ssid);
      return { success: true, spreadsheetId: ssid };
    }
    return { success: false, error: 'SSID required' };
  }
};

// Wrapper para ejecución directa
function setupService() {
  return SETUP_SERVICE.runSetup();
}

function verifyConfig() {
  return SETUP_SERVICE.verifyConfig();
}

function migrateLegacy() {
  return SETUP_SERVICE.migrateLegacy();
}

function setSpreadsheetId(ssid) {
  return SETUP_SERVICE.setSpreadsheetIdFromSsid(ssid);
}
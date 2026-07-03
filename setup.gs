/**
 * SETUP SERVICE - Inicialización y verificación del sistema
 * Ejecutar: setupService.runSetup() o desde web app: ?ssid=<ID>
 */

const SETUP_SCHEMA_VERSION = '2.5';
const LEGACY_MIGRATED_FLAG = 'LEGACY_MIGRATED';

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
      
      if (!ss) {
        results.errors.push('No active spreadsheet found');
        results.success = false;
        return results;
      }
      
      const existingSheets = ss.getSheets().map(s => s.getName());
      const sheetsCreated = [];

      for (const sheetConfig of this.SHEETS_REQUIRED) {
        if (!existingSheets.includes(sheetConfig.name)) {
          try {
            const sheet = ss.insertSheet(sheetConfig.name);
            this._createHeaders(sheet, sheetConfig.columns);
            results.sheetsCreated.push(sheetConfig.name);
            sheetsCreated.push(sheetConfig.name);
          } catch (e) {
            results.errors.push(sheetConfig.name + ': ' + e.message);
          }
        } else {
          const sheet = ss.getSheetByName(sheetConfig.name);
          if (sheet) {
            const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
            const needsUpdate = existingHeaders.length < sheetConfig.columns.length;
            
            if (needsUpdate) {
              const hasData = sheet.getLastRow() > 1;
              if (hasData) {
                results.errors.push(sheetConfig.name + ': Already has data, skipping header update');
                continue;
              }
              this._createHeaders(sheet, sheetConfig.columns);
              results.sheetsVerified.push(sheetConfig.name + ' (actualizado)');
            } else {
              results.sheetsVerified.push(sheetConfig.name);
            }
          } else {
            results.errors.push(sheetConfig.name + ': Sheet not found after existence check');
          }
        }
      }

      if (results.errors.length > 0 && sheetsCreated.length > 0) {
        for (const sheetName of sheetsCreated) {
          try {
            const sheet = ss.getSheetByName(sheetName);
            if (sheet) ss.deleteSheet(sheet);
          } catch (e) {
            results.errors.push('Rollback failed for ' + sheetName + ': ' + e.message);
          }
        }
        results.sheetsCreated = [];
      }

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
    if (!sheet || !columns) return;
    
    const headers = sheet.getRange(1, 1, 1, columns.length);
    
    if (sheet.getLastRow() > 1) {
      const existingHeaders = headers.getValues()[0];
      const same = existingHeaders.every((h, i) => String(h).trim() === String(columns[i]).trim());
      if (same) return;
    }
    
    headers.setValues([columns]);
    headers.setFontWeight('bold');
  },

  verifyConfig: function() {
    const config = {
      spreadsheetId: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
      timezone: Session.getScriptTimeZone(),
      version: SETUP_SCHEMA_VERSION,
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

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      config.checks.push({ name: 'ACTIVE_SPREADSHEET', status: false, error: 'No active spreadsheet' });
    } else {
      config.checks.push({ name: 'ACTIVE_SPREADSHEET', status: true, id: ss.getId() });
      
      for (const sheetConfig of this.SHEETS_REQUIRED) {
        const sheet = ss.getSheetByName(sheetConfig.name);
        if (sheet) {
          const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
          const expectedLen = sheetConfig.columns.length;
          const actualLen = headers.length;
          const headersMatch = actualLen >= expectedLen && sheetConfig.columns.every((col, i) => String(headers[i] || '').trim() === col);
          config.checks.push({
            name: 'HOJA_' + sheetConfig.name,
            status: headersMatch,
            expectedColumns: expectedLen,
            actualColumns: actualLen
          });
        } else {
          config.checks.push({
            name: 'HOJA_' + sheetConfig.name,
            status: false
          });
        }
      }
    }

    config.allPassed = config.checks.every(c => c.status);
    return config;
  },

  migrateLegacy: function() {
    const legacy = PropertiesService.getScriptProperties().getProperty(LEGACY_MIGRATED_FLAG);
    if (legacy) return { status: 'already_migrated' };

    const results = {
      status: 'migrated',
      operations: [],
      errors: []
    };
    
    try {
      const sheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
      if (!sheet || sheet.getLastRow() < 2) {
        results.operations.push({ name: 'migrateKardexFormat', status: 'skipped', reason: 'Empty or missing sheet' });
      } else {
        const data = sheet.getDataRange().getValues();
        let modifiedRows = 0;
        
        const existingIds = new Set();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0]) existingIds.add(String(data[i][0]).trim());
        }
        
        for (let i = 1; i < data.length; i++) {
          if (!data[i][0] || data[i][0].toString().trim() === '') {
            let newId;
            let attempts = 0;
            do {
              newId = 'KDX-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + ('0000' + (i + modifiedRows)).slice(-5);
              attempts++;
            } while (existingIds.has(newId) && attempts < 100);
            
            if (attempts < 100) {
              data[i][0] = newId;
              existingIds.add(newId);
              modifiedRows++;
            } else {
              results.errors.push('Could not generate unique ID for row ' + (i + 1));
            }
          }
        }
        
        if (modifiedRows > 0) {
          sheet.getRange(2, 1, data.length - 1, data[0].length).setValues(data.slice(1));
        }
        results.operations.push({ name: 'migrateKardexFormat', status: 'success', modifiedRows: modifiedRows });
      }
    } catch (e) {
      results.status = 'failed';
      results.errors.push(e.message);
      LogService && LogService.logError && LogService.logError('migrateLegacy', e);
    }

    if (results.status !== 'failed') {
      PropertiesService.getScriptProperties().setProperty(LEGACY_MIGRATED_FLAG, 'true');
    }
    return results;
  },

  setSpreadsheetIdFromSsid: function(ssid) {
    if (!ssid || typeof ssid !== 'string') {
      return { success: false, error: 'SSID must be a non-empty string' };
    }
    
    if (ssid.length < 10 || ssid.length > 100) {
      return { success: false, error: 'SSID has invalid length' };
    }
    
    try {
      const sheet = SpreadsheetApp.openById(ssid);
      if (!sheet) {
        return { success: false, error: 'Spreadsheet not found or not accessible' };
      }
      PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ssid);
      return { success: true, spreadsheetId: ssid };
    } catch (e) {
      return { success: false, error: 'Failed to access spreadsheet: ' + e.message };
    }
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
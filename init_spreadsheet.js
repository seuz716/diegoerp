/**
 * Script de inicialización - ejecutar una vez desde el spreadsheet
 * Este archivo debe guardarse en el spreadsheet y ejecutarse para configurar el SPREADSHEET_ID
 */
function initFromSpreadsheet() {
  // Obtener el spreadsheet activo
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssId = ss.getId();
  
  // Guardar el ID
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ssId);
  
  // Verificar que las hojas existen
  const sheets = ['Terceros', 'Cartera', 'Movimientos_Cartera', 'AUDIT_LOG', 'Productos'];
  const results = {};
  
  for (const name of sheets) {
    const sheet = ss.getSheetByName(name);
    results[name] = sheet ? { exists: true, rows: sheet.getLastRow() } : { exists: false };
  }
  
  Logger.log("Spreadsheet configurado: " + ssId);
  Logger.log("Hojas: " + JSON.stringify(results));
  
  return { success: true, spreadsheetId: ssId, sheets: results };
}

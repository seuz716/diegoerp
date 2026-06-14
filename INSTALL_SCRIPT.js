/**
 * INSTALACIÓN AUTOMÁTICA - Ejecuta esto desde tu spreadsheet
 * Ve a Extensiones > Apps Script > Pega este código en un nuevo archivo > Ejecutar > initCartera
 */

function initCartera() {
  // Configurar el spreadsheet ID automáticamente
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssId = ss.getId();
  
  // Guardar en propiedades
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ssId);
  
  // Mostrar hojas disponibles
  const sheets = ss.getSheets();
  Logger.log("Spreadsheet: " + ss.getName() + " (ID: " + ssId + ")");
  Logger.log("Hojas encontradas: " + sheets.map(s => s.getName()).join(", "));
  
  // Verificar hojas requeridas
  const requiredSheets = ["Terceros", "Cartera", "Movimientos_Cartera", "AUDIT_LOG", "Productos"];
  const missing = [];
  requiredSheets.forEach(name => {
    if (!ss.getSheetByName(name)) missing.push(name);
  });
  
  if (missing.length > 0) {
    Logger.log("⚠️ Hojas faltantes: " + missing.join(", "));
  }
  
  // Verificar datos en cartera
  const carteraSheet = ss.getSheetByName("Cartera");
  if (carteraSheet) {
    const lastRow = carteraSheet.getLastRow();
    Logger.log("Filas en Cartera: " + lastRow);
    
    if (lastRow > 1) {
      const data = carteraSheet.getDataRange().getValues();
      const headers = data[0];
      Logger.log("Encabezados: " + headers.join(" | "));
      
      // Contar tipos
      const tipos = {};
      for (let i = 1; i < data.length; i++) {
        const tipo = String(data[i][6] || "").trim(); // Columna 6 = Tipo
        if (tipo) tipos[tipo] = (tipos[tipo] || 0) + 1;
      }
      Logger.log("Tipos en cartera: " + JSON.stringify(tipos));
    }
  }
  
  return "✅ Configuración completada. SPREADSHEET_ID: " + ssId;
}

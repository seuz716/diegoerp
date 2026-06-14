/**
 * INSTALACIÓN ONE-CLICK - Ejecuta esto desde tu spreadsheet
 * 1. Ve a Extensiones > Apps Script
 * 2. Pega este código en un nuevo archivo
 * 3. Guarda y ejecuta setupCompleto()
 */

function setupCompleto() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssId = ss.getId();
  
  // Guardar ID
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ssId);
  
  // Mostrar estado
  Logger.log("=== SETUP MICROERP ===");
  Logger.log("Spreadsheet: " + ss.getName());
  Logger.log("ID: " + ssId);
  
  // Verificar hojas
  const hojas = ["Terceros", "Cartera", "Movimientos_Cartera", "AUDIT_LOG", "Productos"];
  let mensaje = "\nHOJAS:\n";
  
  hojas.forEach(nombre => {
    const hoja = ss.getSheetByName(nombre);
    if (hoja) {
      const filas = hoja.getLastRow();
      mensaje += "✅ " + nombre + ": " + filas + " filas\n";
    } else {
      mensaje += "❌ " + nombre + ": NO EXISTE\n";
    }
  });
  
  // Verificar cartera
  const cartera = ss.getSheetByName("Cartera");
  if (cartera && cartera.getLastRow() > 1) {
    const data = cartera.getDataRange().getValues();
    const tipos = {};
    for (let i = 1; i < data.length; i++) {
      const t = String(data[i][6] || "").trim();
      if (t) tipos[t] = (tipos[t] || 0) + 1;
    }
    mensaje += "\nTIPOS EN CARTERA: " + JSON.stringify(tipos);
  }
  
  Logger.log(mensaje);
  return mensaje;
}

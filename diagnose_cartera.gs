/**
 * DIAGNÓSTICO DE CARTERA - Ejecuta esto directamente
 * Muestra exactamente qué está pasando con los datos
 */

function diagnoseCartera() {
  const result = {
    spreadsheetId: null,
    hojas: {},
    cartera: { totalFilas: 0, tipos: {} },
    error: null
  };
  
  try {
    // 1. Verificar spreadsheet ID
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      result.spreadsheetId = ss.getId();
      result.spreadsheetName = ss.getName();
    } else {
      // Intentar desde propiedades
      result.spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    }
    
    // 2. Verificar hojas
    const hojasRequeridas = ["Terceros", "Cartera", "Movimientos_Cartera", "AUDIT_LOG", "Productos"];
    hojasRequeridas.forEach(nombre => {
      try {
        const sheet = ss.getSheetByName(nombre);
        result.hojas[nombre] = {
          existe: !!sheet,
          filas: sheet ? sheet.getLastRow() : 0
        };
      } catch (e) {
        result.hojas[nombre] = { existe: false, error: e.message };
      }
    });
    
    // 3. Verificar cartera
    const carteraSheet = ss.getSheetByName("Cartera");
    if (carteraSheet) {
      const lastRow = carteraSheet.getLastRow();
      result.cartera.totalFilas = lastRow;
      
      if (lastRow > 1) {
        const data = carteraSheet.getDataRange().getValues();
        const headers = data[0];
        result.cartera.headers = headers;
        
        // Contar tipos
        for (let i = 1; i < data.length; i++) {
          const tipo = String(data[i][6] || "").trim(); // Columna Tipo
          if (tipo) {
            result.cartera.tipos[tipo] = (result.cartera.tipos[tipo] || 0) + 1;
          }
        }
      }
    }
    
  } catch (e) {
    result.error = e.message;
  }
  
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

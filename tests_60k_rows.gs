/**
 * Pruebas de Escalabilidad: Medición de Tiempos con 60,000 filas
 * Ejecutar desde el editor de Apps Script.
 */

/**
 * Llena la hoja 'Cartera' con 60,000 filas ficticias de forma masiva y optimizada.
 * Utiliza setValues en bloque para evitar agotar las cuotas de Google Apps Script.
 */
function generar60kFilasFicticias() {
  Logger.log("Iniciando generación de 60,000 filas de cartera...");
  const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
  
  // Guardamos las cabeceras originales
  const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
  const headers = ["ID", "Fecha", "ID_Tercero", "Origen_ID", "Total", "Saldo", "Tipo", "Estado", "Fecha_Vencimiento", "Vencida_Timestamp", "Version"];
  
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  const totalRows = 60000;
  const batchSize = 10000; // Procesar en bloques de 10k para no saturar la memoria del script durante el llenado
  
  const baseDate = new Date();
  
  for (let batch = 0; batch < totalRows; batch += batchSize) {
    const rows = [];
    for (let i = 0; i < batchSize; i++) {
      const idx = batch + i;
      rows.push([
        "CXC_TEST_60K_" + idx, // ID
        baseDate,              // Fecha
        "TERC001",             // ID_Tercero (NIT existente)
        "ORIG_SALE_" + idx,    // Origen_ID
        150000,                // Total
        150000,                // Saldo
        "CxC",                 // Tipo
        "ABIERTA",             // Estado
        new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000), // Fecha_Vencimiento (30 días en el futuro)
        "",                    // Vencida_Timestamp
        1                      // Version
      ]);
    }
    sheet.getRange(2 + batch, 1, batchSize, headers.length).setValues(rows);
    Logger.log("Bloque escrito: " + (batch + batchSize) + " / " + totalRows);
  }
  
  Logger.log("Generación masiva completada con éxito. Hoja de Cartera tiene: " + sheet.getLastRow() + " filas.");
}

/**
 * Mide el rendimiento de la paginación de la Cartera.
 * Recupera la primera página de 1,000 registros y mide el tiempo de respuesta.
 * Debe completarse en menos de 3.0 segundos (3,000 ms).
 */
function testMedirTiempoPrimeraPagina() {
  Logger.log("Iniciando medición de velocidad para la primera página (1,000 registros)...");
  
  const start = Date.now();
  
  // Solicitamos la primera página (pageSize=1000, pageToken=0)
  const pageResult = DOMAIN.getCartera(null, null, 1000, 0);
  
  const duration = Date.now() - start;
  
  Logger.log("--- RESULTADOS DEL RENDIMIENTO ---");
  Logger.log("Registros devueltos en la primera página: " + (pageResult.items ? pageResult.items.length : 0));
  Logger.log("Siguiente página (Token): " + pageResult.nextPageToken);
  Logger.log("Tiempo de ejecución: " + duration + " ms");
  
  const passSpeed = duration < 3000;
  const passRows = pageResult.items && pageResult.items.length === 1000;
  
  Logger.log("Rendimiento dentro del límite (< 3s): " + (passSpeed ? "SÍ (PASS)" : "NO (FAIL)"));
  Logger.log("Cantidad correcta de registros en página: " + (passRows ? "SÍ (PASS)" : "NO (FAIL)"));
  
  const testPassed = passSpeed && passRows;
  Logger.log("Resultado General de la Prueba: " + (testPassed ? "PASS" : "FAIL"));
  return testPassed;
}

/**
 * Restaura la hoja de Cartera vaciándola y dejándola limpia.
 */
function limpiar60kFilas() {
  Logger.log("Limpiando filas ficticias de la cartera...");
  const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
  const headers = ["ID", "Fecha", "ID_Tercero", "Origen_ID", "Total", "Saldo", "Tipo", "Estado", "Fecha_Vencimiento", "Vencida_Timestamp", "Version"];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  Logger.log("Limpieza completada.");
}

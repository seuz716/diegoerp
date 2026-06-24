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

// ════════════════════════════════════════════
// PRUEBAS UNITARIAS — MÓDULO COMPRAS
// ════════════════════════════════════════════

function testRegistrarCompra() {
  Logger.log("[TEST] ===== testRegistrarCompra =====");
  try {
    var terceros = CACHE.getTerceros();
    var proveedor = null;
    for (var i = 0; i < terceros.length; i++) {
      var t = terceros[i];
      if ((t.tipo === "PROVEEDOR" || t.tipo === "AMBOS") && t.activo === "ACTIVO") {
        proveedor = t;
        break;
      }
    }
    if (!proveedor) {
      Logger.log("[TEST] No se encontró proveedor activo. Usando el primer tercero como prueba.");
      proveedor = terceros[0];
    }
    Logger.log("[TEST] Proveedor: " + proveedor.id + " - " + proveedor.nombre);

    var items = [
      { id: "PROD-001", cantidad: 2, precio_unitario: 50000 },
      { id: "PROD-002", cantidad: 1, precio_unitario: 120000 },
    ];
    var total = 2 * 50000 + 1 * 120000;
    var result = DOMAIN.registrarCompraAtomic(proveedor.id, items, total, null, "FAC-TEST-001");
    Logger.log("[TEST] Resultado: " + JSON.stringify(result));
    return result;
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testVencimientosProximos() {
  Logger.log("[TEST] ===== testVencimientosProximos =====");
  try {
    var v7 = DOMAIN.getVencimientosProximos(7);
    var v30 = DOMAIN.getVencimientosProximos(30);
    Logger.log("[TEST] Próximos 7 días: " + v7.length + " items");
    Logger.log("[TEST] Próximos 30 días: " + v30.length + " items");
    return { dias7: v7.length, dias30: v30.length, muestra: v7.slice(0, 3) };
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testRankingDeudores() {
  Logger.log("[TEST] ===== testRankingDeudores =====");
  try {
    var ranking = DOMAIN.getRankingDeudores(5);
    Logger.log("[TEST] Top deudores: " + JSON.stringify(ranking));
    return ranking;
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testConcentracionProveedores() {
  Logger.log("[TEST] ===== testConcentracionProveedores =====");
  try {
    var conc = DOMAIN.getConcentracionProveedores();
    Logger.log("[TEST] Concentración: " + JSON.stringify(conc));
    return conc;
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testMigrarDatosCompras() {
  Logger.log("[TEST] ===== testMigrarDatosCompras =====");
  try {
    var result = migrarDatosCompras();
    Logger.log("[TEST] Resultado: " + JSON.stringify(result));
    return result;
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

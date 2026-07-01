
/**
 * Entry point — GAS Web App
 */
function doGet(e) {
  try {
    // Auto-configurar SPREADSHEET_ID si viene como parámetro en la URL
    if (e && e.parameter && e.parameter.ssid) {
      PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", e.parameter.ssid);
      Logger.log("INFO: SPREADSHEET_ID configurado desde parámetro URL");
    }
    
    // Verificar si ya hay SPREADSHEET_ID configurado
    const ssId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    
    if (!ssId && !e.parameter?.ssid) {
      // Intentar obtener del spreadsheet activo si está vinculado
      try {
        const activeSs = SpreadsheetApp.getActiveSpreadsheet();
        if (activeSs) {
          PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", activeSs.getId());
          Logger.log("INFO: SPREADSHEET_ID auto-detectado del spreadsheet activo");
        }
      } catch (e) {
        Logger.log("WARN: No se pudo obtener spreadsheet activo: " + e.message);
      }
    }
    
    if (e && e.parameter && e.parameter.health !== undefined) {
      return handleHealthCheck();
    }
    validateAndMapSchemas();
  } catch (err) {
    Logger.log("ERROR doGet: " + err.message);
    const html = HtmlService.createHtmlOutput(
      '<html><body><h2>Error de configuración</h2>' +
      '<p>' + err.message + '</p>' +
      '<p><strong>Solución:</strong> Visita esta URL con el parámetro ssid:</p>' +
      '<code>https://script.google.com/macros/s/AKfycbzM7IMFbsWlzD3tmDgQtD6FytBpxEQupohTMylvH7I/exec?ssid=1hPpL-9ay6DNRDTBKy84r_M3pCnEGU6hJRdCzUQyJFoc</code>' +
      '</body></html>'
    );
    return html;
  }
  const tpl = HtmlService.createTemplateFromFile('index_v3_SaaS');
  const defaultDesc = 'Sistema profesional de gestión de cartera con facturación DIAN, contabilidad, inventario y alertas automáticas de vencimientos.';
  tpl.pageTitle = 'MicroERP · Cartera Pro';
  tpl.ogTitle = 'MicroERP · Cartera Pro';
  tpl.ogDescription = defaultDesc;
  tpl.ogImage = 'https://placehold.co/1200x630/1A1814/D4A82A/png?text=MicroERP+Cartera';
  tpl.ogUrl = ScriptApp.getService().getUrl();
  return tpl.evaluate()
    .setTitle('MicroERP · Cartera Pro')
    .setFaviconUrl('data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 64 64\'><rect width=\'64\' height=\'64\' rx=\'12\' fill=\'%233A7B6D\'/><text x=\'32\' y=\'44\' text-anchor=\'middle\' font-size=\'36\' fill=\'white\' font-family=\'system-ui\'>μ</text></svg>');
}

function handleHealthCheck() {
  const checks = {
    timestamp: new Date().toISOString(),
    status: "OK",
    sheets: {},
    cache: null,
    triggers: null,
    errors: [],
  };

  try {
    // Check sheets exist
    const ss = getActiveSpreadsheet();
    const sheetNames = ["Terceros", "Cartera", "Movimientos_Cartera", "AUDIT_LOG", "Productos"];
    for (const name of sheetNames) {
      const sheet = ss.getSheetByName(name);
      checks.sheets[name] = sheet ? { exists: true, rows: sheet.getLastRow() } : { exists: false };
      if (!sheet) {
        checks.errors.push("Hoja faltante: " + name);
      }
    }
  } catch (e) {
    checks.errors.push("Error accediendo sheets: " + e.message);
    checks.status = "DEGRADED";
  }

  try {
    // Check cache state
    checks.cache = {
      tercerosValid: CACHE && CACHE.isTercerosValid ? CACHE.isTercerosValid() : false,
      carteraValid: CACHE && CACHE.isCarteraValid ? CACHE.isCarteraValid() : false,
    };
  } catch (e) {
    checks.errors.push("Error checking cache: " + e.message);
  }

  try {
    // Check triggers
    const triggers = ScriptApp.getProjectTriggers();
    const expectedHandlers = ["actualizarVencimientos", "revisarInventario", "cleanupExpiredLocks"];
    const activeFunctions = triggers.map(t => t.getHandlerFunction());
    const missingHandlers = expectedHandlers.filter(f => activeFunctions.indexOf(f) === -1);

    checks.triggers = {
      count: triggers.length,
      functions: activeFunctions,
      missing: missingHandlers,
    };

    if (missingHandlers.length > 0) {
      checks.errors.push("Triggers faltantes: " + missingHandlers.join(", "));
    }
  } catch (e) {
    checks.errors.push("Error checking triggers: " + e.message);
  }

  if (checks.errors.length > 0) {
    checks.status = "DEGRADED";
  }

  const output = HtmlService.createHtmlOutput(JSON.stringify(checks, null, 2));
  output.setTitle("MicroERP · Health Check");
  return output;
}

/**
 * Envía notificación por email cuando un trigger falla.
 * Usa LockService para evitar inundación de correos en fallos consecutivos.
 */
function _notificarErrorTrigger(context, error) {
  const cache = CacheService.getScriptCache();
  const dedupKey = "TRIGGER_ERR_" + context;
  const lastSent = cache.get(dedupKey);
  if (lastSent) return; // ya se notificó en los últimos 10 min

  try {
    const adminEmail = SESSION_SERVICE.getCurrentUser().getEmail();
    if (adminEmail) {
      MailApp.sendEmail({
        to: adminEmail,
        subject: "[MicroERP] Error en trigger: " + context,
        body: "Error en " + context + ": " + (error.message || String(error)) + "\n\nTimestamp: " + new Date().toISOString(),
      });
    }
  } catch (_) {}

  cache.put(dedupKey, "1", 600); // no repetir por 10 min
}

/**
 * Public function to get health status from frontend or clasp calls.
 */
function getHealthStatus() {
  return JSON.parse(handleHealthCheck().getContent());
}

/**
 * Diagnostico: Verificar datos de cartera directamente desde console GAS
 */
function Main_getCarteraDebug(filtroTipo, filtroEstado) {
   const result = { checks: {}, errors: [] };
   try {
     const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
     result.checks.sheetExists = !!sheet;
     if (!sheet) {
       result.errors.push("La hoja Cartera no existe");
       return result;
     }
     result.checks.sheetLastRow = sheet.getLastRow();
     const colCount = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.CARTERA)) + 1;
     if (result.checks.sheetLastRow < 2) {
       result.errors.push("La hoja Cartera está vacía");
       return result;
     }
     const rawData = sheet.getRange(2, 1, result.checks.sheetLastRow - 1, colCount).getValues();
     result.checks.rawDataCount = rawData.length;
     const tiposSet = {};
     for (let i = 0; i < rawData.length; i++) {
       const tipo = String(rawData[i][CARTERA_CONFIG.COLUMNS.CARTERA.tipo] || '').trim();
       if (tipo) tiposSet[tipo] = (tiposSet[tipo] || 0) + 1;
     }
     result.checks.tiposEnHoja = Object.keys(tiposSet);
     try {
       const apiResult = DOMAIN.getCartera(filtroTipo, filtroEstado, 5, 0);
       result.checks.apiResult = {
         itemsCount: apiResult && apiResult.items ? apiResult.items.length : 0,
         error: null
       };
     } catch (e) {
       result.checks.apiResult = { itemsCount: 0, error: e.message };
     }
   } catch (e) {
     result.errors.push(e.message);
   }
   return result;
 }

function debugCartera() {
  try {
    CACHE.invalidate(); // Forzar refresh fresco
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const lastRow = sheet.getLastRow();
    const colCount = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.CARTERA)) + 1;
    
    Logger.log("DEBUG CARTERA: sheet=%s, lastRow=%s, cols=%s", 
      CARTERA_CONFIG.SHEETS.CARTERA, lastRow, colCount);
    
    if (lastRow < 2) {
      Logger.log("DEBUG CARTERA: No hay datos (lastRow < 2)");
      return { success: true, count: 0, message: "No hay datos en hoja Cartera", sheetRows: 0 };
    }
    
    // Leer directamente de la hoja
    const data = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
    Logger.log("DEBUG CARTERA: datos leidos=%s", data.length);
    
    // Analizar tipos reales en la hoja
    const tiposEncontrados = {};
    const estadosEncontrados = {};
    for (let i = 0; i < data.length; i++) {
      const tipo = String(data[i][6] || "").trim(); // Columna Tipo
      const estado = String(data[i][7] || "").trim(); // Columna Estado
      if (tipo) tiposEncontrados[tipo] = (tiposEncontrados[tipo] || 0) + 1;
      if (estado) estadosEncontrados[estado] = (estadosEncontrados[estado] || 0) + 1;
    }
    Logger.log("DEBUG CARTERA: tipos en hoja=%s", JSON.stringify(tiposEncontrados));
    Logger.log("DEBUG CARTERA: estados en hoja=%s", JSON.stringify(estadosEncontrados));
    
    // Verificar DAO sin filtro
    const daoResult = DAO.getCartera();
    Logger.log("DEBUG CARTERA: DAO getCartera() returned items=%s", daoResult?.items?.length || 0);
    
    // Verificar Domain sin filtro
    const domainResult = DOMAIN.getCartera();
    Logger.log("DEBUG CARTERA: DOMAIN getCartera() returned items=%s", domainResult?.items?.length || 0);
    
    // Test con filtro CxC específico
    const cxcResult = DAO.getCartera("CxC", null);
    Logger.log("DEBUG CARTERA: DAO getCartera('CxC') returned items=%s", cxcResult?.items?.length || 0);
    
    return { 
      success: true, 
      count: daoResult?.items?.length || 0,
      sheetRows: lastRow - 1,
      rawRows: data.length,
      tiposEnHoja: tiposEncontrados,
      estadosEnHoja: estadosEncontrados,
      sample: data.slice(0, 5).map(r => ({
        id: r[0], 
        id_tercero: r[2], 
        tipo: r[6], 
        estado: r[7],
        saldo: r[5]
      }))
    };
  } catch (e) {
    Logger.log("DEBUG CARTERA ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testCarteraSimple() {
  try {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const lastRow = sheet.getLastRow();
    Logger.log("testCarteraSimple: Sheet exists, lastRow=%s", lastRow);
    return lastRow;
  } catch(e) {
    Logger.log("testCarteraSimple ERROR: " + e.toString());
    throw e;
  }
}

/**
 * Verificar configuración de IA - diagnóstico
 */
function checkIAKey() {
  try {
    const hasKey = AuthService.hasApiKey("GEMINI_API_KEY");
    Logger.log("checkIAKey: hasApiKey=%s", hasKey);
    
    if (hasKey) {
      // Do not log key length - security best practice
      return { 
        success: true, 
        hasKey: true, 
        proxyUrl: PropertiesService.getScriptProperties().getProperty("SECRET_PROXY_URL") ? "CONFIGURED" : null
      };
    }
    return { success: true, hasKey: false };
  } catch (e) {
    Logger.log("checkIAKey ERROR: " + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * Configurar Gemini API Key - Guárdala desde el editor
 * ⚠️ Ejecutar desde el editor con el usuario que la usará
 */
function setupGeminiKeyFromPrompt() {
  const key = Browser.inputBox("Configurar Gemini API Key", "Pega tu API key de Gemini:", Browser.Buttons.OK_CANCEL);
  if (key === "cancel") return { success: false, cancelled: true };
  
  try {
    AuthService.setApiKey("GEMINI_API_KEY", key);
    Logger.log("✅ Gemini API Key configurada correctamente");
    return { success: true, message: "API Key configurada correctamente" };
  } catch (e) {
    Logger.log("ERROR setupGeminiKeyFromPrompt: " + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * Auto-configurar SPREADSHEET_ID basado en la hoja vinculada al script
 */
function autoConfigureSpreadsheetId() {
  try {
    // Obtener la hoja activa del script
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      // Intentar desde la hoja activa si existe
      const activeSs = SpreadsheetApp.getActive();
      if (activeSs) {
        const ssId = activeSs.getId();
        PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ssId);
        Logger.log("✅ SPREADSHEET_ID auto-configurado: " + ssId);
        return { success: true, spreadsheetId: ssId, message: "SPREADSHEET_ID configurado automáticamente" };
      }
      return { success: false, error: "No se encontró spreadsheet activo. Vincule el script a una hoja." };
    }
    const ssId = ss.getId();
    PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ssId);
    Logger.log("✅ SPREADSHEET_ID auto-configurado: " + ssId);
    return { success: true, spreadsheetId: ssId, message: "SPREADSHEET_ID configurado automáticamente" };
  } catch (e) {
    Logger.log("ERROR autoConfigureSpreadsheetId: " + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * Configurar SPREADSHEET_ID manualmente
 */
function setSpreadsheetId(ssId) {
  if (!ssId || ssId.length < 10) {
    return { success: false, error: "ID de spreadsheet inválido" };
  }
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ssId);
  Logger.log("✅ SPREADSHEET_ID configurado: " + ssId);
  return { success: true, spreadsheetId: ssId };
}

/**
 * Inicializa el sistema después del renombrado de archivos .js → .gs.
 * Recarga esquemas, valida estructura de hojas y registra el resultado.
 * Ejecutar UNA SOLA VEZ desde el editor de Apps Script después de la migración.
 */
function inicializarSistema() {
  try {
    Logger.log("[MIGRACION] Iniciando inicializarSistema()...");
    const resultado = CONFIG.reloadSchema();
    Logger.log("[MIGRACION] reloadSchema ejecutado: " + JSON.stringify(resultado));
    const reporte = CONFIG.getSchemaReport();
    Logger.log("[MIGRACION] Reporte de esquemas: " + JSON.stringify(reporte));
    Logger.log("[MIGRACION] Sistema inicializado correctamente.");
    return {
      success: true,
      schemaChanges: resultado,
      schemaReport: reporte,
      message: "Sistema inicializado correctamente. Todos los esquemas están validados."
    };
  } catch (e) {
    Logger.log("[MIGRACION] Error en inicializarSistema: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

/**
 * Migración de estructura: agrega columnas nuevas a la hoja Cartera de forma segura.
 * Idempotente: se puede ejecutar varias veces sin dañar datos existentes.
 * Agrega Numero_Factura después de la columna Origen_ID.
 */
function migrarEstructuraCompras() {
  try {
    Logger.log("[MIGRACION] Iniciando migrarEstructuraCompras()...");
    const ss = getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CARTERA_CONFIG.SHEETS.CARTERA);
    if (!sheet) {
      return { success: false, error: "Hoja Cartera no encontrada" };
    }
    const lastCol = sheet.getLastColumn();
    const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const headerNames = headers.map(function(h) { return String(h || "").trim(); });
    const cambios = [];

    // --- Agregar Numero_Factura ---
    if (headerNames.indexOf("Numero_Factura") === -1) {
      const colIdx = headerNames.indexOf("Origen_ID");
      if (colIdx === -1) colIdx = headerNames.length;
      const insertAt = colIdx + 1;
      sheet.insertColumnAfter(insertAt);
      sheet.getRange(1, insertAt).setValue("Numero_Factura");
      cambios.push("Numero_Factura agregada en columna " + insertAt);
      Logger.log("[MIGRACION] Columna Numero_Factura agregada en posición " + insertAt);
    } else {
      Logger.log("[MIGRACION] Numero_Factura ya existe, saltando.");
    }

    // Recargar esquemas después de los cambios
    CONFIG.reloadSchema();

    Logger.log("[MIGRACION] migrarEstructuraCompras() completado: " + JSON.stringify(cambios));
    return { success: true, cambios: cambios };
  } catch (e) {
    Logger.log("[MIGRACION] Error en migrarEstructuraCompras: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

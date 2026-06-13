/**
 * Entry point — GAS Web App
 */
function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.health !== undefined) {
      return handleHealthCheck();
    }
    validateAndMapSchemas();
  } catch (err) {
    Logger.log("ERROR doGet schema validation: " + err.message);
    return HtmlService.createHtmlOutput("Error de inicialización. Contacte al administrador.");
  }
  return HtmlService.createTemplateFromFile('index_v3_SaaS')
    .evaluate()
    .setTitle('MicroERP · Cartera Pro');
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
    const adminEmail = Session.getActiveUser().getEmail();
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
  var result = { checks: {}, errors: [] };
  try {
    var sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    result.checks.sheetExists = !!sheet;
    if (!sheet) {
      result.errors.push("La hoja Cartera no existe");
      return result;
    }
    result.checks.sheetLastRow = sheet.getLastRow();
    var colCount = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.CARTERA)) + 1;
    if (result.checks.sheetLastRow < 2) {
      result.errors.push("La hoja Cartera está vacía");
      return result;
    }
    var rawData = sheet.getRange(2, 1, result.checks.sheetLastRow - 1, colCount).getValues();
    result.checks.rawDataCount = rawData.length;
    var tiposSet = {};
    for (var i = 0; i < rawData.length; i++) {
      var tipo = String(rawData[i][CARTERA_CONFIG.COLUMNS.CARTERA.tipo] || '').trim();
      if (tipo) tiposSet[tipo] = (tiposSet[tipo] || 0) + 1;
    }
    result.checks.tiposEnHoja = Object.keys(tiposSet);
    try {
      var apiResult = DOMAIN.getCartera(filtroTipo, filtroEstado, 5, 0);
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
    var sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    var lastRow = sheet.getLastRow();
    var colCount = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.CARTERA)) + 1;
    
    Logger.log("DEBUG CARTERA: sheet=%s, lastRow=%s, cols=%s", 
      CARTERA_CONFIG.SHEETS.CARTERA, lastRow, colCount);
    
    if (lastRow < 2) {
      Logger.log("DEBUG CARTERA: No hay datos (lastRow < 2)");
      return { success: true, count: 0, message: "No hay datos en hoja Cartera", sheetRows: 0 };
    }
    
    // Leer directamente de la hoja
    var data = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
    Logger.log("DEBUG CARTERA: datos leidos=%s", data.length);
    
    // Verificar DAO
    var daoResult = DAO.getCartera();
    Logger.log("DEBUG CARTERA: DAO getCartera returned items=%s", daoResult?.items?.length || 0);
    
    return { 
      success: true, 
      count: daoResult?.items?.length || 0,
      sheetRows: lastRow - 1,
      rawRows: data.length,
      sample: data.slice(0, 2).map(r => ({id: r[0], id_tercero: r[2]}))
    };
  } catch (e) {
    Logger.log("DEBUG CARTERA ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testCarteraSimple() {
  try {
    var sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    var lastRow = sheet.getLastRow();
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
      const key = AuthService.getApiKey("GEMINI_API_KEY");
      Logger.log("checkIAKey: Key length=%s (masked)", key ? key.length : 0);
      return { 
        success: true, 
        hasKey: true, 
        keyLength: key ? key.length : 0,
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

/**
 * Entry point — GAS Web App
 * Sanitiza todos los parámetros URL antes de procesarlos.
 * Configuración de ssid requiere token de seguridad.
 */
function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};

    if (params.ssid) {
      try {
        // 🔒 SECURITY FIX: Requerir token para configuración remota de ssid
        if (!params.token) {
          Logger.log("WARN: ssid configuración rechazada - token no proporcionado");
          // No exponer error al cliente, continuar sin cambiar ssid
        } else {
          const storedToken = PropertiesService.getScriptProperties().getProperty("SETUP_TOKEN");
          if (!storedToken || params.token !== storedToken) {
            Logger.log("WARN: ssid configuración rechazada - token inválido");
            // No exponer error al cliente, continuar sin cambiar ssid
          } else {
            const ssid = INPUT_VALIDATOR.validateId(params.ssid);
            if (ssid && /^[a-zA-Z0-9-_]+$/.test(ssid)) {
              // Validar que el spreadsheet es accesible
              try {
                SpreadsheetApp.openById(ssid);
                PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ssid);
                Logger.log("INFO: SPREADSHEET_ID configurado desde parámetro URL (validado con token)");
                // Revocar token después de uso (one-time)
                PropertiesService.getScriptProperties().deleteProperty("SETUP_TOKEN");
                Logger.log("INFO: SETUP_TOKEN revocado tras uso exitoso");
              } catch (ssErr) {
                Logger.log("WARN: ssid no accesible: " + ssErr.message);
              }
            } else {
              Logger.log("WARN: ssid inválido rechazado: " + params.ssid);
            }
          }
        }
      } catch (err) {
        Logger.log("WARN: ssid inválido: " + err.message);
      }
    }

    if (params.health === '1') {
      return handleHealthCheck();
    }

    const ssId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (!ssId) {
      try {
        const activeSs = SpreadsheetApp.getActiveSpreadsheet();
        if (activeSs) {
          PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", activeSs.getId());
          Logger.log("INFO: SPREADSHEET_ID auto-detectado del spreadsheet activo");
        }
      } catch (err) {
        Logger.log("WARN: No se pudo obtener spreadsheet activo: " + err.message);
      }
    }

    validateAndMapSchemas();

    const tpl = HtmlService.createTemplateFromFile('index_v3_SaaS');
    tpl.pageTitle = 'MicroERP · Cartera Pro';
    tpl.ogTitle = 'MicroERP · Cartera Pro';
    tpl.ogDescription = 'Sistema profesional de gestión de cartera con libro diario contable exportable, contabilidad, inventario y alertas automáticas de vencimientos.';
    tpl.ogImage = 'https://placehold.co/1200x630/1A1814/D4A82A/png?text=MicroERP+Cartera';
    tpl.ogUrl = ScriptApp.getService().getUrl();

    return tpl.evaluate()
      .setTitle('MicroERP · Cartera Pro')
      .setFaviconUrl('https://placehold.co/64x64/1A1814/D4A82A/png')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);

  } catch (err) {
    Logger.log("ERROR doGet: " + err.message);
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<title>Error - MicroERP</title><meta name="robots" content="noindex, nofollow">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '</head><body><h2>Error de configuración</h2>' +
      '<p>' + err.message + '</p>' +
      '<p><strong>Solución:</strong> Ejecuta la función generateSetupToken() desde el editor.</p>' +
      '</body></html>'
    );
  }
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

  const output = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
    '<title>Health Check - MicroERP</title><meta name="robots" content="noindex, nofollow">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '</head><body><pre>' + JSON.stringify(checks, null, 2) + '</pre></body></html>'
  );
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
      let stale = false;
      let ageDays = null;
      try {
        const status = AuthService.getSecretStatus("GEMINI_API_KEY");
        stale = !!status.stale;
        ageDays = status.ageDays != null ? Math.floor(status.ageDays) : null;
      } catch (_) {}
      // Do not log key length - security best practice
      return { 
        success: true, 
        hasKey: true, 
        stale: stale,
        ageDays: ageDays,
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
    
    // Setup backup and export triggers
    if (typeof setupBackupAndExports === 'function') {
      setupBackupAndExports();
      Logger.log("[MIGRACION] Triggers de backup y export configurados");
    }
    
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

/**
 * Generate a one-time setup token for remote SPREADSHEET_ID configuration.
 * Execute this from the Apps Script editor to get a token for secure setup.
 * @returns {Object} Contains the token and full setup URL
 */
function generateSetupToken() {
  try {
    const token = Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty("SETUP_TOKEN", token);
    const scriptUrl = ScriptApp.getService().getUrl();
    Logger.log("=== SETUP TOKEN GENERATED ===");
    Logger.log("Token: " + token);
    Logger.log("Use URL: " + scriptUrl + "?ssid=YOUR_SSID&token=" + token);
    Logger.log("============================");
    return {
      success: true,
      token: token,
      message: "Token generado. Revisa los logs para obtener la URL completa."
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Revoke the current setup token (if any exists).
 * @returns {Object} Result of revocation
 */
function revokeSetupToken() {
  try {
    const hadToken = PropertiesService.getScriptProperties().getProperty("SETUP_TOKEN");
    PropertiesService.getScriptProperties().deleteProperty("SETUP_TOKEN");
    return {
      success: true,
      revoked: !!hadToken,
      message: hadToken ? "Token revocado exitosamente" : "No había token activo"
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

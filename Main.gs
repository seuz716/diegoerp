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

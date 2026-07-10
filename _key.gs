/**
 * ADVERTENCIA DE SEGURIDAD:
 * No hardcodees API keys en este archivo ni en ningún otro del proyecto.
 * 
 * Las API keys deben configurarse en tiempo de ejecución vía:
 *   AuthService.setApiKey("GEMINI_API_KEY", "tu-key-aqui")
 * 
 * O mediante el Secret Proxy externo:
 *   PROXY_SECRET_SERVICE.setEndpointUrl("https://tu-proxy.com")
 *   PROXY_SECRET_SERVICE.setHmacSecret("tu-hmac-secret")
 * 
 * Este archivo se mantiene vacío intencionalmente.
 */

function _verificarConfiguracionSegura() {
  let hasLocalKey = false;
  let hasProxy = false;
  let error = null;
  let secretStatus = null;
  try {
    hasLocalKey = AuthService.hasApiKey("GEMINI_API_KEY");
    hasProxy = !!PropertiesService.getScriptProperties().getProperty("SECRET_PROXY_URL");
    try { secretStatus = AuthService.getSecretStatus("GEMINI_API_KEY"); } catch (_) { secretStatus = null; }
  } catch (e) {
    // K-04: do not silently swallow. Surface the failure instead of masking a broken subsystem.
    error = (e && e.message) ? e.message : String(e);
    if (typeof LogService !== 'undefined' && LogService && typeof LogService.logError === 'function') {
      LogService.logError("ConfiguracionSegura: fallo en verificacion", { functionName: '_verificarConfiguracionSegura', error: error });
    } else {
      Logger.log("[SEC] _verificarConfiguracionSegura ERROR: " + error);
    }
  }

  // If the key subsystem threw (e.g. AuthService undefined), it is NOT configured.
  if (error) {
    return { configured: false, message: "Subsistema de claves no operativo: " + error };
  }

  // K-04: mere presence of a proxy URL is not proof of configuration.
  // configured:true requires an actually resolvable key (local or working proxy).
  if (!hasLocalKey) {
    // Usa AuthService.setApiKey("GEMINI_API_KEY", "tu-key-aqui")
    // o configura un Secret Proxy externo funcional.
    const message = hasProxy
      ? "Proxy configurado pero no resuelve una API key válida"
      : "API key no configurada";
    return { configured: false, message: message };
  }
  // K-05: flag stale keys that exceed the rotation window
  if (secretStatus && secretStatus.stale) {
    return {
      configured: true,
      stale: true,
      ageDays: secretStatus.ageDays != null ? Math.floor(secretStatus.ageDays) : null,
      maxAgeDays: secretStatus.maxAgeDays,
      message: "API key requiere rotación (configurada hace " +
        (secretStatus.ageDays != null ? Math.floor(secretStatus.ageDays) : "?") +
        " días, máximo " + secretStatus.maxAgeDays + ")"
    };
  }
  return { configured: true };
}

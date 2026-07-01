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
  try {
    hasLocalKey = AuthService.hasApiKey("GEMINI_API_KEY");
    hasProxy = !!PropertiesService.getScriptProperties().getProperty("SECRET_PROXY_URL");
  } catch (e) {}
  if (!hasLocalKey && !hasProxy) {
    // Usa AuthService.setApiKey("GEMINI_API_KEY", "tu-key-aqui")
    // o configura un Secret Proxy externo.
    return { configured: false, message: "API key no configurada" };
  }
  return { configured: true };
}

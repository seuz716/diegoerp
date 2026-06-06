/**
 * Entry point — GAS Web App
 */
function doGet(e) {
  try {
    validateAndMapSchemas();
  } catch (err) {
    return HtmlService.createHtmlOutput("Error de inicialización del esquema: " + err.message);
  }
  return HtmlService.createTemplateFromFile('index_v3_SaaS')
    .evaluate()
    .setTitle('MicroERP · Cartera Pro')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

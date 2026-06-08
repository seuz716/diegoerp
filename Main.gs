/**
 * Entry point — GAS Web App
 */
function doGet(e) {
  try {
    validateAndMapSchemas();
  } catch (err) {
    Logger.log("ERROR doGet schema validation: " + err.message);
    return HtmlService.createHtmlOutput("Error de inicialización. Contacte al administrador.");
  }
  return HtmlService.createTemplateFromFile('index_v3_SaaS')
    .evaluate()
    .setTitle('MicroERP · Cartera Pro')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.SAMEORIGIN);
}

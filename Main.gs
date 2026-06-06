/**
 * Entry point — GAS Web App
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index_v3_SaaS')
    .evaluate()
    .setTitle('MicroERP · Cartera Pro')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

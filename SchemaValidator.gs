// SchemaValidator.gs — delegado a CONFIG
function validateAndMapSchemas() {
  if (_schemaValidated) return;
  CONFIG.reloadSchema();
}

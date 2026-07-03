/**
 * Smoke Tests para validar el sistema después de cada despliegue.
 * Estas pruebas se ejecutan para verificar el estado básico del sistema.
 */

const SmokeTests = {
  /**
   * Ejecuta todas las pruebas de humo.
   * @returns {Object} { success: boolean, results: Array, summary: string }
   */
  runAll() {
    const results = [];
    let allPassed = true;
    
    // 1. Health Check
    try {
      const result = this.testHealthCheck();
      results.push({ name: 'Health Check', passed: true, message: result });
    } catch (e) {
      results.push({ name: 'Health Check', passed: false, message: e.message });
      allPassed = false;
    }
    
    // 2. Hojas de datos
    try {
      const result = this.testSheetsExist();
      results.push({ name: 'Sheets Exist', passed: true, message: result });
    } catch (e) {
      results.push({ name: 'Sheets Exist', passed: false, message: e.message });
      allPassed = false;
    }
    
    // 3. Funciones críticas
    try {
      const result = this.testCriticalFunctions();
      results.push({ name: 'Critical Functions', passed: true, message: result });
    } catch (e) {
      results.push({ name: 'Critical Functions', passed: false, message: e.message });
      allPassed = false;
    }
    
    // 4. Configuración
    try {
      const result = this.testConfiguration();
      results.push({ name: 'Configuration', passed: true, message: result });
    } catch (e) {
      results.push({ name: 'Configuration', passed: false, message: e.message });
      allPassed = false;
    }
    
    // 5. Triggers
    try {
      const result = this.testTriggersExist();
      results.push({ name: 'Triggers', passed: result.passed, message: result.message });
      if (!result.passed) allPassed = false;
    } catch (e) {
      results.push({ name: 'Triggers', passed: false, message: e.message });
      allPassed = false;
    }
    
    return {
      success: allPassed,
      results: results,
      summary: allPassed ? '✅ All smoke tests passed' : '❌ Some tests failed'
    };
  },
  
  /**
   * Prueba 1: Health check.
   */
  testHealthCheck() {
    const health = typeof getHealthStatus !== 'undefined' ? getHealthStatus() : null;
    if (!health) {
      const cache = typeof CACHE !== 'undefined' && CACHE.getHealth ? CACHE.getHealth() : null;
      if (cache && typeof cache.terceros?.failCount === 'number') {
        return 'Health check via CACHE: OK';
      }
      throw new Error('getHealthStatus no disponible - verificar Main.gs');
    }
    var parsed;
    try {
      parsed = typeof health === 'string' ? JSON.parse(health) : health;
    } catch (_) {
      throw new Error('Health check: respuesta no es JSON válido');
    }
    if (parsed.status !== 'OK' && parsed.errors?.length > 0) {
      throw new Error('Health check errors: ' + parsed.errors.join(', '));
    }
    return 'Health check OK';
  },
  
  /**
   * Prueba 2: Verificar que las hojas críticas existen.
   */
  testSheetsExist() {
    const ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!ssId) throw new Error('SPREADSHEET_ID no configurado');
    
    if (typeof CARTERA_CONFIG === 'undefined' || typeof CONFIG === 'undefined' || typeof COMPRAS_CONFIG === 'undefined') {
      throw new Error('Configuración global no disponible (CARTERA_CONFIG, CONFIG o COMPRAS_CONFIG)');
    }
    
    const ss = SpreadsheetApp.openById(ssId);
    const expectedSheets = [
      CARTERA_CONFIG.SHEETS.TERCEROS,
      CARTERA_CONFIG.SHEETS.CARTERA,
      CONFIG.SHEETS.PRODUCTOS,
      COMPRAS_CONFIG.SHEETS.COMPRAS
    ].filter(Boolean);
    
    const existingSheets = ss.getSheets().map(s => s.getName());
    const missing = expectedSheets.filter(s => !existingSheets.includes(s));
    
    if (missing.length > 0) {
      throw new Error('Hojas faltantes: ' + missing.join(', '));
    }
    return 'Todas las hojas existen: ' + expectedSheets.join(', ');
  },
  
  /**
   * Prueba 3: Funciones críticas básicas.
   */
  testCriticalFunctions() {
    // getTerceros
    if (typeof getTerceros !== 'function') {
      throw new Error('getTerceros no existe');
    }
    
    // getProductos
    if (typeof getProductos !== 'function') {
      throw new Error('getProductos no existe');
    }
    
    // CACHE.getHealth
    if (typeof CACHE === 'undefined' || typeof CACHE.getHealth !== 'function') {
      throw new Error('CACHE.getHealth no existe');
    }
    
    // DAO_COMPRAS.getMovimientosKardex
    if (typeof DAO_COMPRAS === 'undefined' || typeof DAO_COMPRAS.getMovimientosKardex !== 'function') {
      throw new Error('DAO_COMPRAS.getMovimientosKardex no existe');
    }
    
    return 'Todas las funciones críticas existen y están disponibles';
  },
  
  /**
   * Prueba 4: Configuración.
   */
  testConfiguration() {
    const props = PropertiesService.getScriptProperties();
    const ssId = props.getProperty('SPREADSHEET_ID');
    
    if (!ssId) {
      throw new Error('SPREADSHEET_ID no configurado');
    }
    
    const geminiKey = props.getProperty('GEMINI_API_KEY');
    const geminiConfigured = !!geminiKey;
    
    return `SPREADSHEET_ID configurado. GEMINI_API_KEY ${geminiConfigured ? 'configurada' : 'no configurada (opcional)'}`;
  },
  
  /**
   * Prueba 5: Triggers.
   */
  testTriggersExist() {
    const triggers = ScriptApp.getProjectTriggers();
    const handlerFunctions = triggers.map(t => t.getHandlerFunction());
    
    const requiredTriggers = ['cleanupExpiredLocks'];
    const optionalTriggers = ['removeOrphanLocksTrigger'];
    const missingRequired = requiredTriggers.filter(t => !handlerFunctions.includes(t));
    const missingOptional = optionalTriggers.filter(t => !handlerFunctions.includes(t));
    
    var msg = 'Triggers presentes: ' + handlerFunctions.join(', ');
    if (missingRequired.length > 0) {
      msg += '. FALTAN obligatorios: ' + missingRequired.join(', ');
    }
    if (missingOptional.length > 0) {
      msg += '. Opcionales faltantes: ' + missingOptional.join(', ');
    }
    
    return {
      passed: missingRequired.length === 0,
      message: msg
    };
  }
};

/**
 * Ejecuta smoke tests y registra resultados.
 */
function runSmokeTests() {
  const result = SmokeTests.runAll();
  
  // Registrar en LogService si existe
  try {
    if (typeof LogService !== 'undefined') {
      LogService.logInfo('Smoke tests completed', { 
        functionName: 'runSmokeTests', 
        details: { success: result.success, summary: result.summary } 
      });
    }
  } catch (logErr) {
    Logger.log('Smoke tests log error: ' + logErr.message);
  }
  
  // Si falla y no se alertó en 12 horas, enviar alerta
  if (!result.success) {
    const lastAlert = PropertiesService.getScriptProperties().getProperty('LAST_SMOKE_ALERT');
    const now = Date.now();
    if (!lastAlert || (now - parseInt(lastAlert)) > 12 * 60 * 60 * 1000) {
      try {
        sendSmokeAlert(result);
        PropertiesService.getScriptProperties().setProperty('LAST_SMOKE_ALERT', String(now));
      } catch (alertErr) {
        Logger.log('Smoke alert error: ' + alertErr.message);
      }
    }
  }
  
  return result;
}

/**
 * Envía alerta por correo.
 */
function sendSmokeAlert(result) {
  try {
    var email = SESSION_SERVICE?.getCurrentUser?.()?.getEmail();
    if (!email) {
      email = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL') || 'admin@empresa.com';
    }
    const subject = '[MicroERP] Smoke Tests FALLARON después de deploy';
    let body = 'Smoke tests han fallado:\n\n';
    result.results.forEach(r => {
      body += `${r.passed ? '✅' : '❌'} ${r.name}: ${r.message}\n`;
    });
    MailApp.sendEmail(email, subject, body);
  } catch (e) {
    Logger.log('Error enviando alerta: ' + e.message);
  }
}
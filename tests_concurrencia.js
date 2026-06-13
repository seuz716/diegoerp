/**
 * Pruebas sugeridas por la Auditoría de Concurrencia
 * Valida que los bloqueos granulares operan sin asfixiar la cuota o el Lock Global
 */

function testConcurrentAbonos() {
  const users = 50;
  const results = [];

  Logger.log(`Iniciando test de concurrencia con ${users} simulacros...`);

    // Safe test: avoid writing to real spreadsheet unless explicitly enabled
  const REAL_TEST_ENABLED = false; // Set true to run against real data (use with caution)
  for (let i = 0; i < users; i++) {
    Utilities.sleep(Math.random() * 100); // Simular llegada asíncrona
    try {
      if (REAL_TEST_ENABLED) {
        // Ejecutar la operación real
        const result = DOMAIN.registrarAbonoAtomic('TERC001', 100, 'REF_TEST_' + i, 'CxC');
        results.push({ attempt: i, status: "OK", payload: result });
      } else {
        // Simular éxito sin tocar la hoja
        results.push({ attempt: i, status: "MOCK", payload: { simulated: true, ref: 'REF_TEST_' + i } });
      }
    } catch (e) {
      results.push({ attempt: i, status: "FAIL", error: e.toString() });
    }
  }

  // Verificar consistencia final
  const carteraResult = DOMAIN.getCartera();
  const cartera = carteraResult.items || [];
  const pendientes = cartera.filter(c => c.id_tercero === 'TERC001' && c.saldo > 0);
  
  Logger.log('Resumen de Transacciones: ' + JSON.stringify(results, null, 2));
  
  if (pendientes.length > 0) {
    const totalPendiente = pendientes.reduce((acc, c) => acc + c.saldo, 0);
    Logger.log(`Consistencia Final - Saldo actual TERC001: ${totalPendiente}`);
  } else {
    Logger.log('Consistencia Final - Sin cartera pendiente (Totalmente pagada).');
  }
}

/**
 * Simulación de dos ediciones simultáneas del mismo registro.
 * La Transacción A adquiere el lock primero. La Transacción B intenta adquirirlo,
 * realiza backoffs y finalmente falla limpiamente sin corromper ni pisar datos.
 */
function testSimulatedConcurrentEdits() {
  Logger.log("Iniciando prueba: testSimulatedConcurrentEdits...");
  
  const resourceId = "TERC_SIMULADO_CONCURRENTE";
  
  // Limpiamos cualquier lock previo
  PropertiesService.getScriptProperties().deleteProperty("LOCK_" + resourceId);
  
  // 1. La Transacción A adquiere el bloqueo sobre el recurso
  Logger.log("Transacción A: Intentando adquirir bloqueo sobre " + resourceId);
  const lockA = LOCK_MANAGER.acquireResourceLock(resourceId);
  Logger.log("Transacción A: Bloqueo adquirido exitosamente.");
  
  // 2. La Transacción B intenta adquirir el bloqueo sobre el mismo recurso.
  // Como A tiene el bloqueo, B debe esperar (backoff) y finalmente fallar o lanzar error limpio al agotar reintentos.
  Logger.log("Transacción B: Intentando adquirir bloqueo sobre el mismo recurso (debe fallar limpiamente)...");
  
  let lockB = null;
  let errorB = null;
  const startAttempt = Date.now();
  
  // Reducimos temporalmente el timeout de B para la simulación
  const originalTimeout = LOCK_MANAGER.RESOURCE_LOCK_TIMEOUT;
  const originalRetries = LOCK_MANAGER.MAX_RETRIES;
  
  try {
    LOCK_MANAGER.RESOURCE_LOCK_TIMEOUT = 2000; // 2 segundos max
    LOCK_MANAGER.MAX_RETRIES = 2; // 2 intentos max
    
    lockB = LOCK_MANAGER.acquireResourceLock(resourceId);
  } catch (e) {
    errorB = e;
  } finally {
    // Restauramos valores
    LOCK_MANAGER.RESOURCE_LOCK_TIMEOUT = originalTimeout;
    LOCK_MANAGER.MAX_RETRIES = originalRetries;
  }
  
  const duration = Date.now() - startAttempt;
  Logger.log("Transacción B: Terminó tras " + duration + "ms.");
  
  // 3. Liberamos el bloqueo de la Transacción A
  Logger.log("Transacción A: Liberando bloqueo...");
  lockA.releaseLock();
  Logger.log("Transacción A: Bloqueo liberado.");
  
  // 4. Verificaciones
  const passBFailedCleanly = (errorB !== null && (errorB.message.indexOf("No se pudo adquirir el bloqueo") !== -1 || errorB.message.indexOf("Timeout") !== -1));
  const passNoDataLost = (lockB === null); // B nunca obtuvo el lock, evitando condiciones de carrera
  
  Logger.log("Transacción B falló con error limpio esperado: " + (passBFailedCleanly ? "SÍ" : "NO") + " - Error: " + (errorB ? errorB.message : "Ninguno"));
  Logger.log("Consistencia de datos garantizada (B bloqueado): " + (passNoDataLost ? "SÍ" : "NO"));
  
  const testPassed = passBFailedCleanly && passNoDataLost;
  Logger.log("Resultado del Test de Simulación Concurrente: " + (testPassed ? "PASS" : "FAIL"));
  return testPassed;
}

function runAllConcurrencyTests() {
  Logger.log("═══════════════════════════════════════════════");
  Logger.log("INICIANDO PRUEBAS DE CONCURRENCIA");
  Logger.log("═══════════════════════════════════════════════");
  
  const tests = [
    testSimulatedConcurrentEdits
  ];
  
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      if (t()) passed++; else failed++;
    } catch (e) {
      Logger.log(t.name + ": ERROR — " + e.toString());
      failed++;
    }
  }
  
  Logger.log("═══════════════════════════════════════════════");
  Logger.log("RESULTADO CONCURRENCIA: " + passed + " pasaron, " + failed + " fallaron de " + tests.length);
  Logger.log("═══════════════════════════════════════════════");
  return { passed, failed, total: tests.length };
}

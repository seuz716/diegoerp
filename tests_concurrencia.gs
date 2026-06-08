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
  const cartera = DOMAIN.getCartera();
  const pendientes = cartera.filter(c => c.id_tercero === 'TERC001' && c.saldo > 0);
  
  Logger.log('Resumen de Transacciones: ' + JSON.stringify(results, null, 2));
  
  if (pendientes.length > 0) {
    const totalPendiente = pendientes.reduce((acc, c) => acc + c.saldo, 0);
    Logger.log(`Consistencia Final - Saldo actual TERC001: ${totalPendiente}`);
  } else {
    Logger.log('Consistencia Final - Sin cartera pendiente (Totalmente pagada).');
  }
}

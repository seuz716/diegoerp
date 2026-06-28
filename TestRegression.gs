/**
 * REGRESSION TESTS - Manual verification suite
 * Execute via: function runAllRegressionTests()
 */

const TEST_RESULTS = { passed: 0, failed: 0, tests: [] };

function _test(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      TEST_RESULTS.passed++;
      TEST_RESULTS.tests.push({ name, status: 'PASS', error: null });
      console.log('[PASS] ' + name);
    } else {
      TEST_RESULTS.failed++;
      TEST_RESULTS.tests.push({ name, status: 'FAIL', error: result });
      console.error('[FAIL] ' + name + ': ' + result);
    }
  } catch (e) {
    TEST_RESULTS.failed++;
    TEST_RESULTS.tests.push({ name, status: 'ERROR', error: e.message });
    console.error('[ERROR] ' + name + ': ' + e.message);
  }
}

function runAllRegressionTests() {
  TEST_RESULTS.passed = 0;
  TEST_RESULTS.failed = 0;
  TEST_RESULTS.tests = [];
  
  // ===== AuthService Tests =====
  _test('checkPermission requires auth for non-whitelisted action', () => {
    try {
      AuthService.checkPermission('registrar_abono');
      return 'Should have thrown - no email provided';
    } catch (e) {
      if (e.message.includes('requiere autenticación')) return true;
      return 'Wrong error: ' + e.message;
    }
  });
  
  _test('checkPermission allows safe action without identity', () => {
    try {
      AuthService.checkPermission('actualizarVencimientos');
      return true;
    } catch (e) {
      return 'Should not throw for safe action: ' + e.message;
    }
  });
  
  _test('checkPermission throws for unknown action', () => {
    try {
      AuthService.checkPermission('acción_fantasma');
      return 'Should have thrown - unknown action';
    } catch (e) {
      if (e.message.includes('desconocida')) return true;
      return 'Wrong error: ' + e.message;
    }
  });
  
  // ===== LockManager Tests =====
  _test('cleanupExpiredLocks returns valid structure', () => {
    const result = LOCK_MANAGER.cleanupExpiredLocks();
    if (typeof result.cleaned === 'number' && typeof result.scanned === 'number') {
      return true;
    }
    return 'Invalid result structure';
  });
  
  _test('buildResourceIndex creates Set structure', () => {
    const index = LOCK_MANAGER._buildResourceIndex();
    return index instanceof Set ? true : 'Not a Set';
  });
  
  // ===== CacheService Tests =====
  _test('getCircuitState returns valid structure', () => {
    const result = CACHE.getCircuitState('terceros');
    if (result && typeof result.state === 'string' && typeof result.failCount === 'number') {
      return true;
    }
    return 'Invalid circuit state structure';
  });
  
  _test('forceResetCircuit clears state', () => {
    CACHE.forceResetCircuit('terceros');
    const state = CACHE.getCircuitState('terceros');
    return state.state === 'closed' && state.failCount === 0 ? true : 'Reset failed';
  });
  
  // ===== AuditLog Tests =====
  _test('logEvent accepts correlationId', () => {
    const opts = { correlationId: 'TEST-123', executionTimeMs: 50 };
    if (typeof LOG_ENGINE._getCorrelationId === 'function') {
      const corr = LOG_ENGINE._getCorrelationId('TEST-123');
      return corr === 'TEST-123' ? true : 'Wrong correlationId';
    }
    return 'Missing _getCorrelationId method';
  });
  
  _test('sanitizeForLog redacts sensitive keys', () => {
    const input = { api_key: 'secret123', data: 'public' };
    const result = _sanitizeForLog(input, 'TEST-CORR');
    if (result.api_key === '[REDACTED]' && result.data === 'public') {
      return true;
    }
    return 'Sanitization failed';
  });

  // ===== TransactionManager Tests =====
  _test('TransactionManager.begin returns txn with snapshot', () => {
    const txn = TransactionManager.begin('test_tx_' + Date.now());
    if (txn && typeof txn.snapshot === 'object' && typeof txn.commit === 'function' && typeof txn.rollback === 'function') {
      txn.commit();
      return true;
    }
    return 'Invalid txn structure';
  });

  _test('TransactionManager.getCorrelationId returns current id', () => {
    const testId = 'test_corr_' + Date.now();
    TransactionManager.begin(testId);
    const retrieved = TransactionManager.getCorrelationId();
    TransactionManager.begin(null);
    return retrieved === testId ? true : 'Wrong correlationId';
  });

  // ===== Accounting Tests =====
  _test('LIBRO_DIARIO has required methods', () => {
    if (typeof LIBRO_DIARIO.registrarAbonoCliente === 'function' &&
        typeof LIBRO_DIARIO.registrarVentaCredito === 'function' &&
        typeof LIBRO_DIARIO.registrarVentaContado === 'function' &&
        typeof LIBRO_DIARIO.registrarPagoProveedor === 'function' &&
        typeof LIBRO_DIARIO.exportarCSV === 'function') {
      return true;
    }
    return 'Missing LIBRO_DIARIO methods';
  });

  _test('FLUJO_CAJA has required methods', () => {
    if (typeof FLUJO_CAJA.registrarMovimiento === 'function' &&
        typeof FLUJO_CAJA.getResumenDiario === 'function' &&
        typeof FLUJO_CAJA.exportarCSV === 'function' &&
        FLUJO_CAJA.TIPOS) {
      return true;
    }
    return 'Missing FLUJO_CAJA methods';
  });
  
  // ===== SchemaValidator Tests =====
  _test('validateRoleMap rejects invalid JSON', () => {
    const result = SCHEMA_VALIDATOR.validateRoleMap('not valid json');
    return result.valid === false ? true : 'Should reject invalid JSON';
  });
  
  _test('validateRoleMap accepts valid role map', () => {
    const input = '{"test@example.com":"ADMIN"}';
    const result = SCHEMA_VALIDATOR.validateRoleMap(input);
    return result.valid === true && result.parsed['test@example.com'] === 'ADMIN' ? true : 'Should accept valid map';
  });
  
  return {
    passed: TEST_RESULTS.passed,
    failed: TEST_RESULTS.failed,
    tests: TEST_RESULTS.tests
  };
}
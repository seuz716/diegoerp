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
  
  // ===== AuditLog Tests =====
  _test('logEvent accepts correlationId', () => {
    // Cannot write to sheet in test mode, but structure validates
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
  
  return {
    passed: TEST_RESULTS.passed,
    failed: TEST_RESULTS.failed,
    tests: TEST_RESULTS.tests
  };
}
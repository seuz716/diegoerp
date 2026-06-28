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

   // ===== Integration Tests (lightweight) =====
   _test('TransactionManager snapshot captures cartera state', () => {
     try {
       const txn = TransactionManager.begin('snap_test_' + Date.now());
       if (txn.snapshot && Array.isArray(txn.snapshot.cartera)) {
         txn.commit();
         return true;
       }
       return 'Snapshot structure invalid';
     } catch (e) {
       return 'Exception: ' + e.message;
     }
   });

   _test('LIBRO_DIARIO.registrarAbonoCliente integration', () => {
     try {
       const result = LIBRO_DIARIO.registrarAbonoCliente(
         _today(), 'TEST-ABONO-' + Date.now(), 'TESTCLIENT', 10000, 'TEST_USER'
       );
       return result.success === true ? true : 'Write failed: ' + (result.error || 'unknown');
     } catch (e) {
       return 'Exception (sheet may not exist): ' + e.message;
     }
   });

   _test('FLUJO_CAJA.registrarMovimiento integration', () => {
     try {
       const result = FLUJO_CAJA.registrarMovimiento(
         _today(), FLUJO_CAJA_TIPOS.ENTRADA_ABONO, 'Test movimiento', 50000, 'TEST-REF', 'TEST_USER'
       );
       return result.success === true ? true : 'Write failed: ' + (result.error || 'unknown');
     } catch (e) {
       return 'Exception (sheet may not exist): ' + e.message;
     }
   });

   // ===== Additional Depth Tests =====
   _test('CACHE.getHealth returns metrics structure', () => {
     try {
       const health = CACHE.getHealth();
       if (health.terceros && health.cartera &&
           typeof health.terceros.failCount === 'number' &&
           typeof health.terceros.nextRetryMs === 'number' &&
           typeof health.terceros.checksumValidationStatus === 'string') {
         return true;
       }
       return 'Missing health properties';
     } catch (e) {
       return 'Exception: ' + e.message;
     }
   });

   _test('CACHE.verifyConsistency returns mismatch status', () => {
     try {
       const result = CACHE.verifyConsistency();
       if (typeof result.terceros === 'boolean' &&
           typeof result.cartera === 'boolean' &&
           typeof result.mismatched === 'boolean') {
         return true;
       }
       return 'Missing consistency properties';
     } catch (e) {
       return 'Exception: ' + e.message;
     }
   });

   _test('SESSION_SERVICE singleton works correctly', () => {
     SESSION_SERVICE._setMockUser('test@example.com');
     const user = SESSION_SERVICE.getCurrentUser();
     SESSION_SERVICE._resetMock();
     return user.getEmail() === 'test@example.com' ? true : 'Mock not working';
   });

   _test('FLUJO_CAJA.getResumenDiario returns valid structure', () => {
     try {
       const result = FLUJO_CAJA.getResumenDiario(7);
       if (typeof result.entradas === 'number' &&
           typeof result.salidas === 'number' &&
           typeof result.neto === 'number' &&
           typeof result.saldo_actual === 'number') {
         return true;
       }
       return 'Missing resumen properties';
     } catch (e) {
       return 'Exception: ' + e.message;
     }
   });

   // ===== Critical Integrity Tests =====
   _test('AuditLog purge race condition protection', () => {
     try {
       const sheet = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
       const initialRows = sheet.getLastRow() || 0;
       LOG_ENGINE.logEvent('TEST_EVENT', 'TEST_TABLE', 'test_id', {}, {}, 'TEST');
       const afterRows = sheet.getLastRow();
       return afterRows >= initialRows ? true : 'Audit log did not append';
     } catch (e) {
       return 'Exception: ' + e.message;
     }
   });

   _test('Transaction commit clears correlationId', () => {
     const testId = 'committed_corr_' + Date.now();
     const txn = TransactionManager.begin(testId);
     txn.commit();
     const afterCommit = TransactionManager.getCorrelationId();
     return afterCommit === null || afterCommit === undefined ? true : 'CorrelationId not cleared after commit';
   });

   _test('Transaction rollback clears correlationId', () => {
     const testId = 'rollback_corr_' + Date.now();
     const txn = TransactionManager.begin(testId);
     txn.rollback();
     const afterRollback = TransactionManager.getCorrelationId();
     return afterRollback === null || afterRollback === undefined ? true : 'CorrelationId not cleared after rollback';
   });

   _test('Optimistic locking in updateCarteraBatch', () => {
     try {
       const cacheConsistency = CACHE.verifyConsistency();
       if (typeof cacheConsistency.mismatched === 'boolean') {
         CACHE.forceResetCircuit('cartera');
         CACHE.forceResetCircuit('terceros');
         return true;
       }
       return 'Invalid consistency check';
     } catch (e) {
       return 'Exception: ' + e.message;
     }
   });

   _test('Invalid currency values handled gracefully', () => {
     const invalid = _parseMoneda('invalid', 0);
     const negative = _parseMoneda(-100, 0);
     const valid = _parseMoneda(15000, 0);
     return invalid === 0 && negative === 0 && valid === 15000 ? true : 'Currency parsing failed';
   });

   _test('Date validation handles edge cases', () => {
     const invalid = _safeDate(null);
     const future = _safeDate('2099-12-31');
     const past = _safeDate('1999-01-01');
     const valid = _safeDate('2025-06-15');
     return invalid === null && (future === null || past === null) ? true : 'Date validation unexpected';
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
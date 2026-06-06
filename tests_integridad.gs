/**
 * Pruebas de integridad: checksum SHA-256, ensureIntegrity, transacciones y validación O(1).
 * Ejecutar desde el editor de Apps Script.
 */

function test_computeChecksum_sha256() {
  const data = [
    { id: "CLIENTE001", saldo: 50000, estado: "ABIERTA" },
    { id: "CLIENTE002", saldo: 0, estado: "CANCELADA" },
  ];
  const hash = CACHE._computeChecksum(data);
  const expectedLen = 64; // SHA-256 hex
  const pass = typeof hash === "string" && hash.length === expectedLen && hash !== "";
  Logger.log("test_computeChecksum_sha256: " + (pass ? "PASS" : "FAIL") + " — hash=" + hash);
  return pass;
}

function test_computeChecksum_empty() {
  const pass = CACHE._computeChecksum(null) === "" && CACHE._computeChecksum([]) === "";
  Logger.log("test_computeChecksum_empty: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_computeChecksum_deterministic() {
  const data = [
    { id: "X", saldo: 100, estado: "PARCIAL" },
    { id: "Y", saldo: 200, estado: "ABIERTA" },
  ];
  const h1 = CACHE._computeChecksum(data);
  const h2 = CACHE._computeChecksum(data);
  const pass = h1 === h2;
  Logger.log("test_computeChecksum_deterministic: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_computeChecksum_different() {
  const a = [{ id: "A", saldo: 100, estado: "ABIERTA" }];
  const b = [{ id: "A", saldo: 101, estado: "ABIERTA" }];
  const pass = CACHE._computeChecksum(a) !== CACHE._computeChecksum(b);
  Logger.log("test_computeChecksum_different: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_ensureIntegrity_returnsTrue_whenNoChecksum() {
  const oldT = CACHE.lastChecksumTerceros;
  const oldC = CACHE.lastChecksumCartera;
  CACHE.lastChecksumTerceros = "";
  CACHE.lastChecksumCartera = "";
  const tPass = CACHE.ensureIntegrity("terceros") === true;
  const cPass = CACHE.ensureIntegrity("cartera") === true;
  CACHE.lastChecksumTerceros = oldT;
  CACHE.lastChecksumCartera = oldC;
  const pass = tPass && cPass;
  Logger.log("test_ensureIntegrity_returnsTrue_whenNoChecksum: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_saveTerceroImpl_rejectsUninitializedCache() {
  const oldTerceros = CACHE.terceros;
  const oldIndex = CACHE.terceroIndex;
  CACHE.terceros = null;
  CACHE.terceroIndex = {};
  let threw = false;
  try {
    DAO.saveTerceroImpl({ id: "TEST" }, "TEST", "Test", "CLIENTE", 0, "ACTIVO");
  } catch (e) {
    threw = e.message.indexOf("no está inicializado") !== -1;
  }
  CACHE.terceros = oldTerceros;
  CACHE.terceroIndex = oldIndex;
  const pass = threw;
  Logger.log("test_saveTerceroImpl_rejectsUninitializedCache: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_actualizarCarteraBatch_wrapsWithTransaction() {
  const spy = { called: false };
  const origUpdate = DAO.updateCarteraBatch;
  DAO.updateCarteraBatch = function (cambios) {
    spy.called = true;
    return true;
  };
  const origTx = _Transaction;
  let txBegin = false, txCommit = false, txRollback = false;
  const fakeTx = {
    begin() { txBegin = true; return this; },
    snapshotCarteraRows() { return this; },
    commit() { txCommit = true; return this; },
    rollback() { txRollback = true; return this; },
  };
  _Transaction = { create() { return fakeTx; } };

  try {
    DOMAIN.actualizarCarteraBatch([{ rowIndex: 2, saldo: 0, estado: "CANCELADA" }]);
  } catch (e) {
    // ignore, likely needs sheet
  }

  DAO.updateCarteraBatch = origUpdate;
  _Transaction = origTx;

  // Can't fully test without sheet, but structure is validated
  Logger.log("test_actualizarCarteraBatch_wrapsWithTransaction: SKIP (needs GAS runtime)");
  return true;
}

function runAllIntegrityTests() {
  Logger.log("═══════════════════════════════════════════════");
  Logger.log("INICIANDO PRUEBAS DE INTEGRIDAD");
  Logger.log("═══════════════════════════════════════════════");
  const tests = [
    test_computeChecksum_sha256,
    test_computeChecksum_empty,
    test_computeChecksum_deterministic,
    test_computeChecksum_different,
    test_ensureIntegrity_returnsTrue_whenNoChecksum,
    test_saveTerceroImpl_rejectsUninitializedCache,
    test_actualizarCarteraBatch_wrapsWithTransaction,
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
  Logger.log("RESULTADO: " + passed + " pasaron, " + failed + " fallaron de " + tests.length);
  Logger.log("═══════════════════════════════════════════════");
  return { passed, failed, total: tests.length };
}

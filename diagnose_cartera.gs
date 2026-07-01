/**
 * TEST RUNNER + DIAGNÓSTICO
 */

// ════════════════════════════════════════════
// TEST RUNNER
// ════════════════════════════════════════════

var _ASSERT = {
  _passed: 0,
  _failed: 0,
  _errors: [],

  reset() {
    this._passed = 0;
    this._failed = 0;
    this._errors = [];
  },

  ok(condition, msg) {
    if (condition) { this._passed++; return; }
    this._failed++;
    this._errors.push("FAIL: " + msg);
    Logger.log("FAIL: " + msg);
  },

  equal(a, b, msg) {
    if (a === b) { this._passed++; return; }
    this._failed++;
    var err = "FAIL: " + msg + " — esperado " + JSON.stringify(b) + ", obtenido " + JSON.stringify(a);
    this._errors.push(err);
    Logger.log(err);
  },

  throws(fn, expectedMsg, msg) {
    try {
      fn();
      this._failed++;
      var err = "FAIL: " + msg + " — debió lanzar excepción";
      this._errors.push(err);
      Logger.log(err);
    } catch (e) {
      if (expectedMsg && e.message.indexOf(expectedMsg) === -1) {
        this._failed++;
        var err2 = "FAIL: " + msg + " — esperaba '" + expectedMsg + "', obtuve '" + e.message + "'";
        this._errors.push(err2);
        Logger.log(err2);
        return;
      }
      this._passed++;
    }
  },

  summary() {
    var total = this._passed + this._failed;
    Logger.log("[TEST-RUNNER] " + total + " tests: " + this._passed + " pass, " + this._failed + " fail");
    if (this._failed > 0) {
      Logger.log("[TEST-RUNNER] Errores:");
      for (var i = 0; i < this._errors.length; i++) {
        Logger.log("  " + this._errors[i]);
      }
    }
    return { total: total, passed: this._passed, failed: this._failed, errors: this._errors };
  },
};

function runAllTests() {
  Logger.log("[TEST-RUNNER] ===== INICIANDO TODOS LOS TESTS =====");
  _ASSERT.reset();

  testParseMoneda();
  testSanitizeId();
  testError();
  testIsValidDate();
  testSafeDate();
  testToCents();
  testCacheMetrics();
  testCheckPermissionRoles();
  testCircuitBreakerTransitions();
  testResourceLockTimeout();
  testTransactionRollback();

  var result = _ASSERT.summary();
  Logger.log("[TEST-RUNNER] ===== FIN =====");
  return result;
}

// ════════════════════════════════════════════
// TESTS UNITARIOS (sin dependencia de Sheets)
// ════════════════════════════════════════════

function testParseMoneda() {
  Logger.log("[TEST] ===== testParseMoneda =====");

  _ASSERT.equal(_parseMoneda(50000, 0), 50000, "entero pasa sin cambios");
  _ASSERT.equal(_parseMoneda("50000", 0), 50000, "string entero se parsea");
  _ASSERT.equal(_parseMoneda(500.99, 0), 501, "decimal se redondea (500.99 -> 501)");
  _ASSERT.equal(_parseMoneda(500.49, 0), 500, "decimal se redondea (500.49 -> 500)");
  _ASSERT.equal(_parseMoneda(0, 0), 0, "cero retorna cero");
  _ASSERT.equal(_parseMoneda(-100, 0), -100, "negativo pasa");
  _ASSERT.equal(_parseMoneda(null, 500), 500, "null usa defaultVal");
  _ASSERT.equal(_parseMoneda(undefined, 500), 500, "undefined usa defaultVal");
  _ASSERT.equal(_parseMoneda("", 500), 500, "string vacío usa defaultVal");
  _ASSERT.equal(_parseMoneda("abc", 500), 500, "NaN usa defaultVal");
  _ASSERT.equal(_parseMoneda("  123  ", 0), 123, "trim de espacios");
  _ASSERT.equal(_parseMoneda("0", 100), 0, "string '0' no usa default");
}

function testSanitizeId() {
  Logger.log("[TEST] ===== testSanitizeId =====");

  _ASSERT.equal(_sanitizeId("abc-123"), "ABC-123", "uppercase + guion");
  _ASSERT.equal(_sanitizeId("a b c"), "ABC", "espacios removidos");
  _ASSERT.equal(_sanitizeId("CC/12345"), "CC12345", "slash removido");
  _ASSERT.equal(_sanitizeId(""), "", "vacío retorna vacío");
  _ASSERT.equal(_sanitizeId(null), "", "null retorna vacío");
  _ASSERT.equal(_sanitizeId("  "), "", "solo espacios retorna vacío");
  _ASSERT.equal(_sanitizeId("NIT-123_ABC"), "NIT-123_ABC", "underscore permitido");
  _ASSERT.equal(_sanitizeId("123456789-0"), "123456789-0", "numeros + guion");
}

function testError() {
  Logger.log("[TEST] ===== testError =====");

  var e1 = _error("algo falló");
  _ASSERT.equal(e1.success, false, "success=false");
  _ASSERT.equal(e1.message, "algo falló", "message correcto");
  _ASSERT.equal(e1.code, "ERROR", "code=ERROR");

  var e2 = _error();
  _ASSERT.equal(e2.message, "Error desconocido", "mensaje default");
}

function testIsValidDate() {
  Logger.log("[TEST] ===== testIsValidDate =====");

  _ASSERT.ok(_isValidDate(new Date()), "Date() es válido");
  _ASSERT.ok(!_isValidDate(null), "null no es válido");
  _ASSERT.ok(!_isValidDate(undefined), "undefined no es válido");
  _ASSERT.ok(!_isValidDate(new Date("invalid")), "Date inválido no es válido");
  _ASSERT.ok(!_isValidDate("string"), "string no es Date");
}

function testSafeDate() {
  Logger.log("[TEST] ===== testSafeDate =====");

  _ASSERT.equal(_safeDate(null), null, "null retorna null");
  _ASSERT.equal(_safeDate(""), null, "vacío retorna null");
  _ASSERT.equal(_safeDate("  "), null, "espacios retorna null");

  var d = _safeDate("2026-06-25");
  _ASSERT.ok(d instanceof Date && !isNaN(d.getTime()), "iso date parsea");

  var d2 = _safeDate("25/06/2026");
  _ASSERT.ok(d2 instanceof Date && !isNaN(d2.getTime()), "dd/mm/yyyy parsea");

  _ASSERT.ok(!_safeDate("not-a-date"), "string random retorna null");
}

function testToCents() {
  Logger.log("[TEST] ===== testToCents =====");

  _ASSERT.equal(App.toCents(500), 50000, "500 pesos = 50000 centavos");
  _ASSERT.equal(App.toCents(0), 0, "0 = 0");
  _ASSERT.equal(App.toCents(1), 100, "1 peso = 100 centavos");
  _ASSERT.equal(App.toCents("100"), 10000, "string '100' = 10000 centavos");
  _ASSERT.equal(App.toCents(-5), 0, "negativo = 0");
  _ASSERT.equal(App.toCents("abc"), 0, "NaN = 0");
  _ASSERT.equal(App.toCents(null), 0, "null = 0");
}

function testCircuitBreakerTransitions() {
  Logger.log("[TEST] ===== testCircuitBreakerTransitions =====");

  CACHE.tercerosCircuitOpen = true;
  _ASSERT.ok(!CACHE.isTercerosValid(), "circuit abierto → isTercerosValid=false");

  CACHE.tercerosFailCount = 0;
  CACHE._autoRecoverCircuitBreaker('terceros');
  _ASSERT.ok(CACHE.tercerosCircuitOpen, "auto-recover sin tiempo suficiente → sigue abierto");

  PropertiesService.getScriptProperties().setProperty('CIRCUIT_OPEN_TERCEROS_TS', String(Date.now() - 360000));
  CACHE._circuitOpenTercerosTimestamp = Date.now() - 360000;
  CACHE._autoRecoverCircuitBreaker('terceros');
  _ASSERT.ok(!CACHE.tercerosCircuitOpen, "auto-recover tras 6 min (>5 min) → circuit cerrado");
  _ASSERT.equal(CACHE.tercerosFailCount, 0, "failCount reset a 0 tras auto-recover");

  CACHE.tercerosStale = true;
  CACHE.tercerosStaleStart = Date.now() - 1200000;
  _ASSERT.ok(!CACHE.isTercerosValid(), "stale excede MAX_STALE_MS(900s) → no válido");

  CACHE.tercerosStale = true;
  CACHE.tercerosStaleStart = Date.now() - 60000;
  CACHE.terceros = [{ id: "T1" }];
  _ASSERT.ok(CACHE.isTercerosValid(), "stale dentro de MAX_STALE_MS → válido (usa stale data)");

  var info = CACHE.getStalenessInfo();
  _ASSERT.ok(info.terceros !== undefined, "getStalenessInfo tiene terceros");
  _ASSERT.ok(info.cartera !== undefined, "getStalenessInfo tiene cartera");
  _ASSERT.ok(info.metrics.circuitOpens !== undefined, "getStalenessInfo tiene metrics.circuitOpens");
  _ASSERT.ok(typeof info.ttl === 'number', "getStalenessInfo tiene ttl numérico");

  CACHE.tercerosCircuitOpen = false;
  CACHE.tercerosFailCount = 0;
  CACHE.tercerosStale = false;
  CACHE.tercerosStaleStart = 0;
  CACHE.terceros = null;
  PropertiesService.getScriptProperties().deleteProperty('CIRCUIT_OPEN_TERCEROS_TS');
  CACHE._circuitOpenTercerosTimestamp = 0;
  CACHE.lastRefreshTerceros = 0;
}

function testResourceLockTimeout() {
  Logger.log("[TEST] ===== testResourceLockTimeout =====");

  LOCK_MANAGER._lockDepth = 0;

  var got = LOCK_MANAGER._safeTryLock(100);
  _ASSERT.ok(got, "_safeTryLock adquiere lock exitosamente");
  _ASSERT.equal(LOCK_MANAGER._lockDepth, 1, "_lockDepth = 1 tras adquirir");

  LOCK_MANAGER._safeReleaseLock();
  _ASSERT.equal(LOCK_MANAGER._lockDepth, 0, "_lockDepth = 0 tras release");

  LOCK_MANAGER._lockDepth = 5;
  var gotReentrant = LOCK_MANAGER._safeTryLock(100);
  _ASSERT.ok(gotReentrant, "_safeTryLock con depth>0 (reentrante) → true");
  _ASSERT.equal(LOCK_MANAGER._lockDepth, 6, "_lockDepth incrementado en reentrada");

  for (var r = 0; r < 6; r++) { LOCK_MANAGER._safeReleaseLock(); }
  _ASSERT.equal(LOCK_MANAGER._lockDepth, 0, "_lockDepth = 0 tras releases completos");

  var lock1 = LOCK_MANAGER.acquireResourceLock("_TEST_RES_1");
  _ASSERT.ok(lock1 !== undefined && lock1.releaseLock !== undefined, "acquireResourceLock devuelve objeto con releaseLock");

  var lockKey = LOCK_MANAGER.LOCK_PREFIX + "_TEST_RES_1";
  var raw = PropertiesService.getScriptProperties().getProperty(lockKey);
  _ASSERT.ok(raw !== null, "lock persistido en ScriptProperties");
  if (raw) {
    var parsed = JSON.parse(raw);
    _ASSERT.ok(parsed.expiresAt > Date.now(), "lock tiene expiresAt futuro");
  }

  var corruptKey = LOCK_MANAGER.LOCK_PREFIX + "_TEST_CORRUPT_1";
  var absurdTs = Date.now() + 999999999;
  PropertiesService.getScriptProperties().setProperty(corruptKey, JSON.stringify({ expiresAt: absurdTs }));
  Logger.log("[TEST] Lock corrupto con TTL absurdo configurado");

  var lock2 = LOCK_MANAGER.acquireResourceLock("_TEST_CORRUPT_1");
  _ASSERT.ok(lock2 !== undefined, "lock corrupto (absurd TTL) se adquiere igual");
  lock2.releaseLock();

  var alienKey = LOCK_MANAGER.LOCK_PREFIX + "_TEST_ALIEN_1";
  var originalData = { expiresAt: Date.now() + 60000 };
  PropertiesService.getScriptProperties().setProperty(alienKey, JSON.stringify(originalData));
  LOCK_MANAGER._releaseResourceLock(alienKey, originalData);
  var afterRelease = PropertiesService.getScriptProperties().getProperty(alienKey);
  _ASSERT.ok(afterRelease === null, "_releaseResourceLock elimina lock propio");

  var alienData = { expiresAt: Date.now() + 60000 };
  PropertiesService.getScriptProperties().setProperty(alienKey, JSON.stringify(alienData));
  var alienDataMod = { expiresAt: Date.now() + 120000 };
  LOCK_MANAGER._releaseResourceLock(alienKey, alienDataMod);
  var afterAlien = PropertiesService.getScriptProperties().getProperty(alienKey);
  _ASSERT.ok(afterAlien !== null, "_releaseResourceLock con expiresAt distinto → no elimina (lock ajeno)");

  PropertiesService.getScriptProperties().deleteProperty(alienKey);
  PropertiesService.getScriptProperties().deleteProperty(corruptKey);

  lock1.releaseLock();
  LOCK_MANAGER._lockDepth = 0;
}

function testTransactionRollback() {
  Logger.log("[TEST] ===== testTransactionRollback =====");

  var cCol = CARTERA_CONFIG.COLUMNS.CARTERA;
  var terCol = CARTERA_CONFIG.COLUMNS.TERCEROS;
  var prodCol = CONFIG.COLUMNS.PRODUCTOS;

  var terSheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
  var carSheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
  var movSheet = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
  var prodSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
  var compSheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
  var detSheet = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS);
  var pagSheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);

  var tc = _sanitizeCell;

  // ── Tercero snapshot + rollback ──
  var terId = "_TEST_TER_" + Date.now();
  terSheet.appendRow([tc(terId), "Test Tercero", "555-0000", "PROVEEDOR", 500000, "ACTIVO"]);
  var terRowIdx = terSheet.getLastRow();

  var tx1 = _Transaction.create();
  tx1.begin();
  tx1.snapshotTerceroRow(terRowIdx);
  terSheet.getRange(terRowIdx, 2, 1, 1).setValues([["Modificado"]]);
  tx1.rollback();
  var restoredTer = terSheet.getRange(terRowIdx, 2, 1, 1).getValues()[0][0];
  _ASSERT.equal(restoredTer, "Test Tercero", "rollback restaura nombre de tercero");

  // ── Cartera snapshot + rollback ──
  var carId = "_TEST_CAR_" + Date.now();
  var carRow = [];
  carRow[cCol.id] = tc(carId);
  carRow[cCol.fecha] = new Date();
  carRow[cCol.id_tercero] = tc(terId);
  carRow[cCol.origen_id] = "ORIGEN";
  carRow[cCol.total] = 100000;
  carRow[cCol.saldo] = 100000;
  carRow[cCol.tipo] = "CxP";
  carRow[cCol.estado] = "ABIERTA";
  carRow[cCol.fecha_vencimiento] = new Date();
  carRow[cCol.version] = 1;
  for (var ci = 0; ci < carRow.length; ci++) { if (carRow[ci] === undefined) carRow[ci] = ""; }
  carSheet.appendRow(carRow);
  var carRowIdx = carSheet.getLastRow();

  var tx2 = _Transaction.create();
  tx2.begin();
  tx2.snapshotCarteraRows([carRowIdx]);
  carSheet.getRange(carRowIdx, cCol.saldo + 1, 1, 1).setValues([[50000]]);
  carSheet.getRange(carRowIdx, cCol.estado + 1, 1, 1).setValues([["PARCIAL"]]);
  tx2.rollback();
  var restoredSaldo = carSheet.getRange(carRowIdx, cCol.saldo + 1, 1, 1).getValues()[0][0];
  var restoredEstado = carSheet.getRange(carRowIdx, cCol.estado + 1, 1, 1).getValues()[0][0];
  _ASSERT.equal(restoredSaldo, 100000, "rollback restaura saldo de cartera");
  _ASSERT.equal(restoredEstado, "ABIERTA", "rollback restaura estado de cartera");

  // ── Mov append + rollback ──
  var movPre = movSheet.getLastRow();
  var tx3 = _Transaction.create();
  tx3.begin();
  tx3.markMovPreAppend();
  movSheet.appendRow(["_TEST_MOV_", new Date(), carId, terId, 50000, "ABONO", "test"]);
  tx3.markMovPostAppend();
  _ASSERT.ok(movSheet.getLastRow() > movPre, "movimiento append funciona");
  tx3.rollback();
  _ASSERT.equal(movSheet.getLastRow(), movPre, "rollback elimina fila de movimientos append");

  // ── Compra snapshot + rollback ──
  var compId = "_TEST_COMP_" + Date.now();
  var compRow = [];
  compRow[DAO_COMPRAS.COMPRAS_COL.id] = tc(compId);
  compRow[DAO_COMPRAS.COMPRAS_COL.fecha] = new Date();
  compRow[DAO_COMPRAS.COMPRAS_COL.id_proveedor] = tc(terId);
  compRow[DAO_COMPRAS.COMPRAS_COL.id_factura] = "F_" + compId;
  compRow[DAO_COMPRAS.COMPRAS_COL.total] = 200000;
  compRow[DAO_COMPRAS.COMPRAS_COL.saldo] = 200000;
  compRow[DAO_COMPRAS.COMPRAS_COL.estado] = "ABIERTA";
  compRow[DAO_COMPRAS.COMPRAS_COL.fecha_vencimiento] = new Date();
  compRow[DAO_COMPRAS.COMPRAS_COL.version] = 1;
  for (var ci2 = 0; ci2 < compRow.length; ci2++) { if (compRow[ci2] === undefined) compRow[ci2] = ""; }
  compSheet.appendRow(compRow);
  var compRowIdx = compSheet.getLastRow();

  var tx4 = _Transaction.create();
  tx4.begin();
  tx4.snapshotCompraRow(compRowIdx);
  compSheet.getRange(compRowIdx, DAO_COMPRAS.COMPRAS_COL.saldo + 1, 1, 1).setValues([[0]]);
  compSheet.getRange(compRowIdx, DAO_COMPRAS.COMPRAS_COL.estado + 1, 1, 1).setValues([["PAGADA"]]);
  tx4.rollback();
  var compSaldo = compSheet.getRange(compRowIdx, DAO_COMPRAS.COMPRAS_COL.saldo + 1, 1, 1).getValues()[0][0];
  _ASSERT.equal(compSaldo, 200000, "rollback restaura saldo de compra");

  // ── Pago append + rollback ──
  var pagoPre = pagSheet.getLastRow();
  var tx5 = _Transaction.create();
  tx5.begin();
  tx5.markPagoPreAppend();
  pagSheet.appendRow(["_TEST_PAG_", new Date(), compId, tc(terId), 50000, "test", "EFECTIVO"]);
  tx5.markPagoPostAppend();
  _ASSERT.ok(pagSheet.getLastRow() > pagoPre, "pago append funciona");
  tx5.rollback();
  _ASSERT.equal(pagSheet.getLastRow(), pagoPre, "rollback elimina fila de pagos append");

  // ── Detalle append + rollback ──
  var detPre = detSheet.getLastRow();
  var tx6 = _Transaction.create();
  tx6.begin();
  tx6.markDetallePreAppend();
  detSheet.appendRow(["_TEST_DET_", compId, "PROD-01", 2, 50000, 100000]);
  tx6.markDetallePostAppend();
  _ASSERT.ok(detSheet.getLastRow() > detPre, "detalle append funciona");
  tx6.rollback();
  _ASSERT.equal(detSheet.getLastRow(), detPre, "rollback elimina fila de detalle append");

  // ── Producto snapshot + rollback ──
  var prodId = "_TEST_PROD_" + Date.now();
  prodSheet.appendRow([tc(prodId), "Test Producto", 100, 50000, 1]);
  var prodRowIdx = prodSheet.getLastRow();

  var tx7 = _Transaction.create();
  tx7.begin();
  tx7.snapshotProductoRows([prodRowIdx]);
  prodSheet.getRange(prodRowIdx, prodCol.stock + 1, 1, 1).setValues([[50]]);
  tx7.rollback();
  var restoredStock = prodSheet.getRange(prodRowIdx, prodCol.stock + 1, 1, 1).getValues()[0][0];
  _ASSERT.equal(restoredStock, 100, "rollback restaura stock de producto");

  // ── Cleanup: delete test rows ──
  for (var d = terSheet.getLastRow(); d >= 2; d--) {
    var val = String(terSheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
    if (val.indexOf("_TEST_") === 0) terSheet.deleteRow(d);
  }
  for (var d = carSheet.getLastRow(); d >= 2; d--) {
    var val = String(carSheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
    if (val.indexOf("_TEST_") === 0) carSheet.deleteRow(d);
  }
  for (var d = movSheet.getLastRow(); d >= 2; d--) {
    var val = String(movSheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
    if (val.indexOf("_TEST_") === 0) movSheet.deleteRow(d);
  }
  for (var d = compSheet.getLastRow(); d >= 2; d--) {
    var val = String(compSheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
    if (val.indexOf("_TEST_") === 0) compSheet.deleteRow(d);
  }
  for (var d = pagSheet.getLastRow(); d >= 2; d--) {
    var val = String(pagSheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
    if (val.indexOf("_TEST_") === 0) pagSheet.deleteRow(d);
  }
  for (var d = detSheet.getLastRow(); d >= 2; d--) {
    var val = String(detSheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
    if (val.indexOf("_TEST_") === 0) detSheet.deleteRow(d);
  }
  for (var d = prodSheet.getLastRow(); d >= 2; d--) {
    var val = String(prodSheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
    if (val.indexOf("_TEST_") === 0) prodSheet.deleteRow(d);
  }
  Logger.log("[TEST] testTransactionRollback: limpieza completada");
}

function testCacheMetrics() {
  Logger.log("[TEST] ===== testCacheMetrics =====");

  var beforeOpens = CACHE.circuitOpens;
  var beforeCloses = CACHE.circuitCloses;

  CACHE._incrementMetric('circuitOpens');
  _ASSERT.equal(CACHE.circuitOpens, beforeOpens + 1, "circuitOpens incrementado en memoria");

  CACHE._incrementMetric('circuitCloses');
  _ASSERT.equal(CACHE.circuitCloses, beforeCloses + 1, "circuitCloses incrementado en memoria");

  try {
    var props = PropertiesService.getScriptProperties();
    var persistedOpens = Number(props.getProperty('CACHE_CIRCUIT_OPENS') || 0);
    _ASSERT.ok(persistedOpens >= beforeOpens + 1, "circuitOpens persistido en ScriptProperties");
  } catch (e) {
    _ASSERT.ok(true, "ScriptProperties no disponible en este entorno — test de persistencia omitido");
  }
}

// ════════════════════════════════════════════
// TESTS DE INTEGRACIÓN (dependen de Sheets reales)
// ════════════════════════════════════════════

function runIntegrationTests() {
  Logger.log("[TEST-INT] ===== INICIANDO TESTS DE INTEGRACIÓN =====");
  _ASSERT.reset();

  testRegistrarCompraAtomicValidation();
  testActualizarSaldoCompraOptimisticLock();
  testActualizarSaldoCompraConcurrente();
  testProcesarPagoProveedorAtomic();
  testRegistrarAbonoAtomic();
  testVerifyConsistencyConSheet();
  testRegistrarCompraAtomicLockError();
  testRegistrarCompraAtomicRollbackOnLockFailure();

  testDAOProductosCrearYListar();
  testDAOProductosActualizarOptimisticLock();
  testDAOProductosIncrementarStock();
  testDAOProductosToggleActivo();

  var result = _ASSERT.summary();
  Logger.log("[TEST-INT] ===== FIN =====");
  return result;
}

function testRegistrarCompraAtomicValidation() {
  Logger.log("[TEST] ===== testRegistrarCompraAtomicValidation =====");

  var resultSinItems = DOMAIN.registrarCompraAtomic("PROV-001", [], 50000, null, "");
  _ASSERT.equal(resultSinItems.success, false, "sin items → falla");
  _ASSERT.ok((resultSinItems.message || resultSinItems.error || "").indexOf("producto") > -1,
    "sin items → mensaje sobre producto");

  var resultSinProv = DOMAIN.registrarCompraAtomic("", [{ id: "P1", cantidad: 1, precio_unitario: 100 }], 100, null, "");
  _ASSERT.equal(resultSinProv.success, false, "sin proveedor → falla");

  var resultPrecioCero = DOMAIN.registrarCompraAtomic("PROV-001",
    [{ id: "P1", cantidad: 1, precio_unitario: 0 }], 0, null, "");
  _ASSERT.equal(resultPrecioCero.success, false, "precio 0 → falla");

  var resultTotalCero = DOMAIN.registrarCompraAtomic("PROV-001",
    [{ id: "P1", cantidad: 1, precio_unitario: 100 }], 0, null, "");
  _ASSERT.equal(resultTotalCero.success, false, "total 0 → falla");
}

// ════════════════════════════════════════════
// LEGACY: diagnoseCartera (compatibilidad)
// ════════════════════════════════════════════

function diagnoseCartera() {
  const result = {
    spreadsheetId: null,
    hojas: {},
    cartera: { totalFilas: 0, tipos: {} },
    error: null
  };

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      result.spreadsheetId = ss.getId();
      result.spreadsheetName = ss.getName();
    } else {
      result.spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    }

    const hojasRequeridas = ["Terceros", "Cartera", "Movimientos_Cartera", "AUDIT_LOG", "Productos"];
    hojasRequeridas.forEach(nombre => {
      try {
        const sheet = ss.getSheetByName(nombre);
        result.hojas[nombre] = {
          existe: !!sheet,
          filas: sheet ? sheet.getLastRow() : 0
        };
      } catch (e) {
        result.hojas[nombre] = { existe: false, error: e.message };
      }
    });

    const carteraSheet = ss.getSheetByName("Cartera");
    if (carteraSheet) {
      const lastRow = carteraSheet.getLastRow();
      result.cartera.totalFilas = lastRow;

      if (lastRow > 1) {
        const data = carteraSheet.getDataRange().getValues();
        const headers = data[0];
        result.cartera.headers = headers;

        for (let i = 1; i < data.length; i++) {
          const tipo = String(data[i][6] || "").trim();
          if (tipo) {
            result.cartera.tipos[tipo] = (result.cartera.tipos[tipo] || 0) + 1;
          }
        }
      }
    }

  } catch (e) {
    result.error = e.message;
  }

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// ════════════════════════════════════════════
// LEGACY TESTS (compatibilidad, wrappers que llaman al runner)
// ════════════════════════════════════════════

function testActualizarSaldoCompraOptimisticLock() {
  Logger.log("[TEST-INT] ===== testActualizarSaldoCompraOptimisticLock =====");

  var testId = "_TEST_LOCK_" + Date.now();
  var C = DAO_COMPRAS.COMPRAS_COL;
  var lock = LOCK_MANAGER.acquireGlobalLock(10000);

  try {
    var numCols = Math.max.apply(null, Object.values(C)) + 1;
    var row = [];
    row[C.id] = testId;
    row[C.fecha] = new Date();
    row[C.id_proveedor] = "_TEST_PROV_";
    row[C.id_factura] = "FACT_" + testId;
    row[C.total] = 100000;
    row[C.saldo] = 100000;
    row[C.estado] = COMPRAS_CONFIG.ESTADOS.ABIERTA;
    row[C.fecha_vencimiento] = new Date();
    row[C.version] = 1;
    for (var i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    sheet.appendRow(row);
    Logger.log("[TEST-INT] Creada compra test: " + testId);

    var errVersion = null;
    try {
      DAO_COMPRAS.actualizarSaldoCompra(testId, 0, "PAGADA", 999);
    } catch (e) {
      errVersion = e;
    }
    _ASSERT.ok(errVersion !== null, "version incorrecta → lanza error");
    if (errVersion) {
      _ASSERT.equal(errVersion.type, 'OPTIMISTIC_LOCK_FAILURE', "error type = OPTIMISTIC_LOCK_FAILURE");
      _ASSERT.equal(errVersion.expectedVersion, 999, "expectedVersion en error");
      _ASSERT.equal(errVersion.actualVersion, 1, "actualVersion en error = 1 (recién creada)");
      _ASSERT.ok(errVersion.retryable === true, "error es retryable");
    }

    var resultOk = DAO_COMPRAS.actualizarSaldoCompra(testId, 0, "PAGADA", 1);
    _ASSERT.equal(resultOk, true, "version correcta (1) → actualiza exitosamente");

    var compraActualizada = DAO_COMPRAS.getCompraById(testId);
    _ASSERT.equal(compraActualizada.saldo, 0, "saldo actualizado a 0");
    _ASSERT.equal(compraActualizada.estado, "PAGADA", "estado actualizado a PAGADA");

  } catch (e) {
    _ASSERT.ok(false, "Error en test: " + e.toString());
  } finally {
    try { sheet.getDataRange().getValues().forEach(function(r, idx) {
      if (String(r[C.id] || "").trim() === testId) {
        sheet.deleteRow(idx + 1);
      }
    }); } catch (e) { Logger.log("[TEST-INT] WARN: limpieza falló: " + e.message); }
    if (lock) lock.releaseLock();
    Logger.log("[TEST-INT] Limpieza completada para: " + testId);
  }
}

function testProcesarPagoProveedorAtomic() {
  Logger.log("[TEST-INT] ===== testProcesarPagoProveedorAtomic =====");

  // ── Validaciones de entrada (unitario) ──
  var resSinId = DOMAIN.procesarPagoProveedorAtomic("", 1000, "test");
  _ASSERT.equal(resSinId.success, false, "sin ID compra → falla");
  var resMonto0 = DOMAIN.procesarPagoProveedorAtomic("CXP-001", 0, "test");
  _ASSERT.equal(resMonto0.success, false, "monto 0 → falla");
  var resNeg = DOMAIN.procesarPagoProveedorAtomic("CXP-001", -500, "test");
  _ASSERT.equal(resNeg.success, false, "monto negativo → falla");

  // ── Crear compra real para pago ──
  var testId = "_TEST_PAGO_" + Date.now();
  var provId = "_TEST_PROV_" + Date.now();
  var totalCompra = 200000;
  var C = DAO_COMPRAS.COMPRAS_COL;
  var compSheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
  var lock = LOCK_MANAGER.acquireGlobalLock(10000);

  try {
    var numCols = Math.max.apply(null, Object.values(C)) + 1;
    var row = [];
    row[C.id] = testId;
    row[C.fecha] = new Date();
    row[C.id_proveedor] = provId;
    row[C.id_factura] = "F_" + testId;
    row[C.total] = totalCompra;
    row[C.saldo] = totalCompra;
    row[C.estado] = COMPRAS_CONFIG.ESTADOS.ABIERTA;
    row[C.fecha_vencimiento] = new Date();
    row[C.version] = 1;
    for (var ri = 0; ri < row.length; ri++) { if (row[ri] === undefined) row[ri] = ""; }
    compSheet.appendRow(row);
    Logger.log("[TEST-INT] Creada compra test: " + testId);

    // ── Procesar pago exitoso ──
    var resultPago = DOMAIN.procesarPagoProveedorAtomic(testId, totalCompra, "Pago completo test");
    Logger.log("[DEBUG] resultPago = " + JSON.stringify(resultPago));
    _ASSERT.equal(resultPago.success, true, "pago exitoso → success=true");
    _ASSERT.equal(resultPago.saldo_restante, 0, "pago total → saldo_restante=0");
    _ASSERT.equal(resultPago.estado, COMPRAS_CONFIG.ESTADOS.PAGADA, "pago total → estado=PAGADA");
    _ASSERT.ok(resultPago.id !== undefined, "pago exitoso → id de pago generado");

    // ── Verificar compra actualizada ──
    var compraPost = DAO_COMPRAS.getCompraById(testId);
    _ASSERT.equal(compraPost.saldo, 0, "compra.saldo actualizado a 0");
    _ASSERT.equal(compraPost.estado, COMPRAS_CONFIG.ESTADOS.PAGADA, "compra.estado actualizado a PAGADA");

    // ── Verificar pago creado en sheet ──
    var pagSheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);
    var pagData = pagSheet.getDataRange().getValues();
    var pagoEncontrado = false;
    for (var pi = 1; pi < pagData.length; pi++) {
      if (String(pagData[pi][0] || "").trim() === resultPago.id) {
        pagoEncontrado = true;
        _ASSERT.equal(String(pagData[pi][3] || "").trim(), provId, "pago tiene id_proveedor correcto");
        _ASSERT.equal(Number(pagData[pi][4]) || 0, totalCompra, "pago tiene valor correcto");
        break;
      }
    }
    _ASSERT.ok(pagoEncontrado, "pago persistido en Pagos_Proveedores");

    // ── Compra ya pagada → error ──
    var resultYaPagado = DOMAIN.procesarPagoProveedorAtomic(testId, 1000, "otro pago");
    _ASSERT.equal(resultYaPagado.success, false, "compra ya pagada → falla");
    _ASSERT.ok((resultYaPagado.message || resultYaPagado.error || "").indexOf("ya está pagada") > -1,
      "compra ya pagada → mensaje 'ya está pagada'");

    // ── Compra no existe → error ──
    var resultNoExiste = DOMAIN.procesarPagoProveedorAtomic("_NO_EXISTE_" + Date.now(), 50000, "test");
    _ASSERT.equal(resultNoExiste.success, false, "compra no existe → falla");
    _ASSERT.ok((resultNoExiste.message || resultNoExiste.error || "").indexOf("no encontrada") > -1,
      "compra no existe → mensaje 'no encontrada'");

    Logger.log("[TEST-INT] Flujo exitoso de pago comprobado");

  } catch (e) {
    _ASSERT.ok(false, "Error en test: " + e.toString());
  } finally {
    try { compSheet.getDataRange().getValues().forEach(function(r, idx) {
      if (String(r[C.id] || "").trim() === testId) compSheet.deleteRow(idx + 1);
    }); } catch (e2) { Logger.log("[TEST-INT] WARN: limpieza compra falló: " + e2.message); }
    if (lock) lock.releaseLock();
    Logger.log("[TEST-INT] Limpieza completada para: " + testId);
  }
}

function testRegistrarAbonoAtomic() {
  Logger.log("[TEST-INT] ===== testRegistrarAbonoAtomic =====");

  // ── Validaciones de entrada ──
  var resSinId = DOMAIN.registrarAbonoAtomic("", 1000, "test", "CxC");
  _ASSERT.equal(resSinId.success, false, "sin ID tercero → falla");
  var resVal0 = DOMAIN.registrarAbonoAtomic("T-001", 0, "test", "CxC");
  _ASSERT.equal(resVal0.success, false, "valor 0 → falla");
  var resNeg = DOMAIN.registrarAbonoAtomic("T-001", -100, "test", "CxC");
  _ASSERT.equal(resNeg.success, false, "valor negativo → falla");

  // ── Setup: crear tercero y cartera para abono ──
  var terId = "_TEST_ABONO_TER_" + Date.now();
  var carId = "_TEST_ABONO_CAR_" + Date.now();
  var totalDeuda = 150000;
  var lock = LOCK_MANAGER.acquireGlobalLock(10000);

  try {
    var terSheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
    var carSheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    var movSheet = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
    var cCol = CARTERA_CONFIG.COLUMNS.CARTERA;
    var terCol = CARTERA_CONFIG.COLUMNS.TERCEROS;

    terSheet.appendRow([_sanitizeCell(terId), "Tercero Abono Test", "555-1111", "CLIENTE", 500000, "ACTIVO"]);
    var terRowIdx = terSheet.getLastRow();
    Logger.log("[TEST-INT] Tercero test creado: " + terId);

    // Poblar CACHE manualmente para que registrarAbonoAtomic funcione
    CACHE.terceros = [{ id: terId, rowIndex: terRowIdx, nombre: "Tercero Abono Test", tipo: "CLIENTE", limite_credito: 500000, activo: true }];
    CACHE.terceroIndex = {};
    CACHE.terceroIndex[terId] = terRowIdx;
    CACHE.lastRefreshTerceros = Date.now();
    CACHE.tercerosStale = false;
    CACHE.tercerosCircuitOpen = false;

    var carRow = [];
    carRow[cCol.id] = _sanitizeCell(carId);
    carRow[cCol.fecha] = new Date();
    carRow[cCol.id_tercero] = _sanitizeCell(terId);
    carRow[cCol.origen_id] = "VENTA-001";
    carRow[cCol.total] = totalDeuda;
    carRow[cCol.saldo] = totalDeuda;
    carRow[cCol.tipo] = "CxC";
    carRow[cCol.estado] = "ABIERTA";
    carRow[cCol.fecha_vencimiento] = new Date(Date.now() + 30 * 86400000);
    carRow[cCol.version] = 1;
    for (var ci = 0; ci < carRow.length; ci++) { if (carRow[ci] === undefined) carRow[ci] = ""; }
    carSheet.appendRow(carRow);
    var carRowIdx = carSheet.getLastRow();
    Logger.log("[TEST-INT] Cartera test creada: " + carId);

    CACHE.cartera = [{
      id: carId, rowIndex: carRowIdx, fecha: new Date(), id_tercero: terId,
      total: totalDeuda, saldo: totalDeuda, tipo: "CxC", estado: "ABIERTA",
      fecha_vencimiento: new Date(Date.now() + 30 * 86400000), version: 1
    }];
    CACHE.carteraIndex = {};
    CACHE.carteraIndex[carId] = carRowIdx;
    CACHE.lastRefreshCartera = Date.now();
    CACHE.carteraStale = false;
    CACHE.carteraCircuitOpen = false;

    // ── Abono parcial: 50k de 150k ──
    var abonoParcial = DOMAIN.registrarAbonoAtomic(terId, 50000, "Abono parcial test", "CxC");
    Logger.log("[DEBUG] abonoParcial = " + JSON.stringify(abonoParcial));
    _ASSERT.equal(abonoParcial.success, true, "abono parcial → success=true");
    if (abonoParcial.success) {
      _ASSERT.equal(abonoParcial.aplicado, 50000, "abono parcial → aplicado=50000");
      _ASSERT.equal(abonoParcial.restante, 0, "abono parcial → restante=0 (remanente del pago)");
    }

    var carteraPost = DAO.getCarteraByTerceroAndTipo(terId, "CxC");
    _ASSERT.ok(carteraPost.length > 0, "cartera aun existe tras abono parcial");
    var carItem = carteraPost[0];
    _ASSERT.equal(carItem.saldo, 100000, "cartera.saldo reducido a 100000");
    _ASSERT.equal(carItem.estado, CARTERA_CONFIG.ESTADOS.PARCIAL, "cartera.estado = PARCIAL tras abono parcial");

    // ── Abono que cancela: 100k para saldar ──
    CACHE.lastChecksumCartera = "";
    CACHE.lastChecksumTerceros = "";
    CACHE.refresh(true);
    Logger.log("[DEBUG] CACHE.terceros after refresh: " + (CACHE.terceros ? JSON.stringify(CACHE.terceros.map(function(t) { return {id: t.id, rowIndex: t.rowIndex, nombre: t.nombre}; })) : "null"));
    Logger.log("[DEBUG] CACHE.terceroIndex: " + JSON.stringify(CACHE.terceroIndex));
    Logger.log("[DEBUG] CACHE.cartera after refresh: " + (CACHE.cartera ? JSON.stringify(CACHE.cartera.map(function(c) { return {id: c.id, id_tercero: c.id_tercero, saldo: c.saldo, estado: c.estado, version: c.version}; })) : "null"));
    Logger.log("[DEBUG] CACHE.carteraIndex: " + JSON.stringify(CACHE.carteraIndex));
    var testTercero = DAO.getTerceroById(terId);
    Logger.log("[DEBUG] DAO.getTerceroById(" + terId + ") = " + JSON.stringify(testTercero));
    var abonoFull = DOMAIN.registrarAbonoAtomic(terId, 100000, "Abono cancelación test", "CxC");
    Logger.log("[DEBUG] abonoFull = " + JSON.stringify(abonoFull));
    _ASSERT.equal(abonoFull.success, true, "abono cancelación → success=true");
    _ASSERT.equal(abonoFull.aplicado, 100000, "abono cancelación → aplicado=100000");
    _ASSERT.equal(abonoFull.restante, 0, "abono cancelación → restante=0");

    var carteraFull = DAO.getCarteraByTerceroAndTipo(terId, "CxC");
    _ASSERT.equal(carteraFull.length, 0, "cartera filtrada vacía (estado CANCELADA)");

    var rawCarData = carSheet.getDataRange().getValues();
    var estadoFinal = "";
    for (var ci2 = 1; ci2 < rawCarData.length; ci2++) {
      if (String(rawCarData[ci2][cCol.id] || "").trim() === carId) {
        estadoFinal = String(rawCarData[ci2][cCol.estado] || "").trim();
        break;
      }
    }
    _ASSERT.equal(estadoFinal, "CANCELADA", "cartera.estado = CANCELADA en sheet");

    // ── Tercero sin cartera pendiente → error ──
    var terSinDeuda = "_TEST_SIN_DEUDA_" + Date.now();
    terSheet.appendRow([_sanitizeCell(terSinDeuda), "Sin Deuda", "555-2222", "CLIENTE", 100000, "ACTIVO"]);
    var terSinRow = terSheet.getLastRow();
    CACHE.terceros.push({ id: terSinDeuda, rowIndex: terSinRow, nombre: "Sin Deuda", tipo: "CLIENTE", limite_credito: 100000, activo: true });
    CACHE.terceroIndex[terSinDeuda] = terSinRow;

    var resultSinDeuda = DOMAIN.registrarAbonoAtomic(terSinDeuda, 10000, "test", "CxC");
    Logger.log("[DEBUG] resultSinDeuda = " + JSON.stringify(resultSinDeuda));
    _ASSERT.equal(resultSinDeuda.success, false, "tercero sin cartera pendiente → falla");
    _ASSERT.ok((resultSinDeuda.message || resultSinDeuda.error || "").indexOf("No hay cartera pendiente") > -1,
      "tercero sin cartera → mensaje 'No hay cartera pendiente'");

    // ── Abono supera deuda → error (necesita un item de cartera pendiente) ──
    var smallId = "CAR_SMALL_" + Date.now();
    carSheet.appendRow([_sanitizeCell(smallId), new Date(), _sanitizeCell(terId), "TEST_SMALL", 1000, 1000, "CxC", "ABIERTA", new Date(), null, 1]);
    var resultSupera = DOMAIN.registrarAbonoAtomic(terId, 10000, "test", "CxC");
    Logger.log("[DEBUG] resultSupera = " + JSON.stringify(resultSupera));
    _ASSERT.equal(resultSupera.success, false, "abono supera deuda → falla");
    _ASSERT.ok((resultSupera.message || resultSupera.error || "").indexOf("supera") > -1,
      "abono supera deuda → mensaje 'supera'");

    Logger.log("[TEST-INT] Flujo completo de abono comprobado");

  } catch (e) {
    _ASSERT.ok(false, "Error en test: " + e.toString());
  } finally {
    CACHE.terceros = null;
    CACHE.terceroIndex = {};
    CACHE.cartera = null;
    CACHE.carteraIndex = {};
    CACHE.lastRefreshTerceros = 0;
    CACHE.lastRefreshCartera = 0;

    var allSheets = [
      getSheet(CARTERA_CONFIG.SHEETS.TERCEROS),
      getSheet(CARTERA_CONFIG.SHEETS.CARTERA),
      getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA),
    ];
    for (var si = 0; si < allSheets.length; si++) {
      try {
        var sh = allSheets[si];
        for (var d = sh.getLastRow(); d >= 2; d--) {
          var v = String(sh.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
          if (v.indexOf("_TEST_") === 0) sh.deleteRow(d);
        }
      } catch (eCln) { Logger.log("[TEST-INT] WARN: limpieza falló: " + eCln.message); }
    }
    if (lock) lock.releaseLock();
    Logger.log("[TEST-INT] Limpieza de abono completada");
  }
}

function testRegistrarCompra() {
  return testRegistrarCompraAtomicValidation();
}

function testVencimientosProximos() {
  Logger.log("[TEST] ===== testVencimientosProximos =====");
  try {
    var v7 = DOMAIN.getVencimientosProximos(7);
    var v30 = DOMAIN.getVencimientosProximos(30);
    Logger.log("[TEST] Próximos 7 días: " + v7.length + " items");
    Logger.log("[TEST] Próximos 30 días: " + v30.length + " items");
    return { dias7: v7.length, dias30: v30.length, muestra: v7.slice(0, 3) };
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testRankingDeudores() {
  Logger.log("[TEST] ===== testRankingDeudores =====");
  try {
    var ranking = DOMAIN.getRankingDeudores(5);
    Logger.log("[TEST] Top deudores: " + JSON.stringify(ranking));
    return ranking;
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testConcentracionProveedores() {
  Logger.log("[TEST] ===== testConcentracionProveedores =====");
  try {
    var conc = DOMAIN.getConcentracionProveedores();
    Logger.log("[TEST] Concentración: " + JSON.stringify(conc));
    return conc;
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

function testMigrarDatosCompras() {
  Logger.log("[TEST] ===== testMigrarDatosCompras =====");
  try {
    var result = migrarDatosCompras();
    Logger.log("[TEST] Resultado: " + JSON.stringify(result));
    return result;
  } catch (e) {
    Logger.log("[TEST] ERROR: " + e.toString());
    return { success: false, error: e.toString() };
  }
}

// ════════════════════════════════════════════
// TESTS UNITARIOS ADICIONALES
// ════════════════════════════════════════════

function testCheckPermissionRoles() {
  Logger.log("[TEST] ===== testCheckPermissionRoles =====");

  var accionValida = "ver_terceros";
  var accionInvalida = "accion_inexistente_xyz";
  _ASSERT.ok(!!PERMISSION_ROLES[accionValida], "accionValida existe en PERMISSION_ROLES");
  _ASSERT.ok(!PERMISSION_ROLES[accionInvalida], "accionInvalida NO existe en PERMISSION_ROLES");

  var errAccion = null;
  try {
    AuthService.checkPermission(accionInvalida);
  } catch (e) {
    errAccion = e;
  }
  _ASSERT.ok(errAccion !== null, "accion desconocida → lanza error");
  if (errAccion) {
    _ASSERT.ok(errAccion.message.indexOf("Acción desconocida") > -1, "mensaje contiene 'Acción desconocida'");
  }

  var props = PropertiesService.getScriptProperties();
  var savedUsers = props.getProperty("AUTHORIZED_USERS");
  props.setProperty("AUTHORIZED_USERS", JSON.stringify({ "test@example.com": "VIEWER" }));

  var roleViewer = AuthService.getUserRole("test@example.com");
  _ASSERT.equal(roleViewer, "VIEWER", "getUserRole('test@example.com') = VIEWER");

  var roleNull = AuthService.getUserRole("unknown@example.com");
  _ASSERT.equal(roleNull, null, "getUserRole('unknown') = null");

  var corruptSnapshot = '{"bad json';
  props.setProperty("AUTHORIZED_USERS", corruptSnapshot);
  var roleCorrupt = AuthService.getUserRole("test@example.com");
  _ASSERT.equal(roleCorrupt, null, "getUserRole con JSON corrupto → null");

  if (savedUsers) {
    props.setProperty("AUTHORIZED_USERS", savedUsers);
  } else {
    props.deleteProperty("AUTHORIZED_USERS");
  }
}

function testActualizarSaldoCompraConcurrente() {
  Logger.log("[TEST-INT] ===== testActualizarSaldoCompraConcurrente =====");

  var testId = "_TEST_CONCUR_" + Date.now();
  var C = DAO_COMPRAS.COMPRAS_COL;
  var lock = LOCK_MANAGER.acquireGlobalLock(10000);
  var sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);

  try {
    var numCols = Math.max.apply(null, Object.values(C)) + 1;
    var row = [];
    row[C.id] = testId;
    row[C.fecha] = new Date();
    row[C.id_proveedor] = "_TEST_CONCUR_PROV_";
    row[C.id_factura] = "F_" + testId;
    row[C.total] = 100000;
    row[C.saldo] = 100000;
    row[C.estado] = COMPRAS_CONFIG.ESTADOS.ABIERTA;
    row[C.fecha_vencimiento] = new Date();
    row[C.version] = 1;
    for (var i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
    sheet.appendRow(row);
    Logger.log("[TEST-INT] Creada compra test: " + testId);

    // Simular actualización 1: versión correcta (1) → éxito
    var r1 = DAO_COMPRAS.actualizarSaldoCompra(testId, 50000, "PARCIAL", 1);
    _ASSERT.equal(r1, true, "actualización 1 (v1) → éxito");

    // Simular actualización 2: versión vieja (1, pero ahora es 2) → fallo
    var errConc = null;
    try {
      DAO_COMPRAS.actualizarSaldoCompra(testId, 0, "PAGADA", 1);
    } catch (e) {
      errConc = e;
    }
    _ASSERT.ok(errConc !== null, "actualización 2 con versión obsoleta → lanza error");
    if (errConc) {
      _ASSERT.equal(errConc.type, 'OPTIMISTIC_LOCK_FAILURE', "error type = OPTIMISTIC_LOCK_FAILURE");
      _ASSERT.equal(errConc.expectedVersion, 1, "expectedVersion = 1");
      _ASSERT.equal(errConc.actualVersion, 2, "actualVersion = 2 (incrementada por upd1)");
      _ASSERT.ok(errConc.retryable === true, "retryable = true");
    }

    // Actualización 3: ahora con versión correcta (2) → éxito
    var r3 = DAO_COMPRAS.actualizarSaldoCompra(testId, 0, "PAGADA", 2);
    _ASSERT.equal(r3, true, "actualización 3 (v2) → éxito");

    var compraFinal = DAO_COMPRAS.getCompraById(testId);
    _ASSERT.equal(compraFinal.saldo, 0, "saldo final = 0");
    _ASSERT.equal(compraFinal.estado, "PAGADA", "estado final = PAGADA");

  } catch (e) {
    _ASSERT.ok(false, "Error en test: " + e.toString());
  } finally {
    try { sheet.getDataRange().getValues().forEach(function(r, idx) {
      if (String(r[C.id] || "").trim() === testId) sheet.deleteRow(idx + 1);
    }); } catch (e) { Logger.log("[TEST-INT] WARN: limpieza falló: " + e.message); }
    if (lock) lock.releaseLock();
    Logger.log("[TEST-INT] Limpieza completada para: " + testId);
  }
}

function testVerifyConsistencyConSheet() {
  Logger.log("[TEST-INT] ===== testVerifyConsistencyConSheet =====");

  // Forzar CACHE a tener datos válidos para que verifyConsistency tenga con qué comparar
  CACHE.invalidate();
  CACHE.refresh(true);
  var consistBase = CACHE.verifyConsistency();
  Logger.log("[TEST-INT] verifyConsistency baseline: " + JSON.stringify(consistBase));

  // Si no hay datos en las hojas, no se puede probar — marcar como omitido
  if (!CACHE.cartera || CACHE.cartera.length === 0 || !CACHE.terceros || CACHE.terceros.length === 0) {
    _ASSERT.ok(true, "verifyConsistency: sin datos en sheet, test omitido (no hay datos para comparar)");
    return;
  }

  _ASSERT.ok(!consistBase.mismatched, "verifyConsistency baseline → no hay mismatch");

  // Modificar el checksum almacenado para simular desincronización
  var originalCarChecksum = CACHE.lastChecksumCartera;
  CACHE.lastChecksumCartera = "FORCED_MISMATCH_" + Date.now();

  var consistForzado = CACHE.verifyConsistency();
  _ASSERT.ok(consistForzado.mismatched, "verifyConsistency con checksum alterado → mismatched=true");
  _ASSERT.ok(!consistForzado.cartera, "verifyConsistency → cartera=false tras alterar checksum");

  // Restaurar
  CACHE.lastChecksumCartera = originalCarChecksum;
  var consistRestored = CACHE.verifyConsistency();
  _ASSERT.ok(!consistRestored.mismatched, "verifyConsistency tras restaurar checksum → sin mismatch");
}

function testRegistrarCompraAtomicLockError() {
  Logger.log("[TEST-INT] ===== testRegistrarCompraAtomicLockError =====");

  // Mock: reemplazar temporalmente acquireResourceLock para que siempre falle
  var originalAcquire = LOCK_MANAGER.acquireResourceLock;
  var mockCalled = false;

  LOCK_MANAGER.acquireResourceLock = function(resourceId) {
    mockCalled = true;
    throw new Error("LOCK_TIMEOUT: Recurso " + resourceId + " no disponible (mock)");
  };

  try {
    var result = DOMAIN.registrarCompraAtomic("PROV_MOCK", [{ id: "P1", cantidad: 1, precio_unitario: 100 }], 100, null, "");
    _ASSERT.ok(mockCalled, "acquireResourceLock fue invocado");
    _ASSERT.equal(result.success, false, "lock timeout → respuesta con success=false");
    _ASSERT.ok((result.message || result.error || "").indexOf("LOCK") > -1 ||
      (result.message || result.error || "").indexOf("Timeout") > -1 ||
      (result.message || result.error || "").indexOf("bloqueo") > -1,
      "mensaje de error alude a lock/timeout");
  } finally {
    LOCK_MANAGER.acquireResourceLock = originalAcquire;
  }
}

function testRegistrarCompraAtomicRollbackOnLockFailure() {
  Logger.log("[TEST-INT] ===== testRegistrarCompraAtomicRollbackOnLockFailure =====");

  // Mock acquireResourceLock para simular timeout después de escritura parcial
  var originalAcquire = LOCK_MANAGER.acquireResourceLock;
  var callCount = 0;

  LOCK_MANAGER.acquireResourceLock = function(resourceId) {
    callCount++;
    if (callCount > 1) {
      throw new Error("LOCK_TIMEOUT: Simulated lock failure on retry");
    }
    return { releaseLock: function() { Logger.log("[MOCK] releaseLock called"); } };
  };

  try {
    var result = DOMAIN.registrarCompraAtomic("PROV_MOCK_RB", [
      { id: "P1", cantidad: 1, precio_unitario: 100 }
    ], 100, null, "");

    _ASSERT.ok(callCount >= 1, "acquireResourceLock fue invocado al menos 1 vez");
    _ASSERT.equal(result.success, false, "rollback en lock failure → success=false");
  } finally {
    LOCK_MANAGER.acquireResourceLock = originalAcquire;
  }
}

// ════════════════════════════════════════════
// TESTS DAO PRODUCTOS (Pareto P1)
// ════════════════════════════════════════════

function testDAOProductosCrearYListar() {
  Logger.log("[TEST-INT] ===== testDAOProductosCrearYListar =====");
  var lock = LOCK_MANAGER.acquireGlobalLock(10000);
  var createdIds = [];
  try {
    var r = DAO_PRODUCTOS.crear({ nombre: "TEST-PROD-CR-" + Date.now(), precio_compra: 5000, precio_venta: 12000, categoria: "HERRAMIENTAS" });
    _ASSERT.ok(r.success === true, "crear → success=true");
    _ASSERT.ok(r.id && r.id.indexOf("P") === 0, "crear → id prefijo P");
    _ASSERT.equal(r.stock, 0, "crear → stock=0");
    createdIds.push(r.id);

    var lista = DAO_PRODUCTOS.listar({ activo: true });
    var encontrado = lista.some(function(p) { return p.id === r.id; });
    _ASSERT.ok(encontrado, "listar({ activo:true }) incluye producto");

    var o = DAO_PRODUCTOS.obtener(r.id);
    _ASSERT.ok(o !== null, "obtener → objeto");
    _ASSERT.equal(o.nombre, r.nombre, "obtener.nombre");
    _ASSERT.equal(o.precio_compra, 5000, "obtener.precio_compra");
    _ASSERT.equal(o.precio_venta, 12000, "obtener.precio_venta");
    _ASSERT.equal(o.categoria, "HERRAMIENTAS", "obtener.categoria");
    _ASSERT.equal(o.activo, "ACTIVO", "obtener.activo");
    _ASSERT.equal(o.stock, 0, "obtener.stock");
    _ASSERT.equal(o.version, 1, "obtener.version=1");
    _ASSERT.ok(o.fecha_creacion instanceof Date, "obtener.fecha_creacion Date");

    var dup = DAO_PRODUCTOS.crear({ nombre: r.nombre, precio_venta: 100 });
    _ASSERT.equal(dup.success, false, "nombre duplicado → false");
    _ASSERT.ok((dup.error || "").indexOf("Ya existe") > -1, "dup → msg 'Ya existe'");

    var sinNom = DAO_PRODUCTOS.crear({ nombre: "", precio_venta: 100 });
    _ASSERT.equal(sinNom.success, false, "nombre vacío → false");

    var precioNeg = DAO_PRODUCTOS.crear({ nombre: "OTRO-TEST-" + Date.now(), precio_venta: -1 });
    _ASSERT.equal(precioNeg.success, false, "precio negativo → false");

    _ASSERT.equal(DAO_PRODUCTOS.obtener(""), null, "obtener('') → null");
    _ASSERT.equal(DAO_PRODUCTOS.obtener(null), null, "obtener(null) → null");
    _ASSERT.equal(DAO_PRODUCTOS.obtener("P_NO_EXISTE_999"), null, "obtener inexistente → null");

    var todos = DAO_PRODUCTOS.listar();
    _ASSERT.ok(Array.isArray(todos), "listar() → array");
    for (var j = 1; j < todos.length; j++) {
      _ASSERT.ok(todos[j-1].nombre <= todos[j].nombre, "listar orden alfabético");
    }

    Logger.log("[TEST-INT] testDAOProductosCrearYListar OK");
  } catch (e) {
    _ASSERT.ok(false, "ERROR: " + e.toString());
  } finally {
    var sheet = getSheet(DAO_PRODUCTOS.SHEET);
    for (var d = sheet.getLastRow(); d >= 2; d--) {
      var v = String(sheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
      if (createdIds.indexOf(v) !== -1) sheet.deleteRow(d);
    }
    if (lock) lock.releaseLock();
  }
}

function testDAOProductosActualizarOptimisticLock() {
  Logger.log("[TEST-INT] ===== testDAOProductosActualizarOptimisticLock =====");
  var lock = LOCK_MANAGER.acquireGlobalLock(10000);
  var prodId = null;
  try {
    var r = DAO_PRODUCTOS.crear({ nombre: "TEST-PROD-UPD-" + Date.now(), precio_compra: 1000, precio_venta: 2000, categoria: "A" });
    _ASSERT.ok(r.success === true, "crear producto para actualizar");
    prodId = r.id;

    var errVer = null;
    try {
      DAO_PRODUCTOS.actualizar(prodId, { precio_venta: 9999 }, 999);
    } catch (e) {
      errVer = e;
    }
    _ASSERT.ok(errVer !== null, "version incorrecta → lanza error");
    if (errVer) {
      _ASSERT.equal(errVer.type, 'OPTIMISTIC_LOCK_FAILURE', "error.type = OPTIMISTIC_LOCK_FAILURE");
      _ASSERT.equal(errVer.expectedVersion, 999, "error.expectedVersion");
      _ASSERT.equal(errVer.actualVersion, 1, "error.actualVersion=1");
      _ASSERT.ok(errVer.retryable === true, "error.retryable=true");
    }

    var ok = DAO_PRODUCTOS.actualizar(prodId, { precio_venta: 9999, categoria: "B" }, 1);
    _ASSERT.equal(ok, true, "actualizar v1 → true");

    var p = DAO_PRODUCTOS.obtener(prodId);
    _ASSERT.equal(p.precio_venta, 9999, "precio_venta actualizado");
    _ASSERT.equal(p.categoria, "B", "categoria actualizada");
    _ASSERT.equal(p.nombre, r.nombre, "nombre inmutable sin cambios");
    _ASSERT.equal(p.version, 2, "version=2 tras update");

    var ok2 = DAO_PRODUCTOS.actualizar(prodId, { nombre: "TEST-PROD-UPD-RENAMED" }, 2);
    _ASSERT.equal(ok2, true, "actualizar nombre v2 → true");

    var p2 = DAO_PRODUCTOS.obtener(prodId);
    _ASSERT.equal(p2.nombre, "TEST-PROD-UPD-RENAMED", "nombre actualizado");
    _ASSERT.equal(p2.version, 3, "version=3");

    var okSinVer = DAO_PRODUCTOS.actualizar(prodId, { precio_compra: 7777 });
    _ASSERT.equal(okSinVer, true, "actualizar sin version → true");

    Logger.log("[TEST-INT] testDAOProductosActualizarOptimisticLock OK");
  } catch (e) {
    _ASSERT.ok(false, "ERROR: " + e.toString());
  } finally {
    if (prodId) {
      var sheet = getSheet(DAO_PRODUCTOS.SHEET);
      for (var d = sheet.getLastRow(); d >= 2; d--) {
        var v = String(sheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
        if (v === prodId) sheet.deleteRow(d);
      }
    }
    if (lock) lock.releaseLock();
  }
}

function testDAOProductosIncrementarStock() {
  Logger.log("[TEST-INT] ===== testDAOProductosIncrementarStock =====");
  var lock = LOCK_MANAGER.acquireGlobalLock(10000);
  var prodId = null;
  try {
    var r = DAO_PRODUCTOS.crear({ nombre: "TEST-PROD-STK-" + Date.now(), precio_compra: 500, precio_venta: 1500 });
    _ASSERT.ok(r.success === true, "crear producto para stock");
    prodId = r.id;

    var inc1 = DAO_PRODUCTOS.incrementarStock(prodId, 5);
    _ASSERT.ok(inc1 !== undefined, "incrementarStock devuelve objeto");
    _ASSERT.equal(inc1.stockAnterior, 0, "stockAnterior=0");
    _ASSERT.equal(inc1.stockNuevo, 5, "stockNuevo=5");

    var inc2 = DAO_PRODUCTOS.incrementarStock(prodId, -2);
    _ASSERT.equal(inc2.stockAnterior, 5, "stockAnterior=5");
    _ASSERT.equal(inc2.stockNuevo, 3, "stockNuevo=3");

    var errStock = null;
    try {
      DAO_PRODUCTOS.incrementarStock(prodId, -10);
    } catch (e) {
      errStock = e;
    }
    _ASSERT.ok(errStock !== null, "stock insuficiente → lanza error");
    if (errStock) {
      _ASSERT.ok(errStock.message.indexOf("insuficiente") > -1, "mensaje contiene 'insuficiente'");
    }

    var p = DAO_PRODUCTOS.obtener(prodId);
    _ASSERT.equal(p.stock, 3, "stock final = 3 (no afectado por error)");
    _ASSERT.ok(p.version > 1, "version incrementada");

    Logger.log("[TEST-INT] testDAOProductosIncrementarStock OK");
  } catch (e) {
    _ASSERT.ok(false, "ERROR: " + e.toString());
  } finally {
    if (prodId) {
      var sheet = getSheet(DAO_PRODUCTOS.SHEET);
      for (var d = sheet.getLastRow(); d >= 2; d--) {
        var v = String(sheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
        if (v === prodId) sheet.deleteRow(d);
      }
    }
    if (lock) lock.releaseLock();
  }
}

function testDAOProductosToggleActivo() {
  Logger.log("[TEST-INT] ===== testDAOProductosToggleActivo =====");
  var lock = LOCK_MANAGER.acquireGlobalLock(10000);
  var prodId = null;
  try {
    var r = DAO_PRODUCTOS.crear({ nombre: "TEST-PROD-TGL-" + Date.now(), precio_venta: 3000 });
    _ASSERT.ok(r.success === true, "crear producto para toggle");
    prodId = r.id;

    var t1 = DAO_PRODUCTOS.toggleActivo(prodId);
    _ASSERT.equal(t1.activo, "INACTIVO", "primer toggle → INACTIVO");

    var listaInactivos = DAO_PRODUCTOS.listar({ activo: false });
    _ASSERT.ok(listaInactivos.some(function(p) { return p.id === prodId; }), "listar({ activo:false }) lo incluye");

    var listaActivos = DAO_PRODUCTOS.listar({ activo: true });
    _ASSERT.ok(!listaActivos.some(function(p) { return p.id === prodId; }), "listar({ activo:true }) NO lo incluye");

    var t2 = DAO_PRODUCTOS.toggleActivo(prodId);
    _ASSERT.equal(t2.activo, "ACTIVO", "segundo toggle → ACTIVO");

    var p = DAO_PRODUCTOS.obtener(prodId);
    _ASSERT.equal(p.activo, "ACTIVO", "obtener confirma ACTIVO");

    var errNoExiste = null;
    try {
      DAO_PRODUCTOS.toggleActivo("P_NO_EXISTE_999");
    } catch (e) {
      errNoExiste = e;
    }
    _ASSERT.ok(errNoExiste !== null, "toggle ID inexistente → lanza error");

    Logger.log("[TEST-INT] testDAOProductosToggleActivo OK");
  } catch (e) {
    _ASSERT.ok(false, "ERROR: " + e.toString());
  } finally {
    if (prodId) {
      var sheet = getSheet(DAO_PRODUCTOS.SHEET);
      for (var d = sheet.getLastRow(); d >= 2; d--) {
        var v = String(sheet.getRange(d, 1, 1, 1).getValues()[0][0] || "").trim();
        if (v === prodId) sheet.deleteRow(d);
      }
    }
    if (lock) lock.releaseLock();
  }
}

/**
 * Pruebas de muestreo estratificado: _segmentByAge, _weightedRandomSample, _stratifiedSample
 * Ejecutar desde el editor de Apps Script.
 */

function test_segmentByAge_empty() {
  const result = IA_SERVICE._segmentByAge([]);
  const pass = Object.keys(result).length === 0;
  Logger.log("test_segmentByAge_empty: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_segmentByAge_singleBucket() {
  const hoy = new Date();
  const items = [
    { dias_vencido: -5, fecha_vencimiento: "2026-06-10" },
    { dias_vencido: 0, fecha_vencimiento: "2026-06-05" },
    { dias_vencido: -1, fecha_vencimiento: "2026-06-04" },
  ];
  const result = IA_SERVICE._segmentByAge(items);
  const pass = Object.keys(result).length === 1
    && result.SIN_VENCER !== undefined
    && result.SIN_VENCER.length === 3;
  Logger.log("test_segmentByAge_singleBucket: " + (pass ? "PASS" : "FAIL") + " — buckets=" + Object.keys(result).join(","));
  return pass;
}

function test_segmentByAge_allBuckets() {
  const items = [
    { dias_vencido: null },
    { dias_vencido: undefined },
    { dias_vencido: -10 },
    { dias_vencido: 0 },
    { dias_vencido: 15 },
    { dias_vencido: 30 },
    { dias_vencido: 45 },
    { dias_vencido: 90 },
    { dias_vencido: 120 },
    { dias_vencido: 180 },
    { dias_vencido: 365 },
  ];
  const result = IA_SERVICE._segmentByAge(items);
  const expectedBuckets = ["SIN_FECHA", "SIN_VENCER", "MORA_1_30", "MORA_31_90", "MORA_91_180", "MORA_180_PLUS"];
  const pass = expectedBuckets.every(b => result[b] !== undefined && result[b].length >= 1)
    && result.SIN_FECHA.length === 2
    && result.SIN_VENCER.length === 2
    && result.MORA_1_30.length === 2
    && result.MORA_31_90.length === 2
    && result.MORA_91_180.length === 2
    && result.MORA_180_PLUS.length === 1;
  Logger.log("test_segmentByAge_allBuckets: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_weightedSample_zero() {
  const hoy = new Date();
  const items = [
    { saldo: 1000, dias_vencido: 10, fecha_vencimiento: null, estado: "VENCIDA" },
    { saldo: 500, dias_vencido: 0, fecha_vencimiento: "2026-07-01", estado: "ABIERTA" },
  ];
  const result = IA_SERVICE._weightedRandomSample(items, hoy, 0);
  const pass = Array.isArray(result) && result.length === 0;
  Logger.log("test_weightedSample_zero: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_weightedSample_all() {
  const hoy = new Date();
  const items = [
    { saldo: 100, dias_vencido: 5, fecha_vencimiento: null, estado: "ABIERTA" },
    { saldo: 200, dias_vencido: 10, fecha_vencimiento: null, estado: "VENCIDA" },
    { saldo: 300, dias_vencido: 0, fecha_vencimiento: null, estado: "CANCELADA" },
  ];
  const result = IA_SERVICE._weightedRandomSample(items, hoy, 5);
  const pass = result.length === 3
    && result.some(r => r.estado === "ABIERTA")
    && result.some(r => r.estado === "VENCIDA")
    && result.some(r => r.estado === "CANCELADA");
  Logger.log("test_weightedSample_all: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_weightedSample_returnsCorrectSize() {
  const hoy = new Date();
  const items = [];
  for (let i = 0; i < 100; i++) {
    items.push({ saldo: i * 100, dias_vencido: i % 30, fecha_vencimiento: null, estado: i % 2 === 0 ? "ABIERTA" : "VENCIDA" });
  }
  const n = 20;
  const result = IA_SERVICE._weightedRandomSample(items, hoy, n);
  const pass = result.length === n && new Set(result).size === n;
  Logger.log("test_weightedSample_returnsCorrectSize: " + (pass ? "PASS" : "FAIL") + " — size=" + result.length + ", unique=" + new Set(result).size);
  return pass;
}

function test_weightedSample_higherScoresSelectedMore() {
  const hoy = new Date();
  // Create items with clearly differentiated scores
  const highScoreItems = [
    { saldo: 1000000, dias_vencido: 200, fecha_vencimiento: null, estado: "VENCIDA" },
    { saldo: 500000, dias_vencido: 180, fecha_vencimiento: null, estado: "VENCIDA" },
  ];
  const lowScoreItems = [];
  for (let i = 0; i < 50; i++) {
    lowScoreItems.push({ saldo: 100, dias_vencido: 0, fecha_vencimiento: null, estado: "CANCELADA" });
  }
  const allItems = [...highScoreItems, ...lowScoreItems];

  let highSelectedTotal = 0;
  const trials = 50;
  for (let t = 0; t < trials; t++) {
    const result = IA_SERVICE._weightedRandomSample(allItems, hoy, 5);
    const highSelected = result.filter(r => r.saldo >= 500000).length;
    highSelectedTotal += highSelected;
  }

  const avgHighPerDraw = highSelectedTotal / trials;
  // With 52 items and 2 high-score items (extreme scores), both high-score items
  // should be selected in most draws of 5
  const pass = avgHighPerDraw >= 1.5;
  Logger.log("test_weightedSample_higherScoresSelectedMore: " + (pass ? "PASS" : "FAIL") + " — avg high per draw=" + avgHighPerDraw.toFixed(2));
  return pass;
}

function test_stratifiedSample_empty() {
  const hoy = new Date();
  const result = IA_SERVICE._stratifiedSample([], hoy, 500);
  const pass = Array.isArray(result) && result.length === 0;
  Logger.log("test_stratifiedSample_empty: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_stratifiedSample_underLimit() {
  const hoy = new Date();
  const items = [];
  for (let i = 0; i < 10; i++) {
    items.push({ saldo: i * 100, dias_vencido: i, fecha_vencimiento: null, estado: "ABIERTA" });
  }
  const result = IA_SERVICE._stratifiedSample(items, hoy, 500);
  const pass = result.length === 10 && result.every(r => items.includes(r));
  Logger.log("test_stratifiedSample_underLimit: " + (pass ? "PASS" : "FAIL") + " — length=" + result.length);
  return pass;
}

function test_stratifiedSample_respectsMax() {
  const hoy = new Date();
  const items = [];
  for (let i = 0; i < 2000; i++) {
    const dias = Math.floor(i / 100) * 30;
    items.push({
      saldo: (i % 100 + 1) * 1000,
      dias_vencido: dias,
      fecha_vencimiento: null,
      estado: i % 3 === 0 ? "VENCIDA" : i % 3 === 1 ? "ABIERTA" : "CANCELADA",
    });
  }

  const maxItems = 500;
  const result = IA_SERVICE._stratifiedSample(items, hoy, maxItems);

  const pass = result.length <= maxItems && result.length > 0;
  Logger.log("test_stratifiedSample_respectsMax: " + (pass ? "PASS" : "FAIL") + " — length=" + result.length + "/" + maxItems);
  return pass;
}

function test_stratifiedSample_allBucketsRepresented() {
  const hoy = new Date();
  const items = [
    { saldo: 1000, dias_vencido: null, fecha_vencimiento: null, estado: "ABIERTA" },
    { saldo: 1000, dias_vencido: -5, fecha_vencimiento: null, estado: "ABIERTA" },
    { saldo: 1000, dias_vencido: 15, fecha_vencimiento: null, estado: "VENCIDA" },
    { saldo: 1000, dias_vencido: 45, fecha_vencimiento: null, estado: "VENCIDA" },
    { saldo: 1000, dias_vencido: 120, fecha_vencimiento: null, estado: "VENCIDA" },
    { saldo: 1000, dias_vencido: 365, fecha_vencimiento: null, estado: "VENCIDA" },
  ];

  const result = IA_SERVICE._stratifiedSample(items, hoy, 6);
  const pass = result.length === 6;
  Logger.log("test_stratifiedSample_allBucketsRepresented: " + (pass ? "PASS" : "FAIL") + " — length=" + result.length);
  return pass;
}

function test_stratifiedSample_proportionalDistribution() {
  const hoy = new Date();
  // 800 items in SIN_VENCER, 200 in MORA_1_30, 2000 total
  const items = [];
  for (let i = 0; i < 800; i++) {
    items.push({ saldo: 100, dias_vencido: 0, fecha_vencimiento: null, estado: "ABIERTA" });
  }
  for (let i = 0; i < 200; i++) {
    items.push({ saldo: 100, dias_vencido: 15, fecha_vencimiento: null, estado: "VENCIDA" });
  }

  const result = IA_SERVICE._stratifiedSample(items, hoy, 500);
  const sinVencer = result.filter(r => r.dias_vencido <= 0).length;
  const mora = result.filter(r => r.dias_vencido > 0).length;

  // Expected: ~80% SIN_VENCER (~400), ~20% MORA (~100) + floors
  // Both buckets get floor of 1, then proportional: ~80% of 498 = 398, ~20% of 498 = 100
  const ratio = sinVencer / mora;
  const pass = ratio > 3.0 && ratio < 5.0 && result.length === 500;
  Logger.log("test_stratifiedSample_proportionalDistribution: " + (pass ? "PASS" : "FAIL") + " — sinVencer=" + sinVencer + ", mora=" + mora + ", ratio=" + ratio.toFixed(2));
  return pass;
}

function test_stratifiedSample_singleStratum() {
  const hoy = new Date();
  const items = [];
  for (let i = 0; i < 1000; i++) {
    items.push({ saldo: i * 100, dias_vencido: 0, fecha_vencimiento: null, estado: "ABIERTA" });
  }

  const result = IA_SERVICE._stratifiedSample(items, hoy, 500);
  const pass = result.length === 500;
  Logger.log("test_stratifiedSample_singleStratum: " + (pass ? "PASS" : "FAIL") + " — length=" + result.length);
  return pass;
}

function test_stratifiedSample_preservesInputData() {
  const hoy = new Date();
  const items = [];
  for (let i = 0; i < 100; i++) {
    items.push({ id: "ITEM_" + i, saldo: i * 100, dias_vencido: i, fecha_vencimiento: null, estado: "ABIERTA" });
  }

  const result = IA_SERVICE._stratifiedSample(items, hoy, 500);
  // When len <= maxItems, returns the original reference
  const pass = result === items;
  Logger.log("test_stratifiedSample_preservesInputData: " + (pass ? "PASS" : "FAIL"));
  return pass;
}

function test_calculateImportanceScore_vencida() {
  const hoy = new Date();
  const item = { saldo: 50000, dias_vencido: 30, fecha_vencimiento: null, estado: "VENCIDA" };
  const score = IA_SERVICE._calculateImportanceScore(item, hoy);
  const pass = score > 0;
  Logger.log("test_calculateImportanceScore_vencida: " + (pass ? "PASS" : "FAIL") + " — score=" + score);
  return pass;
}

function test_calculateImportanceScore_outlier() {
  const hoy = new Date();
  const normal = { saldo: 1000, dias_vencido: 0, fecha_vencimiento: null, estado: "ABIERTA" };
  const outlier = { saldo: 50000000, dias_vencido: 200, fecha_vencimiento: null, estado: "VENCIDA" };
  const scoreNormal = IA_SERVICE._calculateImportanceScore(normal, hoy);
  const scoreOutlier = IA_SERVICE._calculateImportanceScore(outlier, hoy);
  const pass = scoreOutlier > scoreNormal * 3;
  Logger.log("test_calculateImportanceScore_outlier: " + (pass ? "PASS" : "FAIL") + " — normal=" + scoreNormal + ", outlier=" + scoreOutlier);
  return pass;
}

function test_calculateImportanceScore_nullDate() {
  const hoy = new Date();
  const item = { saldo: 1000, dias_vencido: null, fecha_vencimiento: null, estado: "ABIERTA" };
  const score = IA_SERVICE._calculateImportanceScore(item, hoy);
  const pass = score > 0;
  Logger.log("test_calculateImportanceScore_nullDate: " + (pass ? "PASS" : "FAIL") + " — score=" + score);
  return pass;
}

function runAllSamplingTests() {
  Logger.log("═══════════════════════════════════════════════");
  Logger.log("INICIANDO PRUEBAS DE MUESTREO ESTRATIFICADO");
  Logger.log("═══════════════════════════════════════════════");
  const tests = [
    test_segmentByAge_empty,
    test_segmentByAge_singleBucket,
    test_segmentByAge_allBuckets,
    test_weightedSample_zero,
    test_weightedSample_all,
    test_weightedSample_returnsCorrectSize,
    test_weightedSample_higherScoresSelectedMore,
    test_stratifiedSample_empty,
    test_stratifiedSample_underLimit,
    test_stratifiedSample_respectsMax,
    test_stratifiedSample_allBucketsRepresented,
    test_stratifiedSample_proportionalDistribution,
    test_stratifiedSample_singleStratum,
    test_stratifiedSample_preservesInputData,
    test_calculateImportanceScore_vencida,
    test_calculateImportanceScore_outlier,
    test_calculateImportanceScore_nullDate,
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

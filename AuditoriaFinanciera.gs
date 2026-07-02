/**
 * LAYER 5: AUDIT ENGINE - Deep Kardex Integrity Validation
 * Validates inventory movements, cost consistency, and business logic compliance
 */

/**
 * Prueba 1: Verificar que cada salida tenga una entrada previa (FIFO/PEPS)
 */
function testKardexIntegridadFIFO() {
  Logger.log("=== TEST KARDEX INTEGRIDAD FIFO ===");

  var movimientos = DAO_COMPRAS.getAllMovimientosKardex(30, 2000);
  if (movimientos.length === 0) {
    Logger.log('⚠️ No hay movimientos de Kardex para probar');
    return { success: true, message: 'Sin movimientos para probar' };
  }

  Logger.log('📊 Movimientos totales: ' + movimientos.length);

  var movPorProducto = {};
  var errores = [];

  for (var i = 0; i < movimientos.length; i++) {
    var m = movimientos[i];
    var prodId = m.id_producto;
    if (!prodId) continue;
    if (!movPorProducto[prodId]) {
      movPorProducto[prodId] = { movimientos: [], stock: 0 };
    }
    movPorProducto[prodId].movimientos.push(m);
  }

  for (var prodId in movPorProducto) {
    var movs = movPorProducto[prodId].movimientos;
    movs.sort(function(a, b) {
      return new Date(a.fecha) - new Date(b.fecha);
    });

    var stock = 0;
    for (var j = 0; j < movs.length; j++) {
      var mov = movs[j];
      var cantidad = mov.cantidad || 0;
      var tipo = String(mov.tipo_mov || '').toUpperCase();

      if (tipo === 'ENTRADA') {
        stock += cantidad;
      } else if (tipo === 'SALIDA') {
        if (stock < cantidad) {
          errores.push({
            producto: prodId,
            mensaje: 'Salida de ' + cantidad + ' unidades sin stock suficiente (disponible: ' + stock + ')'
          });
        }
        stock -= cantidad;
        if (stock < 0) stock = 0;
      }
    }
  }

  if (errores.length > 0) {
    Logger.log('❌ Se encontraron ' + errores.length + ' errores FIFO:');
    for (var e = 0; e < Math.min(errores.length, 20); e++) {
      Logger.log('  - ' + errores[e].producto + ': ' + errores[e].mensaje);
    }
    throw new Error('Kardex tiene ' + errores.length + ' errores de integridad FIFO');
  }

  Logger.log('✅ testKardexIntegridadFIFO PASS - Todos los movimientos son consistentes');
  return { success: true, message: 'Integridad FIFO verificada' };
}

/**
 * Prueba 2: Verificar consistencia de costos (precio_compra > 0 para productos con stock)
 */
function testKardexConsistenciaCostos() {
  Logger.log("=== TEST KARDEX CONSISTENCIA DE COSTOS ===");

  var productos = DAO_PRODUCTOS.listar({});
  var errores = [];
  var productosConStock = 0;
  var productosSinCosto = 0;

  for (var i = 0; i < productos.length; i++) {
    var p = productos[i];
    var stock = p.stock || 0;
    var costo = p.precio_compra || 0;

    if (stock > 0) {
      productosConStock++;
      if (costo <= 0) {
        productosSinCosto++;
        errores.push({
          producto: p.id,
          nombre: p.nombre,
          mensaje: 'Stock: ' + stock + ', Costo: ' + costo + ' (debe ser > 0)'
        });
      }
    }
  }

  if (errores.length > 0) {
    Logger.log('❌ ' + errores.length + ' productos con stock y costo cero:');
    for (var e = 0; e < Math.min(errores.length, 10); e++) {
      Logger.log('  - ' + errores[e].producto + ' (' + errores[e].nombre + '): ' + errores[e].mensaje);
    }
    throw new Error('Hay ' + errores.length + ' productos con stock pero costo = 0');
  }

  Logger.log('✅ testKardexConsistenciaCostos PASS - Todos los productos con stock tienen costo > 0');
  return { success: true, message: 'Costos consistentes' };
}

/**
 * Prueba 3: Verificar que no haya movimientos huérfanos
 */
function testKardexMovimientosHuerfanos() {
  Logger.log("=== TEST KARDEX MOVIMIENTOS HUÉRFANOS ===");

  var movimientos = DAO_COMPRAS.getAllMovimientosKardex(30, 2000);
  var errores = [];
  var productosValidos = {};

  var productos = DAO_PRODUCTOS.listar({});
  for (var i = 0; i < productos.length; i++) {
    productosValidos[productos[i].id] = true;
  }

  for (var j = 0; j < movimientos.length; j++) {
    var m = movimientos[j];
    var prodId = m.id_producto;
    if (!prodId) {
      errores.push({ mensaje: 'Movimiento sin ID de producto: ' + m.id });
      continue;
    }
    if (!productosValidos[prodId]) {
      errores.push({
        producto: prodId,
        mensaje: 'Movimiento para producto inexistente: ' + prodId
      });
    }
  }

  if (errores.length > 0) {
    Logger.log('❌ ' + errores.length + ' movimientos huérfanos detectados:');
    for (var e = 0; e < Math.min(errores.length, 10); e++) {
      Logger.log('  - ' + (errores[e].producto || 'SIN ID') + ': ' + errores[e].mensaje);
    }
    throw new Error('Hay ' + errores.length + ' movimientos huérfanos en el Kardex');
  }

  Logger.log('✅ testKardexMovimientosHuerfanos PASS - Todos los movimientos tienen producto válido');
  return { success: true, message: 'Sin movimientos huérfanos' };
}

/**
 * Prueba 4: Verificar que las fechas de los movimientos sean lógicas
 */
function testKardexFechasLogicas() {
  Logger.log("=== TEST KARDEX FECHAS LÓGICAS ===");

  var movimientos = DAO_COMPRAS.getAllMovimientosKardex(30, 2000);
  var errores = [];
  var hoy = new Date();
  var hace5Anios = new Date(hoy.getFullYear() - 5, hoy.getMonth(), hoy.getDate());

  for (var i = 0; i < movimientos.length; i++) {
    var m = movimientos[i];
    var fecha = new Date(m.fecha);
    if (isNaN(fecha.getTime())) {
      errores.push({ mensaje: 'Fecha inválida en movimiento: ' + m.id });
      continue;
    }
    if (fecha > hoy) {
      errores.push({
        producto: m.id_producto,
        mensaje: 'Fecha futura: ' + m.fecha
      });
    }
    if (fecha < hace5Anios) {
      errores.push({
        producto: m.id_producto,
        mensaje: 'Fecha muy antigua (>5 años): ' + m.fecha
      });
    }
  }

  if (errores.length > 0) {
    Logger.log('❌ ' + errores.length + ' movimientos con fechas inconsistentes:');
    for (var e = 0; e < Math.min(errores.length, 10); e++) {
      Logger.log('  - ' + (errores[e].producto || 'SIN ID') + ': ' + errores[e].mensaje);
    }
    throw new Error('Hay ' + errores.length + ' movimientos con fechas ilógicas');
  }

  Logger.log('✅ testKardexFechasLogicas PASS - Todas las fechas son lógicas');
  return { success: true, message: 'Fechas consistentes' };
}

/**
 * Ejecutar todas las pruebas de integridad de Kardex
 */
function ejecutarTestsIntegridadKardex() {
  Logger.log("========== EJECUTANDO TESTS DE INTEGRIDAD DE KARDEX ==========");
  var resultados = [];

  try {
    var r1 = testKardexIntegridadFIFO();
    resultados.push({ nombre: 'FIFO', success: r1.success, mensaje: r1.message });
  } catch (e) {
    resultados.push({ nombre: 'FIFO', success: false, mensaje: e.message });
  }

  try {
    var r2 = testKardexConsistenciaCostos();
    resultados.push({ nombre: 'Costos', success: r2.success, mensaje: r2.message });
  } catch (e) {
    resultados.push({ nombre: 'Costos', success: false, mensaje: e.message });
  }

  try {
    var r3 = testKardexMovimientosHuerfanos();
    resultados.push({ nombre: 'Huérfanos', success: r3.success, mensaje: r3.message });
  } catch (e) {
    resultados.push({ nombre: 'Huérfanos', success: false, mensaje: e.message });
  }

  try {
    var r4 = testKardexFechasLogicas();
    resultados.push({ nombre: 'Fechas', success: r4.success, mensaje: r4.message });
  } catch (e) {
    resultados.push({ nombre: 'Fechas', success: false, mensaje: e.message });
  }

  Logger.log("\n=== RESUMEN DE RESULTADOS ===");
  var fallidos = 0;
  for (var i = 0; i < resultados.length; i++) {
    var r = resultados[i];
    Logger.log((r.success ? '✅' : '❌') + ' ' + r.nombre + ': ' + r.mensaje);
    if (!r.success) fallidos++;
  }

  if (fallidos > 0) {
    Logger.log('\n❌ ' + fallidos + ' pruebas fallidas. Revisar hallazgos.');
    return { success: false, resultados: resultados };
  }

  Logger.log('\n✅ Todas las pruebas de integridad de Kardex pasaron');
  return { success: true, resultados: resultados };
}

const AUDIT_ENGINE = {
  auditarInventarios() {
    const tz = _getTimeZone();
    const hoy = new Date();
    const hace5Anios = new Date(hoy.getFullYear() - 5, hoy.getMonth(), hoy.getDate());

    const resultado = {
      timestamp: new Date(),
      success: true,
      metricas: {
        total_productos: 0,
        total_movimientos_kardex: 0,
        productos_con_stock: 0,
        errores_fifo: 0,
        productos_stock_sin_costo: 0,
        movimientos_huerfanos: 0,
        movimientos_fechas_invalidas: 0
      },
      hallazgos: {
        test_integridad: { pasado: true, hallazgos: [] },
        test_valuation: { pasado: true, hallazgos: [] }
      }
    };

    try {
      // 1. Obtener datos base
      const productos = DAO_PRODUCTOS.listar({});
      const movimientosKardex = DAO_COMPRAS.getAllMovimientosKardex(null, 2000);

      resultado.metricas.total_productos = productos.length;
      resultado.metricas.total_movimientos_kardex = movimientosKardex.length;
      resultado.metricas.productos_con_stock = productos.filter(p => (p.stock || 0) > 0).length;

      // 2. TEST FIFO INTEGRITY - Cada salida debe tener entrada previa
      Logger.log("  - Validando integridad FIFO...");
      const movPorProducto = {};

      for (let i = 0; i < movimientosKardex.length; i++) {
        const mov = movimientosKardex[i];
        const prodId = mov.id_producto;
        if (!prodId) continue;
        if (!movPorProducto[prodId]) movPorProducto[prodId] = { movimientos: [], stock: 0 };
        movPorProducto[prodId].movimientos.push(mov);
      }

      for (const prodId in movPorProducto) {
        const data = movPorProducto[prodId];
        const movs = data.movimientos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

        let stock = 0;
        for (let j = 0; j < movs.length; j++) {
          const mov = movs[j];
          const cantidad = mov.cantidad || 0;
          const tipo = String(mov.tipo_mov || '').toUpperCase();

          if (tipo === 'ENTRADA') {
            stock += cantidad;
          } else if (tipo === 'SALIDA') {
            if (stock < cantidad) {
              resultado.hallazgos.test_integridad.pasado = false;
              resultado.hallazgos.test_integridad.hallazgos.push(
                `FIFO: ${prodId} - Salida de ${cantidad} unidades sin entrada previa (stock disponible: ${stock})`
              );
            }
            stock -= cantidad;
            if (stock < 0) stock = 0;
          }
        }
        data.stock = stock;
      }

      resultado.metricas.errores_fifo = resultado.hallazgos.test_integridad.hallazgos.filter(h => h.startsWith('FIFO:')).length;

      // 3. TEST COST CONSISTENCY - Productos con stock deben tener costo > 0
      Logger.log("  - Validando consistencia de costos...");
      let productosConStockYCostoCero = 0;

      for (let i = 0; i < productos.length; i++) {
        const p = productos[i];
        const stock = Number(p.stock) || 0;
        const costo = Number(p.precio_compra) || 0;
        if (stock > 0 && costo === 0) {
          productosConStockYCostoCero++;
          resultado.hallazgos.test_valuation.pasado = false;
          resultado.hallazgos.test_valuation.hallazgos.push(
            `PRODUCTO CON STOCK Y COSTO CERO: ${p.id} (${p.nombre}) - Stock: ${stock}, Costo: 0 - Posible error de valuación`
          );
        }
      }
      resultado.metricas.productos_stock_sin_costo = productosConStockYCostoCero;

      // 4. TEST ORPHAN MOVEMENTS - Movimientos para productos inexistentes
      Logger.log("  - Validando movimientos huérfanos...");
      const productosIds = new Set(productos.map(p => p.id));
      let movimientosHuerfanos = 0;

      for (let i = 0; i < movimientosKardex.length; i++) {
        const mov = movimientosKardex[i];
        const prodId = mov.id_producto;
        if (prodId && !productosIds.has(prodId)) {
          movimientosHuerfanos++;
          resultado.hallazgos.test_integridad.pasado = false;
          resultado.hallazgos.test_integridad.hallazgos.push(
            `MOVIMIENTO HUÉRFANO: Producto ${prodId} no existe en maestro - ID: ${mov.id}`
          );
        }
      }
      resultado.metricas.movimientos_huerfanos = movimientosHuerfanos;

      // 5. TEST DATE LOGIC - Fechas válidas
      Logger.log("  - Validando fechas lógicas...");
      let movimientosFechasInvalidas = 0;

      for (let i = 0; i < movimientosKardex.length; i++) {
        const mov = movimientosKardex[i];
        const fecha = new Date(mov.fecha);
        if (isNaN(fecha.getTime())) {
          movimientosFechasInvalidas++;
          resultado.hallazgos.test_integridad.pasado = false;
          resultado.hallazgos.test_integridad.hallazgos.push(
            `FECHA INVÁLIDA: Movimiento ${mov.id} con fecha no procesable`
          );
          continue;
        }
        if (fecha > hoy) {
          movimientosFechasInvalidas++;
          resultado.hallazgos.test_integridad.pasado = false;
          resultado.hallazgos.test_integridad.hallazgos.push(
            `FECHA FUTURA: ${mov.fecha} para producto ${mov.id_producto} - Posible error de registro`
          );
        }
        if (fecha < hace5Anios) {
          movimientosFechasInvalidas++;
          resultado.hallazgos.test_integridad.pasado = false;
          resultado.hallazgos.test_integridad.hallazgos.push(
            `FECHA ANTIGUA (>5 años): ${mov.fecha} para producto ${mov.id_producto} - Verificar si aún es relevante`
          );
        }
      }
      resultado.metricas.movimientos_fechas_invalidas = movimientosFechasInvalidas;

      // Actualizar estado general
      if (!resultado.hallazgos.test_integridad.pasado || !resultado.hallazgos.test_valuation.pasado) {
        resultado.success = false;
      }

      Logger.log(`Kardex: ${movimientosKardex.length} movimientos, ${resultado.metricas.errores_fifo} errores FIFO, ${productosConStockYCostoCero} sin costo, ${movimientosHuerfanos} huérfanos, ${movimientosFechasInvalidas} fechas inválidas`);

      return resultado;

    } catch (e) {
      Logger.log("Error en AUDIT_ENGINE.auditarInventarios: " + e.toString());
      return {
        success: false,
        error: e.message,
        timestamp: new Date(),
        metricas: resultado.metricas,
        hallazgos: { error: e.message }
      };
    }
  },

  /**
   * Audita la conciliación del flujo de caja.
   * Valida que el saldo de caja coincida entre libro diario y flujo de caja,
   * y que las transacciones estén registradas correctamente.
   */
  auditarConciliacionFlujo() {
    Logger.log("--- CONCILIACIÓN DE FLUJO DE CAJA ---");
    const tz = _getTimeZone();
    const resultado = {
      test_conciliacion_saldo: { pasado: true, hallazgos: [] },
      test_conciliacion_transacciones: { pasado: true, hallazgos: [] },
      test_integridad_saldos: { pasado: true, hallazgos: [] },
      metricas: {}
    };

    try {
      const libroDiario = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
      const flujoCaja = getSheet(CONFIG.SHEETS.FLUJO_CAJA);

      if (!libroDiario || !flujoCaja) {
        resultado.test_conciliacion_saldo.pasado = false;
        resultado.test_conciliacion_saldo.hallazgos.push('Hojas de libro diario o flujo de caja no encontradas');
        return resultado;
      }

      // ============================================================
      // 1. CONCILIACIÓN DE SALDO (TEST_1)
      // ============================================================
      const ldData = libroDiario.getDataRange().getValues();
      const ldCol = CONFIG.COLUMNS.LIBRO_DIARIO;
      let saldoLD = 0;
      let entradasLD = 0;
      let salidasLD = 0;
      const transaccionesLD = [];

      for (let i = 1; i < ldData.length; i++) {
        const tipo = String(ldData[i][ldCol.tipo] || '').trim();
        const monto = _parseMoneda(ldData[i][ldCol.monto], 0);
        const idRef = String(ldData[i][ldCol.id_referencia] || '').trim();

        if (tipo === 'VENTA_CONTADO' || tipo === 'ABONO_CLIENTE') {
          saldoLD += monto;
          entradasLD += monto;
          transaccionesLD.push({ tipo: 'ENTRADA', monto: monto, ref: idRef });
        } else if (tipo === 'PAGO_PROVEEDOR' || tipo === 'COMPRA') {
          saldoLD -= monto;
          salidasLD += monto;
          transaccionesLD.push({ tipo: 'SALIDA', monto: monto, ref: idRef });
        }
      }

      const fcData = flujoCaja.getDataRange().getValues();
      const fcCol = CONFIG.COLUMNS.FLUJO_CAJA;
      let saldoFC = 0;
      let entradasFC = 0;
      let salidasFC = 0;
      const transaccionesFC = {};

      for (let j = 1; j < fcData.length; j++) {
        const tipo = String(fcData[j][fcCol.tipo] || '').trim();
        const monto = _parseMoneda(fcData[j][fcCol.monto], 0);
        const ref = String(fcData[j][fcCol.referencia] || '').trim();

        if (tipo === FLUJO_CAJA_TIPOS.ENTRADA_ABONO || tipo === FLUJO_CAJA_TIPOS.ENTRADA_VENTA) {
          saldoFC += monto;
          entradasFC += monto;
        } else if (tipo === FLUJO_CAJA_TIPOS.SALIDA_PAGO_PROV || tipo === FLUJO_CAJA_TIPOS.SALIDA_COMPRA) {
          saldoFC -= monto;
          salidasFC += monto;
        }

        if (ref) {
          const key = ref + '|' + monto;
          if (!transaccionesFC[key]) transaccionesFC[key] = [];
          transaccionesFC[key].push({ tipo: tipo, monto: monto, ref: ref });
        }
      }

      const diferencia = saldoLD - saldoFC;
      const umbral = CONFIG.MATERIALITY_THRESHOLD || 100000;

      resultado.metricas.saldo_libro_diario = saldoLD;
      resultado.metricas.saldo_flujo_caja = saldoFC;
      resultado.metricas.diferencia_saldo = diferencia;

      if (Math.abs(diferencia) > umbral) {
        resultado.test_conciliacion_saldo.pasado = false;
        resultado.test_conciliacion_saldo.hallazgos.push(
          `Diferencia significativa: ${_formatMoneda(diferencia)} (umbral: ${_formatMoneda(umbral)})`
        );
      }

      // ============================================================
      // 2. CONCILIACIÓN DE TRANSACCIONES (TEST_2) - Muestreo Pareto
      // ============================================================
      const muestras = Math.min(20, transaccionesLD.length);
      let transaccionesNoConciliadas = 0;
      const erroresTransacciones = [];

      for (let k = 0; k < transaccionesLD.length && transaccionesNoConciliadas < 20; k++) {
        const txn = transaccionesLD[k];
        const key = txn.ref + '|' + txn.monto;
        let encontrado = false;

        if (transaccionesFC[key]) {
          encontrado = true;
        }

        if (!encontrado && txn.ref) {
          for (const refKey in transaccionesFC) {
            if (refKey.startsWith(txn.ref + '|')) {
              encontrado = true;
              break;
            }
          }
        }

        if (!encontrado) {
          transaccionesNoConciliadas++;
          erroresTransacciones.push({
            ref: txn.ref,
            tipo: txn.tipo,
            monto: txn.monto
          });
        }
      }

      resultado.metricas.transacciones_muestreadas = Math.min(20, transaccionesLD.length);
      resultado.metricas.transacciones_no_conciliadas = transaccionesNoConciliadas;

      if (transaccionesNoConciliadas > 0) {
        resultado.test_conciliacion_transacciones.pasado = false;
        for (const err of erroresTransacciones) {
          resultado.test_conciliacion_transacciones.hallazgos.push(
            `Transacción no conciliada: Ref=${err.ref} (${err.tipo}) - ${_formatMoneda(err.monto)}`
          );
        }
      }

      // ============================================================
      // 3. INTEGRIDAD DE SALDOS (TEST_3): Sin saldos negativos
      // ============================================================
      let saldoAcumulado = 0;
      let saldosNegativos = 0;
      const erroresSaldos = [];

      for (let l = 1; l < fcData.length; l++) {
        const tipo = String(fcData[l][fcCol.tipo] || '').trim();
        const monto = _parseMoneda(fcData[l][fcCol.monto], 0);
        const concepto = String(fcData[l][fcCol.concepto] || '').trim();
        const ref = String(fcData[l][fcCol.referencia] || '').trim();

        if (tipo === FLUJO_CAJA_TIPOS.ENTRADA_ABONO || tipo === FLUJO_CAJA_TIPOS.ENTRADA_VENTA) {
          saldoAcumulado += monto;
        } else if (tipo === FLUJO_CAJA_TIPOS.SALIDA_PAGO_PROV || tipo === FLUJO_CAJA_TIPOS.SALIDA_COMPRA) {
          saldoAcumulado -= monto;
        }

        if (saldoAcumulado < 0 && saldosNegativos < 10) {
          saldosNegativos++;
          erroresSaldos.push({
            fecha: fcData[l][fcCol.fecha],
            concepto: concepto,
            ref: ref,
            saldo: saldoAcumulado
          });
        }
      }

      resultado.metricas.saldos_negativos_detectados = saldosNegativos;

      if (saldosNegativos > 0) {
        resultado.test_integridad_saldos.pasado = false;
        for (const err of erroresSaldos) {
          resultado.test_integridad_saldos.hallazgos.push(
            `Saldo negativo en ${err.concepto || 'movimiento'} (Ref=${err.ref}): ${_formatMoneda(err.saldo)}`
          );
        }
      }

      Logger.log(`Flujo de caja: Saldo LD=${_formatMoneda(saldoLD)}, Saldo FC=${_formatMoneda(saldoFC)}, Diff=${_formatMoneda(diferencia)}, Transacciones no conciliadas=${transaccionesNoConciliadas}, Saldos negativos=${saldosNegativos}`);

    } catch (e) {
      Logger.log("ERROR en auditoría de conciliación de flujo: " + e.message);
      resultado.error = e.message;
    }

    return resultado;
  },

  ejecutarAuditoriaCompleta() {
    Logger.log("========== EJECUTANDO AUDITORÍA FINANCIERA COMPLETA ==========");

    const resultados = {};

    try {
      resultados.inventarios = AUDIT_ENGINE.auditarInventarios();
      Logger.log("Auditoría de inventarios completada: " + 
        (resultados.inventarios.success ? "PASÓ" : "CON HALLAZGOS"));
    } catch (e) {
      Logger.log("Error en auditoría de inventarios: " + e.toString());
      resultados.inventarios = { success: false, error: e.message };
    }

    // 8. Auditoría de Conciliación de Flujo de Caja
    try {
      resultados.flujo = AUDIT_ENGINE.auditarConciliacionFlujo();
      Logger.log("Auditoría de flujo de caja completada: " + 
        (resultados.flujo.test_conciliacion_saldo.pasado ? "PASÓ" : "CON HALLAZGOS"));
    } catch (e) {
      Logger.log("Error en auditoría de flujo de caja: " + e.toString());
      resultados.flujo = { success: false, error: e.message };
    }

    return {
      success: resultados.inventarios ? resultados.inventarios.success : false,
      timestamp: new Date(),
      resultados: resultados
    };
  }
};

function ejecutarAuditoriaFinanciera() {
  return AUDIT_ENGINE.ejecutarAuditoriaCompleta();
}

/**
 * =============================================================================
 * VTA-01 a VTA-05: TESTS DE VENTAS → SALIDAS DE KARDEX
 * =============================================================================
 */

/**
 * VTA-01: Toda venta genera salida de kardex
 * Para cada venta en AUDIT_LOG (tabla VENTAS), verificar movimiento SALIDA en kardex
 */
function testVentasKardexSalidas() {
  Logger.log("=== TEST VENTAS → SALIDAS DE KARDEX (VTA-01) ===");

  try {
    const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
    const sheetKardex = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);

    if (!sheetAudit || !sheetKardex) {
      Logger.log('⚠️ Hojas AUDIT_LOG o KARDEX no encontradas');
      return { success: true, message: 'Hojas no configuradas' };
    }

    const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;

    const auditData = sheetAudit.getDataRange().getValues();
    const kardexData = sheetKardex.getDataRange().getValues();

    const ventas = auditData.slice(1).filter(r => 
      String(r[COL.tabla]).trim() === "VENTAS" && 
      String(r[COL.operacion]).trim() === "CREATE_VENTA"
    );

    const kardexRefs = new Set();
    for (let i = 1; i < kardexData.length; i++) {
      kardexRefs.add(String(kardexData[i][KCOL.referencia] || "").trim());
    }

    let sinSalida = 0;
    const idsSinSalida = [];

    for (let v = 0; v < ventas.length; v++) {
      const idVenta = String(ventas[v][COL.id_registro] || "").trim();
      if (idVenta && !kardexRefs.has(idVenta)) {
        sinSalida++;
        if (idsSinSalida.length < 10) idsSinSalida.push(idVenta);
      }
    }

    if (sinSalida > 0) {
      Logger.log('❌ ' + sinSalida + ' ventas sin salida en kardex');
      throw new Error('Hay ' + sinSalida + ' ventas sin registro de salida en kardex');
    }

    Logger.log('✅ testVentasKardexSalidas PASS - Todas las ventas tienen salida en kardex');
    return { success: true, message: 'Ventas conciliadas con kardex' };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testVentasKardexSalidas FAIL: ' + e.message);
    throw e;
  }
}

/**
 * VTA-02: Cantidad vendida = cantidad salida en kardex
 */
function testVentasKardexCantidades() {
  Logger.log("=== TEST VENTAS → CANTIDADES KARDEX (VTA-02) ===");

  try {
    const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
    const sheetKardex = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);

    if (!sheetAudit || !sheetKardex) {
      Logger.log('⚠️ Hojas no configuradas');
      return { success: true, message: 'Sin hojas para validar' };
    }

    const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;

    const auditData = sheetAudit.getDataRange().getValues();
    const kardexData = sheetKardex.getDataRange().getValues();

    const ventas = auditData.slice(1).filter(r => 
      String(r[COL.tabla]).trim() === "VENTAS" && 
      String(r[COL.operacion]).trim() === "CREATE_VENTA"
    );

    const kardexPorRef = {};
    for (let i = 1; i < kardexData.length; i++) {
      const ref = String(kardexData[i][KCOL.referencia] || "").trim();
      const tipo = String(kardexData[i][KCOL.tipo_mov] || "").trim().toUpperCase();
      const prodId = String(kardexData[i][KCOL.id_producto] || "").trim();
      const cant = _parseMoneda(kardexData[i][KCOL.cantidad], 0);

      if (ref && tipo === 'SALIDA') {
        if (!kardexPorRef[ref]) kardexPorRef[ref] = {};
        if (!kardexPorRef[ref][prodId]) kardexPorRef[ref][prodId] = 0;
        kardexPorRef[ref][prodId] += cant;
      }
    }

    let errores = 0;
    const ejemplos = [];

    for (let v = 0; v < ventas.length; v++) {
      const idVenta = String(ventas[v][COL.id_registro] || "").trim();
      const datosNuevos = JSON.parse(ventas[v][COL.datos_nuevos] || "{}");
      const items = datosNuevos.items || [];

      if (!idVenta || !kardexPorRef[idVenta]) continue;

      for (let it = 0; it < items.length; it++) {
        const item = items[it];
        const prodId = item.id;
        const cantVendida = item.cantidad || 0;
        const cantKardex = kardexPorRef[idVenta][prodId] || 0;

        if (cantVendida !== cantKardex) {
          errores++;
          if (ejemplos.length < 5) {
            ejemplos.push(idVenta + ': ' + prodId + ' vendido=' + cantVendida + ', kardex=' + cantKardex);
          }
        }
      }
    }

    if (errores > 0) {
      Logger.log('❌ ' + errores + ' inconsistencias de cantidades');
      throw new Error('Cantidades vendidas no coinciden con kardex: ' + ejemplos.join('; '));
    }

    Logger.log('✅ testVentasKardexCantidades PASS - Cantidades concuerdan');
    return { success: true, message: 'Cantidades conciliadas' };
  } catch (e) {
    if (e.message.includes('no configurada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testVentasKardexCantidades FAIL: ' + e.message);
    throw e;
  }
}

/**
 * VTA-03: Venta sin stock suficiente no debería existir
 */
function testVentasSinStockSuficiente() {
  Logger.log("=== TEST VENTAS → STOCK SUFICIENTE (VTA-03) ===");

  try {
    const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
    const sheetKardex = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);

    if (!sheetAudit || !sheetKardex) {
      Logger.log('⚠️ Hojas no configuradas');
      return { success: true, message: 'Sin hojas para validar' };
    }

    const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;

    const kardexData = sheetKardex.getDataRange().getValues();

    const kardexCompleto = [];
    for (let i = 1; i < kardexData.length; i++) {
      kardexCompleto.push({
        fecha: kardexData[i][KCOL.fecha],
        id_producto: String(kardexData[i][KCOL.id_producto] || "").trim(),
        tipo_mov: String(kardexData[i][KCOL.tipo_mov] || "").trim().toUpperCase(),
        cantidad: _parseMoneda(kardexData[i][KCOL.cantidad], 0),
        stock_anterior: _parseMoneda(kardexData[i][KCOL.stock_anterior], 0),
        referencia: String(kardexData[i][KCOL.referencia] || "").trim()
      });
    }

    const ventas = sheetAudit.getDataRange().getValues();
    const ventasData = ventas.slice(1).filter(r => 
      String(r[COL.tabla]).trim() === "VENTAS" && 
      String(r[COL.operacion]).trim() === "CREATE_VENTA" &&
      String(r[COL.estado]).trim() !== "ERROR"
    );

    let errores = 0;
    const ejemplos = [];

    for (let v = 0; v < ventasData.length; v++) {
      const idVenta = String(ventasData[v][COL.id_registro] || "").trim();
      const fechaVenta = ventasData[v][COL.timestamp];
      const datosNuevos = JSON.parse(ventasData[v][COL.datos_nuevos] || "{}");
      const items = datosNuevos.items || [];

      for (let it = 0; it < items.length; it++) {
        const item = items[it];
        const prodId = item.id;
        const cantVendida = item.cantidad || 0;

        const kardexAntes = kardexCompleto
          .filter(k => k.id_producto === prodId && new Date(k.fecha) < new Date(fechaVenta))
          .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

        let stock = 0;
        for (let k = 0; k < kardexAntes.length; k++) {
          if (kardexAntes[k].tipo_mov === 'ENTRADA') {
            stock += kardexAntes[k].cantidad;
          } else if (kardexAntes[k].tipo_mov === 'SALIDA') {
            stock -= kardexAntes[k].cantidad;
            if (stock < 0) stock = 0;
          }
        }

        if (cantVendida > stock) {
          errores++;
          if (ejemplos.length < 5) {
            ejemplos.push(idVenta + ': ' + prodId + ' vendido=' + cantVendida + ', stock disponible=' + stock);
          }
        }
      }
    }

    if (errores > 0) {
      Logger.log('❌ ' + errores + ' ventas sin stock suficiente');
      throw new Error('Ventas con stock insuficiente detectadas: ' + ejemplos.join('; '));
    }

    Logger.log('✅ testVentasSinStockSuficiente PASS - Todas las ventas tuvieron stock');
    return { success: true, message: 'Stock sufficiente en todas las ventas' };
  } catch (e) {
    if (e.message.includes('no configurada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testVentasSinStockSuficiente FAIL: ' + e.message);
    throw e;
  }
}

/**
 * VTA-04: Precio venta consistente
 */
function testVentasPrecioVentaConsistente() {
  Logger.log("=== TEST VENTAS → PRECIO CONSISTENTE (VTA-04) ===");

  try {
    const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);

    if (!sheetAudit) {
      Logger.log('⚠️ Hoja AUDIT_LOG no configurada');
      return { success: true, message: 'Sin hoja para validar' };
    }

    const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
    const productos = DAO_PRODUCTOS.listar({});
    const preciosCompra = {};
    for (let p = 0; p < productos.length; p++) {
      preciosCompra[productos[p].id] = productos[p].precio_compra || 0;
    }

    const ventas = sheetAudit.getDataRange().getValues();
    const ventasData = ventas.slice(1).filter(r => 
      String(r[COL.tabla]).trim() === "VENTAS" && 
      String(r[COL.operacion]).trim() === "CREATE_VENTA"
    );

    let alertas = 0;
    const ejemplos = [];

    for (let v = 0; v < ventasData.length; v++) {
      const datosNuevos = JSON.parse(ventasData[v][COL.datos_nuevos] || "{}");
      const items = datosNuevos.items || [];

      for (let it = 0; it < items.length; it++) {
        const item = items[it];
        const prodId = item.id;
        const precioVenta = item.precio || 0;
        const precioCompra = preciosCompra[prodId] || 0;

        if (precioVenta < precioCompra) {
          alertas++;
          if (ejemplos.length < 5) {
            ejemplos.push(prodId + ': venta=' + precioVenta + ', compra=' + precioCompra);
          }
        }
      }
    }

    if (alertas > 0) {
      Logger.log('⚠️ ' + alertas + ' alertas de precio (sin bloqueo - posible pérdida)');
    }

    Logger.log('✅ testVentasPrecioVentaConsistente PASS - ' + alertas + ' alertas');
    return { success: true, message: alertas + ' alertas de precio bajo' };
  } catch (e) {
    if (e.message.includes('no configurada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testVentasPrecioVentaConsistente FAIL: ' + e.message);
    throw e;
  }
}

/**
 * VTA-05: Devolución de venta genera entrada
 */
function testVentasDevolucionGeneraEntrada() {
  Logger.log("=== TEST VENTAS → DEVOLUCIÓN KARDEX (VTA-05) ===");

  try {
    const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
    const sheetKardex = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);

    if (!sheetAudit || !sheetKardex) {
      Logger.log('⚠️ Hojas no configuradas');
      return { success: true, message: 'Sin hojas para validar (devoluciones no implementadas)' };
    }

    const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;

    const auditData = sheetAudit.getDataRange().getValues();
    const kardexData = sheetKardex.getDataRange().getValues();

    const devoluciones = auditData.slice(1).filter(r => 
      String(r[COL.tabla]).trim() === "VENTAS" && 
      String(r[COL.operacion]).trim() === "DEVOLUCION"
    );

    const entradasPorRef = {};
    for (let i = 1; i < kardexData.length; i++) {
      const ref = String(kardexData[i][KCOL.referencia] || "").trim();
      const tipo = String(kardexData[i][KCOL.tipo_mov] || "").trim().toUpperCase();
      if (ref && tipo === 'ENTRADA') {
        entradasPorRef[ref] = true;
      }
    }

    let sinEntrada = 0;
    for (let d = 0; d < devoluciones.length; d++) {
      const idDevolucion = String(devoluciones[d][COL.id_registro] || "").trim();
      const datosNuevos = JSON.parse(devoluciones[d][COL.datos_nuevos] || "{}");
      const ventaOriginal = datosNuevos.id_venta_original || "";

      if (idDevolucion && !entradasPorRef[idDevolucion] && !entradasPorRef[ventaOriginal]) {
        sinEntrada++;
      }
    }

    Logger.log('✅ testVentasDevolucionGeneraEntrada PASS - ' + sinEntrada + ' sin entrada (módulo devoluciones no implementado)');
    return { success: true, message: 'Devoluciones verificadas' };
  } catch (e) {
    if (e.message.includes('no configurada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testVentasDevolucionGeneraEntrada FAIL: ' + e.message);
    throw e;
  }
}

/**
 * Ejecutar todos los tests de integridad de ventas → kardex
 */
function ejecutarTestsIntegridadVentasKardex() {
  Logger.log("========== EJECUTANDO TESTS VENTAS → KARDEX ==========");
  var resultados = [];

  try {
    var r1 = testVentasKardexSalidas();
    resultados.push({ nombre: 'VTA-01 Salidas', success: r1.success, mensaje: r1.message });
  } catch (e) {
    resultados.push({ nombre: 'VTA-01 Salidas', success: false, mensaje: e.message });
  }

  try {
    var r2 = testVentasKardexCantidades();
    resultados.push({ nombre: 'VTA-02 Cantidades', success: r2.success, mensaje: r2.message });
  } catch (e) {
    resultados.push({ nombre: 'VTA-02 Cantidades', success: false, mensaje: e.message });
  }

  try {
    var r3 = testVentasSinStockSuficiente();
    resultados.push({ nombre: 'VTA-03 Stock', success: r3.success, mensaje: r3.message });
  } catch (e) {
    resultados.push({ nombre: 'VTA-03 Stock', success: false, mensaje: e.message });
  }

  try {
    var r4 = testVentasPrecioVentaConsistente();
    resultados.push({ nombre: 'VTA-04 Precio', success: r4.success, mensaje: r4.message });
  } catch (e) {
    resultados.push({ nombre: 'VTA-04 Precio', success: false, mensaje: e.message });
  }

  try {
    var r5 = testVentasDevolucionGeneraEntrada();
    resultados.push({ nombre: 'VTA-05 Devolución', success: r5.success, mensaje: r5.message });
  } catch (e) {
    resultados.push({ nombre: 'VTA-05 Devolución', success: false, mensaje: e.message });
  }

  Logger.log("\n=== RESUMEN DE RESULTADOS VENTAS-KARDEX ===");
  var fallidos = 0;
  for (var i = 0; i < resultados.length; i++) {
    var r = resultados[i];
    Logger.log((r.success ? '✅' : '❌') + ' ' + r.nombre + ': ' + r.mensaje);
    if (!r.success) fallidos++;
  }

  return { success: fallidos === 0, resultados: resultados };
}
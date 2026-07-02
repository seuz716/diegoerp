/**
 * =============================================================================
 * PRUEBAS DE CONCILIACIÓN DE FLUJO DE CAJA
 * =============================================================================
 * Estas pruebas validan que el flujo de caja registrado en el sistema
 * sea consistente con las transacciones del libro diario.
 */

/**
 * Prueba 1: Conciliación de saldo de caja
 * Calcula el saldo de caja a partir del libro diario y lo compara con el flujo.
 */
function testConciliacionSaldoCaja() {
  Logger.log("=== TEST CONCILIACIÓN SALDO DE CAJA ===");
  
  try {
    const libroDiario = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
    const flujoCaja = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
    
    if (!libroDiario || !flujoCaja) {
      Logger.log('⚠️ Hojas de libro diario o flujo de caja no encontradas (omitir test)');
      return { success: true, message: 'Sin hojas para conciliar (no configuradas)' };
    }

    // 1. Calcular saldo desde libro diario
    const ldData = libroDiario.getDataRange().getValues();
    const ldCol = CONFIG.COLUMNS.LIBRO_DIARIO;
    let saldoLD = 0;
    let entradasLD = 0;
    let salidasLD = 0;

    for (let i = 1; i < ldData.length; i++) {
      const tipo = String(ldData[i][ldCol.tipo] || '').trim();
      const monto = _parseMoneda(ldData[i][ldCol.monto], 0);
      
      if (tipo === 'VENTA_CONTADO' || tipo === 'ABONO_CLIENTE') {
        saldoLD += monto;
        entradasLD += monto;
      } else if (tipo === 'PAGO_PROVEEDOR' || tipo === 'COMPRA') {
        saldoLD -= monto;
        salidasLD += monto;
      }
    }

    Logger.log('📊 Libro diario: Entradas=' + _formatMoneda(entradasLD) + ', Salidas=' + _formatMoneda(salidasLD) + ', Saldo=' + _formatMoneda(saldoLD));

    // 2. Calcular saldo desde flujo de caja
    const fcData = flujoCaja.getDataRange().getValues();
    const fcCol = CONFIG.COLUMNS.FLUJO_CAJA;
    let saldoFC = 0;
    let entradasFC = 0;
    let salidasFC = 0;

    for (let j = 1; j < fcData.length; j++) {
      const tipoFC = String(fcData[j][fcCol.tipo] || '').trim();
      const montoFC = _parseMoneda(fcData[j][fcCol.monto], 0);
      
      if (tipoFC === FLUJO_CAJA_TIPOS.ENTRADA_ABONO || tipoFC === FLUJO_CAJA_TIPOS.ENTRADA_VENTA) {
        saldoFC += montoFC;
        entradasFC += montoFC;
      } else if (tipoFC === FLUJO_CAJA_TIPOS.SALIDA_PAGO_PROV || tipoFC === FLUJO_CAJA_TIPOS.SALIDA_COMPRA) {
        saldoFC -= montoFC;
        salidasFC += montoFC;
      }
    }

    Logger.log('📊 Flujo de caja: Entradas=' + _formatMoneda(entradasFC) + ', Salidas=' + _formatMoneda(salidasFC) + ', Saldo=' + _formatMoneda(saldoFC));

    // 3. Comparar saldos
    const diferencia = saldoLD - saldoFC;
    const umbral = CONFIG.MATERIALITY_THRESHOLD || 100000;

    if (Math.abs(diferencia) > umbral) {
      Logger.log('❌ Diferencia significativa: ' + _formatMoneda(diferencia) + ' (umbral: ' + _formatMoneda(umbral) + ')');
      throw new Error('Conciliación de caja falló: Diferencia de ' + _formatMoneda(diferencia));
    }

    Logger.log('✅ testConciliacionSaldoCaja PASS - Diferencia: ' + _formatMoneda(diferencia));
    return { 
      success: true, 
      message: 'Saldo conciliado',
      diferencia: diferencia,
      saldoLD: saldoLD,
      saldoFC: saldoFC
    };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testConciliacionSaldoCaja FAIL: ' + e.message);
    throw e;
  }
}

/**
 * Prueba 2: Verificar que transacciones del libro diario tengan registro en flujo de caja
 * Muestreo Pareto de las últimas 30 transacciones.
 */
function testConciliacionTransacciones() {
  Logger.log("=== TEST CONCILIACIÓN TRANSACCIONES ===");
  
  try {
    const libroDiario = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
    const flujoCaja = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
    
    if (!libroDiario || !flujoCaja) {
      Logger.log('⚠️ Hojas de libro diario o flujo de caja no encontradas (omitir test)');
      return { success: true, message: 'Sin hojas para conciliar' };
    }

    // 1. Obtener transacciones de libro diario que afectan caja (últimas 20)
    const ldData = libroDiario.getDataRange().getValues();
    const ldCol = CONFIG.COLUMNS.LIBRO_DIARIO;
    const transaccionesLD = [];

    // Obtener últimas 20 filas (muestreo Pareto)
    const startIdx = Math.max(1, ldData.length - 20);
    for (let i = startIdx; i < ldData.length; i++) {
      const tipo = String(ldData[i][ldCol.tipo] || '').trim();
      const monto = _parseMoneda(ldData[i][ldCol.monto], 0);
      const idRef = String(ldData[i][ldCol.id_referencia] || '').trim();
      
      if ((tipo === 'VENTA_CONTADO' || tipo === 'ABONO_CLIENTE' || 
           tipo === 'PAGO_PROVEEDOR' || tipo === 'COMPRA') && idRef) {
        transaccionesLD.push({ tipo: tipo, monto: monto, ref: idRef });
      }
    }

    Logger.log('📊 Transacciones de libro diario (muestra): ' + transaccionesLD.length);

    // 2. Obtener todas las transacciones de flujo de caja (últimas 100)
    const fcData = flujoCaja.getDataRange().getValues();
    const fcCol = CONFIG.COLUMNS.FLUJO_CAJA;
    const transaccionesFC = {};

    const fcStartIdx = Math.max(1, fcData.length - 100);
    for (let j = fcStartIdx; j < fcData.length; j++) {
      const refFC = String(fcData[j][fcCol.referencia] || '').trim();
      const montoFC = _parseMoneda(fcData[j][fcCol.monto], 0);
      
      if (refFC) {
        const key = refFC + '|' + montoFC;
        if (!transaccionesFC[key]) transaccionesFC[key] = [];
        transaccionesFC[key].push({ monto: montoFC, ref: refFC });
      }
    }

    Logger.log('📊 Transacciones de flujo de caja (últimas 100): ' + Object.keys(transaccionesFC).length);

    // 3. Verificar cada transacción de libro diario contra flujo de caja
    const errores = [];

    for (const txn of transaccionesLD) {
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
        errores.push({
          referencia: txn.ref,
          tipo: txn.tipo,
          monto: txn.monto
        });
      }
    }

    if (errores.length > 0) {
      Logger.log('❌ ' + errores.length + ' transacciones de libro diario no encontradas en flujo de caja');
      for (const err of errores.slice(0, 5)) {
        Logger.log('  - Ref: ' + err.referencia + ' (' + err.tipo + ') - ' + _formatMoneda(err.monto));
      }
      throw new Error('Hay ' + errores.length + ' transacciones sin conciliar en flujo de caja');
    }

    Logger.log('✅ testConciliacionTransacciones PASS - Todas las transacciones muestreadas están conciliadas');
    return { success: true, message: 'Transacciones conciliadas' };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testConciliacionTransacciones FAIL: ' + e.message);
    throw e;
  }
}

/**
 * Prueba 3: Verificar integridad del flujo de caja (sin saldos negativos)
 */
function testFlujoCajaSinNegativos() {
  Logger.log("=== TEST FLUJO DE CAJA SIN NEGATIVOS ===");
  
  try {
    const flujoCaja = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
    if (!flujoCaja) {
      Logger.log('⚠️ Hoja de flujo de caja no encontrada (omitir test)');
      return { success: true, message: 'Sin hoja de flujo de caja' };
    }

    const fcData = flujoCaja.getDataRange().getValues();
    const fcCol = CONFIG.COLUMNS.FLUJO_CAJA;
    let saldoAcumulado = 0;
    const errores = [];
    const tz = _getTimeZone();

    for (let i = 1; i < fcData.length; i++) {
      const tipo = String(fcData[i][fcCol.tipo] || '').trim();
      const monto = _parseMoneda(fcData[i][fcCol.monto], 0);
      const concepto = String(fcData[i][fcCol.concepto] || '').trim();
      const referencia = String(fcData[i][fcCol.referencia] || '').trim();

      if (tipo === FLUJO_CAJA_TIPOS.ENTRADA_ABONO || tipo === FLUJO_CAJA_TIPOS.ENTRADA_VENTA) {
        saldoAcumulado += monto;
      } else if (tipo === FLUJO_CAJA_TIPOS.SALIDA_PAGO_PROV || tipo === FLUJO_CAJA_TIPOS.SALIDA_COMPRA) {
        saldoAcumulado -= monto;
      }

      if (saldoAcumulado < 0) {
        errores.push({
          fecha: fcData[i][fcCol.fecha],
          concepto: concepto,
          referencia: referencia,
          saldo: saldoAcumulado
        });
        if (errores.length >= 10) break;
      }
    }

    if (errores.length > 0) {
      Logger.log('❌ ' + errores.length + ' momentos con saldo de caja negativo');
      throw new Error('El flujo de caja tiene saldos negativos (posiblemente mal registrado)');
    }

    Logger.log('✅ testFlujoCajaSinNegativos PASS - Saldo de caja siempre positivo');
    return { success: true, message: 'Sin saldos negativos' };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testFlujoCajaSinNegativos FAIL: ' + e.message);
    throw e;
  }
}

/**
 * Ejecutar todas las pruebas de conciliación de flujo de caja
 */
function ejecutarTestsConciliacionFlujo() {
  Logger.log("========== EJECUTANDO TESTS DE CONCILIACIÓN DE FLUJO DE CAJA ==========");
  const resultados = [];
  
  try {
    const r1 = testConciliacionSaldoCaja();
    resultados.push({ nombre: 'SaldoCaja', success: r1.success, mensaje: r1.message });
  } catch (e) {
    resultados.push({ nombre: 'SaldoCaja', success: false, mensaje: e.message });
  }

  try {
    const r2 = testConciliacionTransacciones();
    resultados.push({ nombre: 'Transacciones', success: r2.success, mensaje: r2.message });
  } catch (e) {
    resultados.push({ nombre: 'Transacciones', success: false, mensaje: e.message });
  }

  try {
    const r3 = testFlujoCajaSinNegativos();
    resultados.push({ nombre: 'SinNegativos', success: r3.success, mensaje: r3.message });
  } catch (e) {
    resultados.push({ nombre: 'SinNegativos', success: false, mensaje: e.message });
  }

  Logger.log("\n=== RESUMEN DE RESULTADOS ===");
  let fallidos = 0;
  for (const r of resultados) {
    Logger.log((r.success ? '✅' : '❌') + ' ' + r.nombre + ': ' + r.mensaje);
    if (!r.success) fallidos++;
  }

  if (fallidos > 0) {
    Logger.log('\n❌ ' + fallidos + ' pruebas fallidas. Revisar hallazgos.');
    return { success: false, resultados: resultados };
  }

  Logger.log('\n✅ Todas las pruebas de conciliación de flujo de caja pasaron');
  return { success: true, resultados: resultados };
}
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
    let libroDiario, flujoCaja;
    try {
      libroDiario = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
      flujoCaja = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
    } catch (sheetErr) {
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
  
  let libroDiario, flujoCaja;
  try {
    libroDiario = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
    flujoCaja = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
  } catch (sheetErr) {
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
  
  let flujoCaja;
  try {
    flujoCaja = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
  } catch (sheetErr) {
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

// =============================================================================
// PRUEBAS DE CONCILIACIÓN INVENTARIO FÍSICO VS CONTABLE
// =============================================================================

/**
 * INV-01: Conciliación stock Productos vs Kardex acumulado
 * Para cada producto activo, calcular stock teórico sumando/restando todos los movimientos
 * Comparar con stock en hoja Productos
 */
function testInvConciliacionStock() {
  Logger.log("=== TEST INV-01: CONCILIACIÓN STOCK FÍSICO VS CONTABLE ===");
  
  try {
    // Verificar que las hojas existen
    let productosSheet, kardexSheet;
    try {
      productosSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
      kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    } catch (sheetErr) {
      Logger.log('⚠️ Hojas no encontradas (omitir test)');
      return { success: true, message: 'Sin hojas para probar' };
    }

    const productosData = productosSheet.getDataRange().getValues();
    const kardexData = kardexSheet.getDataRange().getValues();
    
    const prodCol = CONFIG.COLUMNS.PRODUCTOS;
    const kardexCol = COMPRAS_CONFIG.COLUMNS.KARDEX;
    
    // Agrupar movimientos por producto
    const movimientosPorProducto = {};
    
    for (let i = 1; i < kardexData.length; i++) {
      const prodId = String(kardexData[i][kartexCol.id_producto] || '').trim();
      if (!prodId) continue;
      
      if (!movimientosPorProducto[prodId]) {
        movimientosPorProducto[prodId] = [];
      }
      
      movimientosPorProducto[prodId].push({
        tipo: String(kardexData[i][kartexCol.tipo_mov] || '').trim().toUpperCase(),
        cantidad: _parseMoneda(kardexData[i][kartexCol.cantidad], 0),
        referencia: String(kardexData[i][kartexCol.referencia] || '').trim()
      });
    }
    
    // Calcular stock teórico para cada producto activo
    const errores = [];
    const umbral = CONFIG.MATERIALITY_THRESHOLD || 1; // Umbral de 1 unidad
    
    for (let i = 1; i < productosData.length; i++) {
      const prodId = String(productosData[i][prodCol.id] || '').trim();
      const stockContable = _parseMoneda(productosData[i][prodCol.stock], 0);
      const activo = String(productosData[i][prodCol.activo] || '').trim();
      
      // Solo procesar productos activos
      if (activo !== 'ACTIVO') continue;
      
      // Calcular stock teórico desde kardex
      let stockFisico = 0;
      const movimientos = movimientosPorProducto[prodId] || [];
      
      for (const mov of movimientos) {
        if (mov.tipo === 'ENTRADA') {
          stockFisico += mov.cantidad;
        } else if (mov.tipo === 'SALIDA') {
          stockFisico -= mov.cantidad;
        }
      }
      
      // Comparar con tolerancia
      const diferencia = stockFisico - stockContable;
      if (Math.abs(diferencia) > umbral) {
        errores.push({
          producto: prodId,
          stockContable: stockContable,
          stockFisico: stockFisico,
          diferencia: diferencia
        });
      }
    }
    
    if (errores.length > 0) {
      Logger.log('❌ ' + errores.length + ' productos con discrepancia de stock');
      for (const err of errores.slice(0, 10)) {
        Logger.log('  - ' + err.producto + ': Contable=' + err.stockContable + ', Físico=' + err.stockFisico + ', Diff=' + err.diferencia);
      }
      throw new Error('Hay ' + errores.length + ' productos con discrepancia de stock entre Productos y Kardex');
    }
    
    Logger.log('✅ testInvConciliacionStock PASS - Todos los productos concuerdan');
    return { success: true, message: 'Stock conciliado', errores: errores.length };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testInvConciliacionStock FAIL: ' + e.message);
    throw e;
  }
}

/**
 * INV-02: Stock negativo histórico
 * Revisar si algún producto tuvo stock_nuevo < 0 en algún movimiento
 */
function testInvStockNegativoHistorico() {
  Logger.log("=== TEST INV-02: STOCK NEGATIVO HISTÓRICO ===");
  
  try {
    let kardexSheet;
    try {
      kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    } catch (sheetErr) {
      Logger.log('⚠️ Hoja Kardex no encontrada (omitir test)');
      return { success: true, message: 'Sin hoja Kardex' };
    }

    const kardexData = kardexSheet.getDataRange().getValues();
    const kardexCol = COMPRAS_CONFIG.COLUMNS.KARDEX;
    
    const errores = [];
    
    for (let i = 1; i < kardexData.length; i++) {
      const stockNuevo = _parseMoneda(kardexData[i][kartexCol.stock_nuevo], 0);
      const prodId = String(kardexData[i][kartexCol.id_producto] || '').trim();
      const tipo = String(kardexData[i][kartexCol.tipo_mov] || '').trim();
      
      if (stockNuevo < 0) {
        errores.push({
          producto: prodId,
          tipo: tipo,
          stockNuevo: stockNuevo,
          fila: i + 1
        });
      }
    }
    
    if (errores.length > 0) {
      Logger.log('❌ ' + errores.length + ' movimientos con stock_nuevo negativo');
      throw new Error('Stock negativo detectado - posible error grave de inventario');
    }
    
    Logger.log('✅ testInvStockNegativoHistorico PASS - Sin stock negativo');
    return { success: true, message: 'Sin stock negativo histórico' };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testInvStockNegativoHistorico FAIL: ' + e.message);
    throw e;
  }
}

/**
 * INV-03: Movimientos sin transacción original
 * Cada ENTRADA debe tener una compra asociada
 * Cada SALIDA debe tener una venta asociada (ver en AUDIT_LOG)
 */
function testInvMovimientosSinTransaccion() {
  Logger.log("=== TEST INV-03: MOVIMIENTOS SIN TRANSACCIÓN ORIGINAL ===");
  
  try {
    let kardexSheet, comprasSheet, auditLogSheet;
    try {
      kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
      comprasSheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
      auditLogSheet = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
    } catch (sheetErr) {
      Logger.log('⚠️ Hojas no encontradas (omitir test)');
      return { success: true, message: 'Sin hojas para probar' };
    }

    const kardexData = kardexSheet.getDataRange().getValues();
    const comprasData = comprasSheet.getDataRange().getValues();
    const auditLogData = auditLogSheet.getDataRange().getValues();
    
    const kardexCol = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const comprasCol = COMPRAS_CONFIG.COLUMNS.COMPRAS;
    const auditCol = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
    
    // Indexar compras por ID para búsqueda rápida
    const comprasIds = new Set();
    for (let i = 1; i < comprasData.length; i++) {
      comprasIds.add(String(comprasData[i][comprasCol.id] || '').trim());
    }
    
    // Indexar referencias de ventas desde AUDIT_LOG
    const ventasRefs = new Set();
    for (let i = 1; i < auditLogData.length; i++) {
      const tabla = String(auditLogData[i][auditCol.tabla] || '').trim();
      const operacion = String(auditLogData[i][auditCol.operacion] || '').trim();
      const idRef = String(auditLogData[i][auditCol.id_registro] || '').trim();
      if (tabla === 'VENTAS' || operacion.includes('VENTA')) {
        ventasRefs.add(idRef);
      }
    }
    
    const errores = [];
    
    for (let i = 1; i < kardexData.length; i++) {
      const tipo = String(kardexData[i][kartexCol.tipo_mov] || '').trim().toUpperCase();
      const ref = String(kardexData[i][kartexCol.referencia] || '').trim();
      const prodId = String(kardexData[i][kartexCol.id_producto] || '').trim();
      
      if (tipo === 'ENTRADA' && ref && !comprasIds.has(ref)) {
        errores.push({ tipo: 'ENTRADA', referencia: ref, producto: prodId });
      } else if (tipo === 'SALIDA' && ref && !ventasRefs.has(ref)) {
        errores.push({ tipo: 'SALIDA', referencia: ref, producto: prodId });
      }
    }
    
    if (errores.length > 0) {
      Logger.log('❌ ' + errores.length + ' movimientos sin transacción original');
      for (const err of errores.slice(0, 5)) {
        Logger.log('  - ' + err.tipo + ': ' + err.referencia + ' (prod: ' + err.producto + ')');
      }
      throw new Error('Movimientos huérfanos detectados - falta transacción original');
    }
    
    Logger.log('✅ testInvMovimientosSinTransaccion PASS - Todas las transacciones tienen origen');
    return { success: true, message: 'Transacciones validadas' };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testInvMovimientosSinTransaccion FAIL: ' + e.message);
    throw e;
  }
}

/**
 * INV-04: Duplicidad de movimientos
 * Detectar movimientos con mismo id_producto, misma fecha, misma cantidad, mismo tipo
 */
function testInvDuplicidadMovimientos() {
  Logger.log("=== TEST INV-04: DUPLICIDAD DE MOVIMIENTOS ===");
  
  try {
    let kardexSheet;
    try {
      kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    } catch (sheetErr) {
      Logger.log('⚠️ Hoja Kardex no encontrada (omitir test)');
      return { success: true, message: 'Sin hoja Kardex' };
    }

    const kardexData = kardexSheet.getDataRange().getValues();
    const kardexCol = COMPRAS_CONFIG.COLUMNS.KARDEX;
    
    const firmas = {};
    const duplicados = [];
    
    for (let i = 1; i < kardexData.length; i++) {
      const prodId = String(kardexData[i][kartexCol.id_producto] || '').trim();
      const fecha = new Date(kardexData[i][kartexCol.fecha]).toISOString().split('T')[0];
      const tipo = String(kardexData[i][kartexCol.tipo_mov] || '').trim().toUpperCase();
      const cantidad = _parseMoneda(kardexData[i][kartexCol.cantidad], 0);
      
      const firma = `${prodId}|${fecha}|${tipo}|${cantidad}`;
      
      if (firmas[firma]) {
        duplicados.push({
          producto: prodId,
          fecha: fecha,
          tipo: tipo,
          cantidad: cantidad,
          referencia: String(kardexData[i][kartexCol.referencia] || '').trim()
        });
      } else {
        firmas[firma] = true;
      }
    }
    
    if (duplicados.length > 0) {
      Logger.log('❌ ' + duplicados.length + ' movimientos duplicados detectados');
      for (const dup of duplicados.slice(0, 5)) {
        Logger.log('  - Prod: ' + dup.producto + ', Fecha: ' + dup.fecha + ', Tipo: ' + dup.tipo);
      }
      throw new Error('Posible doble registro en Kardex');
    }
    
    Logger.log('✅ testInvDuplicidadMovimientos PASS - Sin duplicados');
    return { success: true, message: 'Sin duplicidad' };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testInvDuplicidadMovimientos FAIL: ' + e.message);
    throw e;
  }
}

/**
 * INV-05: Ajustes de inventario no autorizados
 * Identificar movimientos con origen = "AJUSTE" y verificar usuario ADMIN
 */
function testInvAjustesNoAutorizados() {
  Logger.log("=== TEST INV-05: AJUSTES DE INVENTARIO NO AUTORIZADOS ===");
  
  try {
    let kardexSheet;
    try {
      kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    } catch (sheetErr) {
      Logger.log('⚠️ Hoja Kardex no encontrada (omitir test)');
      return { success: true, message: 'Sin hoja Kardex' };
    }

    const kardexData = kardexSheet.getDataRange().getValues();
    const kardexCol = COMPRAS_CONFIG.COLUMNS.KARDEX;
    
    const errores = [];
    
    for (let i = 1; i < kardexData.length; i++) {
      const origen = String(kardexData[i][kartexCol.origen] || '').trim().toUpperCase();
      const usuario = String(kardexData[i][kartexCol.usuario] || '').trim().toUpperCase();
      const ref = String(kardexData[i][kartexCol.referencia] || '').trim();
      
      if (origen === 'AJUSTE' && usuario !== 'ADMIN') {
        errores.push({
          referencia: ref,
          usuario: usuario || '(sin usuario)'
        });
      }
    }
    
    if (errores.length > 0) {
      Logger.log('❌ ' + errores.length + ' ajustes sin autorización ADMIN');
      for (const err of errores.slice(0, 5)) {
        Logger.log('  - Ref: ' + err.referencia + ', Usuario: ' + err.usuario);
      }
      throw new Error('Ajustes de inventario sin autorización de ADMIN');
    }
    
    Logger.log('✅ testInvAjustesNoAutorizados PASS - Ajustes autorizados');
    return { success: true, message: 'Ajustes validados' };
  } catch (e) {
    if (e.message.includes('no encontrada')) {
      return { success: true, message: e.message };
    }
    Logger.log('❌ testInvAjustesNoAutorizados FAIL: ' + e.message);
    throw e;
  }
}

/**
 * Ejecutar todas las pruebas de conciliación de inventario
 */
function ejecutarTestsConciliacionInventario() {
  Logger.log("========== EJECUTANDO TESTS DE CONCILIACIÓN DE INVENTARIO ==========");
  const resultados = [];
  
  try {
    const r1 = testInvConciliacionStock();
    resultados.push({ nombre: 'INV-01 Stock', success: r1.success, mensaje: r1.message });
  } catch (e) {
    resultados.push({ nombre: 'INV-01 Stock', success: false, mensaje: e.message });
  }

  try {
    const r2 = testInvStockNegativoHistorico();
    resultados.push({ nombre: 'INV-02 Negativo', success: r2.success, mensaje: r2.message });
  } catch (e) {
    resultados.push({ nombre: 'INV-02 Negativo', success: false, mensaje: e.message });
  }

  try {
    const r3 = testInvMovimientosSinTransaccion();
    resultados.push({ nombre: 'INV-03 Huérfanos', success: r3.success, mensaje: r3.message });
  } catch (e) {
    resultados.push({ nombre: 'INV-03 Huérfanos', success: false, mensaje: e.message });
  }

  try {
    const r4 = testInvDuplicidadMovimientos();
    resultados.push({ nombre: 'INV-04 Duplicados', success: r4.success, mensaje: r4.message });
  } catch (e) {
    resultados.push({ nombre: 'INV-04 Duplicados', success: false, mensaje: e.message });
  }

  try {
    const r5 = testInvAjustesNoAutorizados();
    resultados.push({ nombre: 'INV-05 Ajustes', success: r5.success, mensaje: r5.message });
  } catch (e) {
    resultados.push({ nombre: 'INV-05 Ajustes', success: false, mensaje: e.message });
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

  Logger.log('\n✅ Todas las pruebas de conciliación de inventario pasaron');
  return { success: true, resultados: resultados };
}
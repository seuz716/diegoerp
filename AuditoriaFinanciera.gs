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
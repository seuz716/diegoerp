/**
 * Tests automáticos para módulo de Cartera
 * Autor: Copilot (generado para QA)
 * Instrucciones: ejecutar `runAllTests()` desde el editor de Apps Script.
 * NOTA: Este archivo NO modifica código productivo. Sobrescribe en runtime funciones globales
 *       como `getSheet`, `LockService`, `Utilities` para simular Sheets en memoria.
 */

// -------------------------
// Mocks y utilidades
// -------------------------
function _makeMockSheet(rows) {
  const data = rows.map(r => r.slice());
  return {
    _data: data,
    getDataRange: function() { return { getValues: () => this._data }; },
    getValues: function() { return this._data; },
    getLastRow: function() { return Math.max(1, this._data.length); },
    appendRow: function(row) { this._data.push(row.slice()); },
    // row, col are 1-based
    getRange: function(row, col, numRows, numCols) {
      const sheet = this;
      numRows = numRows || 1; numCols = numCols || 1;
      return {
        setValues: function(values) {
          for (let r = 0; r < values.length; r++) {
            const destRow = row - 1 + r;
            sheet._data[destRow] = sheet._data[destRow] || [];
            for (let c = 0; c < values[r].length; c++) {
              sheet._data[destRow][col - 1 + c] = values[r][c];
            }
          }
        },
        setValue: function(val) {
          sheet._data[row - 1] = sheet._data[row - 1] || [];
          sheet._data[row - 1][col - 1] = val;
        }
      };
    }
  };
}

const _TEST_STATE = { sheets: {} };

function _resetMocks(initial) {
  _TEST_STATE.sheets = {};
  for (const name in initial) {
    _TEST_STATE.sheets[name] = _makeMockSheet(initial[name]);
  }

  // Mock global helpers used by el código productivo
  this.getSheet = function(name) { return _TEST_STATE.sheets[name] || _makeMockSheet([[]]); };

  this.SpreadsheetApp = this.SpreadsheetApp || {};
  this.SpreadsheetApp.flush = function() {};

  this.Logger = this.Logger || { log: function() {} };

  this.LockService = this.LockService || {};
  this.LockService.getScriptLock = function() {
    return {
      tryLock: function() { return true; },
      releaseLock: function() {}
    };
  };

  this.Utilities = this.Utilities || {};
  this.Utilities.getUuid = function() { return 'MOCK-UUID-0000'; };
}

// Asserts y runner
function _assert(cond, message) { if (!cond) throw new Error(message || 'Assertion failed'); }

function _run(name, fn, results) {
  try {
    fn();
    results.push(`✔ ${name}: OK`);
  } catch (e) {
    results.push(`❌ ${name}: FALLÓ → ${e.message}`);
  }
}

// -------------------------
// Test cases
// -------------------------

function test_crearTercero() {
  _resetMocks({
    Terceros: [ ['ID','Nombre','Telefono','Tipo','Limite','Activo'] ]
  });

  // llamar a saveTercero (archivo productivo)
  const res = saveTercero({ id: 'T001', nombre: 'Cliente Test', telefono: '3001112222', tipo: 'CLIENTE', limite_credito: 1000 });
  _assert(res && res.success, 'saveTercero devolvió error');

  const terceros = getTerceros();
  _assert(terceros.some(t => t.id === 'T001'), 'Tercero no encontrado en getTerceros');
}

function test_crearVentaContado() {
  _resetMocks({
    Productos: [ ['ID','Nombre','Stock','Precio'], ['P1','Prod1',10,500] ],
    Ventas: [ ['ID','Fecha','Total'] ],
    Detalle_Ventas: [ ['Venta','Prod','Cant','Precio'] ],
  });

  // definir CONFIG mínimo requerido por procesarVentaV2
  this.CONFIG = { SHEETS: { VENTAS: 'Ventas', DETALLE_VENTAS: 'Detalle_Ventas', PRODUCTOS: 'Productos' } };

  const carrito = [{ id_producto: 'P1', nombre: 'Prod1', cantidad: 2, precio: 500 }];
  const r = procesarVentaV2(carrito, {});
  _assert(r && r.success, 'procesarVentaV2 contado falló');

  const ventas = getSheet('Ventas').getDataRange().getValues();
  _assert(ventas.length > 1, 'Venta no fue registrada en hoja Ventas');

  const stock = getSheet('Productos').getDataRange().getValues();
  _assert(parseInt(stock[1][2]) === 8, 'Stock no fue decrementado correctamente');
}

function test_crearVentaCredito() {
  _resetMocks({
    Productos: [ ['ID','Nombre','Stock','Precio'], ['P2','Prod2',5,200] ],
    Ventas: [ ['ID','Fecha','Total'] ],
    Detalle_Ventas: [ ['Venta','Prod','Cant','Precio'] ],
    Cartera: [ ['ID','Fecha','ID_Tercero','Origen_ID','Total','Saldo','Tipo','Estado','Fecha_Vencimiento'] ],
    Terceros: [ ['ID','Nombre','Tel','Tipo','Limite','Activo'], ['C001','ClienteCred','300','CLIENTE',1000,'ACTIVO'] ],
  });

  this.CONFIG = { SHEETS: { VENTAS: 'Ventas', DETALLE_VENTAS: 'Detalle_Ventas', PRODUCTOS: 'Productos' } };

  const carrito = [{ id_producto: 'P2', nombre: 'Prod2', cantidad: 2, precio: 200 }];
  const r = procesarVentaV2(carrito, { tipo: 'credito', idTercero: 'C001', diasCredito: 15 });
  _assert(r && r.success && r.credito === true, 'procesarVentaV2 credito falló');

  const cartera = getSheet('Cartera').getDataRange().getValues();
  _assert(cartera.length > 1, 'Registro de cartera no creado');
  const last = cartera[cartera.length - 1];
  _assert(parseFloat(last[4]) === 400, 'Total en Cartera incorrecto');
  _assert(parseFloat(last[5]) === 400, 'Saldo en Cartera incorrecto');
}

function test_registrarAbono_parcial_y_fifo() {
  _resetMocks({
    Cartera: [ ['ID','Fecha','ID_Tercero','Origen_ID','Total','Saldo','Tipo','Estado','Fecha_Vencimiento'],
              ['C1', new Date(2025,0,1), 'T1', 'V1', 500, 500, 'CxC', 'ABIERTA', new Date(2025,1,1)],
              ['C2', new Date(2025,6,1), 'T1', 'V2', 300, 300, 'CxC', 'ABIERTA', new Date(2025,7,1)]
    ],
    Movimientos_Cartera: [ ['ID','Fecha','ID_CarterA','ID_Tercero','Valor','Tipo_Mov','Referencia'] ]
  });

  const r = registrarAbono('T1', 300, 'Pago parcial', 'CxC');
  _assert(r && r.success, 'registrarAbono parcial devolvió error');

  const cartera = getSheet('Cartera').getDataRange().getValues();
  _assert(parseFloat(cartera[1][5]) === 200, 'Saldo del primer registro no actualizado correctamente');
  _assert(String(cartera[1][7]) === 'PARCIAL', 'Estado no actualizado a PARCIAL');

  const mov = getSheet('Movimientos_Cartera').getDataRange().getValues();
  _assert(mov.length === 2, 'Movimiento no fue registrado correctamente');
  _assert(String(mov[1][5]) === 'ABONO', 'Tipo de movimiento incorrecto (esperado ABONO)');
}

function test_registrarAbono_total() {
  _resetMocks({
    Cartera: [ ['ID','Fecha','ID_Tercero','Origen_ID','Total','Saldo','Tipo','Estado','Fecha_Vencimiento'],
              ['C3', new Date(2025,0,1), 'T2', 'V3', 200, 200, 'CxC', 'ABIERTA', new Date(2025,1,1)]
    ],
    Movimientos_Cartera: [ ['ID','Fecha','ID_CarterA','ID_Tercero','Valor','Tipo_Mov','Referencia'] ]
  });

  const r = registrarAbono('T2', 200, 'Pago total', 'CxC');
  _assert(r && r.success, 'registrarAbono total devolvió error');

  const cartera = getSheet('Cartera').getDataRange().getValues();
  _assert(parseFloat(cartera[1][5]) === 0, 'Saldo no quedó en 0');
  _assert(String(cartera[1][7]) === 'CANCELADA', 'Estado no quedó en CANCELADA');
}

function test_exceso_de_pago_debe_fallar() {
  _resetMocks({
    Cartera: [ ['ID','Fecha','ID_Tercero','Origen_ID','Total','Saldo','Tipo','Estado','Fecha_Vencimiento'],
              ['C4', new Date(), 'T3', 'V4', 100, 100, 'CxC', 'ABIERTA', new Date()] ],
    Movimientos_Cartera: [ ['ID','Fecha','ID_CarterA','ID_Tercero','Valor','Tipo_Mov','Referencia'] ]
  });

  const r = registrarAbono('T3', 200, 'Pago excesivo', 'CxC');
  _assert(r && r.success === false, 'registro de pago excesivo debería fallar');
}

function test_limite_credito_excedido() {
  _resetMocks({
    Productos: [ ['ID','Nombre','Stock','Precio'] ],
    Ventas: [ ['ID','Fecha','Total'] ],
    Detalle_Ventas: [ ['Venta','Prod','Cant','Precio'] ],
    Terceros: [ ['ID','Nombre','Tel','Tipo','Limite','Activo'], ['CLIM','ClienteLim','300', 'CLIENTE', 100, 'ACTIVO'] ],
  });
  this.CONFIG = { SHEETS: { VENTAS: 'Ventas', DETALLE_VENTAS: 'Detalle_Ventas', PRODUCTOS: 'Productos' } };

  // crear producto con precio y stock
  getSheet('Productos').appendRow(['PX','ProdX',5,200]);

  const carrito = [{ id_producto: 'PX', nombre: 'ProdX', cantidad: 1, precio: 200 }];
  const r = procesarVentaV2(carrito, { tipo: 'credito', idTercero: 'CLIM' });
  _assert(r && r.success === false, 'Venta a crédito que excede límite debe fallar');
}

function test_fecha_vencida_persiste_estado() {
  // fecha vencimiento en pasado
  const pasada = new Date(); pasada.setDate(pasada.getDate() - 10);
  _resetMocks({
    Cartera: [ ['ID','Fecha','ID_Tercero','Origen_ID','Total','Saldo','Tipo','Estado','Fecha_Vencimiento'],
              ['COLD', new Date(), 'T5', 'V5', 50, 50, 'CxC', 'ABIERTA', pasada ]
    ]
  });

  actualizarVencimientos();
  const cartera = getSheet('Cartera').getDataRange().getValues();
  _assert(String(cartera[1][7]) === 'VENCIDA', 'Estado no fue marcado como VENCIDA');
}

// -------------------------
// Runner general y reporte esperado
// -------------------------

function runAllTests() {
  const results = [];
  _run('Crear tercero', test_crearTercero, results);
  _run('Crear venta contado', test_crearVentaContado, results);
  _run('Crear venta crédito', test_crearVentaCredito, results);
  _run('Registrar abono parcial + FIFO', test_registrarAbono_parcial_y_fifo, results);
  _run('Registrar abono total', test_registrarAbono_total, results);
  _run('Exceso de pago (debe fallar)', test_exceso_de_pago_debe_fallar, results);
  _run('Límite de crédito excedido', test_limite_credito_excedido, results);
  _run('Fecha vencida → VENCIDA', test_fecha_vencida_persiste_estado, results);

  // Mostrar reporte en Logger y devolver texto
  const resumen = results.join('\n');
  Logger.log('--- Reporte Tests Cartera ---\n' + resumen);
  return resumen;
}

function expectedResults() {
  return [
    '✔ Crear tercero: OK',
    '✔ Crear venta contado: OK',
    '✔ Crear venta crédito: OK',
    '✔ Registrar abono parcial + FIFO: OK',
    '✔ Registrar abono total: OK',
    '✔ Exceso de pago (debe fallar): OK',
    '✔ Límite de crédito excedido: OK',
    '✔ Fecha vencida → VENCIDA: OK'
  ].join('\n');
}

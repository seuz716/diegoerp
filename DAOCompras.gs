/**
 * LAYER 4: DAO — COMPRAS (Cuentas por Pagar a Proveedores)
 */
const DAO_COMPRAS = {
  COMPRAS_COL: COMPRAS_CONFIG.COLUMNS.COMPRAS,
  DETALLE_COL: COMPRAS_CONFIG.COLUMNS.DETALLE_COMPRAS,
  PAGOS_COL: COMPRAS_CONFIG.COLUMNS.PAGOS_PROVEEDORES,

  _rowToCompra(row, rowIndex) {
    var C = DAO_COMPRAS.COMPRAS_COL;
    return {
      id: String(row[C.id] || "").trim(),
      fecha: row[C.fecha],
      id_proveedor: String(row[C.id_proveedor] || "").trim(),
      id_factura: String(row[C.id_factura] || "").trim(),
      total: _parseMoneda(row[C.total], 0),
      saldo: _parseMoneda(row[C.saldo], 0),
      estado: String(row[C.estado] || COMPRAS_CONFIG.ESTADOS.ABIERTA).trim(),
      fecha_vencimiento: row[C.fecha_vencimiento],
      vencida_timestamp: row[C.vencida_timestamp],
      version: parseInt(row[C.version]) || 1,
      rowIndex: rowIndex,
    };
  },

  _rowToDetalle(row) {
    var C = DAO_COMPRAS.DETALLE_COL;
    return {
      id: String(row[C.id] || "").trim(),
      id_compra: String(row[C.id_compra] || "").trim(),
      id_producto: String(row[C.id_producto] || "").trim(),
      cantidad: _parseMoneda(row[C.cantidad], 0),
      precio_unitario: _parseMoneda(row[C.precio_unitario], 0),
      subtotal: _parseMoneda(row[C.subtotal], 0),
    };
  },

  _rowToPago(row) {
    var C = DAO_COMPRAS.PAGOS_COL;
    return {
      id: String(row[C.id] || "").trim(),
      fecha: row[C.fecha],
      id_compra: String(row[C.id_compra] || "").trim(),
      id_proveedor: String(row[C.id_proveedor] || "").trim(),
      valor: _parseMoneda(row[C.valor], 0),
      referencia: String(row[C.referencia] || "").trim(),
      metodo_pago: String(row[C.metodo_pago] || "").trim(),
    };
  },

  crearCompra(registro) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    var C = DAO_COMPRAS.COMPRAS_COL;
    var numCols = Math.max.apply(null, Object.values(C)) + 1;
    var row = [];
    row[C.id] = registro.id;
    row[C.fecha] = registro.fecha;
    row[C.id_proveedor] = registro.id_proveedor;
    row[C.id_factura] = registro.id_factura || "";
    row[C.total] = registro.total;
    row[C.saldo] = registro.saldo;
    row[C.estado] = registro.estado;
    row[C.fecha_vencimiento] = registro.fecha_vencimiento;
    row[C.vencida_timestamp] = "";
    row[C.version] = 1;
    for (var i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
    sheet.appendRow(row);
    return registro.id;
  },

  crearDetalleCompra(detalle) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS);
    var C = DAO_COMPRAS.DETALLE_COL;
    var numCols = Math.max.apply(null, Object.values(C)) + 1;
    var row = [];
    row[C.id] = detalle.id;
    row[C.id_compra] = detalle.id_compra;
    row[C.id_producto] = detalle.id_producto;
    row[C.cantidad] = detalle.cantidad;
    row[C.precio_unitario] = detalle.precio_unitario;
    row[C.subtotal] = detalle.subtotal;
    for (var i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
    sheet.appendRow(row);
  },

  getCompraById(id) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    var data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.COMPRAS_COL)) + 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][DAO_COMPRAS.COMPRAS_COL.id] || "").trim() === id) {
        return DAO_COMPRAS._rowToCompra(data[i], i + 2);
      }
    }
    return null;
  },

  getComprasByProveedor(idProveedor) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.COMPRAS_COL)) + 1).getValues();
    var result = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][DAO_COMPRAS.COMPRAS_COL.id_proveedor] || "").trim() === idProveedor) {
        result.push(DAO_COMPRAS._rowToCompra(data[i], i + 2));
      }
    }
    return result;
  },

  getCompras(filtroProveedor, filtroEstado) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.COMPRAS_COL)) + 1).getValues();
    var result = [];
    for (var i = 0; i < data.length; i++) {
      var item = DAO_COMPRAS._rowToCompra(data[i], i + 2);
      if (filtroProveedor && item.id_proveedor !== filtroProveedor) continue;
      if (filtroEstado && item.estado !== filtroEstado) continue;
      result.push(item);
    }
    return result;
  },

  actualizarSaldoCompra(idCompra, nuevoSaldo, nuevoEstado) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error("Compra no encontrada: " + idCompra);
    var C = DAO_COMPRAS.COMPRAS_COL;
    var data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(C)) + 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][C.id] || "").trim() === idCompra) {
        var rowIdx = i + 2;
        var currentVersion = parseInt(data[i][C.version]) || 1;
        sheet.getRange(rowIdx, C.saldo + 1).setValue(nuevoSaldo);
        sheet.getRange(rowIdx, C.estado + 1).setValue(nuevoEstado);
        sheet.getRange(rowIdx, C.version + 1).setValue(currentVersion + 1);
        return true;
      }
    }
    throw new Error("Compra no encontrada: " + idCompra);
  },

  crearPagoProveedor(pago) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);
    var C = DAO_COMPRAS.PAGOS_COL;
    var row = [];
    row[C.id] = pago.id;
    row[C.fecha] = pago.fecha;
    row[C.id_compra] = pago.id_compra;
    row[C.id_proveedor] = pago.id_proveedor;
    row[C.valor] = pago.valor;
    row[C.referencia] = pago.referencia || "";
    row[C.metodo_pago] = pago.metodo_pago || "";
    for (var i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
    sheet.appendRow(row);
  },

  getDetallesByCompra(idCompra) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.DETALLE_COL)) + 1).getValues();
    var result = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][DAO_COMPRAS.DETALLE_COL.id_compra] || "").trim() === idCompra) {
        result.push(DAO_COMPRAS._rowToDetalle(data[i]));
      }
    }
    return result;
  },

  getPagosByCompra(idCompra) {
    var sheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.PAGOS_COL)) + 1).getValues();
    var result = [];
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][DAO_COMPRAS.PAGOS_COL.id_compra] || "").trim() === idCompra) {
        result.push(DAO_COMPRAS._rowToPago(data[i]));
      }
    }
    return result;
  },
};

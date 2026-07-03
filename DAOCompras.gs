/**
 * LAYER 4: DAO — COMPRAS (Cuentas por Pagar a Proveedores)
 */
const DAO_COMPRAS = {
  COMPRAS_COL: COMPRAS_CONFIG.COLUMNS.COMPRAS,
  DETALLE_COL: COMPRAS_CONFIG.COLUMNS.DETALLE_COMPRAS,
  PAGOS_COL: COMPRAS_CONFIG.COLUMNS.PAGOS_PROVEEDORES,
  KARDEX_COL: COMPRAS_CONFIG.COLUMNS.KARDEX,

  _requestCache: {},

  _cacheSheet(sheetName) {
    if (this._requestCache[sheetName] && this._requestCache[sheetName].expires > Date.now()) {
      return this._requestCache[sheetName].data;
    }
    return null;
  },

  _setCacheSheet(sheetName, data, ttlMs) {
    if (!ttlMs) ttlMs = 5000;
    this._requestCache[sheetName] = { data: data, expires: Date.now() + ttlMs };
  },

  _clearCache() {
    this._requestCache = {};
  },

  _safeDateCompare(a, b) {
    const da = new Date(a);
    const db = new Date(b);
    if (isNaN(da.getTime()) || isNaN(db.getTime())) return 0;
    return db - da;
  },

  _validateRequired(obj, fields, label) {
    for (const f of fields) {
      const val = obj[f];
      if (val === undefined || val === null || val === "") {
        throw new Error("Campo requerido '" + f + "' no proporcionado en " + label);
      }
    }
  },

  _rowToKardex(row) {
    const C = DAO_COMPRAS.KARDEX_COL;
    return {
      id: String(row[C.id] || "").trim(),
      fecha: row[C.fecha],
      id_producto: String(row[C.id_producto] || "").trim(),
      tipo_mov: String(row[C.tipo_mov] || "").trim(),
      cantidad: _parseMoneda(row[C.cantidad], 0),
      stock_anterior: _parseMoneda(row[C.stock_anterior], 0),
      stock_nuevo: _parseMoneda(row[C.stock_nuevo], 0),
      referencia: String(row[C.referencia] || "").trim(),
      origen: String(row[C.origen] || "").trim(),
      usuario: String(row[C.usuario] || "").trim(),
    };
  },

  /**
   * Creates a new kardex inventory movement record.
   * @param {Object} movimiento - Movement data.
   * @param {string} movimiento.id - Movement ID.
   * @param {Date} [movimiento.fecha] - Movement date (defaults to now).
   * @param {string} movimiento.id_producto - Product ID.
   * @param {string} movimiento.tipo_mov - Movement type (ENTRADA/SALIDA).
   * @param {number} movimiento.cantidad - Quantity moved.
   * @param {number} movimiento.stock_anterior - Stock before movement.
   * @param {number} movimiento.stock_nuevo - Stock after movement.
   * @param {string} [movimiento.referencia] - Reference document.
   * @param {string} [movimiento.origen] - Origin module.
   * @param {string} [movimiento.usuario] - User who performed the movement.
   */
  crearMovimientoKardex(movimiento) {
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
      const sheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
      const C = DAO_COMPRAS.KARDEX_COL;
      const row = [];
      row[C.id] = movimiento.id;
      row[C.fecha] = movimiento.fecha || new Date();
      row[C.id_producto] = movimiento.id_producto;
      row[C.tipo_mov] = movimiento.tipo_mov;
      row[C.cantidad] = movimiento.cantidad;
      row[C.stock_anterior] = movimiento.stock_anterior;
      row[C.stock_nuevo] = movimiento.stock_nuevo;
      row[C.referencia] = movimiento.referencia || "";
      row[C.origen] = movimiento.origen || "";
      row[C.usuario] = movimiento.usuario || "";
      for (let i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
      sheet.appendRow(row);
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  crearMovimientosKardexBatch(movimientos) {
    if (!movimientos || movimientos.length === 0) return { success: true, count: 0 };
    for (let m = 0; m < movimientos.length; m++) {
      this._validateRequired(movimientos[m], ['id_producto', 'tipo_mov', 'cantidad'], 'crearMovimientosKardexBatch[' + m + ']');
    }
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
      const sheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
      const C = DAO_COMPRAS.KARDEX_COL;
      const rows = [];
      for (let m = 0; m < movimientos.length; m++) {
        const mov = movimientos[m];
        const row = [];
        row[C.id] = mov.id || ("KD" + Date.now() + "_" + m);
        row[C.fecha] = mov.fecha || new Date();
        row[C.id_producto] = mov.id_producto || "";
        row[C.tipo_mov] = mov.tipo_mov || "";
        row[C.cantidad] = mov.cantidad || 0;
        row[C.stock_anterior] = mov.stock_anterior || 0;
        row[C.stock_nuevo] = mov.stock_nuevo || 0;
        row[C.referencia] = mov.referencia || "";
        row[C.origen] = mov.origen || "";
        row[C.usuario] = mov.usuario || "";
        for (let i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
        rows.push(row);
      }
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      return { success: true, count: rows.length };
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  /**
   * Retrieves kardex movements for a specific product, sorted by date descending.
   * @param {string} idProducto - Product ID.
   * @param {number} [limit] - Max results to return.
   * @returns {Array<Object>} List of kardex movements.
   */
  getMovimientosKardex(idProducto, limit) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const C = DAO_COMPRAS.KARDEX_COL;
    const numCols = Math.max.apply(null, Object.values(C)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][C.id_producto] || "").trim() === idProducto) {
        result.push(DAO_COMPRAS._rowToKardex(data[i]));
      }
    }
    result.sort((a, b) => this._safeDateCompare(b.fecha, a.fecha));
    if (limit && result.length > limit) {
      Logger.log("[DAO_COMPRAS.getMovimientosKardex] ADVERTENCIA: Resultados truncados a " + limit + ". Total filtrados: " + result.length);
      result.length = limit;
    }
    return result;
  },

  getAllMovimientosKardex(dias, limit) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    limit = parseInt(limit) || 500;
    const C = DAO_COMPRAS.KARDEX_COL;
    const numCols = Math.max.apply(null, Object.values(C)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const result = [];
    const cutoffDate = new Date();
    if (dias) cutoffDate.setDate(cutoffDate.getDate() - dias);
    for (let i = 0; i < data.length; i++) {
      const mov = DAO_COMPRAS._rowToKardex(data[i]);
      if (!dias) {
        result.push(mov);
      } else {
        const movDate = new Date(mov.fecha);
        if (!isNaN(movDate.getTime()) && movDate >= cutoffDate) {
          result.push(mov);
        }
      }
    }
    result.sort((a, b) => DAO_COMPRAS._safeDateCompare(b.fecha, a.fecha));
    if (result.length > limit) {
      Logger.log("[DAO_COMPRAS.getAllMovimientosKardex] ADVERTENCIA: Resultados truncados a " + limit + ". Total filtrados: " + result.length);
      result.length = limit;
    }
    return result;
  },

  _rowToCompra(row, rowIndex) {
    const C = DAO_COMPRAS.COMPRAS_COL;
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
    const C = DAO_COMPRAS.DETALLE_COL;
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
    const C = DAO_COMPRAS.PAGOS_COL;
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
    this._validateRequired(registro, ['id', 'fecha', 'id_proveedor', 'total', 'saldo', 'estado', 'fecha_vencimiento'], 'crearCompra');
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
      const sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
      const C = DAO_COMPRAS.COMPRAS_COL;
      const numCols = Math.max.apply(null, Object.values(C)) + 1;
      const row = [];
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
      for (let i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
      sheet.appendRow(row);
      return registro.id;
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  crearDetalleCompra(detalle) {
    this._validateRequired(detalle, ['id', 'id_compra', 'id_producto', 'cantidad', 'precio_unitario', 'subtotal'], 'crearDetalleCompra');
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
      const sheet = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS);
      const C = DAO_COMPRAS.DETALLE_COL;
      const numCols = Math.max.apply(null, Object.values(C)) + 1;
      const row = [];
      row[C.id] = detalle.id;
      row[C.id_compra] = detalle.id_compra;
      row[C.id_producto] = detalle.id_producto;
      row[C.cantidad] = detalle.cantidad;
      row[C.precio_unitario] = detalle.precio_unitario;
      row[C.subtotal] = detalle.subtotal;
      for (let i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
      sheet.appendRow(row);
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  getCompraById(id) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.COMPRAS_COL)) + 1).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][DAO_COMPRAS.COMPRAS_COL.id] || "").trim() === id) {
        return DAO_COMPRAS._rowToCompra(data[i], i + 2);
      }
    }
    return null;
  },

  getComprasByProveedor(idProveedor) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.COMPRAS_COL)) + 1).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][DAO_COMPRAS.COMPRAS_COL.id_proveedor] || "").trim() === idProveedor) {
        result.push(DAO_COMPRAS._rowToCompra(data[i], i + 2));
      }
    }
    return result;
  },

  /**
   * Retrieves purchase records with optional filters.
   * @param {string|null} filtroProveedor - Filter by provider ID.
   * @param {string|null} filtroEstado - Filter by estado.
   * @param {number} [maxRows=10000] - Max rows to read from sheet.
   * @returns {Array<Object>} List of purchase records.
   */
  getCompras(filtroProveedor, filtroEstado, maxRows) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const C = DAO_COMPRAS.COMPRAS_COL;
    const numCols = Math.max.apply(null, Object.values(C)) + 1;
    if (!maxRows || maxRows <= 0) maxRows = 10000;
    const totalDataRows = Math.min(lastRow - 1, maxRows);
    if (totalDataRows < lastRow - 1) {
      Logger.log("[DAO_COMPRAS.getCompras] ADVERTENCIA: Datos truncados a " + totalDataRows + " filas. Total disponible: " + (lastRow - 1));
    }
    const data = sheet.getRange(2, 1, totalDataRows, numCols).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      const item = DAO_COMPRAS._rowToCompra(data[i], i + 2);
      if (filtroProveedor && item.id_proveedor !== filtroProveedor) continue;
      if (filtroEstado && item.estado !== filtroEstado) continue;
      result.push(item);
    }
    return result;
  },

  actualizarSaldoCompra(idCompra, nuevoSaldo, nuevoEstado, expectedVersion) {
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
      const sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) throw new Error("Compra no encontrada: " + idCompra);
      const C = DAO_COMPRAS.COMPRAS_COL;
      const numCols = Math.max.apply(null, Object.values(C)) + 1;
      const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][C.id] || "").trim() === idCompra) {
          const rowIdx = i + 2;
          const currentVersion = parseInt(data[i][C.version]) || 1;
          if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
            const err = new Error(
              "OptimisticLockError: Compra " + idCompra + " fue modificada concurrentemente " +
              "(esperada v" + expectedVersion + ", actual v" + currentVersion + "). Reintente."
            );
            err.type = 'OPTIMISTIC_LOCK_FAILURE';
            err.rowIndex = rowIdx;
            err.expectedVersion = expectedVersion;
            err.actualVersion = currentVersion;
            err.retryable = true;
            throw err;
          }
          data[i][C.saldo] = nuevoSaldo;
          data[i][C.estado] = nuevoEstado;
          data[i][C.version] = currentVersion + 1;
          sheet.getRange(rowIdx, 1, 1, numCols).setValues([data[i]]);
          return true;
        }
      }
      throw new Error("Compra no encontrada: " + idCompra);
    } finally {
      lock.releaseLock();
    }
  },

  crearPagoProveedor(pago) {
    this._validateRequired(pago, ['id', 'fecha', 'id_compra', 'id_proveedor', 'valor'], 'crearPagoProveedor');
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
      const sheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);
      const C = DAO_COMPRAS.PAGOS_COL;
      const row = [];
      row[C.id] = pago.id;
      row[C.fecha] = pago.fecha;
      row[C.id_compra] = pago.id_compra;
      row[C.id_proveedor] = pago.id_proveedor;
      row[C.valor] = pago.valor;
      row[C.referencia] = pago.referencia || "";
      row[C.metodo_pago] = pago.metodo_pago || "";
      for (let i = 0; i < row.length; i++) { if (row[i] === undefined) row[i] = ""; }
      sheet.appendRow(row);
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Retrieves detail lines for a given purchase.
   * @param {string} idCompra - Purchase ID.
   * @returns {Array<Object>} List of detail items.
   */
  getDetallesByCompra(idCompra) {
    return this._getDetallesByCompra(idCompra);
  },

  // Alias para compatibilidad con tests
  _getDetallesByCompra(idCompra) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.DETALLE_COL)) + 1).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][DAO_COMPRAS.DETALLE_COL.id_compra] || "").trim() === idCompra) {
        result.push(DAO_COMPRAS._rowToDetalle(data[i]));
      }
    }
    return result;
  },

  /**
   * Retrieves payment records for a given purchase.
   * @param {string} idCompra - Purchase ID.
   * @returns {Array<Object>} List of payment records.
   */
  getPagosByCompra(idCompra) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max.apply(null, Object.values(DAO_COMPRAS.PAGOS_COL)) + 1).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][DAO_COMPRAS.PAGOS_COL.id_compra] || "").trim() === idCompra) {
        result.push(DAO_COMPRAS._rowToPago(data[i]));
      }
    }
    return result;
  },

  /**
   * Retrieves the most recent payment for a specific provider.
   * @param {string} idProveedor - Provider ID.
   * @returns {Object|null} Most recent payment or null if none found.
   */
  getUltimoPagoProveedor(idProveedor) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    const C = DAO_COMPRAS.PAGOS_COL;
    const numCols = Math.max.apply(null, Object.values(C)) + 1;

    // Read all payments and filter by proveedor
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const pagosProveedor = [];

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][C.id_proveedor] || "").trim() === idProveedor) {
        pagosProveedor.push(DAO_COMPRAS._rowToPago(data[i]));
      }
    }

    if (pagosProveedor.length === 0) return null;

    pagosProveedor.sort((a, b) => DAO_COMPRAS._safeDateCompare(b.fecha, a.fecha));
    return pagosProveedor[0];
  },

  /**
   * Retrieves all purchase detail lines (for reporting/analysis).
   * @param {number} [maxRows=10000] - Max rows to read.
   * @returns {Array<Object>} All detail records.
   */
  listarDetalles(maxRows) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const C = DAO_COMPRAS.DETALLE_COL;
    const numCols = Math.max.apply(null, Object.values(C)) + 1;
    if (!maxRows || maxRows <= 0) maxRows = 10000;
    const totalDataRows = Math.min(lastRow - 1, maxRows);
    const data = sheet.getRange(2, 1, totalDataRows, numCols).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      result.push(DAO_COMPRAS._rowToDetalle(data[i]));
    }
    return result;
  },

  /**
   * Retrieves payment records for a specific provider.
   * @param {string} idProveedor - Provider ID.
   * @returns {Array<Object>} List of payment records.
   */
  listarPagosPorProveedor(idProveedor) {
    const sheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const C = DAO_COMPRAS.PAGOS_COL;
    const numCols = Math.max.apply(null, Object.values(C)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][C.id_proveedor] || "").trim() === idProveedor) {
        result.push(DAO_COMPRAS._rowToPago(data[i]));
      }
    }
    return result;
  },
};

/**
 * LAYER 4: DAO â€” PRODUCTOS (Maestro de productos e inventario)
 */

const DAO_PRODUCTOS = {
  COL: CONFIG.COLUMNS.PRODUCTOS,
  SHEET: "Productos",

  _rowToProducto(row, rowIndex) {
    const C = DAO_PRODUCTOS.COL;
    return {
      id: String(row[C.id] || "").trim(),
      nombre: String(row[C.nombre] || "").trim(),
      stock: _parseMoneda(row[C.stock], 0),
      precio_compra: _parseMoneda(row[C.precio_compra], 0),
      precio_venta: _parseMoneda(row[C.precio_venta], 0),
      categoria: String(row[C.categoria] || "").trim(),
      activo: String(row[C.activo] || PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.ACTIVO).trim(),
      fecha_creacion: row[C.fecha_creacion] || null,
      version: _parseMoneda(row[C.version], 1),
      rowIndex: rowIndex || 0,
    };
  },

  _ensureSchema() {
    const sheet = getSheet(DAO_PRODUCTOS.SHEET);
    let lastCol = sheet.getLastColumn();
    const expected = CONFIG.SCHEMA_definitions.PRODUCTOS;
    const expectedNames = Object.values(expected);
    if (lastCol > 0) {
      let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || "").trim(); });
      for (let key in expected) {
        if (headers.indexOf(expected[key]) === -1) {
          sheet.getRange(1, lastCol + 1).setValue(expected[key]);
          lastCol++;
          headers.push(expected[key]);
        }
      }
    } else {
      if (expectedNames.length > 0) {
        sheet.getRange(1, 1, 1, expectedNames.length).setValues([expectedNames]);
      }
    }
    delete _SHEETS_CACHE[DAO_PRODUCTOS.SHEET];
  },

  listar(filtros) {
    const sheet = getSheet(DAO_PRODUCTOS.SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const C = DAO_PRODUCTOS.COL;
    const numCols = Math.max.apply(null, Object.values(C)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      const item = DAO_PRODUCTOS._rowToProducto(data[i], i + 2);
      if (filtros) {
        if (filtros.activo === true && item.activo !== PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.ACTIVO) continue;
        if (filtros.activo === false && item.activo !== PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.INACTIVO) continue;
        if (filtros.categoria && item.categoria !== filtros.categoria) continue;
        if (filtros.busqueda) {
          const q = filtros.busqueda.toLowerCase();
          if (item.nombre.toLowerCase().indexOf(q) === -1 && item.id.toLowerCase().indexOf(q) === -1) continue;
        }
      }
      result.push(item);
    }
    result.sort(function(a, b) { return a.nombre.localeCompare(b.nombre); });
    return result;
  },

  obtener(id) {
    const idLimpio = _sanitizeId(id);
    if (!idLimpio) return null;
    const sheet = getSheet(DAO_PRODUCTOS.SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    const C = DAO_PRODUCTOS.COL;
    const numCols = Math.max.apply(null, Object.values(C)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][C.id] || "").trim() === idLimpio) {
        return DAO_PRODUCTOS._rowToProducto(data[i], i + 2);
      }
    }
    return null;
  },

  crear(datos) {
    const lock = LOCK_MANAGER.acquireGlobalLock(10000);
    try {
      const nombreLimpio = String(datos.nombre || "").trim();
      if (nombreLimpio.length < 1) {
        return { success: false, error: "El nombre del producto es requerido" };
      }
      const id = datos.id ? _sanitizeId(datos.id) : ("P" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 4));
      if (!id) return { success: false, error: "ID de producto invÃ¡lido." };
      
      // Verificar si el ID ya existe
      const sheet = getSheet(DAO_PRODUCTOS.SHEET);
      const C = DAO_PRODUCTOS.COL;
      const numCols = Math.max.apply(null, Object.values(C)) + 1;
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
        for (let i = 0; i < data.length; i++) {
          const existingId = String(data[i][C.id] || "").trim();
          if (existingId === id) {
            return { success: false, error: "ID ya registrado: " + id };
          }
          const existingName = String(data[i][C.nombre] || "").trim();
          if (existingName.toLowerCase() === nombreLimpio.toLowerCase()) {
            return { success: false, error: "Ya existe un producto con ese nombre" };
          }
        }
      }
      
      const row = [];
      row[C.id] = _sanitizeCell(id);
      row[C.nombre] = _sanitizeCell(nombreLimpio);
      row[C.stock] = 0;
      row[C.precio_compra] = _parseMoneda(datos.precio_compra, 0);
      row[C.precio_venta] = _parseMoneda(datos.precio_venta, 0);
      row[C.categoria] = _sanitizeCell(String(datos.categoria || "").trim());
      row[C.activo] = PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.ACTIVO;
      row[C.fecha_creacion] = new Date();
      row[C.version] = 1;
      for (let j = 0; j < row.length; j++) { if (row[j] === undefined) row[j] = ""; }
      sheet.appendRow(row);
      return { success: true, id: id, nombre: nombreLimpio, stock: 0 };
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  actualizar(id, cambios, expectedVersion) {
    const lock = LOCK_MANAGER.acquireGlobalLock(10000);
    try {
      const idLimpio = _sanitizeId(id);
      if (!idLimpio) throw new Error("ID de producto invÃ¡lido: " + id);
      const sheet = getSheet(DAO_PRODUCTOS.SHEET);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) throw new Error("Producto no encontrado: " + idLimpio);
      const C = DAO_PRODUCTOS.COL;
      const numCols = Math.max.apply(null, Object.values(C)) + 1;
      const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][C.id] || "").trim() === idLimpio) {
          const rowIdx = i + 2;
          const currentVersion = _parseMoneda(data[i][C.version], 1);
          if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
            const err = new Error(
              "OptimisticLockError: Producto " + idLimpio + " fue modificado concurrentemente " +
              "(esperada v" + expectedVersion + ", actual v" + currentVersion + "). Reintente."
            );
            err.type = 'OPTIMISTIC_LOCK_FAILURE';
            err.rowIndex = rowIdx;
            err.expectedVersion = expectedVersion;
            err.actualVersion = currentVersion;
            err.retryable = true;
            throw err;
          }
          const rowRange = sheet.getRange(rowIdx, 1, 1, numCols);
          const rowValues = rowRange.getValues()[0];
          if (cambios.nombre !== undefined) rowValues[C.nombre] = _sanitizeCell(String(cambios.nombre).trim());
          if (cambios.precio_compra !== undefined) rowValues[C.precio_compra] = _parseMoneda(cambios.precio_compra, 0);
          if (cambios.precio_venta !== undefined) rowValues[C.precio_venta] = _parseMoneda(cambios.precio_venta, 0);
          if (cambios.categoria !== undefined) rowValues[C.categoria] = _sanitizeCell(String(cambios.categoria).trim());
          rowValues[C.version] = currentVersion + 1;
          rowRange.setValues([rowValues]);
          return true;
        }
      }
      throw new Error("Producto no encontrado: " + idLimpio);
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  incrementarStock(id, cantidad) {
    const lock = LOCK_MANAGER.acquireResourceLock(id);
    try {
      const idLimpio = _sanitizeId(id);
      if (!idLimpio) throw new Error("ID de producto invÃ¡lido: " + id);
      const sheet = getSheet(DAO_PRODUCTOS.SHEET);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) throw new Error("Producto no encontrado: " + idLimpio);
      const C = DAO_PRODUCTOS.COL;
      const numCols = Math.max.apply(null, Object.values(C)) + 1;
      const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][C.id] || "").trim() === idLimpio) {
          const rowIdx = i + 2;
          const stockActual = _parseMoneda(data[i][C.stock], 0);
          const cant = _parseMoneda(cantidad, NaN);
          if (isNaN(cant)) throw new Error("Cantidad inválida: debe ser un número");
          const nuevoStock = stockActual + cant;
          if (nuevoStock < 0) {
            throw new Error("Stock insuficiente: disponible " + stockActual + ", solicitado " + (-cant));
          }
          const currentVersion = _parseMoneda(data[i][C.version], 1);
          const rowRange = sheet.getRange(rowIdx, 1, 1, numCols);
          const rowValues = rowRange.getValues()[0];
          rowValues[C.stock] = nuevoStock;
          rowValues[C.version] = currentVersion + 1;
          rowRange.setValues([rowValues]);
          return { stockAnterior: stockActual, stockNuevo: nuevoStock };
        }
      }
      throw new Error("Producto no encontrado: " + idLimpio);
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  toggleActivo(id) {
    const idLimpio = _sanitizeId(id);
    if (!idLimpio) throw new Error("ID de producto invÃ¡lido: " + id);
    const producto = DAO_PRODUCTOS.obtener(idLimpio);
    if (!producto) throw new Error("Producto no encontrado: " + idLimpio);
    const lock = LOCK_MANAGER.acquireGlobalLock(10000);
    try {
      const sheet = getSheet(DAO_PRODUCTOS.SHEET);
      const C = DAO_PRODUCTOS.COL;
      const numCols = Math.max.apply(null, Object.values(C)) + 1;
      const rowRange = sheet.getRange(producto.rowIndex, 1, 1, numCols);
      const rowValues = rowRange.getValues()[0];
      const nuevoEstado = rowValues[C.activo] === PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.ACTIVO
        ? PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.INACTIVO
        : PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.ACTIVO;
      rowValues[C.activo] = nuevoEstado;
      rowValues[C.version] = _parseMoneda(rowValues[C.version], 1) + 1;
      rowRange.setValues([rowValues]);
      return { id: idLimpio, activo: nuevoEstado };
    } finally {
      if (lock) lock.releaseLock();
    }
  },
};

DAO_PRODUCTOS._ensureSchema();


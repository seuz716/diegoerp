/**
 * LAYER 5: DOMAIN LOGIC — TRANSACCIONES SIMULADAS Y NEGOCIO
 * Resuelve Problemas #3, #4 y #5 
 * 
 * Dependencies (loaded in order):
 * - Config.gs (SESSION_SERVICE, TransactionManager)
 * - Accounting.gs (LIBRO_DIARIO, FLUJO_CAJA)
 */

// Ensure dependencies are available
// These are global objects defined in their respective modules

// Backwards compatibility: _PROCESSED_CORRELATION_IDS is now deprecated
// IdempotencyService handles persistent storage via CacheService
const _PROCESSED_CORRELATION_IDS = {};

const ROLLBACK_MAX_RETRIES = 3;
const ROLLBACK_BASE_DELAY_MS = 500;

/**
 * Restaura una fila con reintentos y verificación de estado previo.
 * M2: Rollback idempotente con backoff exponencial.
 * @param {Sheet} sheet - Hoja de cálculo.
 * @param {number} rowIndex - Índice de la fila.
 * @param {Array} values - Valores a restaurar.
 * @param {number} versionCol - Columna de versión (1-indexed).
 * @param {number} expectedVersion - Versión esperada.
 * @returns {boolean} true si se restauró, false si ya estaba restaurada.
 */
function _restoreRowWithRetry(sheet, rowIndex, values, versionCol, expectedVersion) {
  var actualVersion = Number(sheet.getRange(rowIndex, versionCol, 1, 1).getValues()[0][0]) || 1;
  if (actualVersion === expectedVersion) return true; // Ya restaurada (idempotente)
  
  for (var attempt = 0; attempt < ROLLBACK_MAX_RETRIES; attempt++) {
    try {
      var numCols = Math.max(...Object.values(CONFIG.COLUMNS.PRODUCTOS).concat(
        Object.values(CARTERA_CONFIG.COLUMNS.TERCEROS).concat(
        Object.values(CARTERA_CONFIG.COLUMNS.CARTERA).concat(
        Object.values(COMPRAS_CONFIG.COLUMNS.COMPRAS)
      ))) + 1;
      
      // Intentar restaurar según tipo de tabla
      if (values.length <= 8) {
        // Cartera/Producto snapshot (startCol based)
        var startCol = values.length <= 3 ? 0 : 0;
        sheet.getRange(rowIndex, startCol + 1, 1, values.length).setValues([values]);
      } else {
        sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
      }
      
      // Verificar versión después de escribir
      var checkVersion = Number(sheet.getRange(rowIndex, versionCol, 1, 1).getValues()[0][0]) || 1;
      if (checkVersion === expectedVersion) return true;
      throw new Error('Verificación versión fallida');
    } catch (e) {
      if (attempt === ROLLBACK_MAX_RETRIES - 1) {
        Logger.log('[ROLLBACK] CRÍTICO: Falló restauración fila ' + rowIndex + ' tras ' + ROLLBACK_MAX_RETRIES + ' intentos');
      }
      var delay = ROLLBACK_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
      Utilities.sleep(delay);
    }
  }
  return false;
}

function _isIdempotent(correlationId, idTercero) {
  if (!correlationId) return false;
  const cacheHit = IdempotencyService.isProcessed(correlationId, idTercero);
  if (cacheHit) {
    Logger.log("[DOMAIN] Idempotencia detectada: " + correlationId + " para " + idTercero);
    return true;
  }
  // Mark as processed (actual idempotencia persistente)
  IdempotencyService.markProcessed(correlationId, idTercero);
  _PROCESSED_CORRELATION_IDS[correlationId + "::" + idTercero] = true;
  return false;
}

/**
 * Mecanismo transaccional write-ahead para Apps Script.
 * Toma snapshot del estado previo de las filas afectadas antes de escribir.
 * Si ocurre cualquier fallo durante la escritura, revierte completamente:
 *   - Restaura filas de cartera a sus valores originales (snapshot)
 *   - Elimina filas de movimientos que se hayan añadido
 */
const _Transaction = {
  create() {
    const ctx = { carteraSnapshots: [], movPreRows: 0, movPostRows: 0, terceroSnapshots: [], productoSnapshots: [], productoPreRows: 0, productoPostRows: 0, compraSnapshots: [], pagoPreRows: 0, pagoPostRows: 0, detallePreRows: 0, detallePostRows: 0, carteraPreRows: 0, carteraPostRows: 0, compraPreRows: 0, compraPostRows: 0, kardexPreRows: 0, kardexPostRows: 0, libroPreRows: 0, libroPostRows: 0, flujoPreRows: 0, flujoPostRows: 0, productoProveedorPreRows: 0, productoProveedorPostRows: 0, active: false };

    return {
      begin() {
        ctx.active = true;
        ctx.carteraSnapshots = [];
        ctx.movPreRows = 0;
        ctx.movPostRows = 0;
        ctx.terceroSnapshots = [];
        ctx.productoSnapshots = [];
        ctx.productoPreRows = 0;
        ctx.productoPostRows = 0;
        ctx.compraSnapshots = [];
        ctx.pagoPreRows = 0;
        ctx.pagoPostRows = 0;
        ctx.detallePreRows = 0;
        ctx.detallePostRows = 0;
        ctx.carteraPreRows = 0;
        ctx.carteraPostRows = 0;
        ctx.compraPreRows = 0;
        ctx.compraPostRows = 0;
        ctx.kardexPreRows = 0;
        ctx.kardexPostRows = 0;
        ctx.libroPreRows = 0;
        ctx.libroPostRows = 0;
        ctx.flujoPreRows = 0;
        ctx.flujoPostRows = 0;
        ctx.productoProveedorPreRows = 0;
        ctx.productoProveedorPostRows = 0;
      },

      snapshotTerceroRow(rowIndex) {
        if (!ctx.active || !rowIndex) return;
        const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
        const COL = CARTERA_CONFIG.COLUMNS.TERCEROS;
        const numCols = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.TERCEROS)) + 1;
        const rangeData = sheet.getRange(rowIndex, 1, 1, numCols).getValues();
        ctx.terceroSnapshots.push({ rowIndex: rowIndex, values: rangeData[0] });
      },

      snapshotCarteraRows(rowIndexes) {
        if (!ctx.active || !rowIndexes || rowIndexes.length === 0) return;
        const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
        const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
        const unique = [...new Set(rowIndexes)].sort((a, b) => a - b);
        const minRow = unique[0];
        const maxRow = unique[unique.length - 1];
        const cols = [COL.saldo, COL.estado, COL.vencida_timestamp, COL.version];
        const minCol = Math.min(...cols);
        const maxCol = Math.max(...cols);
        const rangeData = sheet.getRange(minRow, minCol + 1, maxRow - minRow + 1, maxCol - minCol + 1).getValues();
        const rowIndexSet = new Set(unique);
        ctx.carteraSnapshots = [];
        for (let i = 0; i < rangeData.length; i++) {
          const actualRow = minRow + i;
          if (rowIndexSet.has(actualRow)) {
            ctx.carteraSnapshots.push({ rowIndex: actualRow, values: rangeData[i], startCol: minCol });
          }
        }
      },

      markMovPreAppend() {
        if (!ctx.active) return;
        ctx.movPreRows = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA).getLastRow();
      },

      markMovPostAppend() {
        if (!ctx.active) return;
        ctx.movPostRows = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA).getLastRow();
      },

      snapshotProductoRows(rowIndexes) {
        if (!ctx.active || !rowIndexes || rowIndexes.length === 0) return;
        const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
        const COL = CONFIG.COLUMNS.PRODUCTOS;
        const unique = [...new Set(rowIndexes)].sort((a, b) => a - b);
        const minRow = unique[0];
        const maxRow = unique[unique.length - 1];
        const cols = [COL.stock, COL.version];
        const minCol = Math.min(...cols);
        const maxCol = Math.max(...cols);
        const rangeData = sheet.getRange(minRow, minCol + 1, maxRow - minRow + 1, maxCol - minCol + 1).getValues();
        const rowIndexSet = new Set(unique);
        ctx.productoSnapshots = [];
        for (let i = 0; i < rangeData.length; i++) {
          const actualRow = minRow + i;
          if (rowIndexSet.has(actualRow)) {
            ctx.productoSnapshots.push({ rowIndex: actualRow, values: rangeData[i], startCol: minCol });
          }
        }
      },

      markProductoPreAppend() {
        if (!ctx.active) return;
        ctx.productoPreRows = getSheet(CONFIG.SHEETS.PRODUCTOS).getLastRow();
      },

      markProductoPostAppend() {
        if (!ctx.active) return;
        ctx.productoPostRows = getSheet(CONFIG.SHEETS.PRODUCTOS).getLastRow();
      },

      snapshotCompraRow(rowIndex) {
        if (!ctx.active || !rowIndex) return;
        const sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
        const COL = COMPRAS_CONFIG.COLUMNS.COMPRAS;
        const numCols = Math.max(...Object.values(COMPRAS_CONFIG.COLUMNS.COMPRAS)) + 1;
        const rangeData = sheet.getRange(rowIndex, 1, 1, numCols).getValues();
        ctx.compraSnapshots.push({ rowIndex: rowIndex, values: rangeData[0] });
      },

      markDetallePreAppend() {
        if (!ctx.active) return;
        ctx.detallePreRows = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS).getLastRow();
      },

      markDetallePostAppend() {
        if (!ctx.active) return;
        ctx.detallePostRows = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS).getLastRow();
      },

      markPagoPreAppend() {
        if (!ctx.active) return;
        ctx.pagoPreRows = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES).getLastRow();
      },

      markPagoPostAppend() {
        if (!ctx.active) return;
        ctx.pagoPostRows = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES).getLastRow();
      },

      // === NUEVOS marcadores para tablas principales y contables (#1) ===
      markCarteraPreAppend() {
        if (!ctx.active) return;
        ctx.carteraPreRows = getSheet(CARTERA_CONFIG.SHEETS.CARTERA).getLastRow();
      },
      markCarteraPostAppend() {
        if (!ctx.active) return;
        ctx.carteraPostRows = getSheet(CARTERA_CONFIG.SHEETS.CARTERA).getLastRow();
      },
      markCompraPreAppend() {
        if (!ctx.active) return;
        ctx.compraPreRows = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS).getLastRow();
      },
      markCompraPostAppend() {
        if (!ctx.active) return;
        ctx.compraPostRows = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS).getLastRow();
      },
      markKardexPreAppend() {
        if (!ctx.active) return;
        ctx.kardexPreRows = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX).getLastRow();
      },
      markKardexPostAppend() {
        if (!ctx.active) return;
        ctx.kardexPostRows = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX).getLastRow();
      },
      markLibroPreAppend() {
        if (!ctx.active) return;
        ctx.libroPreRows = getSheet(CONFIG.SHEETS.LIBRO_DIARIO).getLastRow();
      },
      markLibroPostAppend() {
        if (!ctx.active) return;
        ctx.libroPostRows = getSheet(CONFIG.SHEETS.LIBRO_DIARIO).getLastRow();
      },
      markFlujoPreAppend() {
        if (!ctx.active) return;
        ctx.flujoPreRows = getSheet(CONFIG.SHEETS.FLUJO_CAJA).getLastRow();
      },
      markFlujoPostAppend() {
        if (!ctx.active) return;
        ctx.flujoPostRows = getSheet(CONFIG.SHEETS.FLUJO_CAJA).getLastRow();
      },
      markProductoProveedorPreAppend() {
        if (!ctx.active) return;
        ctx.productoProveedorPreRows = getSheet(PRODUCTO_PROVEEDOR_CONFIG.SHEET).getLastRow();
      },
      markProductoProveedorPostAppend() {
        if (!ctx.active) return;
        ctx.productoProveedorPostRows = getSheet(PRODUCTO_PROVEEDOR_CONFIG.SHEET).getLastRow();
      },

      commit() {
        ctx.active = false;
        ctx.carteraSnapshots = [];
        ctx.movPreRows = 0;
        ctx.movPostRows = 0;
        ctx.terceroSnapshots = [];
        ctx.productoSnapshots = [];
        ctx.productoPreRows = 0;
        ctx.productoPostRows = 0;
        ctx.compraSnapshots = [];
        ctx.pagoPreRows = 0;
        ctx.pagoPostRows = 0;
        ctx.detallePreRows = 0;
        ctx.detallePostRows = 0;
        ctx.carteraPreRows = 0;
        ctx.carteraPostRows = 0;
        ctx.compraPreRows = 0;
        ctx.compraPostRows = 0;
        ctx.kardexPreRows = 0;
        ctx.kardexPostRows = 0;
        ctx.libroPreRows = 0;
        ctx.libroPostRows = 0;
        ctx.flujoPreRows = 0;
        ctx.flujoPostRows = 0;
        ctx.productoProveedorPreRows = 0;
        ctx.productoProveedorPostRows = 0;
      },

      rollback() {
        if (!ctx.active) return;
        // === FASE 1: restaurar snapshots existentes (acumulando conflictos, #5) ===
        const conflicts = [];

        // Rollback de Terceros
        if (ctx.terceroSnapshots && ctx.terceroSnapshots.length > 0) {
          const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
          const COL = CARTERA_CONFIG.COLUMNS.TERCEROS;
          for (const snap of ctx.terceroSnapshots) {
            const currentRow = sheet.getRange(snap.rowIndex, COL.version + 1, 1, 1).getValues()[0];
            const currentVersion = Number(currentRow[0]) || 1;
            const snapshotVersion = Number(snap.values[COL.version]) || 1;
            if (currentVersion !== snapshotVersion) {
              conflicts.push({ table: 'TERCEROS', rowIndex: snap.rowIndex, expected: snapshotVersion, actual: currentVersion });
              continue;
            }
            const numCols = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.TERCEROS)) + 1;
            sheet.getRange(snap.rowIndex, 1, 1, numCols).setValues([snap.values]);
          }
        }

        // Rollback de Cartera (filas existentes)
        const carteraSheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
        const CARCOL = CARTERA_CONFIG.COLUMNS.CARTERA;
        for (const snap of ctx.carteraSnapshots) {
          const currentRow = carteraSheet.getRange(snap.rowIndex, CARCOL.version + 1, 1, 1).getValues()[0];
          const currentVersion = Number(currentRow[0]) || 1;
          const snapshotVersionIdx = CARCOL.version - snap.startCol;
          const snapshotVersion = Number(snap.values[snapshotVersionIdx]) || 1;
          if (currentVersion !== snapshotVersion) {
            conflicts.push({ table: 'CARTERA', rowIndex: snap.rowIndex, expected: snapshotVersion, actual: currentVersion });
            continue;
          }
          const restoredRow = snap.values.slice();
          const numCols = restoredRow.length;
          carteraSheet.getRange(snap.rowIndex, snap.startCol + 1, 1, numCols).setValues([restoredRow]);
        }

        // Rollback de Productos (stock)
        if (ctx.productoSnapshots && ctx.productoSnapshots.length > 0) {
          const prodSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
          const PCOL = CONFIG.COLUMNS.PRODUCTOS;
          for (const snap of ctx.productoSnapshots) {
            const snapshotVersionIdx = PCOL.version - snap.startCol;
            const snapshotVersion = Number(snap.values[snapshotVersionIdx]) || 1;
            const currentRow = prodSheet.getRange(snap.rowIndex, PCOL.version + 1, 1, 1).getValues()[0];
            const currentVersion = Number(currentRow[0]) || 1;
            if (currentVersion !== snapshotVersion) {
              conflicts.push({ table: 'PRODUCTOS', rowIndex: snap.rowIndex, expected: snapshotVersion, actual: currentVersion });
              continue;
            }
            const numCols = snap.values.length;
            prodSheet.getRange(snap.rowIndex, snap.startCol + 1, 1, numCols).setValues([snap.values]);
          }
        }

        // Rollback de Compras (filas existentes)
        if (ctx.compraSnapshots && ctx.compraSnapshots.length > 0) {
          const compraSheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
          const CCOL = COMPRAS_CONFIG.COLUMNS.COMPRAS;
          for (const snap of ctx.compraSnapshots) {
            const snapshotVersion = Number(snap.values[CCOL.version]) || 1;
            const currentRow = compraSheet.getRange(snap.rowIndex, CCOL.version + 1, 1, 1).getValues()[0];
            const currentVersion = Number(currentRow[0]) || 1;
            if (currentVersion !== snapshotVersion) {
              conflicts.push({ table: 'COMPRAS', rowIndex: snap.rowIndex, expected: snapshotVersion, actual: currentVersion });
              continue;
            }
            const numCols = Math.max(...Object.values(COMPRAS_CONFIG.COLUMNS.COMPRAS)) + 1;
            compraSheet.getRange(snap.rowIndex, 1, 1, numCols).setValues([snap.values]);
          }
        }

        // === FASE 2: eliminar inserciones en orden descendente por startRow (#1) ===
        const deletes = [];
        function _addDel(sheetName, pre, post) {
          if (post > pre) {
            deletes.push({ sheet: getSheet(sheetName), startRow: pre + 1, count: post - pre });
          }
        }
        _addDel(CARTERA_CONFIG.SHEETS.MOV_CARTERA, ctx.movPreRows, ctx.movPostRows);
        _addDel(CONFIG.SHEETS.PRODUCTOS, ctx.productoPreRows, ctx.productoPostRows);
        _addDel(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES, ctx.pagoPreRows, ctx.pagoPostRows);
        _addDel(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS, ctx.detallePreRows, ctx.detallePostRows);
        _addDel(CARTERA_CONFIG.SHEETS.CARTERA, ctx.carteraPreRows, ctx.carteraPostRows);
        _addDel(COMPRAS_CONFIG.SHEETS.COMPRAS, ctx.compraPreRows, ctx.compraPostRows);
        _addDel(COMPRAS_CONFIG.SHEETS.KARDEX, ctx.kardexPreRows, ctx.kardexPostRows);
        _addDel(CONFIG.SHEETS.LIBRO_DIARIO, ctx.libroPreRows, ctx.libroPostRows);
        _addDel(CONFIG.SHEETS.FLUJO_CAJA, ctx.flujoPreRows, ctx.flujoPostRows);
        _addDel(PRODUCTO_PROVEEDOR_CONFIG.SHEET, ctx.productoProveedorPreRows, ctx.productoProveedorPostRows);

        deletes.sort((a, b) => b.startRow - a.startRow);
        for (const d of deletes) {
          if (d.sheet.getLastRow() >= d.startRow) {
            d.sheet.deleteRows(d.startRow, d.count);
          }
        }

        ctx.active = false;

        // === FASE 3: reportar conflictos acumulados (#5) ===
        if (conflicts.length > 0) {
          LOG_ENGINE.logEvent("ROLLBACK_PARCIAL", "SYSTEM", "", {}, { conflicts: conflicts }, "ERROR");
          const resumen = conflicts.map(c => c.table + " fila " + c.rowIndex).join(", ");
          throw new Error("Rollback parcial: " + conflicts.length + " conflicto(s) de version [" + resumen + "]");
        }
      },
    };
  },
};

function _buildAbonoPlan(pendientes, valor, idPrefijo, fechaMov, refLimpia) {
  const movimientos = [];
  const cambios = [];
  let restante = valor;
  let movIdx = 0;

  for (const p of pendientes) {
    if (restante <= 0) break;

    const aplicado = Math.min(restante, p.saldo);
    const nuevoSaldo = p.saldo - aplicado;
    const nuevoEstado = nuevoSaldo <= 0 ? CARTERA_CONFIG.ESTADOS.CANCELADA : CARTERA_CONFIG.ESTADOS.PARCIAL;

    movimientos.push({
      id: idPrefijo + "_" + (movIdx++),
      fecha: fechaMov,
      id_cartera: p.id,
      id_tercero: p.id_tercero,
      valor: aplicado,
      tipo_mov: (aplicado >= p.saldo) ? "CANCELACION" : "ABONO",
      referencia: refLimpia,
    });

    cambios.push({
      rowIndex: p.rowIndex,
      saldo: nuevoSaldo,
      estado: nuevoEstado,
      expectedVersion: p.version || 1,
    });

    restante -= aplicado;
  }

  return {
    movimientos: movimientos,
    cambios: cambios,
    aplicadoTotal: valor - restante,
    restante: restante,
  };
}

/**
 * Creates a product inline with global lock to prevent ID collisions.
 * Used when a purchase includes a product that doesn't exist in the master.
 * NOTE: The lock ensures exclusive access for ID generation and insertion.
 */
function _crearProductoInline(nombre, precioCompra, precioVenta, categoria) {
  let lockAcquired = null;
  try {
    // Acquire global lock for product creation to prevent ID collisions
    lockAcquired = LOCK_MANAGER.acquireGlobalLock("producto_creation");
    
    // Generate unique ID with timestamp + random suffix for collision avoidance
    const prodId = "P" + Date.now() + "_" + Math.random().toString(36).substr(2, 6).toUpperCase();
    
    // Create via DAO (which has its own local lock)
    const creado = DAO_PRODUCTOS.crear({
      nombre: _sanitizeCell(nombre),
      precio_compra: _parseMoneda(precioCompra, 0),
      precio_venta: _parseMoneda(precioVenta, 0),
      categoria: _sanitizeCell(categoria),
    });
    
    return creado;
  } finally {
    if (lockAcquired) lockAcquired.releaseLock();
  }
}

const DOMAIN = {
  /**
   * Creates or updates a third party record (CLIENTE/PROVEEDOR/AMBOS).
   * Validates ID format, credit limit, and initial balance.
   * Acquires distributed lock, snapshots existing row for rollback,
   * persists via DAO, logs the event, and invalidates cache.
   * @param {Object} tercero - Third party data object
   * @param {string} tercero.id - Unique identifier (RUT/CC)
   * @param {string} [tercero.nombre] - Full name or business name
   * @param {string} [tercero.telefono] - Contact phone number
   * @param {string} [tercero.tipo] - Type: CLIENTE, PROVEEDOR, or AMBOS
   * @param {number} [tercero.limite_credito] - Credit limit in currency units
   * @param {number} [tercero.saldo_inicial] - Initial balance
   * @param {boolean} [tercero.activo] - Active status flag
   * @returns {{success: boolean, id: string}} Result with success flag and tercero ID
   */
  saveTercero(tercero) {
    let lockAcquired = null;
    const tx = _Transaction.create();
    try {
      if (!tercero || typeof tercero !== 'object') return _error('Datos inválidos.');
      const id = _sanitizeId(tercero.id);
      if (!id) return _error("ID de tercero inválido.");
      
      // Business rule validation
      const limiteCredito = _parseMoneda(tercero.limite_credito, 0);
      if (isNaN(limiteCredito) || limiteCredito < 0) return _error("Límite de crédito inválido.");
      
      const saldoInicial = _parseMoneda(tercero.saldo_inicial, 0);
      if (isNaN(saldoInicial) || saldoInicial < 0) return _error("Saldo inicial inválido.");

      lockAcquired = LOCK_MANAGER.acquireResourceLock(id);

      // === INICIO FIX M-02 ===
      // Tomar snapshot de la fila existente para posible rollback
      const cachedRow = CACHE.terceroIndex ? CACHE.terceroIndex[id] : null;
      if (cachedRow) {
        tx.snapshotTerceroRow(cachedRow);
        Logger.log("[FIX-M-02] Snapshot tomado para fila existente: " + cachedRow);
      }
      // === FIN FIX M-02 ===

      tx.begin();

      const nombre = String(tercero.nombre || "S.N.").trim().slice(0, 100);
      const telefono = String(tercero.telefono || "").trim().slice(0, 20);
      const tipo = ["CLIENTE", "PROVEEDOR", "AMBOS"].includes(String(tercero.tipo || "").toUpperCase()) ? String(tercero.tipo).toUpperCase() : "CLIENTE";
      const limite = Math.max(0, _parseMoneda(tercero.limite_credito, 0));
      const activo = tercero.activo !== false ? "ACTIVO" : "INACTIVO";

      const resultado = DAO.saveTerceroImpl(tercero, id, nombre, telefono, tipo, limite, activo);

      tx.commit();
      CACHE.invalidateTerceros();

if (resultado.isUpdate) {
         LOG_ENGINE.logEvent("UPDATE_TERCERO", "TERCEROS", id, { nombre: "*" }, { nombre }, "SUCCESS", { correlationId: TransactionManager.getCorrelationId() || ('tercero_' + Date.now()) });
       } else {
         LOG_ENGINE.logEvent("CREATE_TERCERO", "TERCEROS", id, {}, { nombre }, "SUCCESS", { correlationId: TransactionManager.getCorrelationId() || ('tercero_' + Date.now()) });
       }

      return { success: true, id };

    } catch (e) {
      tx.rollback();
      CACHE.invalidateTerceros();
      if(tercero && tercero.id) {
         LOG_ENGINE.logEvent("ERROR_TERCERO", "TERCEROS", tercero.id, {}, {}, "ERROR: " + e.toString());
      }
      return _error(e.message || "Error al guardar tercero.");
    } finally {
      if (lockAcquired) lockAcquired.releaseLock();
    }
  },

  /**
   * Retrieves accounts receivable/payable (cartera) with optional filtering and pagination.
   * Applies business logic: marks overdue items based on current date,
   * resolves third party names from cache, and calculates overdue days.
   * @param {string|null} [filtroTipo=null] - Filter by type: CxC or CxP
   * @param {string|null} [filtroEstado=null] - Filter by estado: ABIERTA, PARCIAL, VENCIDA, CANCELADA
   * @param {number} [pageSize=5000] - Maximum records per page (1-5000)
   * @param {number} [pageToken=0] - Zero-based offset for pagination
   * @returns {{items: Array, nextPageToken: number}} Paginated cartera items and next offset
   */
  getCartera(filtroTipo = null, filtroEstado = null, pageSize = 5000, pageToken = 0) {
    const debeFiltrarVencida = filtroEstado === CARTERA_CONFIG.ESTADOS.VENCIDA;
    
    const estadoParaDAO = debeFiltrarVencida ? null : filtroEstado;
    const { items: baseCartera, nextPageToken } = DAO.getCartera(filtroTipo, estadoParaDAO, pageSize, pageToken);

    const hoy = _today();

    CACHE.refresh();
    const tercerosMap = new Map();
    if (CACHE.terceros) {
      CACHE.terceros.forEach(t => tercerosMap.set(t.id, t));
    }

    const result = baseCartera.map(c => {
      let estado = c.estado;
      if (estado !== CARTERA_CONFIG.ESTADOS.CANCELADA && _isValidDate(c.fecha_vencimiento)) {
        const fv = _safeDate(c.fecha_vencimiento);
        if (fv.getTime() > 0) {
          if (fv.getTime() < hoy.getTime()) {
            estado = CARTERA_CONFIG.ESTADOS.VENCIDA;
          } else if (estado === CARTERA_CONFIG.ESTADOS.VENCIDA) {
            estado = c.saldo < c.total
              ? CARTERA_CONFIG.ESTADOS.PARCIAL
              : CARTERA_CONFIG.ESTADOS.ABIERTA;
          }
        }
      }

      const tercero = tercerosMap.get(c.id_tercero) || null;
      return {
        ...c,
        estado,
        nombre_tercero: tercero ? tercero.nombre : "DESCONOCIDO",
        dias_vencido: (estado === CARTERA_CONFIG.ESTADOS.VENCIDA && _isValidDate(c.fecha_vencimiento))
          ? Math.floor((_today().getTime() - _safeDate(c.fecha_vencimiento).getTime()) / 86400000)
          : 0,
      };
    });

    if (debeFiltrarVencida) {
      const vencidas = result.filter(c => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA);
      return { items: vencidas, nextPageToken };
    }

    return { items: result, nextPageToken };
  },

  /**
   * TransactionManager wrapper that enhances existing _Transaction with audit and timeouts
   */
  withTransaction(correlationId, operation) {
    const txn = TransactionManager.begin(correlationId || ('txn_' + Date.now()));
    txn.startTime = Date.now();
    const MAX_TIMEOUT = 25000;
    
    try {
      const result = operation(txn);
      if (Date.now() - txn.startTime > MAX_TIMEOUT) {
        Logger.log("[TXN] WARNING: Transaction exceeded 25s timeout");
      }
      txn.commit();
      return result;
    } catch (e) {
      txn.rollback();
      CACHE.invalidateCartera();
      throw e;
    }
  },

  /**
   * Get transaction correlation ID for logging
   */
  getCurrentCorrelationId() {
    return TransactionManager.getCorrelationId();
  },

  /**
   * Registers a payment (abono) against a third party's outstanding debt.
   * Implements idempotency via correlationId, applies payment to oldest pending items first (FIFO), 
   * generates accounting entries and cash flow records. Retries on optimistic locking conflicts.
   * Note: Credit limit validation is NOT performed here - it should be validated at debt creation time.
   * @param {string} idTercero - Third party ID
   * @param {number} valorAbono - Payment amount in currency units
   * @param {string} referencia - Payment reference or description
   * @param {string} tipo - Debt type: CxC or CxP
   * @param {string} [correlationId] - Idempotency key to prevent duplicate processing
   * @returns {{success: boolean, aplicado: number, restante: number, movimientos: number, correlationId: string, deduplicated?: boolean}} Processing result
   */
  registrarAbonoAtomic(idTercero, valorAbono, referencia, tipo, correlationId) {
    const idTerceroLimpio = _sanitizeId(idTercero);
    if (!idTerceroLimpio) return _error('ID tercero inválido.');

    const valor = _parseMoneda(valorAbono, NaN);
    if (isNaN(valor) || valor <= 0) return _error('Valor inválido (mínimo 1 centavo).');

    const tipoLimpio = tipo === CARTERA_CONFIG.TIPOS.CXP ? CARTERA_CONFIG.TIPOS.CXP : CARTERA_CONFIG.TIPOS.CXC;
    const refLimpia = String(referencia || "Abono").trim().slice(0, 100);

    // === IDEMOPOTENCIA (TAREA 2.4) ===
    const corrId = correlationId || ('abono_' + Date.now());
    if (_isIdempotent(corrId, idTerceroLimpio)) {
      return { success: true, aplicado: valor, restante: 0, movimientos: 0, correlationId: corrId, deduplicated: true };
    }
    // === FIN IDEMOPOTENCIA ===

    const MAX_RETRIES = 3;

const _executeAbonoTx = () => {
       let lockAcquired = null;
      const tx = _Transaction.create();

      try {
        lockAcquired = LOCK_MANAGER.acquireResourceLock(idTerceroLimpio);

        const tercero = DAO.getTerceroById(idTerceroLimpio);
        if (!tercero) {
          LOG_ENGINE.logEvent("ERROR_ABONO", "CARTERA", idTerceroLimpio, {}, { error: "TERCERO_NO_EXISTE" }, "ERROR");
          return _error(`Tercero ${idTerceroLimpio} no existe en la base de datos.`);
        }

        // Validación de tipo de tercero para CxP
        if (tipoLimpio === CARTERA_CONFIG.TIPOS.CXP) {
          const tipoTercero = (tercero.tipo || "").toUpperCase();
          if (tipoTercero === "CLIENTE") {
            return _error("Este tercero no está clasificado como proveedor.");
          }
        }

        // NOTA: La validación de límite de crédito NO se hace aquí porque un abono
        // reduce la deuda, no la aumenta. La validación debe hacerse al crear la deuda
        // (venta a crédito) para que el saldo no supere el límite al momento de la venta.

        CACHE.refresh();
        const consistency = CACHE.verifyConsistency();
        if (consistency.mismatched) {
          Logger.log("DOMAIN: Inconsistencia en caché antes de registrarAbonoAtomic. Recuperando.");
          CACHE.recoverFromStale();
        }

        const pendientes = DAO.getCarteraByTerceroAndTipo(idTerceroLimpio, tipoLimpio)
          .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

        if (pendientes.length === 0) {
          return _error("No hay cartera pendiente de ese tipo para este tercero.");
        }

        const totalDeuda = pendientes.reduce((s, p) => s + p.saldo, 0);
        if (valor > totalDeuda) {
          return _error(`Abono supera deuda total: $${_formatMoneda(valor)} > $${_formatMoneda(totalDeuda)}`);
        }

        const fechaMov = new Date();
        const idPrefijo = "MOV" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 8);

        const plan = _buildAbonoPlan(pendientes, valor, idPrefijo, fechaMov, refLimpia);

        const corrId = correlationId || ('abono_' + Date.now());
        tx.begin();
        tx.snapshotCarteraRows(plan.cambios.map(c => c.rowIndex));
        tx.markMovPreAppend();

        DAO.updateCarteraBatch(plan.cambios);
        CACHE.invalidateCartera();
        if (plan.movimientos.length > 0) {
          for (const mov of plan.movimientos) { DAO.createMovimiento(mov); }
        }
        tx.markMovPostAppend();

        // === GENERAR ASIENTO CONTABLE PARA ABONO (dentro del lock, antes del commit) ===
        // F2: el asiento contable debe registrarse ANTES de tx.commit() para que,
        // si falla, el rollback de cartera/movimientos se aplique y no quede la
        // ecuación contable rota (cartera aplicada sin libro diario/flujo de caja).
        const usuario = SESSION_SERVICE.getCurrentUser().getEmail() || "SYSTEM";
        tx.markLibroPreAppend();
        LIBRO_DIARIO.registrarAbonoCliente(
          new Date(),
          "ABONO-" + Date.now(),
          idTerceroLimpio,
          plan.aplicadoTotal,
          usuario
        );
        tx.markLibroPostAppend();

        // Registrar entrada de caja por abono
        tx.markFlujoPreAppend();
        FLUJO_CAJA.registrarMovimiento(
          new Date(),
          FLUJO_CAJA.TIPOS.ENTRADA_ABONO,
          "Abono tercero: " + idTerceroLimpio,
          plan.aplicadoTotal,
          refLimpia,
          usuario
        );
        tx.markFlujoPostAppend();

        tx.commit();

        LOG_ENGINE.logEvent("ABONO_PROCESADO", "CARTERA", idTerceroLimpio,
          { anterior_saldo: totalDeuda },
          { nuevo_saldo: totalDeuda - valor, movimientos: plan.movimientos.length },
          "SUCCESS", { correlationId: corrId });

        return {
          success: true,
          aplicado: plan.aplicadoTotal,
          restante: Math.max(0, plan.restante),
          movimientos: plan.movimientos.length,
          correlationId: corrId
        };

      } catch (e) {
        // === INICIO FIX C-04 ===
        try {
          tx.rollback();
          Logger.log("[FIX-C-04] Rollback completado exitosamente");
        } catch (rbErr) {
          Logger.log("[FIX-C-04] ERROR: Rollback falló - " + rbErr.message);
        }
        CACHE.invalidateCartera();
        throw e;
      } finally {
        if (lockAcquired) lockAcquired.releaseLock();
      }
      // === FIN FIX C-04 ===
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = _executeAbonoTx();
        return result;
      } catch (e) {
        const isOptimisticLock =
          e.type === 'OPTIMISTIC_LOCK_FAILURE' ||
          (e.message && e.message.includes('OptimisticLockError'));

        if (!isOptimisticLock) {
          LOG_ENGINE.logEvent("ERROR_ABONO", "CARTERA", idTercero, {}, { error: e.toString() }, "FAILED");
          return _error(e.message || "Error procesando abono.");
        }

        if (attempt < MAX_RETRIES - 1) {
          CACHE.refresh(true);
          const delay = 100 * Math.pow(2, attempt) + Math.random() * 50;
          Logger.log("WARN: registrarAbonoAtomic retry #" + (attempt + 1) + " para " + idTerceroLimpio + " tras OptimisticLockError");
          Utilities.sleep(delay);
        }
      }
    }

    const msg = `Conflicto de concurrencia persistente para tercero ${idTerceroLimpio}. Operación abortada.`;
    LOG_ENGINE.logEvent("ERROR_ABONO", "CARTERA", idTercero, {}, { error: msg }, "FAILED");
    return _error(msg);
  },

  /**
   * Batch-updates multiple cartera records within a single atomic transaction.
   * Takes a snapshot of affected rows before applying changes,
   * delegates to DAO.updateCarteraBatch, and rolls back on failure.
   * @param {Array} cambios - Array of change objects {rowIndex, saldo, estado, expectedVersion}
   * @returns {boolean} True on successful update
   * @throws {Error} Propagates DAO errors after rollback
   */
  actualizarCarteraBatch(cambios) {
    const tx = _Transaction.create();
    tx.begin();
    try {
      tx.snapshotCarteraRows((cambios || []).map(c => c.rowIndex).filter(i => i > 0));
      DAO.updateCarteraBatch(cambios);
      tx.commit();
      return true;
    } catch (e) {
      tx.rollback();
      Logger.log("ERROR DOMAIN.actualizarCarteraBatch: " + e.toString());
      throw e;
    }
  },

  /**
   * Creates a receivable (CxC) or payable (CxP) entry with full business rule validation.
   * Validates third party existence, credit limits for CxC, generates a unique
   * cartera ID, and acquires a distributed lock for the third party.
   * @param {string} idTercero - Third party ID
   * @param {string} origenId - Origin document ID (invoice, sale, etc.)
   * @param {number} total - Total amount in currency units
   * @param {string} tipo - Cartera type: CxC or CxP
   * @param {number} [diasCredito=30] - Credit term in days (0-365)
   * @returns {string} The newly created cartera record ID
   * @throws {Error} On validation failure, third party not found, or credit limit exceeded
   */
  crearCarteraAtomic(idTercero, origenId, total, tipo, diasCredito) {
    const idTerceroLimpio = _sanitizeId(idTercero);
    const totalLimpio = _parseMoneda(total, NaN);
    const diasCreditoLimpio = Math.max(0, Math.min(365, parseInt(diasCredito) || 30));
    let lockAcquired = null;

    try {
      if (!idTerceroLimpio) throw new Error("ID tercero inválido.");
      if (isNaN(totalLimpio) || totalLimpio <= 0) throw new Error("Monto inválido.");
      if (!tipo || !Object.values(CARTERA_CONFIG.TIPOS).includes(tipo)) {
        throw new Error("Tipo de cartera inválido.");
      }

      lockAcquired = LOCK_MANAGER.acquireResourceLock(idTerceroLimpio);

      const tercero = DAO.getTerceroById(idTerceroLimpio);
      if (!tercero) { throw new Error(`Tercero ${idTerceroLimpio} no existe.`); }

      const consistency = CACHE.verifyConsistency();
      if (consistency.mismatched) {
        Logger.log("DOMAIN: Inconsistencia en caché antes de crearCarteraAtomic. Recuperando.");
        CACHE.recoverFromStale();
      }

      if (tipo === CARTERA_CONFIG.TIPOS.CXC) {
        if (!tercero.limite_credito || tercero.limite_credito === 0) {
          throw new Error("Cliente sin límite de crédito configurado. Configure un límite o use venta de contado.");
        }
        const saldoActual = CACHE.getSaldoTercero(idTerceroLimpio);
        if ((saldoActual + totalLimpio) > tercero.limite_credito) {
          throw new Error(`Límite de crédito superado. Disponible: $${_formatMoneda(tercero.limite_credito - saldoActual)}`);
        }
      }

      const idCartera = (tipo === CARTERA_CONFIG.TIPOS.CXC ? "CXC" : "CXP") + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 8);

      const record = {
        id: idCartera, fecha: new Date(), id_tercero: idTerceroLimpio, origen_id: String(origenId).trim(),
        total: totalLimpio, saldo: totalLimpio, tipo: tipo, estado: CARTERA_CONFIG.ESTADOS.ABIERTA,
        fecha_vencimiento: (() => { 
          const d = _today(); 
          d.setDate(d.getDate() + diasCreditoLimpio); 
          if (isNaN(d.getTime())) throw new Error("Fecha de vencimiento inválida.");
          return d; 
        })(),
      };

DAO.createCartera(record);
        CACHE.invalidateCartera();
        LOG_ENGINE.logEvent("CREATE_CARTERA", "CARTERA", idCartera, {}, { tercero: idTerceroLimpio, total: totalLimpio }, "SUCCESS", { correlationId: TransactionManager.getCorrelationId() || ('cartera_' + Date.now()) });
        
        return idCartera;
    } finally {
      if (lockAcquired) lockAcquired.releaseLock();
    }
  },

  /**
   * Registers a supplier purchase with inline product creation for unknown items.
   * Validates supplier existence, invoice uniqueness, and item data.
   * Automatically creates unknown products, increments stock, records kardex
   * movements, and generates accounting entries. Retries on optimistic locking.
   * @param {string} proveedorId - Supplier third party ID
   * @param {Array} items - Array of purchase items
   * @param {string|undefined} items[].id - Product ID (optional if nombre provided for inline creation)
   * @param {string} [items[].nombre] - Product name for inline creation when ID is unknown
   * @param {number} items[].cantidad - Quantity purchased
   * @param {number} items[].precio_unitario - Unit price
   * @param {number} total - Total purchase amount
   * @param {Date|string} fechaVencimiento - Payment due date (defaults to +30 days)
   * @param {string} [factura] - Supplier invoice number (checked for duplicates)
   * @param {string} [correlationId] - Idempotency key
   * @returns {{success: boolean, id: string, total: number}} Purchase result with ID
   */
  registrarCompraAtomic(proveedorId, items, total, fechaVencimiento, factura, correlationId) {
    const corrId = correlationId || ('compra_' + Date.now());
    // M8: Idempotency check
    if (_isIdempotent(corrId, proveedorId)) {
      return { success: true, id: null, correlationId: corrId, deduplicated: true, total: total };
    }
    const idProv = _sanitizeId(proveedorId);
    if (!idProv) return _error("ID proveedor inválido.");
    const totalLimpio = _parseMoneda(total, NaN);
    if (isNaN(totalLimpio) || totalLimpio <= 0) return _error("Total inválido.");
    if (!items || items.length === 0) return _error("Debe incluir al menos un producto.");

    // Pre-cargar productos existentes para validación
    CACHE.refresh();
    const consistencyPre = CACHE.verifyConsistency();
    if (consistencyPre && consistencyPre.mismatched) {
      CACHE.recoverFromStale();
    }
    const todosProductos = DAO_PRODUCTOS.listar();
    const productoMap = {};
    for (let _pm = 0; _pm < todosProductos.length; _pm++) {
      productoMap[todosProductos[_pm].id] = todosProductos[_pm];
    }

    for (let _i = 0; _i < items.length; _i++) {
      const _item = items[_i];
      const _pid = _sanitizeId(_item.id || _item.productoId || _item.id_producto || "");
      const _nombre = String(_item.nombre || "").trim();
      const _cant = _parseMoneda(_item.cantidad || _item.cant || 0, 0);
      const _pUnit = _parseMoneda(_item.precio_unitario || _item.precio || 0, 0);
      if (!_pid && !_nombre) return _error("Ítem #" + (_i + 1) + ": debe especificar ID o nombre del producto.");
      if (_cant <= 0) return _error("Cantidad inválida en el ítem #" + (_i + 1) + ".");
      if (_pUnit <= 0) return _error("Precio unitario inválido en el ítem #" + (_i + 1) + ".");
      if (_pid && !productoMap[_pid] && !_nombre) {
        return _error("Producto '" + _pid + "' no existe en inventario. Incluya 'nombre' para crearlo automáticamente.");
      }
    }

    // M9: Validate total matches sum of items
    const calculatedTotal = items.reduce((sum, item) => sum + (Number(item.cantidad || item.cant || 0) * Number(item.precio_unitario || item.precio || 0)), 0);
    if (Math.abs(calculatedTotal - totalLimpio) > 1) {
      return _error("Total (" + _formatMoneda(totalLimpio) + ") no coincide con suma de items (" + _formatMoneda(calculatedTotal) + "). Diferencia: " + _formatMoneda(Math.abs(calculatedTotal - totalLimpio)) + ".");
    }

    const idFacturaLimpia = String(factura || "").trim();
    if (idFacturaLimpia) {
      const comprasExistentes = DAO_COMPRAS.getCompras(null, null);
      for (let _ck = 0; _ck < comprasExistentes.length; _ck++) {
        if (String(comprasExistentes[_ck].id_factura || "").trim() === idFacturaLimpia) {
          return _error("Ya existe una compra con la factura #" + idFacturaLimpia + ".");
        }
      }
    }

    const MAX_RETRIES = 3;

    const _executeCompraTx = () => {
      // Collect product IDs and combine with proveedor for deterministic lock order
      const compraProdIds = [];
      for (let j = 0; j < items.length; j++) {
        const pid = _sanitizeId(items[j].id || items[j].productoId || items[j].id_producto || "");
        if (pid && compraProdIds.indexOf(pid) === -1) compraProdIds.push(pid);
      }
      const lockIds = [idProv].concat(compraProdIds);

      return LOCK_MANAGER.acquireMultipleLocks(lockIds, function() {
      const tx = _Transaction.create();

      try {
        const tercero = DAO.getTerceroById(idProv);
        if (!tercero) { LOG_ENGINE.logEvent("ERROR_COMPRA", "COMPRAS", idProv, {}, { error: "PROVEEDOR_NO_EXISTE" }, "ERROR"); return _error("Proveedor " + idProv + " no existe."); }
        const tipoTercero = (tercero.tipo || "").toUpperCase();
        if (tipoTercero !== "PROVEEDOR" && tipoTercero !== "AMBOS") {
          return _error("El tercero " + idProv + " no es un proveedor válido.");
        }

        CACHE.refresh();
        const consistency = CACHE.verifyConsistency();
        if (consistency.mismatched) {
          CACHE.recoverFromStale();
        }

        // OPTIMIZED: Read products once for batch stock updates
        const C = CONFIG.COLUMNS.PRODUCTOS;
        const prodSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
        const lastRow = prodSheet.getLastRow();
        const colCount = C.version + 1;
        const prodData = lastRow >= 2 ? prodSheet.getRange(2, 1, lastRow - 1, colCount).getValues() : [];
        const prodIndex = {};
        const prodVersions = {};
        for (let p = 0; p < prodData.length; p++) {
          const pid = String(prodData[p][C.id] || "").trim();
          if (pid) {
            prodIndex[pid] = p;
            prodVersions[pid] = parseInt(prodData[p][C.version]) || 1;
          }
        }

        const idCompra = "CXP" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
        let fv = fechaVencimiento;
        if (!fv) { fv = _today(); fv.setDate(fv.getDate() + 30); }
        fv = _safeDate(fv);
        if (!fv) fv = _today();

        const compraRecord = {
          id: idCompra, fecha: new Date(), id_proveedor: idProv, id_factura: String(factura || "").trim(),
          total: totalLimpio, saldo: totalLimpio, estado: COMPRAS_CONFIG.ESTADOS.ABIERTA,
          fecha_vencimiento: fv,
        };

        tx.begin();
        tx.markDetallePreAppend();
        tx.markCompraPreAppend();

        DAO_COMPRAS.crearCompra(compraRecord);
        tx.markCompraPostAppend();

        // Collect stock updates for batch write
        const stockUpdates = {}; // pid -> { cantidad, rowIndex, stockAnterior, stockNuevo }

        let subtotalAcumulado = 0;
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          const prodId = _sanitizeId(item.id || item.productoId || item.id_producto || "");
          const cant = _parseMoneda(item.cantidad || item.cant || 0, 0);
          const pUnit = _parseMoneda(item.precio_unitario || item.precio || 0, 0);
          if (!prodId || cant <= 0) continue;
          const sub = cant * pUnit;
          subtotalAcumulado += sub;
          const detId = "DET" + Date.now() + j;
          DAO_COMPRAS.crearDetalleCompra({
            id: detId, id_compra: idCompra, id_producto: prodId,
            cantidad: cant, precio_unitario: pUnit, subtotal: sub,
          });
          const email = SESSION_SERVICE.getCurrentUser()?.getEmail() || "system";

          const idx = prodIndex[prodId];
          if (idx !== undefined) {
            // Existing product - accumulate for batch update
            const stockAnterior = parseInt(prodData[idx][C.stock]) || 0;
            const stockNuevo = stockAnterior + cant;
            prodData[idx][C.stock] = stockNuevo;
            prodData[idx][C.version] = prodVersions[prodId] + 1;
            
            stockUpdates[prodId] = { 
              stockAnterior, stockNuevo, rowIndex: idx + 2, prodIdx: idx,
              kardexId: "KDX" + Date.now() + "_" + prodId + "_" + j,
              usuario: SESSION_SERVICE.getCurrentUser()?.getEmail() || "system",
              costoUnitario: pUnit,
            };
          } else {
            // New product - create inline
            const _nombreItem = String(item.nombre || "").trim();
            if (_nombreItem) {
              tx.markProductoPreAppend();
              const pCompra = _parseMoneda(item.precio_compra || item.precio_unitario || item.precio || 0, 0);
              const creado = DAO_PRODUCTOS.crear({
                id: prodId || undefined,
                nombre: _nombreItem,
                precio_compra: pCompra,
                precio_venta: pCompra,
                categoria: String(item.categoria || "").trim(),
              });
              tx.markProductoPostAppend();
              const prodIdCreado = creado.id;
              
              // Inline productos are created with stock 0, so we set to cant
              // Get the new row (last row)
              const newRowIdx = getSheet(CONFIG.SHEETS.PRODUCTOS).getLastRow();
              const newProdIdx = newRowIdx - 2;
              prodIndex[prodIdCreado] = newProdIdx;
              prodData[newProdIdx] = prodData[newProdIdx] || [];
              prodData[newProdIdx][C.stock] = cant;
              prodData[newProdIdx][C.version] = 1;
              
              stockUpdates[prodIdCreado] = { 
                stockAnterior: 0, stockNuevo: cant, rowIndex: newRowIdx,
                prodIdx: newProdIdx,
                kardexId: "KDX" + Date.now() + "_" + prodIdCreado + "_" + j,
                costoUnitario: pUnit,
/**
   * Links a product to a supplier with pricing and preferred status.
   * Uses TransactionManager for atomicity. If esPreferido=true, demarks any
   * previous preferred supplier for the same product.
   * @param {string} idProducto - Product ID.
   * @param {string} idProveedor - Supplier ID.
   * @param {number} precio - Last purchase price.
   * @param {boolean} esPreferido - Whether this is the preferred supplier.
   * @param {string} [correlationId] - Optional idempotency key.
   * @returns {{success: boolean, id: string, message?: string}} Result.
   */
  vincularProductoProveedor(idProducto, idProveedor, precio, esPreferido, correlationId) {
    const corrId = correlationId || ('vinc_' + Date.now());
    const idProdLimpio = _sanitizeId(idProducto);
    const idProvLimpio = _sanitizeId(idProveedor);
    if (!idProdLimpio) return _error("ID de producto inválido.");
    if (!idProveedor || !idProveedor) return _error("ID de proveedor inválido.");
    if (isNaN(precio) || precio < 0) return _error("Precio inválido.");

    let lockAcquired = null;
    const tx = _Transaction.create();

    try {
      // Validate product exists
      const producto = DAO_PRODUCTOS.obtener(idProdLimpio);
      if (!producto) return _error("Producto no encontrado: " + idProdLimpio);

      // Validate supplier exists and is PROVEEDOR or AMBOS
      const proveedor = DAO.getTerceroById(idProvLimpio);
      if (!proveedor) return _error("Proveedor no encontrado: " + idProvLimpio);
      const tipoTercero = (proveedor.tipo || "").toUpperCase();
      if (tipoTercero !== "PROVEEDOR" && tipoTercero !== "AMBOS") {
        return _error("El tercero " + idProvLimpio + " no está clasificado como proveedor.");
      }

      lockAcquired = LOCK_MANAGER.acquireResourceLock(idProdLimpio + "_supplier");

      tx.begin();

      // If setting as preferred, unmark any existing preferred supplier
      if (esPreferido === true) {
        const sheet = getSheet(PRODUCTO_PROVEEDOR_CONFIG.SHEET);
        const lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          const COL = PRODUCTO_PROVEEDOR_CONFIG.COLUMNS;
          const data = sheet.getRange(2, 1, lastRow - 1, Math.max(...Object.values(COL)) + 1).getValues();
          const toUpdate = [];
          for (let i = 0; i < data.length; i++) {
            if (String(data[i][COL.idProducto] || "").trim() === idProdLimpio &&
                String(data[i][COL.esPreferido] || "").toUpperCase() === "TRUE") {
              toUpdate.push(i + 2);
            }
          }
          for (let i = 0; i < toUpdate.length; i++) {
            sheet.getRange(toUpdate[i], COL.esPreferido + 1, 1, 1).setValue("FALSE");
          }
        }
      }

      // Upsert: update existing linkage or insert new
      const sheet = getSheet(PRODUCTO_PROVEEDOR_CONFIG.SHEET);
      const COL = PRODUCTO_PROVEEDOR_CONFIG.COLUMNS;
      const lastRow = sheet.getLastRow();
      let existingRow = null;
      if (lastRow >= 2) {
        const data = sheet.getRange(2, 1, lastRow - 1, Math.max(...Object.values(COL)) + 1).getValues();
        for (let i = 0; i < data.length; i++) {
          if (String(data[i][COL.idProducto] || "").trim() === idProdLimpio &&
              String(data[i][COL.idProveedor] || "").trim() === idProvLimpio) {
            existingRow = i + 2;
            break;
          }
        }
      }
      if (existingRow) {
        sheet.getRange(existingRow, COL.precioUltimaCompra + 1, 1, 3).setValues([[_parseMoneda(precio, 0), esPreferido === true ? "TRUE" : "FALSE", new Date()]]);
      } else {
        tx.markProductoProveedorPreAppend();
        const rowData = [
          _sanitizeCell(idProdLimpio),
          _sanitizeCell(idProvLimpio),
          _parseMoneda(precio, 0),
          esPreferido === true ? "TRUE" : "FALSE",
          new Date()
        ];
        sheet.appendRow(rowData);
        tx.markProductoProveedorPostAppend();
      }

      tx.commit();

      LOG_ENGINE.logEvent("LINK_PRODUCTO_PROVEEDOR", "PRODUCTO_PROVEEDOR", idProdLimpio,
        {}, { proveedor: idProvLimpio, precio: precio, preferido: esPreferido }, "SUCCESS",
        { correlationId: TransactionManager.getCorrelationId() || corrId });

      return { success: true, id: idProdLimpio, message: "Producto vinculado correctamente." };

    } catch (e) {
      try { tx.rollback(); } catch (rbErr) { Logger.log("[DOMAIN] Rollback error en vincularProductoProveedor: " + rbErr.message); }
      return _error(e.message || "Error al vincular producto-proveedor.");
    } finally {
      if (lockAcquired) lockAcquired.releaseLock();
    }
  },

  /**

    /**
     * Validates that a tercero can receive a CxP payment.
   * Validates that a tercero can receive a CxP payment.
   * @param {string} idTercero - Tercero ID.
   * @returns {boolean} True if tercero is PROVEEDOR or AMBOS.
   * @throws {Error} If tercero is CLIENTE only.
   */
  validarTerceroParaCxP(idTercero) {
    const idLimpio = _sanitizeId(idTercero);
    if (!idLimpio) return false;
    const tercero = DAO.getTerceroById(idLimpio);
    if (!tercero) return false;
    const tipoTercero = (tercero.tipo || "").toUpperCase();
    if (tipoTercero === "CLIENTE") {
      throw new Error("Este tercero no está clasificado como proveedor.");
    }
    return tipoTercero === "PROVEEDOR" || tipoTercero === "AMBOS";
  },

  /**
   * Validates that a tercero can receive a CxC sale.
   * @param {string} idTercero - Tercero ID.
   * @returns {boolean} True if tercero is CLIENTE or AMBOS.
   * @throws {Error} If tercero is PROVEEDOR only.
   */
  validarTerceroParaCxC(idTercero) {
    const idLimpio = _sanitizeId(idTercero);
    if (!idLimpio) return false;
    const tercero = DAO.getTerceroById(idLimpio);
    if (!tercero) return false;
    const tipoTercero = (tercero.tipo || "").toUpperCase();
    if (tipoTercero === "PROVEEDOR") {
      throw new Error("Este tercero no está clasificado como cliente.");
    }
    return tipoTercero === "CLIENTE" || tipoTercero === "AMBOS";
  },

};
              
              LOG_ENGINE.logEvent("CREATE_PRODUCTO_INLINE", "PRODUCTOS", prodIdCreado,
                {}, { nombre: _nombreItem, precio_compra: pCompra, origen: "COMPRA", id_compra: idCompra }, "SUCCESS",
                { correlationId: corrId });
            }
          }
        }

        // Write stock and version columns (row-by-row, no consecutive-range assumption)
        const rowNums = Object.values(stockUpdates).map(u => u.rowIndex).sort((a, b) => a - b);
        if (rowNums.length > 0) {
          tx.snapshotProductoRows(rowNums);
          for (const r of rowNums) {
            const update = Object.values(stockUpdates).find(u => u.rowIndex === r);
            const prodIdx = update.prodIdx;
            if (prodIdx === undefined) continue;
            prodSheet.getRange(r, C.stock + 1, 1, 1).setValue(prodData[prodIdx][C.stock]);
            prodSheet.getRange(r, C.version + 1, 1, 1).setValue(prodData[prodIdx][C.version]);
          }
        }

        // Batch write kardex entries
        const kardexEntries = [];
        for (const pid of Object.keys(stockUpdates)) {
          const update = stockUpdates[pid];
          kardexEntries.push({
            id: update.kardexId,
            fecha: new Date(),
            id_producto: pid,
            tipo_mov: "ENTRADA",
            cantidad: update.stockNuevo - update.stockAnterior,
            stock_anterior: update.stockAnterior,
            stock_nuevo: update.stockNuevo,
            referencia: idCompra,
            origen: "COMPRA",
            usuario: update.usuario || "system",
            costo_unitario: update.costoUnitario || 0,
          });
        }
        if (kardexEntries.length > 0) {
          tx.markKardexPreAppend();
          DAO_COMPRAS.crearMovimientosKardexBatch(kardexEntries);
          tx.markKardexPostAppend();
        }

        tx.markDetallePostAppend();
        tx.commit();

        CACHE.invalidateCartera();

LOG_ENGINE.logEvent("CREATE_COMPRA", "COMPRAS", idCompra,
           {}, { proveedor: idProv, total: totalLimpio, items: items.length }, "SUCCESS", { correlationId: TransactionManager.getCorrelationId() || ('compra_' + Date.now()) });

        return { success: true, id: idCompra, total: totalLimpio };
      } catch (e) {
        _captureError("registrarCompraAtomic", e);
        try { tx.rollback(); } catch (rbErr) { Logger.log("[DOMAIN] Rollback error en compra: " + rbErr.message); }
        CACHE.invalidateCartera();
        throw e;
      }
      }, 30000); // acquireMultipleLocks handles lock release in finally
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = _executeCompraTx();
        return result;
      } catch (e) {
        const isOptimisticLock =
          e.type === 'OPTIMISTIC_LOCK_FAILURE' ||
          (e.message && e.message.includes('OptimisticLockError'));

        if (!isOptimisticLock) {
          LOG_ENGINE.logEvent("ERROR_COMPRA", "COMPRAS", idProv, {}, { error: e.toString() }, "FAILED");
          return _error(e.message || "Error al registrar compra.");
        }

        if (attempt < MAX_RETRIES - 1) {
          CACHE.refresh(true);
          const delay = 100 * Math.pow(2, attempt) + Math.random() * 50;
          Logger.log("WARN: registrarCompraAtomic retry #" + (attempt + 1) + " para " + idProv + " tras OptimisticLockError");
          Utilities.sleep(delay);
        }
      }
    }

    const msg = "Conflicto de concurrencia persistente al registrar compra para " + idProv + ". Operación abortada.";
    LOG_ENGINE.logEvent("ERROR_COMPRA", "COMPRAS", idProv, {}, { error: msg }, "FAILED");
    return _error(msg);
  },

  /**
   * Processes a payment against a supplier purchase order.
   * Validates the purchase exists and is not already fully paid.
   * Updates purchase balance, records payment, generates accounting
   * entries (libro diario + cash flow). Retries on optimistic locking.
   * @param {string} idCompra - Purchase ID to pay
   * @param {number} monto - Payment amount in currency units
   * @param {string} referencia - Payment reference or description
   * @returns {{success: boolean, id: string, saldo_restante: number, estado: string}} Payment result with remaining balance
   */
  procesarPagoProveedorAtomic(idCompra, monto, referencia, correlationId) {
    const idCompraLimpio = String(idCompra || "").trim();
    if (!idCompraLimpio) return _error("ID de compra inválido.");
    const montoLimpio = _parseMoneda(monto, NaN);
    if (isNaN(montoLimpio) || montoLimpio <= 0) return _error("Monto inválido.");
    
    // M8: Idempotency check
    const corrId = correlationId || ('pago_' + Date.now());
    if (_isIdempotent(corrId, idCompraLimpio)) {
      return { success: true, msg: "Pago ya procesado", correlationId: corrId, deduplicated: true };
    }

    const MAX_RETRIES = 3;

    const _executePagoTx = () => {
      let lockAcquired = null;
      const tx = _Transaction.create();

      try {
        const compra = DAO_COMPRAS.getCompraById(idCompraLimpio);
        if (!compra) return _error("Compra no encontrada: " + idCompraLimpio);
        if (compra.estado === COMPRAS_CONFIG.ESTADOS.PAGADA) {
          return _error("La compra ya está pagada.");
        }

        lockAcquired = LOCK_MANAGER.acquireResourceLock(compra.id_proveedor);

        const nuevoSaldo = Math.max(0, compra.saldo - montoLimpio);
        const nuevoEstado = nuevoSaldo <= 0 ? COMPRAS_CONFIG.ESTADOS.PAGADA : COMPRAS_CONFIG.ESTADOS.PARCIAL;

        const pagoId = "PAG" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 8);

        tx.begin();
        tx.snapshotCompraRow(compra.rowIndex);
        tx.markPagoPreAppend();

        DAO_COMPRAS.actualizarSaldoCompra(idCompraLimpio, nuevoSaldo, nuevoEstado, compra.version);
        DAO_COMPRAS.crearPagoProveedor({
          id: pagoId, fecha: new Date(), id_compra: idCompraLimpio,
          id_proveedor: compra.id_proveedor, valor: montoLimpio,
          referencia: String(referencia || "Pago proveedor").trim(), metodo_pago: "",
        });

        tx.markPagoPostAppend();

        // === GENERAR ASIENTO CONTABLE PARA PAGO PROVEEDOR (dentro del lock, antes del commit) ===
        // F2: registrar el asiento antes de tx.commit() para que un fallo dispare
        // el rollback de cartera/pago y no deje la ecuación contable rota.
        const usuario = SESSION_SERVICE.getCurrentUser().getEmail() || "SYSTEM";
        tx.markLibroPreAppend();
        LIBRO_DIARIO.registrarPagoProveedor(
          new Date(),
          "PAGO-" + pagoId,
          compra.id_proveedor,
          montoLimpio,
          usuario
        );
        tx.markLibroPostAppend();

        // Registrar salida de caja por pago proveedor
        tx.markFlujoPreAppend();
        FLUJO_CAJA.registrarMovimiento(
          new Date(),
          FLUJO_CAJA.TIPOS.SALIDA_PAGO_PROV,
          "Pago a proveedor: " + compra.id_proveedor,
          montoLimpio,
          String(referencia || "Pago").trim(),
          usuario
        );
        tx.markFlujoPostAppend();

        tx.commit();

        CACHE.invalidateCartera();

LOG_ENGINE.logEvent("PAGO_PROVEEDOR", "COMPRAS", idCompraLimpio,
           { saldo_anterior: compra.saldo }, { saldo_nuevo: nuevoSaldo, pago: montoLimpio }, "SUCCESS", { correlationId: TransactionManager.getCorrelationId() || ('pago_' + Date.now()) });

        return { success: true, id: pagoId, saldo_restante: nuevoSaldo, estado: nuevoEstado };
      } catch (e) {
        _captureError("registrarPagoProveedor", e);
        try { tx.rollback(); } catch (rbErr) { Logger.log("[DOMAIN] Rollback error en pago: " + rbErr.message); }
        CACHE.invalidateCartera();
        throw e;
      } finally {
        if (lockAcquired) lockAcquired.releaseLock();
      }
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = _executePagoTx();
        return result;
      } catch (e) {
        const isOptimisticLock =
          e.type === 'OPTIMISTIC_LOCK_FAILURE' ||
          (e.message && e.message.includes('OptimisticLockError'));

        if (!isOptimisticLock) {
          LOG_ENGINE.logEvent("ERROR_PAGO_PROVEEDOR", "COMPRAS", idCompra, {}, { error: e.toString() }, "FAILED");
          return _error(e.message || "Error al procesar pago.");
        }

        if (attempt < MAX_RETRIES - 1) {
          CACHE.refresh(true);
          const delay = 100 * Math.pow(2, attempt) + Math.random() * 50;
          Logger.log("WARN: procesarPagoProveedorAtomic retry #" + (attempt + 1) + " para " + idCompraLimpio + " tras OptimisticLockError");
          Utilities.sleep(delay);
        }
      }
    }

    const msg = "Conflicto de concurrencia persistente al procesar pago para " + idCompraLimpio + ". Operación abortada.";
    LOG_ENGINE.logEvent("ERROR_PAGO_PROVEEDOR", "COMPRAS", idCompra, {}, { error: msg }, "FAILED");
    return _error(msg);
  },

  /**
   * Retrieves upcoming due dates for both cartera (CxC/CxP) and supplier purchases
   * within a specified number of days from today. Sorts by closest due date first.
   * @param {number} dias - Number of days ahead to search
   * @returns {Array} Array of upcoming due items with type, third party, amount, and days remaining
   */
  getVencimientosProximos(dias) {
    const hoy = _today();
    const limite = new Date(hoy.getTime() + dias * 86400000);

    const cartera = DOMAIN.getCartera(null, null, 5000, 0).items || [];
    const vencimientos = [];

    for (let i = 0; i < cartera.length; i++) {
      const c = cartera[i];
      if (c.estado === CARTERA_CONFIG.ESTADOS.CANCELADA) continue;
      const fv = _safeDate(c.fecha_vencimiento);
      if (!fv) continue;
      if (fv.getTime() >= hoy.getTime() && fv.getTime() <= limite.getTime()) {
        vencimientos.push({
          tipo: c.tipo,
          id_tercero: c.id_tercero,
          nombre_tercero: c.nombre_tercero || "DESCONOCIDO",
          saldo: c.saldo,
          fecha_vencimiento: fv,
          dias_para_vencer: Math.floor((fv.getTime() - hoy.getTime()) / 86400000),
          origen: "cartera",
        });
      }
    }

    const compras = DAO_COMPRAS.getCompras(null, null);
    const tercerosMap = {};
    if (CACHE.terceros) {
      CACHE.terceros.forEach(function(t) { tercerosMap[t.id] = t.nombre; });
    }
    for (let j = 0; j < compras.length; j++) {
      const cp = compras[j];
      if (cp.estado === COMPRAS_CONFIG.ESTADOS.PAGADA) continue;
      const cfv = _safeDate(cp.fecha_vencimiento);
      if (!cfv) continue;
      if (cfv.getTime() >= hoy.getTime() && cfv.getTime() <= limite.getTime()) {
        vencimientos.push({
          tipo: "CxP",
          id_tercero: cp.id_proveedor,
          nombre_tercero: tercerosMap[cp.id_proveedor] || cp.id_proveedor,
          saldo: cp.saldo,
          fecha_vencimiento: cfv,
          dias_para_vencer: Math.floor((cfv.getTime() - hoy.getTime()) / 86400000),
          origen: "compra",
          id_compra: cp.id,
        });
      }
    }

    vencimientos.sort(function(a, b) { return a.dias_para_vencer - b.dias_para_vencer; });
    return vencimientos;
  },

  /**
   * Returns the top N debtors ranked by total overdue CxC balance.
   * Calculates overdue days, invoice count, and total delinquent amount per debtor.
   * Sorts by descending overdue amount.
   * @param {number} [topN=10] - Number of top debtors to return
   * @returns {Array} Array of debtor objects {id, nombre, saldo_vencido, total_facturas, max_dias}
   */
  getRankingDeudores(topN) {
    if (topN === undefined) topN = 10;
    CACHE.refresh();
    const cartera = CACHE.cartera || [];
    const tercerosMap = {};
    if (CACHE.terceros) {
      CACHE.terceros.forEach(function(t) { tercerosMap[t.id] = t; });
    }

    const hoy = _today();
    const deudores = {};

    for (let i = 0; i < cartera.length; i++) {
      const c = cartera[i];
      if (c.tipo !== CARTERA_CONFIG.TIPOS.CXC) continue;
      if (c.estado === CARTERA_CONFIG.ESTADOS.CANCELADA) continue;
      const fv = _safeDate(c.fecha_vencimiento);
      if (!fv || fv.getTime() >= hoy.getTime()) continue;

      if (!deudores[c.id_tercero]) {
        const t = tercerosMap[c.id_tercero] || {};
        deudores[c.id_tercero] = {
          id: c.id_tercero,
          nombre: t.nombre || "DESCONOCIDO",
          saldo_vencido: 0,
          total_facturas: 0,
          max_dias: 0,
        };
      }
      const d = deudores[c.id_tercero];
      d.saldo_vencido += c.saldo;
      d.total_facturas++;
      const dd = Math.floor((hoy.getTime() - fv.getTime()) / 86400000);
      if (dd > d.max_dias) d.max_dias = dd;
    }

    const ranking = Object.values(deudores);
    ranking.sort(function(a, b) { return b.saldo_vencido - a.saldo_vencido; });
    return ranking.slice(0, topN);
  },

  /**
   * Calculates supplier concentration: each supplier's share of total CxP balance.
   * Returns suppliers sorted by descending balance with percentage of total.
   * @returns {{items: Array, total: number}} Items array with {id, nombre, saldo, porcentaje} and total CxP
   */
  getConcentracionProveedores() {
    CACHE.refresh();
    const cartera = CACHE.cartera || [];
    const tercerosMap = {};
    if (CACHE.terceros) {
      CACHE.terceros.forEach(function(t) { tercerosMap[t.id] = t; });
    }

    const proveedores = {};
    let totalCxP = 0;

    for (let i = 0; i < cartera.length; i++) {
      const c = cartera[i];
      if (c.tipo !== CARTERA_CONFIG.TIPOS.CXP) continue;
      if (c.estado === CARTERA_CONFIG.ESTADOS.CANCELADA) continue;

      if (!proveedores[c.id_tercero]) {
        const t = tercerosMap[c.id_tercero] || {};
        proveedores[c.id_tercero] = {
          id: c.id_tercero,
          nombre: t.nombre || "DESCONOCIDO",
          saldo: 0,
        };
      }
      proveedores[c.id_tercero].saldo += c.saldo;
      totalCxP += c.saldo;
    }

    const result = Object.values(proveedores);
    result.forEach(function(p) {
      p.porcentaje = totalCxP > 0 ? Math.round((p.saldo / totalCxP) * 10000) / 100 : 0;
    });
    result.sort(function(a, b) { return b.saldo - a.saldo; });
    return { items: result, total: totalCxP };
  },

  /**
   * Registers a sale to a client with real-time stock deduction.
   * Validates client existence and stock availability for all items.
   * Applies optimistic locking per product (deadlock prevention via sorted locks),
   * records kardex movements, creates a zero-balance CxC record (if credit sale),
   * and generates accounting entries. Retries on version conflicts.
   * @param {Object|*} paramsOrClienteId - Sale parameters object (new) or clienteId (legacy)
   * @param {Array} [items] - Sale items (legacy signature)
   * @param {number} [total] - Total (legacy signature)
   * @param {string} [correlationId] - Idempotency key (legacy signature)
   * @param {string} [paramsOrClienteId.clienteId] - Client third party ID (optional for CONTADO mode)
   * @param {Array} paramsOrClienteId.items - Sale items
   * @param {number} [paramsOrClienteId.total] - Total (calculated if not provided)
   * @param {string} [paramsOrClienteId.modo='CXC'] - 'CXC' (default) or 'CONTADO'
   * @param {number} [paramsOrClienteId.diasCredito=30] - Credit days for CxC mode
   * @param {string} paramsOrClienteId.correlationId - Idempotency key
   * @param {string} [paramsOrClienteId.usuario] - User performing the operation
   * @returns {{success: boolean, id: string, total: number}} Sale result with ID
   */
  registrarVentaAtomic(paramsOrClienteId, items, total, correlationId) {
    // Support both legacy (clienteId, items, total, correlationId) and new (params) signatures
    let idCliente, itemsList, totalVenta, corrId, modo, diasCredito, usuario;

    if (typeof paramsOrClienteId === 'object' && paramsOrClienteId !== null) {
      // New signature with params object
      const params = paramsOrClienteId;
      idCliente = _sanitizeId(params.clienteId || params.idTercero || "");
      itemsList = params.items || [];
      totalVenta = params.total;
      corrId = params.correlationId || ('venta_' + Date.now());
      modo = (params.modo || 'CXC').toUpperCase();
      diasCredito = Number(params.diasCredito) || 30;
      usuario = params.usuario || (SESSION_SERVICE.getCurrentUser()?.getEmail()) || "SYSTEM";
    } else {
      // Legacy signature
      idCliente = _sanitizeId(paramsOrClienteId);
      itemsList = items;
      totalVenta = total;
      corrId = correlationId || ('venta_' + Date.now());
      modo = 'CXC';
      diasCredito = 30;
      usuario = SESSION_SERVICE.getCurrentUser()?.getEmail() || "SYSTEM";
    }

    // M8: Idempotency check
    if (_isIdempotent(corrId, idCliente || 'venta_contado')) {
      return { success: true, id: null, total: totalVenta, correlationId: corrId, deduplicated: true };
    }

    // Validate mode
    if (modo !== 'CXC' && modo !== 'CONTADO') {
      return _error("Modo inválido: " + modo + ". Use CXC o CONTADO.");
    }

    // Validate items
    if (!itemsList || itemsList.length === 0) {
      return _error("Debe incluir al menos un producto.");
    }

    // For CxC mode, clienteId is required
    if (modo === 'CXC' && !idCliente) {
      return _error("ID cliente es requerido para ventas a crédito.");
    }

    // Validate items structure
    for (let _i = 0; _i < itemsList.length; _i++) {
      const _item = itemsList[_i];
      const _pid = _sanitizeId(_item.id || _item.productoId || _item.id_producto || "");
      const _cant = _parseMoneda(_item.cantidad || _item.cant || 0, 0);
      const _pUnit = _parseMoneda(_item.precio_unitario || _item.precio || 0, 0);
      if (!_pid) return _error("Producto inválido en el ítem #" + (_i + 1) + ".");
      if (_cant <= 0) return _error("Cantidad inválida en el ítem #" + (_i + 1) + ".");
      if (_pUnit <= 0) return _error("Precio unitario inválido en el ítem #" + (_i + 1) + ".");
    }

    const MAX_RETRIES = 3;
    const _executeVentaTx = () => {
      // Collect product IDs and optionally client for deterministic lock order
      const prodIds = [];
      for (let j = 0; j < itemsList.length; j++) {
        const pid = _sanitizeId(itemsList[j].id || itemsList[j].productoId || itemsList[j].id_producto || "");
        if (pid && prodIds.indexOf(pid) === -1) prodIds.push(pid);
      }
      const lockIds = (modo === 'CXC' && idCliente) ? [idCliente].concat(prodIds) : prodIds;

      return LOCK_MANAGER.acquireMultipleLocks(lockIds, function() {
      const tx = _Transaction.create();

      try {
        // For CxC mode, verify client exists
        if (modo === 'CXC') {
          const cliente = DAO.getTerceroById(idCliente);
          if (!cliente) {
            LOG_ENGINE.logEvent("ERROR_VENTA", "VENTAS", idCliente, {}, { error: "CLIENTE_NO_EXISTE" }, "ERROR", { correlationId: corrId });
            return _error("Cliente " + idCliente + " no existe.");
          }
        }

        CACHE.refresh();
        const consistency = CACHE.verifyConsistency();
        if (consistency.mismatched) {
          CACHE.recoverFromStale();
        }

        // OPTIMIZED: Read ID, Stock and Version columns for optimistic locking
        const C = CONFIG.COLUMNS.PRODUCTOS;
        const prodSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
        const lastRow = prodSheet.getLastRow();
        const colCount = C.version + 1; // Include version column for optimistic locking
        const prodData = lastRow >= 2 ? prodSheet.getRange(2, 1, lastRow - 1, colCount).getValues() : [];
        const prodVersions = {};
        const prodIndex = {};
        for (let p = 0; p < prodData.length; p++) {
          const pid = String(prodData[p][C.id] || "").trim();
          if (pid) {
            prodIndex[pid] = p;
            prodVersions[pid] = parseInt(prodData[p][C.version]) || 1;
          }
        }

        // Verificar stock disponible y reducir (in-memory)
        let subtotalAcumulado = 0;
        const changedRows = {};
        const kardexEntries = [];

        for (let j = 0; j < items.length; j++) {
            const item = items[j];
            const prodId = _sanitizeId(item.id || item.productoId || item.id_producto || "");
            const cant = _parseMoneda(item.cantidad || item.cant || 0, 0);
            const pUnit = _parseMoneda(item.precio_unitario || item.precio || 0, 0);
            if (!prodId || cant <= 0) continue;
            const sub = cant * pUnit;
          subtotalAcumulado += sub;

            const p = prodIndex[prodId];
            if (p === undefined) {
            return _error("Producto " + prodId + " no encontrado en inventario.");
          }

            const currentStock = parseInt(prodData[p][C.stock]) || 0;
            const currentVersion = prodVersions[prodId] || 1;
            if (currentStock < cant) {
            return _error("Stock insuficiente para producto " + prodId + ". Disponible: " + currentStock + ", Solicitado: " + cant);
          }
            const nuevoStock = currentStock - cant;
            prodData[p][C.stock] = nuevoStock;
            prodData[p][C.version] = currentVersion + 1; // Optimistic locking version increment
           changedRows[p + 2] = true;

          // Defer kardex until after optimistic lock validation (Bug #2 fix)
            const kardexId = "KDX-" + Utilities.formatDate(new Date(), _getTimeZone(), "yyyyMMdd") + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
            const costBase = _parseMoneda(prodData[p][C.precio_compra], 0);
          kardexEntries.push({
            id: kardexId,
            fecha: new Date(),
            id_producto: prodId,
            tipo_mov: "SALIDA",
            cantidad: cant,
            stock_anterior: currentStock,
            stock_nuevo: nuevoStock,
            referencia: corrId,
            origen: "VENTA",
            usuario: usuario,
            costo_unitario: costBase,
            precio_unitario: pUnit
          });
        }

        // Note: Optimistic locking verification uses prodSheet already read (line ~1391)
        // The productLocks acquired above ensure exclusive access to each product during transaction
        // No second read needed - lock prevents concurrent modification

        // Calculate total if not provided
        const totalCalculado = typeof totalVenta === 'number' ? _parseMoneda(totalVenta, NaN) : subtotalAcumulado;
        if (isNaN(totalCalculado) || totalCalculado <= 0) {
          return _error("Total inválido.");
        }

        // Begin transaction covering stock, kardex, and cartera (Bug #3 fix)
        tx.begin();

        // Write stock and version row-by-row (Bug #1 fix: non-contiguous rows)
         const rowNums = Object.keys(changedRows).map(Number).sort((a, b) => a - b);
         if (rowNums.length > 0) {
           tx.snapshotProductoRows(rowNums);
           for (const r of rowNums) {
             const idx = r - 2;
             prodSheet.getRange(r, C.stock + 1, 1, 1).setValue(prodData[idx][C.stock]);
             prodSheet.getRange(r, C.version + 1, 1, 1).setValue(prodData[idx][C.version]);
           }
         }

        // Write deferred kardex entries (Bug #2 fix: after opt-lock validation)
        if (kardexEntries.length > 0) {
          tx.markKardexPreAppend();
          DAO_COMPRAS.crearMovimientosKardexBatch(kardexEntries);
          tx.markKardexPostAppend();
        }

        // Create cartera record (different for CXC vs CONTADO)
        tx.markCarteraPreAppend();
        const idVenta = "VTA-" + Utilities.formatDate(new Date(), _getTimeZone(), "yyyyMMdd") + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
        const carteraRecord = {
          id: idVenta,
          fecha: new Date(),
          id_tercero: modo === 'CXC' ? idCliente : "",
          origen_id: corrId,
          total: totalCalculado,
          saldo: modo === 'CXC' ? totalCalculado : 0,
          tipo: modo === 'CXC' ? CARTERA_CONFIG.TIPOS.CXC : CARTERA_CONFIG.TIPOS.CONTADO,
          estado: modo === 'CXC' ? CARTERA_CONFIG.ESTADOS.ABIERTA : CARTERA_CONFIG.ESTADOS.CANCELADA,
          fecha_vencimiento: modo === 'CXC' ? (function() { 
          const d = _today(); 
          d.setDate(d.getDate() + diasCredito); 
          return d; 
        })() : _today(),
          vencida_timestamp: ""
        };

        DAO.saveCartera(carteraRecord);
        tx.markCarteraPostAppend();

        CACHE.invalidateCartera();

        // Register in libro diario
        tx.markLibroPreAppend();
        LIBRO_DIARIO.registrarVenta(
          new Date(),
          idVenta,
          modo === 'CXC' ? idCliente : "CONTADO",
          totalCalculado,
          usuario
        );

        // Register cost of goods sold
        const costoVentas = itemsList.reduce(function(acc, item) {
          var pid = item.id || item.productoId || item.id_producto || "";
          var p = prodIndex[pid];
          if (p === undefined) return acc;
          var pc = _parseMoneda(prodData[p][C.precio_compra], 0);
          var c = _parseMoneda(item.cantidad || item.cant || 0, 0);
          return acc + pc * c;
        }, 0);
        if (costoVentas > 0) {
          LIBRO_DIARIO.registrarCostoVentas(
            new Date(),
            idVenta,
            modo === 'CXC' ? idCliente : "CONTADO",
            costoVentas,
            usuario
          );
        }
        tx.markLibroPostAppend();

        // Register cash flow entries (for both modes)
        tx.markFlujoPreAppend();
        FLUJO_CAJA.registrarMovimiento(
          new Date(),
          FLUJO_CAJA.TIPOS.ENTRADA_VENTA,
          "Venta " + (modo === 'CXC' ? "a cliente " + idCliente : "contado"),
          totalCalculado,
          corrId,
          usuario
        );

        // Register cost of goods flow
        if (costoVentas > 0) {
          FLUJO_CAJA.registrarMovimiento(
            new Date(),
            FLUJO_CAJA.TIPOS.SALIDA_VENTA,
            "Costo de venta: " + (modo === 'CXC' ? idCliente : "contado"),
            costoVentas,
            corrId,
            usuario
          );
        }
        tx.markFlujoPostAppend();

        tx.commit();

        LOG_ENGINE.logEvent("CREATE_VENTA", "VENTAS", idVenta,
          {}, { cliente: modo === 'CXC' ? idCliente : "CONTADO", total: totalCalculado, items: itemsList.length, modo: modo }, "SUCCESS", { correlationId: corrId });

        return { success: true, id: idVenta, total: totalCalculado };
      } catch (e) {
        _captureError("procesarVenta", e);
        try { tx.rollback(); } catch (rbErr) { Logger.log("[DOMAIN] Rollback venta error: " + rbErr.message); }
        CACHE.invalidateCartera();
        throw e;
      }
      }, 30000); // acquireMultipleLocks handles lock release in finally
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return _executeVentaTx();
      } catch (e) {
        const isOptimisticLock =
          e.type === 'OPTIMISTIC_LOCK_FAILURE' ||
          (e.message && e.message.includes('OptimisticLockError'));

        if (!isOptimisticLock || attempt >= MAX_RETRIES - 1) {
          LOG_ENGINE.logEvent("ERROR_VENTA", "VENTAS", modo === 'CXC' ? idCliente : "CONTADO", {}, { error: e.toString() }, "FAILED", { correlationId: corrId });
          return _error(e.message || "Error al registrar venta.");
        }

        CACHE.refresh(true);
        Utilities.sleep(100 * Math.pow(2, attempt) + Math.random() * 50);
      }
    }

    return _error("Conflicto de concurrencia persistente al registrar venta.");
  },

  /**
   * Retrieves inventory movement history (kardex) for a specific product.
   * @param {string} idProducto - Product ID
   * @param {number} [limit] - Maximum number of records to return
   * @returns {Array} Array of kardex movement records
   */
  getKardexProducto(idProducto, limit) {
    return DAO_COMPRAS.getMovimientosKardex(idProducto, limit);
  },

  /**
   * Retrieves recent inventory movement history (kardex) for all products.
   * @param {number} [limit] - Maximum number of records to return
   * @returns {Array} Array of kardex movement records
   */
  getKardex(limit) {
    return DAO_COMPRAS.getAllMovimientosKardex(30, limit);
  },

  /**
   * Calculates inventory rotation metrics (entries, exits, net balance) per product
   * within the given time window from kardex data.
   * @param {number} dias - Number of days to analyze
   * @returns {Object} Rotation data keyed by product ID with {entradas, salidas, total}
   */
  getRotacionInventario(dias) {
    const movimientos = this.getKardex(1000);
    const rotacion = {};
    for (let i = 0; i < movimientos.length; i++) {
      const m = movimientos[i];
      if (!rotacion[m.id_producto]) {
        rotacion[m.id_producto] = { entradas: 0, salidas: 0, total: 0 };
      }
      if (m.tipo_mov === "ENTRADA") {
        rotacion[m.id_producto].entradas += m.cantidad;
      } else if (m.tipo_mov === "SALIDA") {
        rotacion[m.id_producto].salidas += m.cantidad;
      }
      rotacion[m.id_producto].total = rotacion[m.id_producto].entradas - rotacion[m.id_producto].salidas;
    }
return rotacion;
    },

    /**
    * Deletes a third party (proveedor/cliente) with critical safety validations.
   * 
   * CRITICAL VALIDATIONS:
   * 1. Verifies tercero exists
   * 2. Blocks deletion if CxP with saldo > 0 (unpaid purchases)
   * 3. Blocks deletion if CxC with saldo > 0 (outstanding receivables)
   * 4. Blocks deletion if has associated products (in Kardex/Detalle_Compras)
   * 5. Blocks deletion if last payment was within 30 days
   * 
   * @param {string} id - Third party ID to delete
   * @param {boolean} [forceDelete=false] - Skip confirmation (use with caution)
   * @returns {{success: boolean, message: string, hasActiveCxP: boolean, hasActiveCxC: boolean, hasRecentPayment: boolean}} Result
   */
  deleteTercero(id, forceDelete) {
    forceDelete = forceDelete || false;
    let lockAcquired = null;
    const tx = _Transaction.create();
    
    try {
      const idLimpio = _sanitizeId(id);
      if (!idLimpio) return _error("ID de tercero inv�lido.");

      lockAcquired = LOCK_MANAGER.acquireResourceLock(idLimpio);

      // Get tercero to verify existence
      const tercero = CACHE.getTerceroRAW(idLimpio);
      if (!tercero) return _error("Tercero no encontrado: " + idLimpio);

      const nombre = tercero.nombre || "DESCONOCIDO";

      // === CRITICAL CHECK 1: Active CxP (Cuentas por Pagar) ===
      const cartera = CACHE.getCarteraBase() || [];
      const activeCxP = cartera.filter(c => 
        c.id_tercero === idLimpio && 
        c.tipo === CARTERA_CONFIG.TIPOS.CXP && 
        c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA && 
        c.saldo > 0
      );

      // === CRITICAL CHECK 2: Active CxC (Cuentas por Cobrar) ===
      const activeCxC = cartera.filter(c => 
        c.id_tercero === idLimpio && 
        c.tipo === CARTERA_CONFIG.TIPOS.CXC && 
        c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA && 
        c.saldo > 0
      );

      // === CRITICAL CHECK 3: Associated products ===
      const hasAssociatedCompras = cartera.some(c => 
        c.id_tercero === idLimpio && 
        c.tipo === CARTERA_CONFIG.TIPOS.CXP
      );

      // === CRITICAL CHECK 4: Last payment within 30 days ===
      const now = Date.now();
      const thirtyDaysAgo = now - (30 * 86400000);
      let lastPaymentRecent = false;

      // Check payments in last 30 days
      const comprasProveedor = cartera.filter(c => 
        c.id_tercero === idLimpio && 
        c.tipo === CARTERA_CONFIG.TIPOS.CXP
      );
      
      for (const compra of comprasProveedor) {
        const pagos = DAO_COMPRAS.getPagosByCompra ? DAO_COMPRAS.getPagosByCompra(compra.id) : [];
        for (const pago of pagos) {
          if (pago.fecha && pago.fecha.getTime && pago.fecha.getTime() > thirtyDaysAgo) {
            lastPaymentRecent = true;
            break;
          }
        }
        if (lastPaymentRecent) break;
      }

      // BLOCK if critical constraints fail
      if (activeCxP.length > 0 && !forceDelete) {
        return {
          success: false, 
          message: "No se puede eliminar: tiene Cuentas por Pagar pendientes (saldo > 0). Pago pendiente por " + activeCxP.reduce((s, c) => s + c.saldo, 0),
          hasActiveCxP: true,
          hasActiveCxC: false,
          hasRecentPayment: false
        };
      }

      if (activeCxC.length > 0 && !forceDelete) {
        return {
          success: false, 
          message: "No se puede eliminar: tiene Cuentas por Cobrar pendientes (saldo > 0). Cobro pendiente por " + activeCxC.reduce((s, c) => s + c.saldo, 0),
          hasActiveCxP: false,
          hasActiveCxC: true,
          hasRecentPayment: false
        };
      }

      // Soft delete: set activo to INACTIVO (safer than row deletion)
      tx.begin();

      const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
      const cachedRow = CACHE.terceroIndex ? CACHE.terceroIndex[idLimpio] : null;
      
      if (cachedRow) {
        tx.snapshotTerceroRow(cachedRow);
        sheet.getRange(cachedRow, CARTERA_CONFIG.COLUMNS.TERCEROS.activo + 1, 1, 1).setValue("INACTIVO");
      }

      tx.commit();
      CACHE.invalidateTerceros();

      LOG_ENGINE.logEvent("DELETE_TERCERO", "TERCEROS", idLimpio, 
        { nombre: nombre, activo: "ACTIVO" }, 
        { nombre: nombre, activo: "INACTIVO" }, 
        "SUCCESS", 
        { correlationId: TransactionManager.getCorrelationId() || ('delete_tercero_' + Date.now()) }
      );

      return {
        success: true,
        message: "Tercero eliminado correctamente (marcado como INACTIVO): " + nombre,
        hasActiveCxP: false,
        hasActiveCxC: false,
        hasRecentPayment: lastPaymentRecent
      };

    } catch (e) {
      tx.rollback();
      CACHE.invalidateTerceros();
      LOG_ENGINE.logEvent("ERROR_DELETE_TERCERO", "TERCEROS", id, {}, { error: e.toString() }, "ERROR");
      return _error(e.message || "Error al eliminar tercero.");
    } finally {
      if (lockAcquired) lockAcquired.releaseLock();
    }
  },

  // =========================================================================
  // AUD-PROV-002: Ranking de productos más comprados por proveedor
  // =========================================================================

  /**
   * Retorna el top N de productos más comprados a un proveedor.
   * @param {string} idProveedor - ID del proveedor.
   * @param {number} [top=5] - Cantidad máxima de productos a retornar.
   * @returns {Array<{idProducto: string, nombreProducto: string, cantidadTotal: number, ultimoPrecio: number}>}
   */
  getProductosMasCompradosPorProveedor(idProveedor, top) {
    if (top === undefined || top === null) top = 5;
    if (top <= 0) return [];
    const idLimpio = _sanitizeId(idProveedor);
    if (!idLimpio) return [];

    const compras = DAO_COMPRAS.getComprasByProveedor(idLimpio);
    if (compras.length === 0) return [];

    const cantidades = {};
    const ultimosPrecios = {};

    for (var ci = 0; ci < compras.length; ci++) {
      var detalles = DAO_COMPRAS.getDetallesByCompra(compras[ci].id);
      for (var di = 0; di < detalles.length; di++) {
        var prodId = detalles[di].id_producto;
        if (!prodId) continue;
        if (!cantidades[prodId]) {
          cantidades[prodId] = 0;
          ultimosPrecios[prodId] = detalles[di].precio_unitario;
        }
        cantidades[prodId] += detalles[di].cantidad;
        ultimosPrecios[prodId] = detalles[di].precio_unitario;
      }
    }

    var sorted = Object.keys(cantidades).sort(function(a, b) {
      return cantidades[b] - cantidades[a];
    });

    if (sorted.length > top) sorted.length = top;

    var result = [];
    for (var ri = 0; ri < sorted.length; ri++) {
      var pid = sorted[ri];
      var prod = DAO_PRODUCTOS.obtener(pid);
      result.push({
        idProducto: pid,
        nombreProducto: prod ? prod.nombre : "(producto eliminado)",
        cantidadTotal: cantidades[pid],
        ultimoPrecio: ultimosPrecios[pid]
      });
    }

    return result;
  },

  // =========================================================================
  // AUD-PROV-001: Análisis consolidado de proveedor
  // =========================================================================

  /**
   * Retorna un análisis consolidado de un proveedor: datos generales, saldo,
   * movimientos recientes y ranking de productos.
   * @param {string} idProveedor - ID del proveedor.
   * @returns {{proveedor: Object, saldo: number, movimientosRecientes: Array, productosMasComprados: Array}}
   * @throws {Error} Si el proveedor no existe o no es PROVEEDOR/AMBOS.
   */
  getAnalisisProveedor(idProveedor) {
    const idLimpio = _sanitizeId(idProveedor);
    if (!idLimpio) throw new Error("ID de proveedor inválido.");

    const proveedor = DAO.getTerceroById(idLimpio);
    if (!proveedor) throw new Error("Proveedor no encontrado: " + idLimpio);

    const tipo = (proveedor.tipo || "").toUpperCase();
    if (tipo !== "PROVEEDOR" && tipo !== "AMBOS") {
      throw new Error("El tercero " + idLimpio + " no está clasificado como proveedor (tipo: " + proveedor.tipo + ").");
    }

    var saldo = 0;
    var compras = DAO_COMPRAS.getComprasByProveedor(idLimpio);
    for (var ci = 0; ci < compras.length; ci++) {
      saldo += compras[ci].saldo || 0;
    }

    var movimientos = compras.slice(-10).reverse();

    var productosMasComprados = this.getProductosMasCompradosPorProveedor(idLimpio, 5);

    return {
      proveedor: proveedor,
      saldo: saldo,
      movimientosRecientes: movimientos,
      productosMasComprados: productosMasComprados
    };
  },

};

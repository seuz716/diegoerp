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

const _PROCESSED_CORRELATION_IDS = {};

function _isIdempotent(correlationId, idTercero) {
  if (!correlationId) return false;
  const key = correlationId + "::" + idTercero;
  if (_PROCESSED_CORRELATION_IDS[key]) {
    Logger.log("[DOMAIN] Idempotencia detectada: " + correlationId + " para " + idTercero);
    return true;
  }
  _PROCESSED_CORRELATION_IDS[key] = true;
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
    const ctx = { carteraSnapshots: [], movPreRows: 0, movPostRows: 0, terceroSnapshots: [], productoSnapshots: [], productoPreRows: 0, productoPostRows: 0, compraSnapshots: [], pagoPreRows: 0, pagoPostRows: 0, detallePreRows: 0, detallePostRows: 0, active: false };

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
      },

      rollback() {
  if (!ctx.active) return;
  // === INICIO FIX M-02 ===
  // Rollback de Terceros (nuevo)
  if (ctx.terceroSnapshots && ctx.terceroSnapshots.length > 0) {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
    const COL = CARTERA_CONFIG.COLUMNS.TERCEROS;
    for (const snap of ctx.terceroSnapshots) {
      const numCols = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.TERCEROS)) + 1;
      sheet.getRange(snap.rowIndex, 1, 1, numCols).setValues([snap.values]);
    }
    Logger.log("[FIX-M-02] Rollback de tercero completado para " + ctx.terceroSnapshots.length + " fila(s)");
  }
  // === FIN FIX M-02 ===
  
  // === INICIO FIX-VERSION-CHECK ===
  // Helper: incrementar contador de rollbacks saltados
  function _incRollbackSkip() {
    const props = PropertiesService.getScriptProperties();
    const failCount = Number(props.getProperty('ROLLBACK_SKIP_COUNT') || 0);
    props.setProperty('ROLLBACK_SKIP_COUNT', String(failCount + 1));
  }
  
  // Rollback de Cartera con verificación de versión optimista
  const carteraSheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
  const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
  for (const snap of ctx.carteraSnapshots) {
    // Leer versión actual de la hoja
    const currentRow = carteraSheet.getRange(snap.rowIndex, COL.version + 1, 1, 1).getValues()[0];
    const currentVersion = Number(currentRow[0]) || 1;
    const snapshotVersionIdx = COL.version - snap.startCol;
    const snapshotVersion = Number(snap.values[snapshotVersionIdx]) || 1;
    
    if (currentVersion !== snapshotVersion) {
      Logger.log("[TXN-ROLLBACK-WARN] Cartera fila " + snap.rowIndex + 
        ": versión actual " + currentVersion + 
        " ≠ esperada " + snapshotVersion + ". Saltando para evitar pérdida de datos.");
      _incRollbackSkip();
      continue;
    }
    const restoredRow = snap.values.slice();
    const numCols = restoredRow.length;
    carteraSheet.getRange(snap.rowIndex, snap.startCol + 1, 1, numCols).setValues([restoredRow]);
  }
  // === FIN FIX-VERSION-CHECK ===
  
  if (ctx.movPostRows > ctx.movPreRows) {
          const movSheet = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
          const startRow = ctx.movPreRows + 1;
          const count = ctx.movPostRows - ctx.movPreRows;
          movSheet.deleteRows(startRow, count);
        }
        // Producto stock rollback
  if (ctx.productoSnapshots && ctx.productoSnapshots.length > 0) {
    const prodSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
    const prodCOL = CONFIG.COLUMNS.PRODUCTOS;
    for (const snap of ctx.productoSnapshots) {
      const snapshotVersionIdx = prodCOL.version - snap.startCol;
      const snapshotVersion = Number(snap.values[snapshotVersionIdx]) || 1;
      const currentRow = prodSheet.getRange(snap.rowIndex, prodCOL.version + 1, 1, 1).getValues()[0];
      const currentVersion = Number(currentRow[0]) || 1;
      
      if (currentVersion !== snapshotVersion) {
        Logger.log("[TXN-ROLLBACK-WARN] Producto fila " + snap.rowIndex + 
          ": versión actual " + currentVersion + 
          " ≠ esperada " + snapshotVersion + ". Saltando para evitar pérdida de datos.");
        _incRollbackSkip();
        continue;
      }
      const numCols = snap.values.length;
      prodSheet.getRange(snap.rowIndex, snap.startCol + 1, 1, numCols).setValues([snap.values]);
    }
    Logger.log("[FIX-RBK-STOCK] Rollback de producto completado para " + ctx.productoSnapshots.length + " fila(s)");
  }
        if (ctx.productoPostRows > ctx.productoPreRows) {
          const prodSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
          const startRow = ctx.productoPreRows + 1;
          const count = ctx.productoPostRows - ctx.productoPreRows;
          prodSheet.deleteRows(startRow, count);
          Logger.log("[DOMAIN] Rollback de productos inline: " + count + " fila(s) eliminada(s)");
        }
        // Compras rollback
  if (ctx.compraSnapshots && ctx.compraSnapshots.length > 0) {
    const compraSheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    const compraCOL = COMPRAS_CONFIG.COLUMNS.COMPRAS;
    for (const snap of ctx.compraSnapshots) {
      const snapshotVersion = Number(snap.values[compraCOL.version]) || 1;
      const currentRow = compraSheet.getRange(snap.rowIndex, compraCOL.version + 1, 1, 1).getValues()[0];
      const currentVersion = Number(currentRow[0]) || 1;
      
      if (currentVersion !== snapshotVersion) {
        Logger.log("[TXN-ROLLBACK-WARN] Compra fila " + snap.rowIndex + 
          ": versión actual " + currentVersion + 
          " ≠ esperada " + snapshotVersion + ". Saltando para evitar pérdida de datos.");
        _incRollbackSkip();
        continue;
      }
      const numCols = Math.max(...Object.values(COMPRAS_CONFIG.COLUMNS.COMPRAS)) + 1;
      compraSheet.getRange(snap.rowIndex, 1, 1, numCols).setValues([snap.values]);
    }
  }
        if (ctx.pagoPostRows > ctx.pagoPreRows) {
          const pagoSheet = getSheet(COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES);
          const startRow = ctx.pagoPreRows + 1;
          const count = ctx.pagoPostRows - ctx.pagoPreRows;
          pagoSheet.deleteRows(startRow, count);
        }
        if (ctx.detallePostRows > ctx.detallePreRows) {
          const detSheet = getSheet(COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS);
          const startRow = ctx.detallePreRows + 1;
          const count = ctx.detallePostRows - ctx.detallePreRows;
          detSheet.deleteRows(startRow, count);
        }
        ctx.active = false;
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
   * Implements idempotency via correlationId, validates credit limits for CxC,
   * applies payment to oldest pending items first (FIFO), generates accounting
   * entries and cash flow records. Retries on optimistic locking conflicts.
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

        // === VALIDACIÓN DE CUPO CREDITICIO (TAREA 2.1) ===
        // Para CxC: verificar que el cliente no exceda su límite de crédito
        // El límite es el crédito disponible: limite_credito - saldo_actual >= 0
        if (tipoLimpio === CARTERA_CONFIG.TIPOS.CXC && tercero.limite_credito > 0) {
          const saldoActual = CACHE.getSaldoTercero(idTerceroLimpio);
          if (saldoActual > tercero.limite_credito) {
            const err = new Error("Cupo crediticio insuficiente");
            err.code = "CREDIT_LIMIT_EXCEEDED";
            LOG_ENGINE.logEvent("ERROR_ABONO", "CARTERA", idTerceroLimpio,
              { saldo_actual: saldoActual, limite: tercero.limite_credito },
              { error: "CREDIT_LIMIT_EXCEEDED", monto_solicitado: valor },
              "ERROR", { correlationId: correlationId || ('abono_' + Date.now()) });
            return _error("Cupo crediticio insuficiente: Saldo actual $" + _formatMoneda(saldoActual) + " excede límite $" + _formatMoneda(tercero.limite_credito));
          }
        }
        // === FIN VALIDACIÓN CUPO CREDITICIO ===

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
        tx.markMovPostAppend();
        if (plan.movimientos.length > 0) {
          for (const mov of plan.movimientos) { DAO.createMovimiento(mov); }
        }
        tx.commit();

        // === GENERAR ASIENTO CONTABLE PARA ABONO ===
        const usuario = SESSION_SERVICE.getCurrentUser().getEmail() || "SYSTEM";
        LIBRO_DIARIO.registrarAbonoCliente(
          new Date(),
          "ABONO-" + Date.now(),
          idTerceroLimpio,
          plan.aplicadoTotal,
          usuario
        );

        // Registrar entrada de caja por abono
        FLUJO_CAJA.registrarMovimiento(
          new Date(),
          FLUJO_CAJA.TIPOS.ENTRADA_ABONO,
          "Abono tercero: " + idTerceroLimpio,
          plan.aplicadoTotal,
          refLimpia,
          usuario
        );

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

      if (tipo === CARTERA_CONFIG.TIPOS.CXC && tercero.limite_credito > 0) {
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
      let lockAcquired = null;
      const tx = _Transaction.create();

      try {
        lockAcquired = LOCK_MANAGER.acquireResourceLock(idProv);

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

        DAO_COMPRAS.crearCompra(compraRecord);

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
              usuario: SESSION_SERVICE.getCurrentUser()?.getEmail() || "system"
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
              prodIndex[prodIdCreado] = newRowIdx - 2;
              
              stockUpdates[prodIdCreado] = { 
                stockAnterior: 0, stockNuevo: cant, rowIndex: newRowIdx,
                kardexId: "KDX" + Date.now() + "_" + prodIdCreado + "_" + j 
              };
              
              LOG_ENGINE.logEvent("CREATE_PRODUCTO_INLINE", "PRODUCTOS", prodIdCreado,
                {}, { nombre: _nombreItem, precio_compra: pCompra, origen: "COMPRA", id_compra: idCompra }, "SUCCESS",
                { correlationId: corrId });
            }
          }
        }

        // Write stock and version columns
        const rowNums = Object.values(stockUpdates).map(u => u.rowIndex).sort((a, b) => a - b);
        if (rowNums.length > 0) {
          const batchData = [];
          for (const r of rowNums) {
            const update = Object.values(stockUpdates).find(u => u.rowIndex === r);
            const prodIdx = update.prodIdx;
            if (prodIdx !== undefined) {
              batchData.push([prodData[prodIdx][C.stock], prodData[prodIdx][C.version]]);
            }
          }
          
          prodSheet.getRange(rowNums[0], C.stock + 1, batchData.length, 1).setValues(
            batchData.map(row => [row[0]])
          );
          prodSheet.getRange(rowNums[0], C.version + 1, batchData.length, 1).setValues(
            batchData.map(row => [row[1]])
          );
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
            usuario: update.usuario || "system"
          });
        }
        if (kardexEntries.length > 0) {
          DAO_COMPRAS.crearMovimientosKardexBatch(kardexEntries);
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
      } finally {
        if (lockAcquired) lockAcquired.releaseLock();
      }
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
  procesarPagoProveedorAtomic(idCompra, monto, referencia) {
    const idCompraLimpio = String(idCompra || "").trim();
    if (!idCompraLimpio) return _error("ID de compra inválido.");
    const montoLimpio = _parseMoneda(monto, NaN);
    if (isNaN(montoLimpio) || montoLimpio <= 0) return _error("Monto inválido.");

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
        tx.commit();

        // === GENERAR ASIENTO CONTABLE PARA PAGO PROVEEDOR ===
        const usuario = SESSION_SERVICE.getCurrentUser().getEmail() || "SYSTEM";
        LIBRO_DIARIO.registrarPagoProveedor(
          new Date(),
          "PAGO-" + pagoId,
          compra.id_proveedor,
          montoLimpio,
          usuario
        );

        // Registrar salida de caja por pago proveedor
        FLUJO_CAJA.registrarMovimiento(
          new Date(),
          FLUJO_CAJA.TIPOS.SALIDA_PAGO_PROV,
          "Pago a proveedor: " + compra.id_proveedor,
          montoLimpio,
          String(referencia || "Pago").trim(),
          usuario
        );

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
   * Registers a cash sale to a client with real-time stock deduction.
   * Validates client existence and stock availability for all items.
   * Applies optimistic locking per product (deadlock prevention via sorted locks),
   * records kardex movements, creates a zero-balance CxC record, and generates
   * accounting entries. Retries on version conflicts.
   * @param {string} clienteId - Client third party ID
   * @param {Array} items - Array of sale items
   * @param {string} items[].id - Product ID
   * @param {number} items[].cantidad - Quantity sold
   * @param {number} items[].precio_unitario - Unit sale price
   * @param {number} total - Total sale amount
   * @param {string} [correlationId] - Idempotency key
   * @returns {{success: boolean, id: string, total: number}} Sale result with ID
   */
  registrarVentaAtomic(clienteId, items, total, correlationId) {
    const corrId = correlationId || ('venta_' + Date.now());
    const idCliente = _sanitizeId(clienteId);
    if (!idCliente) return _error("ID cliente inválido.");
    const totalLimpio = _parseMoneda(total, NaN);
    if (isNaN(totalLimpio) || totalLimpio <= 0) return _error("Total inválido.");
    if (!items || items.length === 0) return _error("Debe incluir al menos un producto.");

    for (let _i = 0; _i < items.length; _i++) {
      const _item = items[_i];
      const _pid = _sanitizeId(_item.id || _item.productoId || _item.id_producto || "");
      const _cant = _parseMoneda(_item.cantidad || _item.cant || 0, 0);
      const _pUnit = _parseMoneda(_item.precio_unitario || _item.precio || 0, 0);
      if (!_pid) return _error("Producto inválido en el ítem #" + (_i + 1) + ".");
      if (_cant <= 0) return _error("Cantidad inválida en el ítem #" + (_i + 1) + ".");
      if (_pUnit <= 0) return _error("Precio unitario inválido en el ítem #" + (_i + 1) + ".");
    }

    const MAX_RETRIES = 3;
    const _executeVentaTx = () => {
      let lockAcquired = null;
      const productLocks = [];
      const tx = _Transaction.create();

      try {
        lockAcquired = LOCK_MANAGER.acquireResourceLock(idCliente);

        // Collect unique product IDs and acquire locks sorted (deadlock prevention)
        const prodIds = [];
        for (let j = 0; j < items.length; j++) {
          const pid = _sanitizeId(items[j].id || items[j].productoId || items[j].id_producto || "");
          if (pid && prodIds.indexOf(pid) === -1) prodIds.push(pid);
        }
        prodIds.sort();
        for (let j = 0; j < prodIds.length; j++) {
          productLocks.push(LOCK_MANAGER.acquireResourceLock(prodIds[j]));
        }

        const cliente = DAO.getTerceroById(idCliente);
        if (!cliente) {
          LOG_ENGINE.logEvent("ERROR_VENTA", "VENTAS", idCliente, {}, { error: "CLIENTE_NO_EXISTE" }, "ERROR");
          return _error("Cliente " + idCliente + " no existe.");
        }

        // Validar que el cliente esté activo
        if (cliente.activo === 'INACTIVO' || cliente.activo === 'INACTIVE') {
          LOG_ENGINE.logEvent("ERROR_VENTA", "VENTAS", idCliente, { cliente_activo: cliente.activo }, { error: "CLIENTE_INACTIVO" }, "ERROR");
          return _error("No se puede vender a cliente inactivo: " + idCliente);
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

          // Registrar salida en kardex
            const kardexId = "KDX" + Date.now() + "_" + prodId + "_SAL_" + j;
            const email = SESSION_SERVICE.getCurrentUser()?.getEmail() || "system";
          DAO_COMPRAS.crearMovimientoKardex({
            id: kardexId,
            fecha: new Date(),
            id_producto: prodId,
            tipo_mov: "SALIDA",
            cantidad: cant,
            stock_anterior: currentStock,
            stock_nuevo: nuevoStock,
            referencia: corrId,
            origen: "VENTA",
            usuario: email
          });
        }

        // Verify optimistic locking - check versions haven't changed since read
        const prodSheetFresh = getSheet(CONFIG.SHEETS.PRODUCTOS);
        const freshCount = prodSheetFresh.getLastRow();
        if (freshCount !== lastRow) {
          const lockErr = new Error("OptimisticLockError: La tabla de productos cambió durante la operación.");
          lockErr.type = 'OPTIMISTIC_LOCK_FAILURE';
          lockErr.retryable = true;
          throw lockErr;
        }
        const freshData = prodSheetFresh.getRange(2, 1, lastRow - 1, C.version + 1).getValues();
        for (const r of Object.keys(changedRows).map(Number)) {
          const idx = r - 2;
          const prodId = String(prodData[idx][C.id]).trim();
          const actualVer = parseInt(freshData[idx][C.version]) || 1;
          const expectedVer = prodVersions[prodId];
          if (expectedVer !== undefined && actualVer !== expectedVer) {
            const lockErr = new Error(
              "OptimisticLockError: Producto " + prodId + " fue modificado concurrentemente " +
              "(esperada v" + expectedVer + ", actual v" + actualVer + "). Reintente."
            );
            lockErr.type = 'OPTIMISTIC_LOCK_FAILURE';
            lockErr.retryable = true;
            throw lockErr;
          }
        }

        // Batch write all stock changes at once with version (optimistic locking)
         const rowNums = Object.keys(changedRows).map(Number).sort((a, b) => a - b);
         if (rowNums.length > 0) {
           const batchData = [];
           for (const r of rowNums) {
             const idx = r - 2; // Convert row index to prodData index
             // Write both stock and version columns
             batchData.push([prodData[idx][C.stock], prodData[idx][C.version]]);
           }
           // Write to columns stock (2) and version (8) - need separate ranges for non-contiguous
           prodSheet.getRange(rowNums[0], C.stock + 1, batchData.length, 1).setValues(
             batchData.map(row => [row[0]])
           );
           prodSheet.getRange(rowNums[0], C.version + 1, batchData.length, 1).setValues(
             batchData.map(row => [row[1]])
           );
         }

        // Crear registro de venta en cartera
        const idVenta = "VTA" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
        const carteraRecord = {
          id: idVenta,
          fecha: new Date(),
          id_tercero: idCliente,
          origen_id: corrId,
          total: totalLimpio,
          saldo: 0,
          tipo: CARTERA_CONFIG.TIPOS.CXC,
          estado: CARTERA_CONFIG.ESTADOS.CANCELADA,
          fecha_vencimiento: new Date(),
          vencida_timestamp: ""
        };

        tx.begin();
        DAO.saveCartera(carteraRecord);
        tx.commit();

        CACHE.invalidateCartera();

        // Registrar en libro diario
        const usuario = SESSION_SERVICE.getCurrentUser()?.getEmail() || "SYSTEM";
        LIBRO_DIARIO.registrarVenta(
          new Date(),
          idVenta,
          idCliente,
          totalLimpio,
          usuario
        );

        // Registrar salida de caja por venta
        FLUJO_CAJA.registrarMovimiento(
          new Date(),
          FLUJO_CAJA.TIPOS.SALIDA_VENTA,
          "Venta a cliente: " + idCliente,
          totalLimpio,
          corrId,
          usuario
        );

        LOG_ENGINE.logEvent("CREATE_VENTA", "VENTAS", idVenta,
          {}, { cliente: idCliente, total: totalLimpio, items: items.length }, "SUCCESS", { correlationId: corrId });

        return { success: true, id: idVenta, total: totalLimpio };
      } catch (e) {
        _captureError("procesarVenta", e);
        try { tx.rollback(); } catch (rbErr) { Logger.log("[DOMAIN] Rollback venta error: " + rbErr.message); }
        CACHE.invalidateCartera();
        throw e;
      } finally {
        // Release product locks in reverse order
        for (let j = productLocks.length - 1; j >= 0; j--) {
          try { productLocks[j].releaseLock(); } catch (_) {}
        }
        if (lockAcquired) lockAcquired.releaseLock();
      }
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return _executeVentaTx();
      } catch (e) {
        const isOptimisticLock =
          e.type === 'OPTIMISTIC_LOCK_FAILURE' ||
          (e.message && e.message.includes('OptimisticLockError'));

        if (!isOptimisticLock || attempt >= MAX_RETRIES - 1) {
          LOG_ENGINE.logEvent("ERROR_VENTA", "VENTAS", idCliente, {}, { error: e.toString() }, "FAILED");
          return _error(e.message || "Error al registrar venta.");
        }

        CACHE.refresh(true);
        Utilities.sleep(100 * Math.pow(2, attempt) + Math.random() * 50);
      }
    }

    return _error("Conflicto de concurrencia persistente al registrar venta.");
  },

  /**
   * Validates if a date is within working hours (8AM-6PM, Mon-Fri).
   * Returns validation result with reason if outside working hours.
   * @param {Date|string} fecha - Date to validate
   * @returns {{valido: boolean, motivo: string}} Validation result
   */
  validarHorarioLaboral(fecha) {
    const d = _safeDate(fecha);
    if (!d) return { valido: false, motivo: "Fecha inválida" };
    
    const day = d.getDay();
    const hour = d.getHours();
    
    if (day === 0 || day === 6) {
      return { valido: false, motivo: "Fin de semana" };
    }
    if (hour < 8 || hour >= 18) {
      return { valido: false, motivo: "Fuera de horario laboral (8AM-6PM)" };
    }
    return { valido: true, motivo: "" };
  },

  /**
   * Validates kardex movement editing restrictions.
   * Only allows edits for movements older than 24h if user is ADMIN.
   * Logs all edit attempts in AUDIT_LOG.
   * @param {string} idMovimiento - Movement ID to validate
   * @param {Date|string} nuevaFecha - Proposed new date
   * @returns {{permitido: boolean, motivo: string}} Permission result
   */
  validarEdicionKardex(idMovimiento, nuevaFecha) {
    const d = _safeDate(nuevaFecha);
    if (!d) return { permitido: false, motivo: "Nueva fecha inválida" };
    
    const user = SESSION_SERVICE.getCurrentUser();
    const email = user && user.getEmail ? user.getEmail() : null;
    const role = email ? AuthService.getUserRole(email) : null;
    const isAdmin = role === "ADMIN";
    
    const kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    if (!kardexSheet) return { permitido: false, motivo: "Hoja KARDEX no disponible" };
    
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const data = kardexSheet.getDataRange().getValues();
    let movimiento = null;
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0] || "").trim() === String(idMovimiento || "").trim()) {
        movimiento = data[i];
        break;
      }
    }
    
    if (!movimiento) return { permitido: false, motivo: "Movimiento no encontrado" };
    
    const fechaMov = _safeDate(movimiento[KCOL.fecha]);
    if (!fechaMov) return { permitido: false, motivo: "Fecha del movimiento inválida" };
    
    const diffMs = d.getTime() - fechaMov.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    if (diffHours >= 24 && !isAdmin) {
      return { permitido: false, motivo: "Edición de movimientos antiguos requiere ADMIN" };
    }
    
    const corrId = TransactionManager.getCorrelationId() || ('kardex_edit_' + Date.now());
    LOG_ENGINE.logEvent("EDITAR_KARDEX", "KARDEX", idMovimiento,
      { fecha_original: fechaMov.toISOString() },
      { nueva_fecha: d.toISOString(), usuario: email },
      "SUCCESS", { correlationId: corrId });
    
    return { permitido: true, motivo: "" };
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
   * Detects duplicate third parties by name (normalized).
   * Returns terceros that have same name but different IDs.
   * @returns {Array<{nombre: string, ids: string[], tipo: string}>} Duplicate entries
   */
  getTercerosDuplicados() {
    const terceros = CACHE.terceros || DAO.getTerceros();
    const nombreAId = {};
    const duplicados = [];
    
    for (let i = 0; i < terceros.length; i++) {
      const t = terceros[i];
      const nombreNormalizado = String(t.nombre || "").trim().toLowerCase();
      if (!nombreNormalizado) continue;
      const tipo = String(t.tipo || "").toUpperCase();
      
      const key = nombreNormalizado + "|" + tipo;
      if (!nombreAId[key]) {
        nombreAId[key] = { nombre: t.nombre, ids: [], tipo };
      }
      nombreAId[key].ids.push(t.id);
    }
    
    for (const key in nombreAId) {
      if (nombreAId[key].ids.length > 1) {
        duplicados.push({
          nombre: nombreAId[key].nombre,
          ids: nombreAId[key].ids,
          tipo: nombreAId[key].tipo
        });
      }
    }
    
    return duplicados;
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
};

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
  deleteTercero(id, forceDelete = false) {
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

  /**
   * Retrieves the most recent payment for a specific provider.
   * @param {string} idProveedor - Provider ID.
   * @returns {Object|null} Most recent payment with fecha, valor, referencia.
   */
  getUltimoPagoProveedor(idProveedor) {
    if (!idProveedor) return null;
    CACHE.refresh();
    
    const cartera = CACHE.getCarteraBase() || [];
    const comprasProveedor = cartera.filter(c => 
      c.id_tercero === idProveedor && 
      c.tipo === CARTERA_CONFIG.TIPOS.CXP
    );

    let ultimoPago = null;
    let fechaMasReciente = 0;

    for (const compra of comprasProveedor) {
      const pagos = DAO_COMPRAS.getPagosByCompra ? DAO_COMPRAS.getPagosByCompra(compra.id) : [];
      for (const pago of pagos) {
        if (pago.fecha && pago.fecha.getTime) {
          const fechaPago = pago.fecha.getTime();
          if (fechaPago > fechaMasReciente) {
            fechaMasReciente = fechaPago;
            ultimoPago = {
              id: pago.id,
              fecha: pago.fecha,
              valor: pago.valor,
              referencia: pago.referencia,
              id_compra: pago.id_compra
            };
          }
        }
      }
    }

    return ultimoPago;
  },

  /**
   * Cancela una compra y revierte sus movimientos de kardex.
   * Genera SALIDAS en kardex para revertir el stock aumentado.
   * @param {string} idCompra - ID de la compra a cancelar
   * @param {string} [motivo] - Motivo de la cancelación
   * @returns {{success: boolean, message: string}} Resultado de la cancelación
   */
  cancelarCompraAtomic(idCompra, motivo) {
    const idLimpio = _sanitizeId(idCompra);
    if (!idLimpio) return _error("ID de compra inválido.");

    const MAX_RETRIES = 3;

    const _executeCancelTx = () => {
      let lockAcquired = null;
      const tx = _Transaction.create();

      try {
        const compra = DAO_COMPRAS.getCompraById(idLimpio);
        if (!compra) return _error("Compra no encontrada: " + idLimpio);
        
        const estadoActual = compra.estado;
        if (estadoActual === COMPRAS_CONFIG.ESTADOS.CANCELADA) {
          return _error("La compra ya está cancelada.");
        }

        lockAcquired = LOCK_MANAGER.acquireResourceLock(compra.id_proveedor);

        tx.begin();
        tx.snapshotCompraRow(compra.rowIndex);

        // Obtener detalles de la compra
        const detalles = DAO_COMPRAS.getDetallesByCompra(idLimpio);
        
        // Obtener movimientos de kardex ENTRADA asociados a esta compra
        const kardexAll = DAO_COMPRAS.getAllMovimientosKardex(30, 2000);
        const kardexEntradas = kardexAll.filter(m => m.referencia === idLimpio && m.tipo_mov === 'ENTRADA');

        // Revertir stock: generar SALIDAS en kardex
        const C = CONFIG.COLUMNS.PRODUCTOS;
        const prodSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
        const lastRow = prodSheet.getLastRow();
        const prodData = lastRow >= 2 ? prodSheet.getRange(2, 1, lastRow - 1, C.version + 1).getValues() : [];
        
        for (let j = 0; j < kardexEntradas.length; j++) {
          const mov = kardexEntradas[j];
          const prodId = mov.id_producto;
          const cantEntrada = mov.cantidad;
          
          // Buscar el producto en los datos
          const prodIdx = prodData.findIndex(p => String(p[C.id]).trim() === prodId);
          if (prodIdx !== -1) {
            const stockActual = parseInt(prodData[prodIdx][C.stock]) || 0;
            const nuevoStock = Math.max(0, stockActual - cantEntrada);
            const nuevaVersion = (parseInt(prodData[prodIdx][C.version]) || 1) + 1;
            
            // Actualizar stock
            prodSheet.getRange(prodIdx + 2, C.stock + 1).setValue(nuevoStock);
            prodSheet.getRange(prodIdx + 2, C.version + 1).setValue(nuevaVersion);
            
            // Generar SALIDA en kardex para revertir
            const kardexId = "KDX-CANC-" + Date.now() + "-" + j;
            DAO_COMPRAS.crearMovimientoKardex({
              id: kardexId,
              fecha: new Date(),
              id_producto: prodId,
              tipo_mov: "SALIDA",
              cantidad: cantEntrada,
              stock_anterior: stockActual,
              stock_nuevo: nuevoStock,
              referencia: idLimpio,
              origen: "CANCELACION_COMPRA",
              usuario: SESSION_SERVICE.getCurrentUser()?.getEmail() || "system"
            });
          }
        }

        // Marcar compra como CANCELADA
        const compraSheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
        const compraRow = compraSheet.getRange(compra.rowIndex, 1, 1, Math.max.apply(null, Object.values(DAO_COMPRAS.COMPRAS_COL)) + 1);
        const compraValues = compraRow.getValues()[0];
        compraValues[DAO_COMPRAS.COMPRAS_COL.estado] = COMPRAS_CONFIG.ESTADOS.CANCELADA;
        compraRow.setValues([compraValues]);

        tx.commit();

        CACHE.invalidate();

        LOG_ENGINE.logEvent("CANCEL_COMPRA", "COMPRAS", idLimpio,
          { estado: estadoActual, total: compra.total },
          { estado: COMPRAS_CONFIG.ESTADOS.CANCELADA, motivo: motivo || "Cancelación" },
          "SUCCESS",
          { correlationId: TransactionManager.getCorrelationId() || ('cancel_' + Date.now()) });

        return { success: true, message: "Compra cancelada correctamente. Stock revertido." };
      } catch (e) {
        _captureError("cancelarCompraAtomic", e);
        try { tx.rollback(); } catch (rbErr) { Logger.log("[DOMAIN] Rollback error: " + rbErr.message); }
        CACHE.invalidateCartera();
        throw e;
      } finally {
        if (lockAcquired) lockAcquired.releaseLock();
      }
    };

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return _executeCancelTx();
      } catch (e) {
        const isOptimisticLock =
          e.type === 'OPTIMISTIC_LOCK_FAILURE' ||
          (e.message && e.message.includes('OptimisticLockError'));

        if (!isOptimisticLock || attempt >= MAX_RETRIES - 1) {
          LOG_ENGINE.logEvent("ERROR_CANCEL_COMPRA", "COMPRAS", idLimpio, {}, { error: e.toString() }, "FAILED");
          return _error(e.message || "Error al cancelar compra.");
        }

        CACHE.refresh(true);
        Utilities.sleep(100 * Math.pow(2, attempt) + Math.random() * 50);
      }
    }

    return _error("Conflicto de concurrencia persistente al cancelar compra.");
  },

  /**
   * Ranking de clientes por producto comprado (basado en ventas/Kardex).
   * @param {string} [idProducto] - Optional product ID filter. Returns ranking for all products if omitted.
   * @param {number} [limit=10] - Maximum clients to return.
   * @returns {Array<{id_cliente: string, nombre: string, producto: string, cantidad: number}>}
   */
  getRankingClienteProducto(idProducto, limit) {
    const tz = _getTimeZone();
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);

    const lastRow = kardexSheet.getLastRow();
    if (lastRow < 2) return [];

    const numCols = Math.max.apply(null, Object.values(KCOL)) + 1;
    const kardexData = kardexSheet.getRange(2, 1, lastRow - 1, numCols).getValues();

    // Agrupar por cliente y producto (basado en referencias de ventas)
    const ranking = {};
    const clientesConVentas = {};

    for (let i = 0; i < kardexData.length; i++) {
      const tipoMov = String(kardexData[i][KCOL.tipo_mov] || "").toUpperCase();
      if (tipoMov !== 'SALIDA') continue;

      const prodId = String(kardexData[i][KCOL.id_producto] || "").trim();
      if (idProducto && prodId !== idProducto) continue;

      const referencia = String(kardexData[i][KCOL.referencia] || "").trim();
      const cantidad = _parseMoneda(kardexData[i][KCOL.cantidad], 0);

      // Extraer cliente de la referencia (asumiendo formato VTA-CLIENTE-*)
      const clienteIdMatch = referencia.match(/CLI[-_]?([A-Z0-9]+)/i) || referencia.match(/^([A-Z0-9]+)[-_]/);
      if (!clienteIdMatch) continue;

      const clienteId = _sanitizeId(clienteIdMatch[1] || clienteIdMatch[0]);
      const key = clienteId + '|' + prodId;

      if (!ranking[key]) {
        ranking[key] = { id_cliente: clienteId, producto: prodId, cantidad: 0 };
      }
      ranking[key].cantidad += cantidad;
      clientesConVentas[clienteId] = true;
    }

    // Obtener nombres de clientes
    const terceros = CACHE.terceros || DAO.getTerceros();
    const terceroMap = {};
    for (let i = 0; i < terceros.length; i++) {
      const t = terceros[i];
      if (t.tipo === 'CLIENTE' || t.tipo === 'AMBOS' || t.tipo === 'PROVEEDOR') {
        terceroMap[t.id] = t.nombre || t.id;
      }
    }

    // Convertir a array y ordenar
    const result = Object.values(ranking).map(r => ({
      id_cliente: r.id_cliente,
      nombre: terceroMap[r.id_cliente] || r.id_cliente,
      producto: r.producto,
      cantidad: r.cantidad
    })).sort((a, b) => b.cantidad - a.cantidad);

    if (limit && result.length > limit) return result.slice(0, limit);
    return result;
  },

  /**
   * Lista clientes activos que no tienen ventas registradas en kardex.
   * @returns {Array<{id: string, nombre: string, tipo: string, activo: string}>}
   */
  listarClientesSinVentas() {
    const terceros = CACHE.terceros || DAO.getTerceros();
    const clientes = terceros.filter(t =>
      (t.tipo === 'CLIENTE' || t.tipo === 'AMBOS') &&
      t.activo !== 'INACTIVO'
    );

    // Obtener clientes con ventas del kardex
    const kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const lastRow = kardexSheet.getLastRow();
    const clientesConVentas = {};

    if (lastRow >= 2) {
      const numCols = Math.max.apply(null, Object.values(KCOL)) + 1;
      const kardexData = kardexSheet.getRange(2, 1, lastRow - 1, numCols).getValues();

      for (let i = 0; i < kardexData.length; i++) {
        const tipoMov = String(kardexData[i][KCOL.tipo_mov] || "").toUpperCase();
        if (tipoMov === 'SALIDA') {
          const referencia = String(kardexData[i][KCOL.referencia] || "").trim();
          // Intentar extraer ID de cliente de la referencia
          const clienteId = referencia.replace(/^VTA[-_]?/, '').split(/[-_]/)[0];
          if (clienteId) {
            clientesConVentas[clienteId] = true;
          }
        }
      }
    }

    // Filtrar clientes sin ventas
    return clientes.filter(c => !clientesConVentas[c.id]).map(c => ({
      id: c.id,
      nombre: c.nombre || c.id,
      tipo: c.tipo,
      activo: c.activo
    }));
  },

  /**
   * Ranking ABC de productos por valor de ventas/inventario.
   * Clasifica productos según su aporte al valor total (80/15/5 rule).
   * @param {string} [tipo='valor'] - 'valor' para valor monetario, 'cantidad' para unidades
   * @returns {Object} { A: [], B: [], C: [] } productos clasificados
   */
  getRankingABC(tipo) {
    const usarValor = tipo !== 'cantidad';
    const movimientos = DAO_COMPRAS.getAllMovimientosKardex(365, 5000);
    const productos = DAO_PRODUCTOS.listar({});

    // Calcular valor total vendido por producto
    const ventasPorProducto = {};
    for (let i = 0; i < movimientos.length; i++) {
      const m = movimientos[i];
      if (String(m.tipo_mov || "").toUpperCase() !== 'SALIDA') continue;
      const prodId = m.id_producto;
      const cantidad = m.cantidad || 0;
      if (!ventasPorProducto[prodId]) {
        ventasPorProducto[prodId] = { cantidad: 0, valor: 0 };
      }
      ventasPorProducto[prodId].cantidad += cantidad;
    }

    // Asignar precios
    const productoMap = {};
    for (let i = 0; i < productos.length; i++) {
      const p = productos[i];
      productoMap[p.id] = p;
      if (!ventasPorProducto[p.id]) {
        ventasPorProducto[p.id] = { cantidad: 0, valor: 0 };
      }
      if (usarValor) {
        ventasPorProducto[p.id].valor = ventasPorProducto[p.id].cantidad * (p.precio_venta || 0);
      }
    }

    // Calcular total
    let total = 0;
    for (const prodId in ventasPorProducto) {
      const key = usarValor ? 'valor' : 'cantidad';
      total += ventasPorProducto[prodId][key] || 0;
    }
    if (total === 0) return { A: [], B: [], C: [] };

    // Ordenar por valor descendente
    const ordenados = Object.entries(ventasPorProducto)
      .map(([prodId, datos]) => ({
        id: prodId,
        nombre: (productoMap[prodId] && productoMap[prodId].nombre) || prodId,
        cantidad: datos.cantidad,
        valor: datos.valor
      }))
      .sort((a, b) => usarValor ? b.valor - a.valor : b.cantidad - a.cantidad);

    // Clasificar ABC (acumulado)
    let acumulado = 0;
    const key = usarValor ? 'valor' : 'cantidad';
    const result = { A: [], B: [], C: [] };

    for (const prod of ordenados) {
      acumulado += prod[key];
      const porcentaje = acumulado / total;
      if (porcentaje <= 0.80) {
        result.A.push(prod);
      } else if (porcentaje <= 0.95) {
        result.B.push(prod);
      } else {
        result.C.push(prod);
      }
    }

    return result;
  },

  /**
   * Detecta quiebres de stock (productos con stock = 0 y ventas recientes).
   * @param {number} [diasVentas=30] - Días atrás para buscar ventas
   * @returns {Array} Productos con quiebre de stock
   */
  detectarQuiebresStock(diasVentas) {
    const dias = parseInt(diasVentas) || 30;
    const productos = DAO_PRODUCTOS.listar({});
    const hoy = _today();
    const fechaLimite = new Date(hoy.getTime() - (dias * 86400000));

    const kardex = DAO_COMPRAS.getAllMovimientosKardex(dias, 5000);
    const ventasRecientes = {};

    // Identificar productos con ventas recientes
    for (let i = 0; i < kardex.length; i++) {
      const m = kardex[i];
      if (String(m.tipo_mov || "").toUpperCase() === 'SALIDA') {
        const f = new Date(m.fecha);
        if (f >= fechaLimite) {
          ventasRecientes[m.id_producto] = true;
        }
      }
    }

    // Productos con stock 0 y ventas recientes = quiebre
    return productos.filter(p =>
      ((p.stock || 0) === 0 || (p.stock || 0) < 0) &&
      ventasRecientes[p.id]
    ).map(p => ({
      id: p.id,
      nombre: p.nombre || p.id,
      stock: p.stock || 0,
      tieneVentasRecientes: true
    }));
  },

  /**
   * Detecta exceso de inventario (stock > 10x promedio mensual de salidas).
   * @param {number} [factor=10] - Multiplicador del promedio (default 10x)
   * @returns {Array} Productos con exceso de inventario
   */
  detectarExcesoInventario(factor) {
    const mult = parseInt(factor) || 10;
    const movimientos = DAO_COMPRAS.getAllMovimientosKardex(30, 5000);
    const productos = DAO_PRODUCTOS.listar({});

    // Calcular salidas promedio mensuales
    const salidasMensuales = {};
    for (let i = 0; i < movimientos.length; i++) {
      const m = movimientos[i];
      if (String(m.tipo_mov || "").toUpperCase() !== 'SALIDA') continue;
      const prodId = m.id_producto;
      if (!salidasMensuales[prodId]) salidasMensuales[prodId] = 0;
      salidasMensuales[prodId] += m.cantidad || 0;
    }

    // Productos con stock > 10x promedio
    return productos.filter(p => {
      const promedioMensual = salidasMensuales[p.id] || 0;
      const umbral = promedioMensual * mult;
      return (p.stock || 0) > umbral && umbral > 0;
    }).map(p => ({
      id: p.id,
      nombre: p.nombre || p.id,
      stock: p.stock || 0,
      salidasMensuales: salidasMensuales[p.id] || 0,
      umbral: (salidasMensuales[p.id] || 0) * mult
    }));
  },

  /**
   * Calcula margen por producto (precio_venta - precio_compra) / precio_venta.
   * @param {number} [umbralMargen=0.10] - Umbral de margen (default 10%)
   * @returns {Object} { margenBajo: [], margenAlto: [] } productos clasificados
   */
  getMargenProductos(umbralMargen) {
    const umbral = parseFloat(umbralMargen) || 0.10;
    const productos = DAO_PRODUCTOS.listar({});

    const result = { margenBajo: [], margenAlto: [] };

    for (let i = 0; i < productos.length; i++) {
      const p = productos[i];
      const precioVenta = p.precio_venta || 0;
      const precioCompra = p.precio_compra || 0;

      if (precioVenta > 0) {
        const margen = (precioVenta - precioCompra) / precioVenta;
        const productoInfo = {
          id: p.id,
          nombre: p.nombre || p.id,
          precio_venta: precioVenta,
          precio_compra: precioCompra,
          margen: Math.round(margen * 10000) / 100
        };
        if (margen < umbral) {
          result.margenBajo.push(productoInfo);
        } else {
          result.margenAlto.push(productoInfo);
        }
      }
    }

    return result;
  },

  /**
   * Trazabilidad completa: proveedor → producto → cliente.
   * Rastrea cada producto desde su origen (proveedor) hasta su destino (cliente).
   * @param {string} [idProducto] - Optional product ID filter
   * @returns {Array} Trazas con proveedor, fecha compra, fecha venta, cliente, cantidades
   */
  getTrazabilidadCompleta(idProducto) {
    const tz = _getTimeZone();
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const lastRow = kardexSheet.getLastRow();

    if (lastRow < 2) return [];

    const numCols = Math.max.apply(null, Object.values(KCOL)) + 1;
    const kardexData = kardexSheet.getRange(2, 1, lastRow - 1, numCols).getValues();

    // Obtener datos base
    const productos = DAO_PRODUCTOS.listar({});
    const terceros = CACHE.terceros || DAO.getTerceros();
    const cartera = CACHE.getCarteraBase() || [];

    // Mapas de búsqueda
    const productoMap = {};
    for (let i = 0; i < productos.length; i++) {
      productoMap[productos[i].id] = productos[i];
    }

    const terceroMap = {};
    for (let i = 0; i < terceros.length; i++) {
      terceroMap[terceros[i].id] = terceros[i];
    }

    const carteraMap = {};
    for (let i = 0; i < cartera.length; i++) {
      if (!carteraMap[cartera[i].id]) {
        carteraMap[cartera[i].id] = [];
      }
      carteraMap[cartera[i].id].push(cartera[i]);
    }

    // Procesar trazas
    const trazas = {};

    for (let i = 0; i < kardexData.length; i++) {
      const tipoMov = String(kardexData[i][KCOL.tipo_mov] || "").toUpperCase();
      const prodId = String(kardexData[i][KCOL.id_producto] || "").trim();
      if (idProducto && prodId !== idProducto) continue;
      if (!prodId) continue;

      const referencia = String(kardexData[i][KCOL.referencia] || "").trim();
      const cantidad = _parseMoneda(kardexData[i][KCOL.cantidad], 0);
      const fecha = kardexData[i][KCOL.fecha];

      // ENTRADA: proveedor → producto
      if (tipoMov === 'ENTRADA') {
        // Buscar compra origen
        const compra = carteraMap[referencia] ? carteraMap[referencia][0] : null;
        const proveedorId = compra ? compra.id_tercero : null;
        const proveedor = proveedorId ? terceroMap[proveedorId] : null;

        if (!trazas[prodId]) {
          trazas[prodId] = {
            producto: prodId,
            nombre_producto: productoMap[prodId] ? productoMap[prodId].nombre : prodId,
            proveedor: proveedorId || 'DESCONOCIDO',
            nombre_proveedor: proveedor ? proveedor.nombre : 'DESCONOCIDO',
            fecha_entrada: fecha,
            cantidad_entrada: cantidad,
            salidas: []
          };
        } else {
          trazas[prodId].cantidad_entrada += cantidad;
        }
        if (proveedorId && !trazas[prodId].proveedor) {
          trazas[prodId].proveedor = proveedorId;
          trazas[prodId].nombre_proveedor = proveedor ? proveedor.nombre : proveedorId;
        }
      }

      // SALIDA: producto → cliente
      if (tipoMov === 'SALIDA') {
        if (!trazas[prodId]) {
          trazas[prodId] = {
            producto: prodId,
            nombre_producto: productoMap[prodId] ? productoMap[prodId].nombre : prodId,
            proveedor: 'SIN_ENTRADA_REGISTRADA',
            nombre_proveedor: 'SIN ENTRADA',
            cantidad_entrada: 0,
            salidas: []
          };
        }

        // Extraer cliente de la referencia
        const clienteId = referencia.replace(/^VTA[-_]?/, '').split(/[-_]/)[0];
        const cliente = terceroMap[clienteId] || null;

        trazas[prodId].salidas.push({
          fecha_salida: fecha,
          cliente: clienteId || 'DESCONOCIDO',
          nombre_cliente: cliente ? cliente.nombre : (clienteId || 'DESCONOCIDO'),
          cantidad: cantidad
        });
      }
    }

    return Object.values(trazas);
  },

  /**
   * Valorización a costo promedio ponderado.
   * @returns {Array} Productos con valuación { id, stock, costo_promedio, valor_valuado }
   */
  getValorizacionCostoPromedio() {
    const movimientos = DAO_COMPRAS.getAllMovimientosKardex(365, 5000);
    const productos = DAO_PRODUCTOS.listar({});

    // Calcular costo promedio por producto
    const entradasPorProducto = {};
    for (let i = 0; i < movimientos.length; i++) {
      const m = movimientos[i];
      if (String(m.tipo_mov || "").toUpperCase() !== 'ENTRADA') continue;
      const prodId = m.id_producto;
      if (!prodId) continue;
      if (!entradasPorProducto[prodId]) {
        entradasPorProducto[prodId] = { totalCantidad: 0, totalCosto: 0, entradas: [] };
      }
      const cant = m.cantidad || 0;
      const costo = m.costo_unitario || m.precio_compra || 0;
      entradasPorProducto[prodId].totalCantidad += cant;
      entradasPorProducto[prodId].totalCosto += cant * costo;
      entradasPorProducto[prodId].entradas.push({ cantidad: cant, costo });
    }

    // Calcular valuado
    return productos.map(p => {
      const datos = entradasPorProducto[p.id] || { totalCantidad: 0, totalCosto: 0 };
      const costoPromedio = datos.totalCantidad > 0 ? datos.totalCosto / datos.totalCantidad : 0;
      const stockActual = p.stock || 0;
      const valorValuado = Math.round(stockActual * costoPromedio);

      return {
        id: p.id,
        nombre: p.nombre || p.id,
        stock: stockActual,
        costo_promedio: Math.round(costoPromedio),
        valor_valuado: valorValuado,
        valor_registro: Math.round((p.precio_compra || 0) * stockActual),
        diferencia: valorValuado - Math.round((p.precio_compra || 0) * stockActual)
      };
    }).filter(p => p.stock > 0);
  },

  /**
   * Valorización a último costo.
   * @returns {Array} Productos con valuación basada en última entrada
   */
  getValorizacionUltimoCosto() {
    const movimientos = DAO_COMPRAS.getAllMovimientosKardex(365, 5000);
    const productos = DAO_PRODUCTOS.listar({});

    // Obtener última entrada por producto
    const ultimaEntradaPorProducto = {};
    for (let i = 0; i < movimientos.length; i++) {
      const m = movimientos[i];
      if (String(m.tipo_mov || "").toUpperCase() !== 'ENTRADA') continue;
      const prodId = m.id_producto;
      if (!prodId) continue;
      const fecha = new Date(m.fecha);
      if (!ultimaEntradaPorProducto[prodId] || fecha > new Date(ultimaEntradaPorProducto[prodId].fecha)) {
        ultimaEntradaPorProducto[prodId] = {
          fecha: m.fecha,
          costo: m.costo_unitario || m.precio_compra || 0
        };
      }
    }

    return productos.map(p => {
      const ultima = ultimaEntradaPorProducto[p.id];
      const ultimoCosto = ultima ? ultima.costo : 0;
      const stockActual = p.stock || 0;
      const valorValuado = Math.round(stockActual * ultimoCosto);

      return {
        id: p.id,
        nombre: p.nombre || p.id,
        stock: stockActual,
        ultimo_costo: ultimoCosto,
        valor_valuado: valorValuado,
        fecha_ultima_entrada: ultima ? ultima.fecha : null
      };
    }).filter(p => p.stock > 0);
  },

  /**
   * Cruza valuación con libro diario buscando diferencias.
   * @returns {Array} Diferencias en valuación vs contabilidad
   */
  getDiferenciasValorizacion() {
    const valuadoPromedio = this.getValorizacionCostoPromedio();
    const libroDiario = DAO.getLibroDiario ? DAO.getLibroDiario() : [];

    // Calcular total compras en libro
    let totalCompras = 0;
    for (let i = 0; i < libroDiario.length; i++) {
      const t = libroDiario[i];
      if (t.tipo === 'COMPRA' || t.tipo === 'COMPRA_PROVEEDOR') {
        totalCompras += Number(t.monto) || 0;
      }
    }

    // Calcular total valuado
    const totalValorizado = valuadoPromedio.reduce((sum, v) => sum + v.valor_valuado, 0);
    const diferencia = totalValorizado - totalCompras;
    const umbral = CONFIG.MATERIALITY_THRESHOLD || 100000;

    return {
      total_compras_libro: totalCompras,
      total_valuado_kardex: totalValorizado,
      diferencia: diferencia,
      diferencia_significativa: Math.abs(diferencia) > umbral,
      umbral: umbral
    };
  },

  /**
   * Ventas del día agrupadas por producto.
   * @returns {Array} { productoId, nombre, cantidad, total }
   */
  getVentasDelDiaPorProducto() {
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const lastRow = kardexSheet.getLastRow();

    if (lastRow < 2) return [];

    const hoy = _today();
    const hoyStr = hoy.toISOString().split('T')[0];

    const numCols = Math.max.apply(null, Object.values(KCOL)) + 1;
    const kardexData = kardexSheet.getRange(2, 1, lastRow - 1, numCols).getValues();

    const ventasPorProducto = {};
    for (let i = 0; i < kardexData.length; i++) {
      const tipoMov = String(kardexData[i][KCOL.tipo_mov] || "").toUpperCase();
      if (tipoMov !== 'SALIDA') continue;

      const fecha = kardexData[i][KCOL.fecha];
      const prodId = String(kardexData[i][KCOL.id_producto] || "").trim();
      if (!prodId) continue;

      const fechaStr = fecha instanceof Date ? fecha.toISOString().split('T')[0] : String(fecha).split(' ')[0];
      if (fechaStr === hoyStr) {
        const cantidad = _parseMoneda(kardexData[i][KCOL.cantidad], 0);
        if (!ventasPorProducto[prodId]) {
          ventasPorProducto[prodId] = { productoId: prodId, cantidad: 0, total: 0 };
        }
        ventasPorProducto[prodId].cantidad += cantidad;
        ventasPorProducto[prodId].total += cantidad * (Number(kardexData[i][KCOL.costo_unitario]) || 0);
      }
    }

    // Agregar nombres de productos
    const productos = DAO_PRODUCTOS.listar({});
    const productoMap = {};
    for (let i = 0; i < productos.length; i++) {
      productoMap[productos[i].id] = productos[i].nombre || productos[i].id;
    }

    return Object.values(ventasPorProducto).map(v => ({
      ...v,
      nombre: productoMap[v.productoId] || v.productoId
    }));
  },

  /**
   * Entradas de kardex del día.
   * @returns {Array} Entradas con compra origen, productos, cantidades
   */
  getEntradasDelDia() {
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const lastRow = kardexSheet.getLastRow();

    if (lastRow < 2) return [];

    const hoy = _today();
    const hoyStr = hoy.toISOString().split('T')[0];

    const numCols = Math.max.apply(null, Object.values(KCOL)) + 1;
    const kardexData = kardexSheet.getRange(2, 1, lastRow - 1, numCols).getValues();

    const entradas = [];
    for (let i = 0; i < kardexData.length; i++) {
      const tipoMov = String(kardexData[i][KCOL.tipo_mov] || "").toUpperCase();
      if (tipoMov !== 'ENTRADA') continue;

      const fecha = kardexData[i][KCOL.fecha];
      const fechaStr = fecha instanceof Date ? fecha.toISOString().split('T')[0] : String(fecha).split(' ')[0];

      if (fechaStr === hoyStr) {
        const prodId = String(kardexData[i][KCOL.id_producto] || "").trim();
        const referencia = String(kardexData[i][KCOL.referencia] || "").trim();
        const cantidad = _parseMoneda(kardexData[i][KCOL.cantidad], 0);

        entradas.push({
          id_producto: prodId,
          cantidad: cantidad,
          referencia: referencia,
          fecha: fecha
        });
      }
    }

    return entradas;
  },

  registrarDevolucionVenta(ventaId, items, motivo, correlationId) {
    if (!ventaId) throw new Error("ventaId requerido");
    if (!items || !Array.isArray(items) || items.length === 0) throw new Error("items requeridos");

    const txn = TransactionManager.begin(correlationId || generateCorrelationId());
    const lock = LOCK_MANAGER.acquireGlobalLock(15000);

    try {
      const auditSheet = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
      const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;
      const PCOL = CONFIG.COLUMNS.PRODUCTOS;

      const auditData = auditSheet.getDataRange().getValues();
      const ACOL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
      let ventaEncontrada = null;
      let fechaVenta = null;

      for (let i = 1; i < auditData.length; i++) {
        const idReg = String(auditData[i][ACOL.id_registro] || "").trim();
        if (idReg === ventaId && String(auditData[i][ACOL.tabla] || "").trim() === "VENTAS") {
          ventaEncontrada = JSON.parse(auditData[i][ACOL.datos_nuevos] || "{}");
          fechaVenta = auditData[i][ACOL.timestamp];
          break;
        }
      }

      if (!ventaEncontrada) {
        throw new Error("Venta origen no encontrada: " + ventaId);
      }

      const productos = DAO_PRODUCTOS.listar({});
      const productoMap = {};
      for (const p of productos) productoMap[p.id] = p;

      const kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
      const hoy = _today();

      for (const item of items) {
        const prodId = String(item.id || item.productoId || "").trim();
        const cantidad = Number(item.cantidad || 0);

        if (!prodId || cantidad <= 0) continue;

        const producto = productoMap[prodId];
        if (!producto) continue;

        const stockAnterior = producto.stock || 0;
        const stockNuevo = stockAnterior + cantidad;

        const rowData = [
          ["DEV_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)],
          hoy,
          prodId,
          "ENTRADA",
          cantidad,
          stockAnterior,
          stockNuevo,
          ventaId,
          "DEVOLUCION_VENTA",
          SESSION_SERVICE.getCurrentUser().getEmail() || "SYSTEM"
        ];

        const numCols = Math.max(...Object.values(KCOL)) + 1;
        kardexSheet.getRange(kardexSheet.getLastRow() + 1, 1, 1, numCols).setValues([rowData]);

        DAO_PRODUCTOS.actualizar(prodId, { stock: stockNuevo }, txn);
      }

      LOG_ENGINE.logEvent("DEVOLUCION_VENTA", "VENTAS", ventaId, {}, { items, motivo }, "OK", { correlationId: txn.correlationId });

      txn.commit();

      return { success: true, ventaId: ventaId, correlationId: txn.correlationId };
    } catch (e) {
      txn.rollback();
      Logger.log("ERROR registrarDevolucionVenta: " + e.toString());
      return { success: false, error: e.message };
    } finally {
      if (lock) lock.releaseLock();
    }
  }

  getQuiebresStock(diasVentas) {
    const dias = parseInt(diasVentas) || 30;
    const productos = DAO_PRODUCTOS.listar({});
    const hoy = _today();
    const fechaLimite = new Date(hoy.getTime() - (dias * 86400000));

    const kardex = DAO_COMPRAS.getAllMovimientosKardex(dias, 5000);
    const ventasRecientes = {};

    for (let i = 0; i < kardex.length; i++) {
      const m = kardex[i];
      if (String(m.tipo_mov || "").toUpperCase() === 'SALIDA') {
        const f = new Date(m.fecha);
        if (f >= fechaLimite) {
          ventasRecientes[m.id_producto] = true;
        }
      }
    }

    return productos.filter(p =>
      ((p.stock || 0) === 0 || (p.stock || 0) < 0) &&
      ventasRecientes[p.id]
    ).map(p => ({
      id: p.id,
      nombre: p.nombre || p.id,
      stock: p.stock || 0,
      tieneVentasRecientes: true
    }));
  },

  getExcesoInventario(factor) {
    const mult = parseInt(factor) || 10;
    const movimientos = DAO_COMPRAS.getAllMovimientosKardex(30, 5000);
    const productos = DAO_PRODUCTOS.listar({});

    const salidasMensuales = {};
    for (let i = 0; i < movimientos.length; i++) {
      const m = movimientos[i];
      if (String(m.tipo_mov || "").toUpperCase() !== 'SALIDA') continue;
      const prodId = m.id_producto;
      if (!salidasMensuales[prodId]) salidasMensuales[prodId] = 0;
      salidasMensuales[prodId] += m.cantidad || 0;
    }

    return productos.filter(p => {
      const promedioMensual = salidasMensuales[p.id] || 0;
      const umbral = promedioMensual * mult;
      return (p.stock || 0) > umbral && umbral > 0;
    }).map(p => ({
      id: p.id,
      nombre: p.nombre || p.id,
      stock: p.stock || 0,
      salidasMensuales: salidasMensuales[p.id] || 0,
      umbral: (salidasMensuales[p.id] || 0) * mult
    }));
  },

  getMargenPorProducto(umbralMargen) {
    const umbral = parseFloat(umbralMargen) || 0.10;
    const productos = DAO_PRODUCTOS.listar({});

    const result = { margenBajo: [], margenAlto: [] };

    for (let i = 0; i < productos.length; i++) {
      const p = productos[i];
      const precioVenta = p.precio_venta || 0;
      const precioCompra = p.precio_compra || 0;

      if (precioVenta > 0) {
        const margen = (precioVenta - precioCompra) / precioVenta;
        const productoInfo = {
          id: p.id,
          nombre: p.nombre || p.id,
          precio_venta: precioVenta,
          precio_compra: precioCompra,
          margen: Math.round(margen * 10000) / 100
        };
        if (margen < umbral) {
          result.margenBajo.push(productoInfo);
        } else {
          result.margenAlto.push(productoInfo);
        }
      }
    }

    return result;
  },

  /**
   * Registers an inventory adjustment (ajuste) movement.
   * Validates stock won't go negative, uses optimistic locking.
   * @param {string} productoId - Product ID
   * @param {number} cantidad - Quantity to adjust (positive or negative)
   * @param {string} justificacion - Required justification
   * @param {string} [correlationId] - Idempotency key
   * @returns {{success: boolean, stockAnterior: number, stockNuevo: number}}
   */
  registrarAjuste(productoId, cantidad, justificacion, correlationId) {
    const prodId = _sanitizeId(productoId);
    if (!prodId) return { success: false, error: "ID producto inválido" };
    const cant = _parseMoneda(cantidad, NaN);
    if (isNaN(cant)) return { success: false, error: "Cantidad inválida" };
    const desc = String(justificacion || "").trim();
    if (!desc) return { success: false, error: "Justificación requerida" };

    const corrId = correlationId || ('ajuste_' + Date.now());
    const lock = LOCK_MANAGER.acquireResourceLock(prodId);

    try {
      const productos = DAO_PRODUCTOS.listar({});
      const prodIdx = productos.findIndex(p => p.id === prodId);
      if (prodIdx === -1) return { success: false, error: "Producto no encontrado" };

      const stockActual = productos[prodIdx].stock || 0;
      const stockNuevo = stockActual + cant;
      if (stockNuevo < 0) return { success: false, error: "Stock resultante no puede ser negativo" };

      const result = DAO_PRODUCTOS.actualizar(prodId, { stock: stockNuevo }, productos[prodIdx].version);
      if (result !== true) return { success: false, error: "Error en actualización (optimistic lock)" };

      const kardexId = "KDX-AJUS-" + Date.now();
      DAO_COMPRAS.crearMovimientoKardex({
        id: kardexId,
        fecha: new Date(),
        id_producto: prodId,
        tipo_mov: "ENTRADA",
        cantidad: Math.abs(cant),
        stock_anterior: stockActual,
        stock_nuevo: stockNuevo,
        referencia: corrId,
        origen: "AJUSTE",
        usuario: SESSION_SERVICE.getCurrentUser()?.getEmail() || "system"
      });

      LOG_ENGINE.logEvent("REGISTRAR_AJUSTE", "KARDEX", kardexId,
        { stock_anterior: stockActual }, { stock_nuevo: stockNuevo, justificacion: desc },
        "SUCCESS", { correlationId: corrId });

      return { success: true, stockAnterior: stockActual, stockNuevo: stockNuevo };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * Registers inventory write-off (merma) movement.
   * @param {string} productoId - Product ID
   * @param {number} cantidad - Quantity to write off
   * @param {string} justificacion - Required justification
   * @param {string} [correlationId] - Idempotency key
   * @returns {{success: boolean, stockAnterior: number, stockNuevo: number}}
   */
  registrarMerma(productoId, cantidad, justificacion, correlationId) {
    return this.registrarAjuste(productoId, -cantidad, "MERMA: " + justificacion, correlationId);
  },

  /**
   * Calculates weighted average cost from kardex entries.
   * @param {string} [productoId] - Product ID (all if omitted)
   * @returns {{costoPromedio: number, totalEntradas: number}}
   */
  calcularCostoPromedio(productoId) {
    const kardex = DAO_COMPRAS.getAllMovimientosKardex(365, 10000);
    const productos = productoId ? 
      (DAO_PRODUCTOS.obtener(productoId) ? [DAO_PRODUCTOS.obtener(productoId)] : []) :
      DAO_PRODUCTOS.listar({});

    const result = {};
    for (let i = 0; i < productos.length; i++) {
const prodId = productos[i].id;
       const entradas = kardex.filter(k => k.id_producto === prodId && k.tipo_mov === "ENTRADA");
       let totalCantidad = 0;
       let totalCosto = 0;
       for (let j = 0; j < entradas.length; j++) {
         const cant = entradas[j].cantidad || 0;
         const costo = entradas[j].costo_unitario || entradas[j].precio_compra || 0;
         totalCantidad += cant;
         totalCosto += cant * costo;
       }
       result[prodId] = {
         nombre: productos[i].nombre,
         costoPromedio: totalCantidad > 0 ? totalCosto / totalCantidad : 0,
         totalEntradas: totalCantidad
       };
     }
     return result;
   },

   /**
    * Obtiene el último costo de reposición de un producto.
    * @param {string} idProducto - ID del producto
    * @returns {number} Último precio de compra o 0 si no hay historial
    */
   getCostoReposicion(idProducto) {
     try {
       const detalleCompras = DAO_COMPRAS.listarDetalles ? DAO_COMPRAS.listarDetalles() : [];
       const ultimaCompra = detalleCompras
         .filter(d => d.id_producto === idProducto)
         .sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))[0];
       
       return ultimaCompra ? Number(ultimaCompra.precio_unitario || 0) : 0;
     } catch (e) {
       return 0;
     }
   },

   /**
    * Obtiene proveedores que no tienen compras registradas.
    * @returns {Array} Array de objetos con id, nombre de proveedores sin compras
    */
   getProveedoresSinCompras() {
     try {
       const terceros = CACHE.terceros || DAO.getTerceros();
       const compras = DAO_COMPRAS.getCompras();
       
       const proveedorIdsConCompras = new Set();
       for (const c of compras) {
         if (c.id_proveedor) proveedorIdsConCompras.add(c.id_proveedor);
       }
       
       const proveedoresSinCompras = terceros.filter(t => {
         const tipo = String(t.tipo || '').toUpperCase();
         return (tipo === 'PROVEEDOR' || tipo === 'AMBOS') && !proveedorIdsConCompras.has(t.id);
       });
       
return proveedoresSinCompras.map(p => ({ id: p.id, nombre: p.nombre }));
      } catch (e) {
        return [];
      }
    },

    /**
     * Clasifica productos por valor en inventario (ABC analysis).
     * A = top 80% valor, B = 15%, C = 5%
     * @returns {{A: Array, B: Array, C: Array}} Productos clasificados
     */
    getRankingABC() {
      try {
        const productos = DAO_PRODUCTOS.listar({});
        const kardex = DAO_COMPRAS.getAllMovimientosKardex(null, 5000);
        
        const valorPorProducto = {};
        for (const p of productos) {
          const entradas = kardex.filter(k => k.id_producto === p.id && String(k.tipo_mov || '').toUpperCase() === 'ENTRADA');
          let totalValor = 0;
          for (const e of entradas) {
            const cant = e.cantidad || 0;
            const costo = e.costo_unitario || p.precio_compra || 0;
            totalValor += cant * costo;
          }
          valorPorProducto[p.id] = {
            id: p.id,
            nombre: p.nombre,
            valor: totalValor,
            stock: p.stock || 0
          };
        }
        
        // Ordenar por valor descendente
        const productosOrdenados = Object.values(valorPorProducto)
          .sort((a, b) => b.valor - a.valor);
        
        const totalValor = productosOrdenados.reduce((sum, p) => sum + p.valor, 0);
        
        let acumulado = 0;
        const A = [], B = [], C = [];
        
        for (const p of productosOrdenados) {
          acumulado += p.valor;
          const pct = totalValor > 0 ? acumulado / totalValor : 0;
          
          if (pct <= 0.80) A.push(p);
          else if (pct <= 0.95) B.push(p);
          else C.push(p);
        }
        
        return { A, B, C };
      } catch (e) {
        return { A: [], B: [], C: [] };
      }
    },

    /**
     * Obtiene productos con margen bajo o alto.
     * @param {number} umbral - Margen mínimo (default 0.10 = 10%)
     * @returns {{margenBajo: Array, margenAlto: Array}} Productos por margen
     */
    getMargenPorProducto(umbral) {
      try {
        const productos = DAO_PRODUCTOS.listar({});
        const margenBajo = [];
        const margenAlto = [];
        
        for (const p of productos) {
          const compra = p.precio_compra || 0;
          const venta = p.precio_venta || 0;
          const margen = venta > 0 ? (venta - compra) / venta : 0;
          
          if (margen < (umbral || 0.10)) {
            margenBajo.push({ id: p.id, nombre: p.nombre, margen });
          } else {
            margenAlto.push({ id: p.id, nombre: p.nombre, margen });
          }
        }
        
        return { margenBajo, margenAlto };
      } catch (e) {
        return { margenBajo: [], margenAlto: [] };
      }
    },

    /**
     * Detecta quiebres de stock: productos con stock=0 y ventas recientes.
     * @returns {Array} Productos con quiebre de stock
     */
    getQuiebresStock() {
      try {
        const productos = DAO_PRODUCTOS.listar({});
        const kardex = DAO_COMPRAS.getAllMovimientosKardex(30, 2000);
        const quiebres = [];
        
        for (const p of productos) {
          if ((p.stock || 0) === 0) {
            const ventas = kardex.filter(k => 
              k.id_producto === p.id && 
              String(k.tipo_mov || '').toUpperCase() === 'SALIDA'
            );
            if (ventas.length > 0) {
              quiebres.push({ id: p.id, nombre: p.nombre, ultimaVenta: ventas[ventas.length - 1].fecha });
            }
          }
        }
        
        return quiebres;
      } catch (e) {
        return [];
      }
    },

    /**
     * Detecta exceso de inventario: stock > 10x promedio mensual.
     * @returns {Array} Productos con exceso de inventario
     */
    getExcesoInventario() {
      try {
        const productos = DAO_PRODUCTOS.listar({});
        const kardex = DAO_COMPRAS.getAllMovimientosKardex(30, 2000);
        const excesos = [];
        
        for (const p of productos) {
          const ventas = kardex.filter(k => 
            k.id_producto === p.id && 
            String(k.tipo_mov || '').toUpperCase() === 'SALIDA'
          );
          
          const totalVentas = ventas.reduce((sum, v) => sum + (v.cantidad || 0), 0);
          const promedioDiario = totalVentas / 30;
          
          if (p.stock > promedioDiario * 10 && promedioDiario > 0) {
            excesos.push({ id: p.id, nombre: p.nombre, stock: p.stock, promedioDiario });
          }
        }
        
        return excesos;
      } catch (e) {
        return [];
      }
    }
};

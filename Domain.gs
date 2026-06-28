/**
 * LAYER 5: DOMAIN LOGIC — TRANSACCIONES SIMULADAS Y NEGOCIO
 * Resuelve Problemas #3, #4 y #5 
 */

/**
 * Mecanismo transaccional write-ahead para Apps Script.
 * Toma snapshot del estado previo de las filas afectadas antes de escribir.
 * Si ocurre cualquier fallo durante la escritura, revierte completamente:
 *   - Restaura filas de cartera a sus valores originales (snapshot)
 *   - Elimina filas de movimientos que se hayan añadido
 */
var _Transaction = {
  create() {
    const ctx = { carteraSnapshots: [], movPreRows: 0, movPostRows: 0, terceroSnapshots: [], productoSnapshots: [], compraSnapshots: [], pagoPreRows: 0, pagoPostRows: 0, detallePreRows: 0, detallePostRows: 0, active: false };

    return {
      begin() {
        ctx.active = true;
        ctx.carteraSnapshots = [];
        ctx.movPreRows = 0;
        ctx.movPostRows = 0;
        ctx.terceroSnapshots = [];
        ctx.productoSnapshots = [];
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
          for (const snap of ctx.terceroSnapshots) {
            const numCols = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.TERCEROS)) + 1;
            sheet.getRange(snap.rowIndex, 1, 1, numCols).setValues([snap.values]);
          }
          Logger.log("[FIX-M-02] Rollback de tercero completado para " + ctx.terceroSnapshots.length + " fila(s)");
        }
        // === FIN FIX M-02 ===
        const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
        for (const snap of ctx.carteraSnapshots) {
          const restoredRow = snap.values.slice();
          const numCols = restoredRow.length;
          sheet.getRange(snap.rowIndex, snap.startCol + 1, 1, numCols).setValues([restoredRow]);
        }
        if (ctx.movPostRows > ctx.movPreRows) {
          const movSheet = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
          const startRow = ctx.movPreRows + 1;
          const count = ctx.movPostRows - ctx.movPreRows;
          movSheet.deleteRows(startRow, count);
        }
        // Producto stock rollback
        if (ctx.productoSnapshots && ctx.productoSnapshots.length > 0) {
          const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
          for (const snap of ctx.productoSnapshots) {
            const numCols = snap.values.length;
            sheet.getRange(snap.rowIndex, snap.startCol + 1, 1, numCols).setValues([snap.values]);
          }
          Logger.log("[FIX-RBK-STOCK] Rollback de producto completado para " + ctx.productoSnapshots.length + " fila(s)");
        }
        // Compras rollback
        if (ctx.compraSnapshots && ctx.compraSnapshots.length > 0) {
          const compraSheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
          for (const snap of ctx.compraSnapshots) {
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
        LOG_ENGINE.logEvent("UPDATE_TERCERO", "TERCEROS", id, { nombre: "*" }, { nombre }, "SUCCESS");
      } else {
        LOG_ENGINE.logEvent("CREATE_TERCERO", "TERCEROS", id, {}, { nombre }, "SUCCESS");
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
    const MAX_TIMEOUT = 45000;
    
    try {
      const result = operation(txn);
      if (Date.now() - txn.startTime > MAX_TIMEOUT) {
        Logger.log("[TXN] WARNING: Transaction exceeded 45s timeout");
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

  registrarAbonoAtomic(idTercero, valorAbono, referencia, tipo, correlationId) {
    const idTerceroLimpio = _sanitizeId(idTercero);
    if (!idTerceroLimpio) return _error('ID tercero inválido.');

    const valor = _parseMoneda(valorAbono, NaN);
    if (isNaN(valor) || valor <= 0) return _error('Valor inválido (mínimo 1 centavo).');

    const tipoLimpio = tipo === CARTERA_CONFIG.TIPOS.CXP ? CARTERA_CONFIG.TIPOS.CXP : CARTERA_CONFIG.TIPOS.CXC;
    const refLimpia = String(referencia || "Abono").trim().slice(0, 100);

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
        const usuario = Session.getActiveUser().getEmail() || "SYSTEM";
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
          "SUCCESS");

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

  crearCarteraAtomic(idTercero, origenId, total, tipo, diasCredito) {
    const idTerceroLimpio = _sanitizeId(idTercero);
    const totalLimpio = _parseMoneda(total, NaN);
    let lockAcquired = null;

    try {
      if (!idTerceroLimpio) throw new Error("ID tercero inválido.");
      if (isNaN(totalLimpio) || totalLimpio <= 0) throw new Error("Monto inválido.");

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
        fecha_vencimiento: (() => { const d = _today(); d.setDate(d.getDate() + (parseInt(diasCredito) || 30)); return d; })(),
      };

      DAO.createCartera(record);
      CACHE.invalidateCartera();
      LOG_ENGINE.logEvent("CREATE_CARTERA", "CARTERA", idCartera, {}, { tercero: idTerceroLimpio, total: totalLimpio }, "SUCCESS");
      
      return idCartera;
    } finally {
      if (lockAcquired) lockAcquired.releaseLock();
    }
  },

  registrarCompraAtomic(proveedorId, items, total, fechaVencimiento, factura) {
    const idProv = _sanitizeId(proveedorId);
    if (!idProv) return _error("ID proveedor inválido.");
    const totalLimpio = _parseMoneda(total, NaN);
    if (isNaN(totalLimpio) || totalLimpio <= 0) return _error("Total inválido.");
    if (!items || items.length === 0) return _error("Debe incluir al menos un producto.");

    for (var _i = 0; _i < items.length; _i++) {
      var _item = items[_i];
      var _pid = _sanitizeId(_item.id || _item.productoId || _item.id_producto || "");
      var _cant = _parseMoneda(_item.cantidad || _item.cant || 0, 0);
      var _pUnit = _parseMoneda(_item.precio_unitario || _item.precio || 0, 0);
      if (!_pid) return _error("Producto inválido en el ítem #" + (_i + 1) + ".");
      if (_cant <= 0) return _error("Cantidad inválida en el ítem #" + (_i + 1) + ".");
      if (_pUnit <= 0) return _error("Precio unitario inválido en el ítem #" + (_i + 1) + ".");
    }

    var idFacturaLimpia = String(factura || "").trim();
    if (idFacturaLimpia) {
      var comprasExistentes = DAO_COMPRAS.getCompras(null, null);
      for (var _ck = 0; _ck < comprasExistentes.length; _ck++) {
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

        const idCompra = "CXP" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
        var fv = fechaVencimiento;
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

        var subtotalAcumulado = 0;
        for (var j = 0; j < items.length; j++) {
          var item = items[j];
          var prodId = _sanitizeId(item.id || item.productoId || item.id_producto || "");
          var cant = _parseMoneda(item.cantidad || item.cant || 0, 0);
          var pUnit = _parseMoneda(item.precio_unitario || item.precio || 0, 0);
          if (!prodId || cant <= 0) continue;
          var sub = cant * pUnit;
          subtotalAcumulado += sub;
          var detId = "DET" + Date.now() + j;
          DAO_COMPRAS.crearDetalleCompra({
            id: detId, id_compra: idCompra, id_producto: prodId,
            cantidad: cant, precio_unitario: pUnit, subtotal: sub,
          });
          try {
            var prodSheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
            var prodData = prodSheet.getDataRange().getValues();
            for (var p = 1; p < prodData.length; p++) {
              var pid = String(prodData[p][CONFIG.COLUMNS.PRODUCTOS.id] || "").trim();
              if (pid === prodId) {
                var currentStock = parseInt(prodData[p][CONFIG.COLUMNS.PRODUCTOS.stock]) || 0;
                prodSheet.getRange(p + 1, CONFIG.COLUMNS.PRODUCTOS.stock + 1).setValue(currentStock + cant);
                break;
              }
            }
          } catch (invErr) {
            Logger.log("[DOMAIN] Error actualizando inventario: " + invErr.toString());
          }
        }

        tx.markDetallePostAppend();
        tx.commit();

        CACHE.invalidateCartera();

        LOG_ENGINE.logEvent("CREATE_COMPRA", "COMPRAS", idCompra,
          {}, { proveedor: idProv, total: totalLimpio, items: items.length }, "SUCCESS");

        return { success: true, id: idCompra, total: totalLimpio };
      } catch (e) {
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

  procesarPagoProveedorAtomic(idCompra, monto, referencia) {
    var idCompraLimpio = String(idCompra || "").trim();
    if (!idCompraLimpio) return _error("ID de compra inválido.");
    var montoLimpio = _parseMoneda(monto, NaN);
    if (isNaN(montoLimpio) || montoLimpio <= 0) return _error("Monto inválido.");

    const MAX_RETRIES = 3;

    const _executePagoTx = () => {
      let lockAcquired = null;
      const tx = _Transaction.create();

      try {
        var compra = DAO_COMPRAS.getCompraById(idCompraLimpio);
        if (!compra) return _error("Compra no encontrada: " + idCompraLimpio);
        if (compra.estado === COMPRAS_CONFIG.ESTADOS.PAGADA) {
          return _error("La compra ya está pagada.");
        }

        lockAcquired = LOCK_MANAGER.acquireResourceLock(compra.id_proveedor);

        var nuevoSaldo = Math.max(0, compra.saldo - montoLimpio);
        var nuevoEstado = nuevoSaldo <= 0 ? COMPRAS_CONFIG.ESTADOS.PAGADA : COMPRAS_CONFIG.ESTADOS.PARCIAL;

        var pagoId = "PAG" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 8);

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
        const usuario = Session.getActiveUser().getEmail() || "SYSTEM";
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
          { saldo_anterior: compra.saldo }, { saldo_nuevo: nuevoSaldo, pago: montoLimpio }, "SUCCESS");

        return { success: true, id: pagoId, saldo_restante: nuevoSaldo, estado: nuevoEstado };
      } catch (e) {
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

  getVencimientosProximos(dias) {
    var hoy = _today();
    var limite = new Date(hoy.getTime() + dias * 86400000);

    var cartera = DOMAIN.getCartera(null, null, 5000, 0).items || [];
    var vencimientos = [];

    for (var i = 0; i < cartera.length; i++) {
      var c = cartera[i];
      if (c.estado === CARTERA_CONFIG.ESTADOS.CANCELADA) continue;
      var fv = _safeDate(c.fecha_vencimiento);
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

    var compras = DAO_COMPRAS.getCompras(null, null);
    var tercerosMap = {};
    if (CACHE.terceros) {
      CACHE.terceros.forEach(function(t) { tercerosMap[t.id] = t.nombre; });
    }
    for (var j = 0; j < compras.length; j++) {
      var cp = compras[j];
      if (cp.estado === COMPRAS_CONFIG.ESTADOS.PAGADA) continue;
      var cfv = _safeDate(cp.fecha_vencimiento);
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

  getRankingDeudores(topN) {
    if (topN === undefined) topN = 10;
    CACHE.refresh();
    var cartera = CACHE.cartera || [];
    var tercerosMap = {};
    if (CACHE.terceros) {
      CACHE.terceros.forEach(function(t) { tercerosMap[t.id] = t; });
    }

    var hoy = _today();
    var deudores = {};

    for (var i = 0; i < cartera.length; i++) {
      var c = cartera[i];
      if (c.tipo !== CARTERA_CONFIG.TIPOS.CXC) continue;
      if (c.estado === CARTERA_CONFIG.ESTADOS.CANCELADA) continue;
      var fv = _safeDate(c.fecha_vencimiento);
      if (!fv || fv.getTime() >= hoy.getTime()) continue;

      if (!deudores[c.id_tercero]) {
        var t = tercerosMap[c.id_tercero] || {};
        deudores[c.id_tercero] = {
          id: c.id_tercero,
          nombre: t.nombre || "DESCONOCIDO",
          saldo_vencido: 0,
          total_facturas: 0,
          max_dias: 0,
        };
      }
      var d = deudores[c.id_tercero];
      d.saldo_vencido += c.saldo;
      d.total_facturas++;
      var dd = Math.floor((hoy.getTime() - fv.getTime()) / 86400000);
      if (dd > d.max_dias) d.max_dias = dd;
    }

    var ranking = Object.values(deudores);
    ranking.sort(function(a, b) { return b.saldo_vencido - a.saldo_vencido; });
    return ranking.slice(0, topN);
  },

  getConcentracionProveedores() {
    CACHE.refresh();
    var cartera = CACHE.cartera || [];
    var tercerosMap = {};
    if (CACHE.terceros) {
      CACHE.terceros.forEach(function(t) { tercerosMap[t.id] = t; });
    }

    var proveedores = {};
    var totalCxP = 0;

    for (var i = 0; i < cartera.length; i++) {
      var c = cartera[i];
      if (c.tipo !== CARTERA_CONFIG.TIPOS.CXP) continue;
      if (c.estado === CARTERA_CONFIG.ESTADOS.CANCELADA) continue;

      if (!proveedores[c.id_tercero]) {
        var t = tercerosMap[c.id_tercero] || {};
        proveedores[c.id_tercero] = {
          id: c.id_tercero,
          nombre: t.nombre || "DESCONOCIDO",
          saldo: 0,
        };
      }
      proveedores[c.id_tercero].saldo += c.saldo;
      totalCxP += c.saldo;
    }

    var result = Object.values(proveedores);
    result.forEach(function(p) {
      p.porcentaje = totalCxP > 0 ? Math.round((p.saldo / totalCxP) * 10000) / 100 : 0;
    });
    result.sort(function(a, b) { return b.saldo - a.saldo; });
    return { items: result, total: totalCxP };
  },
};

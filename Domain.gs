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
    const ctx = { carteraSnapshots: [], movPreRows: 0, movPostRows: 0, active: false };

    return {
      begin() {
        ctx.active = true;
        ctx.carteraSnapshots = [];
        ctx.movPreRows = 0;
        ctx.movPostRows = 0;
      },

      snapshotCarteraRows(rowIndexes) {
        if (!ctx.active || !rowIndexes || rowIndexes.length === 0) return;
        const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
        const numCols = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.CARTERA)) + 1;
        const unique = [...new Set(rowIndexes)].sort((a, b) => a - b);
        for (const rowIndex of unique) {
          const values = sheet.getRange(rowIndex, 1, 1, numCols).getValues()[0];
          ctx.carteraSnapshots.push({ rowIndex, values });
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

      commit() {
        ctx.active = false;
        ctx.carteraSnapshots = [];
        ctx.movPreRows = 0;
        ctx.movPostRows = 0;
      },

      rollback() {
        if (!ctx.active) return;
        // Restaurar filas de cartera a su estado previo
        const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
        const numCols = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.CARTERA)) + 1;
        for (const snap of ctx.carteraSnapshots) {
          sheet.getRange(snap.rowIndex, 1, 1, numCols).setValues([snap.values]);
        }
        // Eliminar filas de movimientos añadidas durante la transacción
        if (ctx.movPostRows > ctx.movPreRows) {
          const movSheet = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
          const startRow = ctx.movPreRows + 1;
          const count = ctx.movPostRows - ctx.movPreRows;
          movSheet.deleteRows(startRow, count);
        }
        ctx.active = false;
      },
    };
  },
};

const DOMAIN = {
  saveTercero(tercero) {
    let lockAcquired = null;
    try {
      if (!tercero || typeof tercero !== 'object') return _error('Datos inválidos.');
      const id = _sanitizeId(tercero.id).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
      if (!id) return _error("ID de tercero inválido.");

      lockAcquired = LOCK_MANAGER.acquireResourceLock(id);

      const consistency = CACHE.verifyConsistency();
      if (consistency.mismatched) {
        Logger.log("DOMAIN: Inconsistencia detectada en caché antes de saveTercero. Forzando recuperación.");
        CACHE.recoverFromStale();
      }

      const nombre = String(tercero.nombre || "S.N.").trim().slice(0, 100);
      const tipo = ["CLIENTE", "PROVEEDOR"].includes(String(tercero.tipo || "").toUpperCase()) ? String(tercero.tipo).toUpperCase() : "CLIENTE";
      const limite = Math.max(0, _parseMoneda(tercero.limite_credito, 0));
      const activo = tercero.activo !== false ? "ACTIVO" : "INACTIVO";

      // 2. Operaciones Database — la caché debe estar poblada para que DAO valide unicidad
      const resultado = DAO.saveTerceroImpl(tercero, id, nombre, tipo, limite, activo);

      CACHE.invalidateTerceros();

      if (resultado.isUpdate) {
        LOG_ENGINE.logEvent("UPDATE_TERCERO", "TERCEROS", id, { nombre: "*" }, { nombre }, "SUCCESS");
      } else {
        LOG_ENGINE.logEvent("CREATE_TERCERO", "TERCEROS", id, {}, { nombre }, "SUCCESS");
      }

      return { success: true, id };

    } catch (e) {
      if(tercero && tercero.id) {
         LOG_ENGINE.logEvent("ERROR_TERCERO", "TERCEROS", tercero.id, {}, {}, "ERROR: " + e.toString());
      }
      return _error(e.message || "Error al guardar tercero.");
    } finally {
      if (lockAcquired) lockAcquired.releaseLock();
    }
  },

  getCartera(filtroEstado = null, filtroTipo = null) {
    const debeFiltrarVencida = filtroEstado === CARTERA_CONFIG.ESTADOS.VENCIDA;
    const baseCartera = DAO.getCartera(filtroTipo, debeFiltrarVencida ? null : filtroEstado);
    const hoy = _today();

    // PRE-CARGA EN MAP O(1) para evitar el cuello de llamadas n*1 iterativas (#4)
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
      return result.filter(c => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA);
    }
    return result;
  },

  registrarAbonoAtomic(idTercero, valorAbono, referencia, tipo) {
    let lockAcquired = null;
    const txPlan = { movimientos: [], cambios: [], logEntry: null };
    const tx = _Transaction.create();

    try {
      const idTerceroLimpio = _sanitizeId(idTercero);
      if (!idTerceroLimpio) return _error('ID tercero inválido.');

      // Lock Selectivo únicamente de ESE tercero.
      lockAcquired = LOCK_MANAGER.acquireResourceLock(idTerceroLimpio);

      const valor = _parseMoneda(valorAbono, NaN);
      if (isNaN(valor) || valor <= 0) return _error('Valor inválido (mínimo 1 centavo).');

      const tercero = DAO.getTerceroById(idTerceroLimpio);
      if (!tercero) {
        LOG_ENGINE.logEvent("ERROR_ABONO", "CARTERA", idTerceroLimpio, {}, { error: "TERCERO_NO_EXISTE" }, "ERROR");
        return _error(`Tercero ${idTerceroLimpio} no existe en la base de datos.`);
      }

      const tipoLimpio = tipo === CARTERA_CONFIG.TIPOS.CXP ? CARTERA_CONFIG.TIPOS.CXP : CARTERA_CONFIG.TIPOS.CXC;
      const refLimpia = String(referencia || "Abono").trim().slice(0, 100);

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

      let restante = valor;
      const fechaMov = new Date();
      const idPrefijo = "MOV" + Date.now() + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
      let movIdx = 0;

      for (const p of pendientes) {
        if (restante <= 0) break;

        const aplicado = Math.min(restante, p.saldo);
        const nuevoSaldo = p.saldo - aplicado;
        const nuevoEstado = nuevoSaldo <= 0 ? CARTERA_CONFIG.ESTADOS.CANCELADA : CARTERA_CONFIG.ESTADOS.PARCIAL;

        txPlan.movimientos.push({
          id: idPrefijo + "_" + (movIdx++), fecha: fechaMov, id_cartera: p.id,
          id_tercero: idTerceroLimpio, valor: aplicado,
          tipo_mov: (aplicado >= p.saldo) ? "CANCELACION" : "ABONO", referencia: refLimpia,
        });

        txPlan.cambios.push({ rowIndex: p.rowIndex, saldo: nuevoSaldo, estado: nuevoEstado });
        restante -= aplicado;
      }

      // ── TRANSACCIÓN: snapshot + escrituras con rollback compensatorio ──
      tx.begin();
      tx.snapshotCarteraRows(txPlan.cambios.map(c => c.rowIndex));
      tx.markMovPreAppend();

      if (txPlan.movimientos.length > 0) {
        for (const mov of txPlan.movimientos) { DAO.createMovimiento(mov); }
      }
      tx.markMovPostAppend();
      DAO.updateCarteraBatch(txPlan.cambios);

      tx.commit();
      // ── FIN TRANSACCIÓN ──

      // Invalidar caché después de todas las escrituras para evitar lecturas parciales.
      CACHE.invalidateCartera();

      LOG_ENGINE.logEvent("ABONO_PROCESADO", "CARTERA", idTerceroLimpio, { anterior_saldo: totalDeuda }, { nuevo_saldo: totalDeuda - valor, movimientos: txPlan.movimientos.length }, "SUCCESS");

      return { success: true, aplicado: valor - restante, restante: Math.max(0, restante), movimientos: txPlan.movimientos.length };

    } catch (e) {
      tx.rollback();
      LOG_ENGINE.logEvent("ERROR_ABONO", "CARTERA", idTercero, {}, { error: e.toString() }, "FAILED");
      return _error(e.message || "Error procesando abono.");
    } finally {
      if (lockAcquired) lockAcquired.releaseLock();
    }
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

      if (tipo === CARTERA_CONFIG.TIPOS.CXC && tercero.limite_credito > 0) {
        const saldoActual = CACHE.getSaldoTercero(idTerceroLimpio);
        if ((saldoActual + totalLimpio) > tercero.limite_credito) {
          throw new Error(`Límite de crédito superado. Disponible: $${_formatMoneda(tercero.limite_credito - saldoActual)}`);
        }
      }

      const consistency = CACHE.verifyConsistency();
      if (consistency.mismatched) {
        Logger.log("DOMAIN: Inconsistencia en caché antes de crearCarteraAtomic. Recuperando.");
        CACHE.recoverFromStale();
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
};

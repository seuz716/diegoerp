/**
 * LAYER 5: DOMAIN LOGIC — TRANSACCIONES SIMULADAS Y NEGOCIO
 * Resuelve Problemas:
 * - #5: PATRÓN DAO - Métodos asíncronos mal etiquetados.
 * - #8: DOMAIN utiliza DAO en lugar de acceder a CACHE directamente.
 * - #2 y #6: Absorbe orquestación de locks, logs y lógica de estados comerciales.
 */

const DOMAIN = {
  saveTercero(tercero) {
    let lockAcquired = null;
    try {
      lockAcquired = LOCK_MANAGER.acquireLock();

      if (!tercero || typeof tercero !== 'object') return _error('Datos inválidos.');

      const id = _sanitizeId(tercero.id).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
      if (!id) return _error("ID de tercero inválido.");

      const nombre = String(tercero.nombre || "S.N.").trim().slice(0, 100);
      const tipo = ["CLIENTE", "PROVEEDOR"].includes(String(tercero.tipo || "").toUpperCase())
        ? String(tercero.tipo).toUpperCase()
        : "CLIENTE";
      const limite = Math.max(0, _parseMoneda(tercero.limite_credito, 0));
      const activo = tercero.activo !== false ? "ACTIVO" : "INACTIVO";

      const resultado = DAO.saveTerceroImpl(tercero, id, nombre, tipo, limite, activo);

      if (resultado.isUpdate) {
        LOG_ENGINE.logEvent("UPDATE_TERCERO", "TERCEROS", id, { nombre: "*" }, { nombre }, "SUCCESS");
      } else {
        LOG_ENGINE.logEvent("CREATE_TERCERO", "TERCEROS", id, {}, { nombre }, "SUCCESS");
      }

      SpreadsheetApp.flush();
      CACHE.invalidateTerceros();
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

  getCartera(filtroTipo = null) {
    const baseCartera = DAO.getCarteraBase();
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    return baseCartera
      .map(c => {
        let estado = c.estado;
        if (estado !== CARTERA_CONFIG.ESTADOS.CANCELADA && _isValidDate(c.fecha_vencimiento)) {
          const fv = new Date(c.fecha_vencimiento); fv.setHours(0, 0, 0, 0);
          if (fv < hoy) estado = CARTERA_CONFIG.ESTADOS.VENCIDA;
        }

        const tercero = DAO.getTerceroById(c.id_tercero);
        return {
          ...c,
          estado,
          nombre_tercero: tercero ? tercero.nombre : "DESCONOCIDO",
          dias_vencido: (estado === CARTERA_CONFIG.ESTADOS.VENCIDA && _isValidDate(c.fecha_vencimiento))
            ? Math.floor((hoy - c.fecha_vencimiento) / 86400000)
            : 0,
        };
      })
      .filter(c => !filtroTipo || c.tipo === filtroTipo);
  },

  registrarAbonoAtomic(idTercero, valorAbono, referencia, tipo) {
    let lockAcquired = null;
    const txPlan = { movimientos: [], cambios: [], logEntry: null };

    try {
      lockAcquired = LOCK_MANAGER.acquireLock();

      const valor = _parseMoneda(valorAbono, NaN);
      if (isNaN(valor) || valor <= 0) return _error('Valor inválido (mínimo 1 centavo).');

      const idTerceroLimpio = _sanitizeId(idTercero);
      if (!idTerceroLimpio) return _error('ID tercero inválido.');

      const tercero = DAO.getTerceroById(idTerceroLimpio);
      if (!tercero) {
        LOG_ENGINE.logEvent("ERROR_ABONO", "CARTERA", idTerceroLimpio, {}, { error: "TERCERO_NO_EXISTE" }, "ERROR");
        return _error(`Tercero ${idTerceroLimpio} no existe en la base de datos.`);
      }

      const tipoLimpio = tipo === CARTERA_CONFIG.TIPOS.CXP ? CARTERA_CONFIG.TIPOS.CXP : CARTERA_CONFIG.TIPOS.CXC;
      const refLimpia = String(referencia || "Abono").trim().slice(0, 100);

      const pendientes = DAO.getCarteraBase()
        .filter(c => c.id_tercero === idTerceroLimpio && c.tipo === tipoLimpio && c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA && c.saldo > 0)
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
          id: idPrefijo + "_" + (movIdx++),
          fecha: fechaMov,
          id_cartera: p.id,
          id_tercero: idTerceroLimpio,
          valor: aplicado,
          tipo_mov: (aplicado >= p.saldo) ? "CANCELACION" : "ABONO",
          referencia: refLimpia,
        });

        txPlan.cambios.push({ rowIndex: p.rowIndex, saldo: nuevoSaldo, estado: nuevoEstado });
        restante -= aplicado;
      }

      if (txPlan.movimientos.length !== txPlan.cambios.length) {
        throw new Error("VALIDACIÓN INTERNA: inconsistencia movimientos vs cambios");
      }

      if (txPlan.movimientos.length > 0) {
        for (const mov of txPlan.movimientos) { DAO.createMovimiento(mov); }
      }

      DAO.updateCarteraBatch(txPlan.cambios);

      LOG_ENGINE.logEvent(
        "ABONO_PROCESADO", "CARTERA", idTerceroLimpio,
        { anterior_saldo: totalDeuda },
        { nuevo_saldo: totalDeuda - valor, movimientos: txPlan.movimientos.length }, "SUCCESS"
      );

      SpreadsheetApp.flush();
      CACHE.invalidateCartera(); 

      return { success: true, aplicado: valor - restante, restante: Math.max(0, restante), movimientos: txPlan.movimientos.length };

    } catch (e) {
      LOG_ENGINE.logEvent("ERROR_ABONO", "CARTERA", idTercero, {}, { error: e.toString() }, "FAILED");
      return _error(e.message || "Error procesando abono.");
    } finally {
      if (lockAcquired) lockAcquired.releaseLock();
    }
  },

  crearCarteraAtomic(idTercero, origenId, total, tipo, diasCredito) {
    const idTerceroLimpio = _sanitizeId(idTercero);
    const totalLimpio = _parseMoneda(total, NaN);

    if (!idTerceroLimpio) throw new Error("ID tercero inválido.");
    if (isNaN(totalLimpio) || totalLimpio <= 0) throw new Error("Monto inválido.");

    const tercero = DAO.getTerceroById(idTerceroLimpio);
    if (!tercero) { throw new Error(`Tercero ${idTerceroLimpio} no existe.`); }

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
      fecha_vencimiento: (() => { const d = new Date(); d.setDate(d.getDate() + (parseInt(diasCredito) || 30)); return d; })(),
    };

    DAO.createCartera(record);
    LOG_ENGINE.logEvent("CREATE_CARTERA", "CARTERA", idCartera, {}, { tercero: idTerceroLimpio, total: totalLimpio }, "SUCCESS");
    CACHE.invalidateCartera();
    return idCartera;
  },
};

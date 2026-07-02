// =============================================================================
// LAYER 6: ACCOUNTING MODULE — LIBRO DIARIO Y FLUJO DE CAJA
// Resuelve: Generación automática de asientos contables
// =============================================================================

const LIBRO_DIARIO_TIPOS = {
  ABONO_CLIENTE: "ABONO_CLIENTE",
  VENTA_CREDITO: "VENTA_CREDITO",
  VENTA_CONTADO: "VENTA_CONTADO",
  PAGO_PROVEEDOR: "PAGO_PROVEEDOR",
};

function _generarCSV(sheetName, colMap, headerRow, fieldGetter, fechaInicio, fechaFin) {
  try {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    const tz = _getTimeZone();
    const fi = _safeDate(fechaInicio);
    const ff = _safeDate(fechaFin);
    const rows = data.slice(1).filter(r => {
      const f = _safeDate(r[colMap.fecha]);
      return (!fi || !f || f >= fi) && (!ff || !f || f <= ff);
    });
    const csv = [headerRow];
    for (const r of rows) {
      csv.push(fieldGetter(r, colMap, tz));
    }
    return csv.join("\n");
  } catch (e) {
    Logger.log("ERROR _generarCSV(" + sheetName + "): " + e.toString());
    return "";
  }
}

const FLUJO_CAJA_TIPOS = {
  ENTRADA_ABONO: "ENTRADA_ABONO",
  SALIDA_PAGO_PROV: "SALIDA_PAGO_PROV",
  ENTRADA_VENTA: "ENTRADA_VENTA",
  SALIDA_COMPRA: "SALIDA_COMPRA",
  SALIDA_VENTA: "SALIDA_VENTA",
};

const LIBRO_DIARIO = {
  /**
   * Registers a customer payment (abono) in the libro diario.
   * @param {Date|string} fecha - Transaction date.
   * @param {string} id - Asiento/entry ID.
   * @param {string} tercero - Tercero/client ID.
   * @param {number} monto - Amount in centavos.
   * @param {string} usuario - User who registered the entry.
   * @returns {{success: boolean, id?: string, error?: string}}
   */
  registrarAbonoCliente(fecha, id, tercero, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.ABONO_CLIENTE, id, tercero, monto, usuario, "Abono de cliente");
  },

  /**
   * Registers a credit sale (venta crédito) in the libro diario.
   * @param {Date|string} fecha - Transaction date.
   * @param {string} id - Asiento/entry ID.
   * @param {string} tercero - Client ID.
   * @param {number} monto - Amount in centavos.
   * @param {string} usuario - User who registered the entry.
   * @returns {{success: boolean, id?: string, error?: string}}
   */
  registrarVentaCredito(fecha, id, tercero, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.VENTA_CREDITO, id, tercero, monto, usuario, "Venta crédito");
  },

  /**
   * Registers a cash sale (venta contado) in the libro diario.
   * @param {Date|string} fecha - Transaction date.
   * @param {string} id - Asiento/entry ID.
   * @param {string} tercero - Client ID.
   * @param {number} monto - Amount in centavos.
   * @param {string} usuario - User who registered the entry.
   * @returns {{success: boolean, id?: string, error?: string}}
   */
  registrarVentaContado(fecha, id, tercero, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.VENTA_CONTADO, id, tercero, monto, usuario, "Venta contado");
  },

  /**
   * Registers a generic sale (alias for registrarVentaContado) in the libro diario.
   * @param {Date|string} fecha - Transaction date.
   * @param {string} id - Asiento/entry ID.
   * @param {string} tercero - Client ID.
   * @param {number} monto - Amount in centavos.
   * @param {string} usuario - User who registered the entry.
   * @returns {{success: boolean, id?: string, error?: string}}
   */
  registrarVenta(fecha, id, tercero, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.VENTA_CONTADO, id, tercero, monto, usuario, "Venta");
  },

  /**
   * Registers a supplier payment (pago proveedor) in the libro diario.
   * @param {Date|string} fecha - Transaction date.
   * @param {string} id - Asiento/entry ID.
   * @param {string} proveedor - Supplier/proveedor ID.
   * @param {number} monto - Amount in centavos.
   * @param {string} usuario - User who registered the entry.
   * @returns {{success: boolean, id?: string, error?: string}}
   */
  registrarPagoProveedor(fecha, id, proveedor, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.PAGO_PROVEEDOR, id, proveedor, monto, usuario, "Pago a proveedor");
  },

  _registrarMovimiento(fecha, tipo, id, tercero, monto, usuario, descripcion) {
    // === INICIO FIX RACE-CONDITION ===
    const lock = LOCK_MANAGER.acquireGlobalLock(15000);
    try {
    // === FIN FIX RACE-CONDITION ===
      const sheet = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
      const COL = CONFIG.COLUMNS.LIBRO_DIARIO;
      const montoLimpio = _parseMoneda(monto, 0);
      const fechaLimpia = _safeDate(fecha) || _today();
      const idLimpio = String(id || "").trim().slice(0, 50);
      const terceroLimpio = String(tercero || "").trim().toUpperCase();
      const usuarioLimpio = String(usuario || "SYSTEM").trim().slice(0, 100);
      const descripcionLimpia = String(descripcion || "").trim().slice(0, 200);

      const rowData = [
        _sanitizeCell(idLimpio || ("ASIENTO_" + Date.now())),
        fechaLimpia,
        _sanitizeCell(tipo),
        _sanitizeCell(idLimpio),
        _sanitizeCell(terceroLimpio),
        montoLimpio,
        _sanitizeCell(usuarioLimpio),
        _sanitizeCell(descripcionLimpia)
      ];

      const lastRow = sheet.getLastRow() || 0;
      if (lastRow === 0) {
        sheet.appendRow(["ID", "Fecha", "Tipo", "ID_Referencia", "Tercero", "Monto", "Usuario", "Descripcion"]);
      }
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowData.length).setValues([rowData]);

      return { success: true, id: idLimpio };
    } catch (e) {
      Logger.log("ERROR LIBRO_DIARIO: Error en operación");
      return { success: false, error: e.message };
    } finally {
      // === INICIO FIX RACE-CONDITION ===
      if (lock) lock.releaseLock();
      // === FIN RACE-CONDITION ===
    }
  },

  /**
   * Exports libro diario entries to CSV format within a date range.
   * @param {Date|string} fechaInicio - Start date (inclusive).
   * @param {Date|string} fechaFin - End date (inclusive).
   * @returns {string} CSV content.
   */
  exportarCSV(fechaInicio, fechaFin) {
    const COL = CONFIG.COLUMNS.LIBRO_DIARIO;
    return _generarCSV(CONFIG.SHEETS.LIBRO_DIARIO, COL,
      "ID,Fecha,Tipo,ID_Referencia,Tercero,Monto,Usuario,Descripcion",
      (r, c, tz) => [
        r[c.id] || "",
        Utilities.formatDate(_safeDate(r[c.fecha]) || new Date(), tz, 'yyyy-MM-dd'),
        r[c.tipo] || "",
        r[c.id_referencia] || "",
        r[c.tercero] || "",
        r[c.monto] || 0,
        r[c.usuario] || "",
        r[c.descripcion] || ""
      ].join(","),
      fechaInicio, fechaFin);
  }
};

const FLUJO_CAJA = {
  TIPOS: FLUJO_CAJA_TIPOS,

  /**
   * Registers a cash flow movement in the flujo de caja sheet.
   * @param {Date|string} fecha - Movement date.
   * @param {string} tipo - Movement type (from FLUJO_CAJA_TIPOS).
   * @param {string} concepto - Description of the movement.
   * @param {number} monto - Amount in centavos.
   * @param {string} ref - Reference identifier.
   * @param {string} usuario - User who registered the movement.
   * @returns {{success: boolean, id?: string, error?: string}}
   */
  registrarMovimiento(fecha, tipo, concepto, monto, ref, usuario) {
    try {
      const sheet = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
      const COL = CONFIG.COLUMNS.FLUJO_CAJA;
      const montoLimpio = _parseMoneda(monto, 0);
      const fechaLimpia = _safeDate(fecha) || _today();
      const tipoLimpio = String(tipo || "").trim();
      const conceptoLimpio = String(concepto || "").trim().slice(0, 200);
      const refLimpia = String(ref || "").trim().slice(0, 100);
      const usuarioLimpio = String(usuario || "SYSTEM").trim().slice(0, 100);
      const idMov = "CAJA_" + Date.now() + "_" + Utilities.getUuid().replace(/-/g, "").slice(0, 6);

      const rowData = [
        _sanitizeCell(idMov),
        fechaLimpia,
        _sanitizeCell(tipoLimpio),
        _sanitizeCell(conceptoLimpio),
        montoLimpio,
        _sanitizeCell(refLimpia),
        _sanitizeCell(usuarioLimpio)
      ];

      const lastRow = sheet.getLastRow() || 0;
      if (lastRow === 0) {
        sheet.appendRow(["ID", "Fecha", "Tipo", "Concepto", "Monto", "Referencia", "Usuario"]);
      }
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowData.length).setValues([rowData]);

      return { success: true, id: idMov };
    } catch (e) {
      Logger.log("ERROR FLUJO_CAJA.registrarMovimiento: " + e.toString());
      return { success: false, error: e.message };
    }
  },

  /**
   * Gets a daily summary of cash flow for the last N days.
   * @param {number} dias - Number of days to look back.
   * @returns {{entradas: number, salidas: number, neto: number, saldo_actual: number}}
   */
  getResumenDiario(dias) {
    try {
      const sheet = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
      const data = sheet.getDataRange().getValues();
      const COL = CONFIG.COLUMNS.FLUJO_CAJA;

      const hoy = _today();
      const limite = new Date(hoy.getTime() - (dias || 1) * 86400000);

      let entradas = 0;
      let salidas = 0;

      for (let i = 1; i < data.length; i++) {
        const f = _safeDate(data[i][COL.fecha]);
        if (f && f >= limite && f <= hoy) {
          const m = _parseMoneda(data[i][COL.monto], 0);
          const t = String(data[i][COL.tipo] || "").trim();
          if (t === FLUJO_CAJA_TIPOS.ENTRADA_ABONO ||
              t === FLUJO_CAJA_TIPOS.ENTRADA_VENTA) {
            entradas += m;
          } else if (t === FLUJO_CAJA_TIPOS.SALIDA_PAGO_PROV ||
                     t === FLUJO_CAJA_TIPOS.SALIDA_COMPRA ||
                     t === FLUJO_CAJA_TIPOS.SALIDA_VENTA) {
            salidas += m;
          }
        }
      }

      const saldoActual = entradas - salidas;
      return { entradas, salidas, neto: saldoActual, saldo_actual: saldoActual };
    } catch (e) {
      Logger.log("ERROR FLUJO_CAJA.getResumenDiario: " + e.toString());
      return { entradas: 0, salidas: 0, neto: 0, saldo_actual: 0 };
    }
  },

  /**
   * Exports cash flow entries to CSV format within a date range.
   * @param {Date|string} fechaInicio - Start date (inclusive).
   * @param {Date|string} fechaFin - End date (inclusive).
   * @returns {string} CSV content.
   */
  exportarCSV(fechaInicio, fechaFin) {
    const COL = CONFIG.COLUMNS.FLUJO_CAJA;
    return _generarCSV(CONFIG.SHEETS.FLUJO_CAJA, COL,
      "ID,Fecha,Tipo,Concepto,Monto,Referencia,Usuario",
      (r, c, tz) => [
        r[c.id] || "",
        Utilities.formatDate(_safeDate(r[c.fecha]) || new Date(), tz, 'yyyy-MM-dd'),
        r[c.tipo] || "",
        r[c.concepto] || "",
        r[c.monto] || 0,
        r[c.referencia] || "",
        r[c.usuario] || ""
      ].join(","),
      fechaInicio, fechaFin);
  }
};
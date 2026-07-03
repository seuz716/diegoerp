// =============================================================================
// LAYER 6: ACCOUNTING MODULE — LIBRO DIARIO Y FLUJO DE CAJA
// Resuelve: Generación automática de asientos contables
// =============================================================================

const LIBRO_DIARIO_TIPOS = {
  ABONO_CLIENTE: "ABONO_CLIENTE",
  VENTA_CREDITO: "VENTA_CREDITO",
  VENTA_CONTADO: "VENTA_CONTADO",
  PAGO_PROVEEDOR: "PAGO_PROVEEDOR",
  COSTO_VENTAS: "COSTO_VENTAS",
};

function _csvEscape(valor) {
  var s = String(valor ?? "");
  var necesitaComillas = /[",\n]/.test(s);
  var protegido = /^[=+\-@]/.test(s) ? "'" + s : s;
  var escapado = protegido.replace(/"/g, '""');
  return necesitaComillas || /^[=+\-@]/.test(s) ? '"' + escapado + '"' : escapado;
}

function _generarCSV(sheetName, colMap, headerRow, fieldGetter, fechaInicio, fechaFin) {
  try {
    const sheet = getSheet(sheetName);
    const lastRow = sheet.getLastRow();
    const numCols = Math.max(...Object.values(colMap)) + 1;
    const MAX_ROWS = 50000; // Limit to prevent memory issues and timeouts
    const rowsToRead = Math.min(Math.max(lastRow, 1) - 1, MAX_ROWS);
    
    // Read in blocks for large sheets (same pattern as _readSheetRaw in CacheService)
    const data = rowsToRead > 0 ? _readSheetInBlocks(sheet, 2, rowsToRead, numCols) : [];
    const tz = _getTimeZone();
    const fi = _safeDate(fechaInicio);
    const ff = _safeDate(fechaFin);
    const rows = data.filter(r => {
      const f = _safeDate(r[colMap.fecha]);
      return (!fi || !f || f >= fi) && (!ff || !f || f <= ff);
    });
    const csv = [headerRow];
    for (const r of rows) {
      csv.push(fieldGetter(r, colMap, tz));
    }
    return csv.join("\n");
  } catch (e) {
    Logger.log("ERROR _generarCSV(" + sheetName + "): limit reached");
    return "";
  }
}

function _readSheetInBlocks(sheet, startRow, totalRows, numCols) {
  if (totalRows <= 0) return [];
  const ITEMS_PER_BLOCK = 20000;
  if (totalRows <= 50000) {
    return sheet.getRange(startRow, 1, totalRows, numCols).getValues();
  }
  Logger.log("[FIX-PERF-2.3] Large sheet: " + totalRows + " rows, reading in blocks of " + ITEMS_PER_BLOCK);
  let result = [];
  for (let offset = 0; offset < totalRows; offset += ITEMS_PER_BLOCK) {
    const blockSize = Math.min(ITEMS_PER_BLOCK, totalRows - offset);
    const block = sheet.getRange(startRow + offset, 1, blockSize, numCols).getValues();
    result = result.concat(block);
  }
  return result;
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

  /**
   * Registers cost of goods sold (COGS) in the libro diario.
   * @param {Date|string} fecha - Transaction date.
   * @param {string} id - Asiento/entry ID (usually the sale ID).
   * @param {string} proveedorOrCliente - Related third party ID.
   * @param {number} monto - COGS amount in centavos.
   * @param {string} usuario - User who registered the entry.
   * @returns {{success: boolean, id?: string, error?: string}}
   */
  registrarCostoVentas(fecha, id, proveedorOrCliente, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.COSTO_VENTAS, id, proveedorOrCliente, monto, usuario, "Costo de ventas");
  },

  _registrarMovimiento(fecha, tipo, id, tercero, monto, usuario, descripcion) {
    const lock = LOCK_MANAGER.acquireResourceLock(id || tipo);
    if (!lock) {
      Logger.log("ERROR LIBRO_DIARIO: No se pudo adquirir lock");
      return { success: false, error: "No se pudo adquirir lock para escritura en libro diario" };
    }
    try {
      const sheet = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
      const montoLimpio = _parseMoneda(monto, 0);
      const fechaLimpia = _safeDate(fecha) || _today();
      const idGenerado = String(id || "").trim().slice(0, 50) || ("ASIENTO_" + Date.now());
      const terceroLimpio = String(tercero || "").trim().toUpperCase();
      const usuarioLimpio = String(usuario || "SYSTEM").trim().slice(0, 100);
      const descripcionLimpia = String(descripcion || "").trim().slice(0, 200);

      const rowData = [
        _sanitizeCell(idGenerado),
        fechaLimpia,
        _sanitizeCell(tipo),
        _sanitizeCell(idGenerado),
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

      return { success: true, id: idGenerado };
    } catch (e) {
      Logger.log("ERROR LIBRO_DIARIO: " + e.toString());
      return { success: false, error: e.message };
    } finally {
      if (lock) lock.releaseLock();
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
        _csvEscape(r[c.id]),
        Utilities.formatDate(_safeDate(r[c.fecha]) || new Date(), tz, 'yyyy-MM-dd'),
        _csvEscape(r[c.tipo]),
        _csvEscape(r[c.id_referencia]),
        _csvEscape(r[c.tercero]),
        _csvEscape(r[c.monto]),
        _csvEscape(r[c.usuario]),
        _csvEscape(r[c.descripcion])
      ].join(","),
      fechaInicio, fechaFin);
  }
};

const FLUJO_CAJA = {
  TIPOS: FLUJO_CAJA_TIPOS,

  /**
   * Calculates Cost of Goods Sold (COGS) for a given period.
   * Sum of (SALIDAS en KARDEX × costo_unitario) vs LIBRO_DIARIO tipo COSTO_VENTAS.
   * @param {Date|string} fechaInicio - Start date of period
   * @param {Date|string} fechaFin - End date of period
   * @returns {{cogsKardex: number, cogsLibroDiario: number, diferencia: number}}
   */
  calcularCostoDeVentas(fechaInicio, fechaFin) {
    const fi = _safeDate(fechaInicio);
    const ff = _safeDate(fechaFin);
    if (!fi || !ff) return { cogsKardex: 0, cogsLibroDiario: 0, diferencia: 0 };
    
    const KCOL = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const kardexSheet = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const kardexRaw = kardexSheet ? kardexSheet.getDataRange().getValues() : [];
    const MAX_ROWS = 10000;
    const kardexData = kardexRaw.length > MAX_ROWS + 1 ? kardexRaw.slice(0, MAX_ROWS + 1) : kardexRaw;
    
    let cogsKardex = 0;
    for (let i = 1; i < kardexData.length; i++) {
      const fecha = _safeDate(kardexData[i][KCOL.fecha]);
      if (!fecha || fecha < fi || fecha > ff) continue;
      const tipoMov = String(kardexData[i][KCOL.tipo_mov] || "").toUpperCase();
      if (tipoMov !== "SALIDA") continue;
      const costoUnitario = _parseMoneda(kardexData[i][KCOL.costo_unitario] || 0, 0);
      const cantidad = _parseMoneda(kardexData[i][KCOL.cantidad], 0);
      cogsKardex += costoUnitario * cantidad;
    }
    
    const LD_COL = CONFIG.COLUMNS.LIBRO_DIARIO;
    const ldSheet = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
    const ldRaw = ldSheet ? ldSheet.getDataRange().getValues() : [];
    const ldData = ldRaw.length > MAX_ROWS + 1 ? ldRaw.slice(0, MAX_ROWS + 1) : ldRaw;
    
    let cogsLibroDiario = 0;
    for (let i = 1; i < ldData.length; i++) {
      const fecha = _safeDate(ldData[i][LD_COL.fecha]);
      if (!fecha || fecha < fi || fecha > ff) continue;
      const tipo = String(ldData[i][LD_COL.tipo] || "").trim();
      if (tipo === "COSTO_VENTAS") {
        cogsLibroDiario += _parseMoneda(ldData[i][LD_COL.monto], 0);
      }
    }
    
    return {
      cogsKardex: cogsKardex,
      cogsLibroDiario: cogsLibroDiario,
      diferencia: Math.abs(cogsKardex - cogsLibroDiario)
    };
  },

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
    const idMov = "CAJA_" + Date.now() + "_" + Utilities.getUuid().replace(/-/g, "").slice(0, 6);
    const lock = LOCK_MANAGER.acquireResourceLock(idMov);
    if (!lock) {
      Logger.log("ERROR FLUJO_CAJA: No se pudo adquirir lock");
      return { success: false, error: "No se pudo adquirir lock para escritura en flujo de caja" };
    }
    try {
      const sheet = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
      const COL = CONFIG.COLUMNS.FLUJO_CAJA;
      const montoLimpio = _parseMoneda(monto, 0);
      const fechaLimpia = _safeDate(fecha) || _today();
      const tipoLimpio = String(tipo || "").trim();
      const conceptoLimpio = String(concepto || "").trim().slice(0, 200);
      const refLimpia = String(ref || "").trim().slice(0, 100);
      const usuarioLimpio = String(usuario || "SYSTEM").trim().slice(0, 100);

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
    } finally {
      if (lock) lock.releaseLock();
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
      if (!sheet) return { entradas: 0, salidas: 0, neto: 0, saldo_actual: 0 };
      
      const COL = CONFIG.COLUMNS.FLUJO_CAJA;
      const lastRow = Math.max(sheet.getLastRow(), 1);
      const MAX_ROWS = 10000;
      const rowsToRead = Math.min(lastRow, MAX_ROWS);
      const data = rowsToRead > 1 ? sheet.getRange(2, 1, rowsToRead - 1, Object.keys(COL).length).getValues() : [];
      
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
   * Calculates the current cash balance from all movements.
   * @returns {number} Current cash balance (entradas - salidas).
   */
  obtenerSaldoActual() {
    try {
      const sheet = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
      if (!sheet) return 0;
      
      const COL = CONFIG.COLUMNS.FLUJO_CAJA;
      const lastRow = Math.max(sheet.getLastRow(), 1);
      const MAX_ROWS = 10000;
      const rowsToRead = Math.min(lastRow, MAX_ROWS);
      const data = rowsToRead > 1 ? sheet.getRange(2, 1, rowsToRead - 1, Object.keys(COL).length).getValues() : [];
      
      let entradas = 0;
      let salidas = 0;
      
      for (let i = 0; i < data.length; i++) {
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
      
      return entradas - salidas;
    } catch (e) {
      Logger.log("ERROR FLUJO_CAJA.obtenerSaldoActual: " + e.toString());
      return 0;
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
        _csvEscape(r[c.id]),
        Utilities.formatDate(_safeDate(r[c.fecha]) || new Date(), tz, 'yyyy-MM-dd'),
        _csvEscape(r[c.tipo]),
        _csvEscape(r[c.concepto]),
        _csvEscape(r[c.monto]),
        _csvEscape(r[c.referencia]),
        _csvEscape(r[c.usuario])
      ].join(","),
      fechaInicio, fechaFin);
  }
};
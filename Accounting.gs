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

const FLUJO_CAJA_TIPOS = {
  ENTRADA_ABONO: "ENTRADA_ABONO",
  SALIDA_PAGO_PROV: "SALIDA_PAGO_PROV",
  ENTRADA_VENTA: "ENTRADA_VENTA",
  SALIDA_COMPRA: "SALIDA_COMPRA",
};

const LIBRO_DIARIO = {
  registrarAbonoCliente(fecha, id, tercero, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.ABONO_CLIENTE, id, tercero, monto, usuario, "Abono de cliente");
  },

  registrarVentaCredito(fecha, id, tercero, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.VENTA_CREDITO, id, tercero, monto, usuario, "Venta crédito");
  },

  registrarVentaContado(fecha, id, tercero, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.VENTA_CONTADO, id, tercero, monto, usuario, "Venta contado");
  },

  registrarPagoProveedor(fecha, id, proveedor, monto, usuario) {
    return this._registrarMovimiento(fecha, LIBRO_DIARIO_TIPOS.PAGO_PROVEEDOR, id, proveedor, monto, usuario, "Pago a proveedor");
  },

  _registrarMovimiento(fecha, tipo, id, tercero, monto, usuario, descripcion) {
    try {
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
      Logger.log("ERROR LIBRO_DIARIO: " + e.toString());
      return { success: false, error: e.message };
    }
  },

  exportarCSV(fechaInicio, fechaFin) {
    try {
      const sheet = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
      const data = sheet.getDataRange().getValues();
      const COL = CONFIG.COLUMNS.LIBRO_DIARIO;

      const tz = _getTimeZone();
      const fi = _safeDate(fechaInicio);
      const ff = _safeDate(fechaFin);

      const rows = data.slice(1).filter(r => {
        const f = _safeDate(r[COL.fecha]);
        return (!fi || !f || f >= fi) && (!ff || !f || f <= ff);
      });

      const csv = ["ID,Fecha,Tipo,ID_Referencia,Tercero,Monto,Usuario,Descripcion"];
      for (const r of rows) {
        csv.push([
          r[COL.id] || "",
          Utilities.formatDate(_safeDate(r[COL.fecha]) || new Date(), tz, 'yyyy-MM-dd'),
          r[COL.tipo] || "",
          r[COL.id_referencia] || "",
          r[COL.tercero] || "",
          r[COL.monto] || 0,
          r[COL.usuario] || "",
          r[COL.descripcion] || ""
        ].join(","));
      }
      return csv.join("\n");
    } catch (e) {
      Logger.log("ERROR LIBRO_DIARIO.exportarCSV: " + e.toString());
      return "";
    }
  }
};

const FLUJO_CAJA = {
  TIPOS: FLUJO_CAJA_TIPOS,

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
                     t === FLUJO_CAJA_TIPOS.SALIDA_COMPRA) {
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

  exportarCSV(fechaInicio, fechaFin) {
    try {
      const sheet = getSheet(CONFIG.SHEETS.FLUJO_CAJA);
      const data = sheet.getDataRange().getValues();
      const COL = CONFIG.COLUMNS.FLUJO_CAJA;

      const tz = _getTimeZone();
      const fi = _safeDate(fechaInicio);
      const ff = _safeDate(fechaFin);

      const rows = data.slice(1).filter(r => {
        const f = _safeDate(r[COL.fecha]);
        return (!fi || !f || f >= fi) && (!ff || !f || f <= ff);
      });

      const csv = ["ID,Fecha,Tipo,Concepto,Monto,Referencia,Usuario"];
      for (const r of rows) {
        csv.push([
          r[COL.id] || "",
          Utilities.formatDate(_safeDate(r[COL.fecha]) || new Date(), tz, 'yyyy-MM-dd'),
          r[COL.tipo] || "",
          r[COL.concepto] || "",
          r[COL.monto] || 0,
          r[COL.referencia] || "",
          r[COL.usuario] || ""
        ].join(","));
      }
      return csv.join("\n");
    } catch (e) {
      Logger.log("ERROR FLUJO_CAJA.exportarCSV: " + e.toString());
      return "";
    }
  }
};
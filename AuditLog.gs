/**
 * LAYER 2: LOGGING ENGINE — AUDITORÍA INMUTABLE
 */

const LOG_ENGINE = {
  /**
   * Registra cambio en hoja.
   * INMUTABLE: append-only
   */
  logEvent(operacion, tabla, idRegistro, datosPrevios, datosNuevos, estado = "SUCCESS") {
    try {
      const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
      if (!sheetAudit) return false;

      const usuario = Session.getActiveUser().getEmail();
      const timestamp = new Date();
      const id = "LOG_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);

      const rowData = [
        id,
        timestamp,
        operacion,
        tabla,
        idRegistro,
        usuario,
        JSON.stringify(datosPrevios || {}),
        JSON.stringify(datosNuevos || {}),
        estado,
      ];

      // BATCH: no appendRow, sino getLastRow + setValues
      const lastRow = sheetAudit.getLastRow() || 0;
      if (lastRow === 0) {
        sheetAudit.appendRow(["ID", "Timestamp", "Operacion", "Tabla", "ID_Registro", "Usuario", "Datos_Previos", "Datos_Nuevos", "Estado"]);
      }
      sheetAudit.getRange(sheetAudit.getLastRow() + 1, 1, 1, 9).setValues([rowData]);
      SpreadsheetApp.flush();
      return true;
    } catch (e) {
      Logger.log("ERROR LOG_ENGINE:" + e.toString());
      return false;
    }
  },

  /**
   * Obtiene log de un registro
   */
  getHistory(tabla, idRegistro, limit = 50) {
    try {
      const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
      if (!sheetAudit) return [];

      const data = sheetAudit.getDataRange().getValues();
      const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;

      return data.slice(1)
        .filter(r => String(r[COL.tabla]).trim() === tabla && String(r[COL.id_registro]).trim() === idRegistro)
        .map(r => ({
          id: String(r[COL.id]).trim(),
          timestamp: r[COL.timestamp],
          operacion: String(r[COL.operacion]).trim(),
          usuario: String(r[COL.usuario]).trim(),
          previos: JSON.parse(r[COL.datos_previos] || "{}"),
          nuevos: JSON.parse(r[COL.datos_nuevos] || "{}"),
          estado: String(r[COL.estado]).trim(),
        }))
        .slice(-limit)
        .reverse();
    } catch (e) {
      Logger.log("ERROR LOG_ENGINE.getHistory:" + e.toString());
      return [];
    }
  },
};

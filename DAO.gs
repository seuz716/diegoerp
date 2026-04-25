/**
 * LAYER 4: DAO — DATA ACCESS OBJECT
 * Resuelve Problemas: 
 * - #2: Escrito optimizado limitando getDataRange (Cuotas Scripting).
 */

const DAO = {
  getTerceroById(id) {
    const idClean = _sanitizeId(id);
    if (!idClean) return null;
    return CACHE.getTerceroRAW(idClean);
  },

  getCarteraBase() {
    return CACHE.getCarteraBase();
  },

  saveTerceroImpl(tercero, id, nombre, tipo, limite, activo) {
      const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
      const rowExisting = CACHE.terceroIndex[id];

      const rowData = [id, nombre, "", tipo, limite, activo];

      if (rowExisting) {
        sheet.getRange(rowExisting + 1, 1, 1, 6).setValues([rowData]);
        return { isUpdate: true };
      } else {
        const lastRow = sheet.getLastRow() || 0;
        if (lastRow === 0) {
          sheet.appendRow(["ID", "Nombre", "Teléfono", "Tipo", "Límite_Crédito", "Activo"]);
        }
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([rowData]);
        return { isUpdate: false };
      }
  },

  /**
   * ACTUALIZACIÓN OPTIMIZADA - No lee Array entero, evita Timeout.
   */
  updateCarteraBatch(cambios) {
    if (!cambios || cambios.length === 0) return true;

    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;

    // Solo tocamos las filas específicas, evitando exceder la cuota O(1) de Google por fila.
    for (const cambio of cambios) {
      if (cambio.rowIndex > 0) {
         // Índice +1 para filas en GSheets (las columnas son 0-based en array interno pero 1-based en range)
         sheet.getRange(cambio.rowIndex, COL.saldo + 1, 1, 1).setValue(cambio.saldo);
         sheet.getRange(cambio.rowIndex, COL.estado + 1, 1, 1).setValue(cambio.estado);
      }
    }

    return true;
  },

  createMovimiento(mov) {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
    const lastRow = sheet.getLastRow() || 0;

    if (lastRow === 0) {
      sheet.appendRow(["ID", "Fecha", "ID_Cartera", "ID_Tercero", "Valor", "Tipo_Mov", "Referencia"]);
    }

    const rowData = [mov.id, mov.fecha, mov.id_cartera, mov.id_tercero, mov.valor, mov.tipo_mov, mov.referencia];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setValues([rowData]);
    return true;
  },

  createCartera(c) {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const lastRow = sheet.getLastRow() || 0;

    if (lastRow === 0) {
      sheet.appendRow(["ID", "Fecha", "ID_Tercero", "Origen_ID", "Total", "Saldo", "Tipo", "Estado", "Fecha_Vencimiento"]);
    }

    const rowData = [c.id, c.fecha, c.id_tercero, c.origen_id, c.total, c.saldo, c.tipo, c.estado, c.fecha_vencimiento];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 9).setValues([rowData]);
    return true;
  },
};

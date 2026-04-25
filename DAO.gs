/**
 * LAYER 4: DAO — DATA ACCESS OBJECT
 * Resuelve Problemas: 
 * - #2: Logica y logs movidos a Domain.
 * - #6: getCartera delega cálculo a Domain.
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

  updateCarteraBatch(cambios) {
    if (!cambios || cambios.length === 0) return true;

    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;

    const fullData = sheet.getDataRange().getValues();

    for (const cambio of cambios) {
      if (cambio.rowIndex > 0 && cambio.rowIndex <= fullData.length) {
        fullData[cambio.rowIndex - 1][COL.saldo] = cambio.saldo;
        fullData[cambio.rowIndex - 1][COL.estado] = cambio.estado;
      }
    }

    sheet.getRange(1, 1, fullData.length, fullData[0].length).setValues(fullData);
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

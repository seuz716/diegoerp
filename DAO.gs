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

  getCartera(filtroTipo = null, filtroEstado = null) {
    if (!filtroTipo && !filtroEstado) {
      return this.getCarteraBase();
    }

    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const numCols = Math.max(...Object.values(COL)) + 1;

    let rowIndexes = null;
    if (filtroTipo) {
      rowIndexes = this._findRowIndexesByColumnValue(sheet, COL.tipo, filtroTipo);
    }

    if (filtroEstado) {
      const estadoRows = this._findRowIndexesByColumnValue(sheet, COL.estado, filtroEstado);
      if (rowIndexes === null) {
        rowIndexes = estadoRows;
      } else {
        const estadoSet = new Set(estadoRows);
        rowIndexes = rowIndexes.filter(row => estadoSet.has(row));
      }
    }

    if (!rowIndexes || rowIndexes.length === 0) {
      return [];
    }

    return this._fetchCarteraItemsFromRows(sheet, rowIndexes, numCols);
  },

  getCarteraByTerceroAndTipo(idTercero, tipoLimpio) {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const numCols = Math.max(...Object.values(COL)) + 1;
    const rowIndexes = this._findRowIndexesByColumnValue(sheet, COL.id_tercero, idTercero);

    if (!rowIndexes || rowIndexes.length === 0) {
      return [];
    }

    return this._fetchCarteraItemsFromRows(sheet, rowIndexes, numCols)
      .filter(c => c.tipo === tipoLimpio && c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA && c.saldo > 0);
  },

  _findRowIndexesByColumnValue(sheet, colIndex, value) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const range = sheet.getRange(2, colIndex + 1, lastRow - 1, 1);
    const matches = range.createTextFinder(String(value))
      .matchEntireCell(true)
      .useRegularExpression(false)
      .findAll();

    if (!matches || matches.length === 0) return [];
    return matches.map(match => match.getRow());
  },

  _fetchCarteraItemsFromRows(sheet, rowIndexes, numCols) {
    if (!rowIndexes || rowIndexes.length === 0) return [];

    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const uniqueRows = Array.from(new Set(rowIndexes)).sort((a, b) => a - b);
    const groups = [];
    let start = uniqueRows[0];
    let end = start;

    for (let i = 1; i < uniqueRows.length; i++) {
      const row = uniqueRows[i];
      if (row === end + 1) {
        end = row;
      } else {
        groups.push({ start, end });
        start = row;
        end = row;
      }
    }
    groups.push({ start, end });

    const items = [];
    for (const group of groups) {
      const values = sheet.getRange(group.start, 1, group.end - group.start + 1, numCols).getValues();
      for (let i = 0; i < values.length; i++) {
        items.push(this._rowToCarteraItem(values[i]));
      }
    }

    return items;
  },

  _rowToCarteraItem(row) {
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    return {
      id: String(row[COL.id] || "").trim(),
      fecha: _safeDate(row[COL.fecha]),
      id_tercero: String(row[COL.id_tercero] || "").trim(),
      origen_id: String(row[COL.origen_id] || "").trim(),
      total: _parseMoneda(row[COL.total], 0),
      saldo: _parseMoneda(row[COL.saldo], 0),
      tipo: String(row[COL.tipo] || "").trim(),
      estado: String(row[COL.estado] || "").trim(),
      fecha_vencimiento: _safeDate(row[COL.fecha_vencimiento]),
    };
  },

  saveTerceroImpl(tercero, id, nombre, tipo, limite, activo) {
      const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
      const rowData = [id, nombre, "", tipo, limite, activo];

      const cachedRow = CACHE.terceroIndex[id];
      let rowExisting = null;
      if (cachedRow) {
        rowExisting = cachedRow;
      } else if (sheet.getLastRow() > 1) {
        const match = this._findRowIndexesByColumnValue(sheet, CARTERA_CONFIG.COLUMNS.TERCEROS.id, id);
        if (match.length > 0) {
          rowExisting = match[0] - 1;
        }
      }

      if (rowExisting) {
        sheet.getRange(rowExisting + 1, 1, 1, 6).setValues([rowData]);
        return { isUpdate: true };
      }

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["ID", "Nombre", "Teléfono", "Tipo", "Límite_Crédito", "Activo"]);
      }
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([rowData]);
      return { isUpdate: false };
  },

  /**
   * ACTUALIZACIÓN OPTIMIZADA - No lee Array entero, evita Timeout.
   * Agrupa TODOS los cambios en una sola llamada setValues() para minimizar llamadas a la API.
   */
  updateCarteraBatch(cambios) {
    if (!cambios || cambios.length === 0) return true;

    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA; // Estas son las columnas 0-based del array interno

    let minRow = Infinity;
    let maxRow = -Infinity;

    // Identificar las columnas mínimas y máximas afectadas (asumimos que COL.saldo y COL.estado son 0-based)
    const minColIdx = Math.min(COL.saldo, COL.estado);
    const maxColIdx = Math.max(COL.saldo, COL.estado);
    const numColsToProcess = maxColIdx - minColIdx + 1; // Número de columnas en el bloque a leer/escribir

    const rowMap = new Map(); // Para almacenar los cambios por fila y evitar duplicados si hay varios cambios para la misma fila
    for (const cambio of cambios) {
      if (cambio.rowIndex > 0) { // rowIndex es 1-based del sheet
        minRow = Math.min(minRow, cambio.rowIndex);
        maxRow = Math.max(maxRow, cambio.rowIndex);
        rowMap.set(cambio.rowIndex, cambio); // Guardamos el último cambio para esta fila
      }
    }

    if (minRow === Infinity) return true; // No hay cambios válidos

    const numRowsToProcess = maxRow - minRow + 1;

    // Obtener el rango completo de datos afectados en una sola llamada
    // minRow es 1-based, minColIdx + 1 es 1-based
    const targetRange = sheet.getRange(minRow, minColIdx + 1, numRowsToProcess, numColsToProcess);
    const values = targetRange.getValues(); // Obtener todos los valores del rango en un array 2D (0-based)

    // Aplicar los cambios al array local en memoria
    for (const [rowIndex, cambio] of rowMap.entries()) {
      const localRowIndex = rowIndex - minRow; // Convertir el índice de fila de hoja a índice de array local (0-based)

      if (localRowIndex >= 0 && localRowIndex < numRowsToProcess) { // Corrección aquí
        // Convertir el índice de columna de COL (0-based) a índice de array local (0-based respecto a minColIdx)
        const localColIndexSaldo = COL.saldo - minColIdx;
        const localColIndexEstado = COL.estado - minColIdx;

        values[localRowIndex][localColIndexSaldo] = cambio.saldo;
        values[localRowIndex][localColIndexEstado] = cambio.estado;
      }
    }

    // Escribir todos los cambios de vuelta a la hoja en una sola llamada
    targetRange.setValues(values);

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


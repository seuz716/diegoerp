/**
 * LAYER 4: DAO — DATA ACCESS OBJECT
 * Resuelve Problemas: 
 * - #2: Escrito optimizado limitando getDataRange (Cuotas Scripting).
 */

/**
 * Custom error for DAO layer operations.
 * @param {string} message - Error description.
 * @param {string} code - Error code (e.g. SHEET_WRITE_FAILURE).
 * @param {*} [details] - Additional error context.
 */
class DAOError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "DAOError";
    this.code = code;
    this.details = details;
  }
}

function _sanitizeCell(value) {
  if (typeof value === 'string' && value.length > 0) {
    return "'" + value;
  }
  return value;
}

const DAO = {
  /**
   * Batch insert multiple rows efficiently
   * @param {string} sheetName - Sheet name
   * @param {Array<Array>} rows - Array of row arrays to insert
   * @param {number} startRow - Starting row (default: lastRow + 1)
   */
  batchInsert(sheetName, rows, startRow = null) {
    if (!rows || rows.length === 0) return;
    // === INICIO FIX RACE-CONDITION ===
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
    // === FIN FIX RACE-CONDITION ===
      const sheet = getSheet(sheetName);
      if (!sheet) return;
      const row = startRow || sheet.getLastRow() + 1;
      sheet.getRange(row, 1, rows.length, rows[0].length).setValues(rows);
    } catch (e) {
      Logger.log(`[DAO.batchInsert] Error: Error en operación`);
      LogService.logError('Error en batchInsert', { functionName: 'batchInsert', error: e });
      throw e;
    } finally {
      // === INICIO FIX RACE-CONDITION ===
      if (lock) lock.releaseLock();
      // === FIN RACE-CONDITION ===
    }
  },

  /**
   * Retrieves a tercero by ID from cache.
   * @param {string} id - Tercero identifier.
   * @returns {Object|null} Tercero object or null if not found.
   */
  getTerceroById(id) {
    const idClean = _sanitizeId(id);
    if (!idClean) return null;
    return CACHE.getTerceroRAW(idClean);
  },

  /**
   * Retrieves the base cartera list from cache.
   * @returns {Array<Object>} List of cartera items.
   */
  getCarteraBase() {
    return CACHE.getCarteraBase();
  },

  /**
   * Retrieves paginated cartera records with optional filters.
   * @param {string|null} [filtroTipo] - Filter by type (CxC/CxP).
   * @param {string|null} [filtroEstado] - Filter by estado.
   * @param {number} [pageSize=5000] - Max items per page (max 5000).
   * @param {number} [pageToken=0] - Zero-based offset for pagination.
   * @returns {{items: Array<Object>, nextPageToken: (number|null)}} Paginated results.
   */
  getCartera(filtroTipo = null, filtroEstado = null, pageSize = 5000, pageToken = 0) {
    pageSize = Math.min(5000, pageSize);
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const numCols = Math.max(...Object.values(COL)) + 1;
    const lastRow = sheet.getLastRow();

    Logger.log("[DAO.getCartera] filtroTipo=" + filtroTipo + ", filtroEstado=" + filtroEstado + ", lastRow=" + lastRow);

    if (!filtroTipo && !filtroEstado) {
      if (lastRow < 2) return { items: [], nextPageToken: null };
      const startRow = 2 + pageToken;
      if (startRow > lastRow) return { items: [], nextPageToken: null };
      const limit = Math.min(pageSize, lastRow - startRow + 1);
      const values = sheet.getRange(startRow, 1, limit, numCols).getValues();
      const items = values.map((row, idx) => this._rowToCarteraItem(row, startRow + idx));
      const nextPageToken = (startRow + limit - 2 < lastRow - 1) ? (pageToken + limit) : null;
      Logger.log("[DAO.getCartera] sin filtro: devolviendo " + items.length + " items");
      return { items, nextPageToken };
    }

    let rowIndexes = null;
    if (filtroTipo) {
      Logger.log("[DAO.getCartera] Buscando por tipo: " + filtroTipo);
      rowIndexes = this._findRowIndexesByColumnValue(sheet, COL.tipo, filtroTipo);
      Logger.log("[DAO.getCartera] Encontrados " + (rowIndexes ? rowIndexes.length : 0) + " por tipo");
    }

    if (filtroEstado) {
      Logger.log("[DAO.getCartera] Buscando por estado: " + filtroEstado);
      const estadoRows = this._findRowIndexesByColumnValue(sheet, COL.estado, filtroEstado);
      Logger.log("[DAO.getCartera] Encontrados " + (estadoRows ? estadoRows.length : 0) + " por estado");
      if (rowIndexes === null) {
        rowIndexes = estadoRows;
      } else {
        const estadoSet = new Set(estadoRows);
        rowIndexes = rowIndexes.filter(row => estadoSet.has(row));
        Logger.log("[DAO.getCartera] Después del filtro combinado: " + rowIndexes.length);
      }
    }

    if (!rowIndexes || rowIndexes.length === 0) {
      Logger.log("[DAO.getCartera] Retornando vacío - no hay coincidencias");
      return { items: [], nextPageToken: null };
    }

    rowIndexes = Array.from(new Set(rowIndexes)).sort((a, b) => a - b);
    const totalCount = rowIndexes.length;
    const paginatedRows = rowIndexes.slice(pageToken, pageToken + pageSize);
    const items = this._fetchCarteraItemsFromRows(sheet, paginatedRows, numCols);
    Logger.log("[DAO.getCartera] Items finales: " + items.length);
    const nextPageToken = (pageToken + paginatedRows.length < totalCount) ? (pageToken + paginatedRows.length) : null;

    return { items, nextPageToken };
  },

  /**
   * Retrieves active non-canceled cartera items for a tercero and type with saldo > 0.
   * @param {string} idTercero - Tercero ID.
   * @param {string} tipoLimpio - Tipo (CxC/CxP).
   * @returns {Array<Object>} Filtered cartera items.
   */
  getCarteraByTerceroAndTipo(idTercero, tipoLimpio) {
    const base = CACHE.getCarteraBase();
    if (base && base.length > 0) {
      return base.filter(c =>
        c.id_tercero === idTercero &&
        c.tipo === tipoLimpio &&
        c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA &&
        c.saldo > 0
      );
    }
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const numCols = Math.max(...Object.values(COL)) + 1;
    const rowIndexes = this._findRowIndexesByColumnValue(sheet, COL.id_tercero, idTercero);
    if (!rowIndexes || rowIndexes.length === 0) return [];
    return this._fetchCarteraItemsFromRows(sheet, rowIndexes, numCols)
      .filter(c => c.tipo === tipoLimpio && c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA && c.saldo > 0);
  },

  _findRowIndexesByColumnValue(sheet, colIndex, value) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const range = sheet.getRange(2, colIndex + 1, lastRow - 1, 1);
    const searchValue = String(value).trim();
    // Use regex to match value with or without leading ' prefix
    const regexPattern = "^'?" + searchValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "$";
    Logger.log("[DAO._findRowIndexes] Buscando en col=" + colIndex + ", valor='" + searchValue + "', regex='" + regexPattern + "'");
    
    const matches = range.createTextFinder(regexPattern)
      .useRegularExpression(true)
      .findAll();

    if (!matches || matches.length === 0) {
      // Debug: intentar leer valores crudos para diagnosticar
      Logger.log("_findRowIndexesByColumnValue: No matches para colIndex=" + colIndex + ", valor=" + searchValue + ". Intentando lectura directa...");
      
      // Fallback: leer valores directamente y buscar coincidencia simple
      const rawValues = range.getValues();
      const directMatches = [];
      for (let i = 0; i < rawValues.length; i++) {
        const cellValue = String(rawValues[i][0] || "").trim();
        if (cellValue === searchValue || cellValue === "'" + searchValue) {
          directMatches.push(i + 2);
        }
      }
      if (directMatches.length > 0) {
        Logger.log("_findRowIndexesByColumnValue: Fallback directo encontró " + directMatches.length + " coincidencias");
        return directMatches;
      }
      
      return [];
    }
    
    Logger.log("_findRowIndexesByColumnValue: Found " + matches.length + " matches para colIndex=" + colIndex);
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
        items.push(this._rowToCarteraItem(values[i], group.start + i));
      }
    }

    return items;
  },

  _rowToCarteraItem(row, rowIndex) {
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    return {
      id: String(row[COL.id] || "").trim(),
      rowIndex: rowIndex || 0,
      fecha: _safeDate(row[COL.fecha]),
      id_tercero: String(row[COL.id_tercero] || "").trim(),
      origen_id: String(row[COL.origen_id] || "").trim(),
      total: _parseMoneda(row[COL.total], 0),
      saldo: _parseMoneda(row[COL.saldo], 0),
      tipo: String(row[COL.tipo] || "").trim(),
      estado: String(row[COL.estado] || "").trim(),
      fecha_vencimiento: _safeDate(row[COL.fecha_vencimiento]),
      vencida_timestamp: row[COL.vencida_timestamp] || null,
      version: Number(row[COL.version]) || 1,
    };
  },

  _calculateColumnRange(cambios, COL) {
    const hasVencidaTs = cambios.some(c => c.vencida_timestamp !== undefined);
    const hasVersionCheck = cambios.some(c => c.expectedVersion !== undefined);
    const colsToInclude = [COL.saldo, COL.estado];
    if (hasVencidaTs) colsToInclude.push(COL.vencida_timestamp);
    if (hasVersionCheck) colsToInclude.push(COL.version);
    const minCol = Math.min(...colsToInclude);
    const maxCol = Math.max(...colsToInclude);
    const numCols = maxCol - minCol + 1;
    return { minCol, maxCol, numCols, hasVersionCheck };
  },

  /**
   * Saves or updates a tercero record with retry logic and cache integrity checks.
   * @param {Object} tercero - Tercero data object.
   * @param {string} id - Tercero ID.
   * @param {string} nombre - Tercero name.
   * @param {string} telefono - Phone number.
   * @param {string} tipo - Tercero type.
   * @param {number} limite - Credit limit.
   * @param {boolean} activo - Active status.
   * @returns {{isUpdate: boolean}} Whether an existing record was updated.
   * @throws {Error} If integrity check fails or retries exhausted.
   */
  saveTerceroImpl(tercero, id, nombre, telefono, tipo, limite, activo) {
    const MAX_RETRIES = 5;
    const BACKOFF_MS = 200;
    for (let retries = 0; retries <= MAX_RETRIES; retries++) {
      try {
        if (!CACHE.ensureIntegrity('terceros')) {
          throw new Error("Integridad de caché de terceros comprometida.");
        }
        if (!CACHE.terceros || Object.keys(CACHE.terceroIndex).length === 0) {
          throw new Error("CACHE.terceroIndex no está inicializado.");
        }

        const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
        const rowData = [_sanitizeCell(id), _sanitizeCell(nombre), _sanitizeCell(telefono), _sanitizeCell(tipo), limite, activo];
        const cachedRow = CACHE.terceroIndex[id];

        // Validate unique name using cache (no sheet read)
        // === INICIO FIX-3.4: Refresh caché si está obsoleta antes de validar duplicados ===
        if (!CACHE.isTercerosValid && !CACHE.isTercerosValid()) {
          CACHE.refresh();
        }
        const nombreNormalizado = nombre.trim().toLowerCase();
        for (let i = 0; i < CACHE.terceros.length; i++) {
          const existing = CACHE.terceros[i];
          if (!existing.nombre) continue;
          // Skip if updating same record
          if (cachedRow && existing.id === id) continue;
          if (String(existing.nombre).trim().toLowerCase() === nombreNormalizado) {
            Logger.log("[DAO] Duplicado detectado: nombre '" + nombre + "' ya existe para ID " + existing.id);
            throw new Error("Ya existe un tercero con el nombre '" + nombre + "'.");
          }
        }

        if (cachedRow) {
          sheet.getRange(cachedRow, 1, 1, 6).setValues([rowData]);
          return { isUpdate: true };
        }

        if (sheet.getLastRow() === 0) {
          sheet.appendRow(["ID", "Nombre", "Teléfono", "Tipo", "Límite_Crédito", "Activo"]);
        }
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([rowData]);
        return { isUpdate: false };
      } catch (e) {
        if (retries >= MAX_RETRIES) throw e;

        const isIntegrityError = e.message.indexOf("Integridad") !== -1;
        const isCacheInitError = e.message.indexOf("no está inicializado") !== -1;

        if (isIntegrityError) {
          CACHE.recoverFromStale();
        } else if (isCacheInitError) {
          if (!CACHE._refreshingTerceros) {
            CACHE._refreshTerceros();
          }
          if (!CACHE.terceros || Object.keys(CACHE.terceroIndex).length === 0) {
            CACHE.invalidateTerceros();
            CACHE.refresh();
          }
        } else {
          throw e;
        }
        Utilities.sleep(BACKOFF_MS * Math.pow(2, retries) + Math.random() * 100);
      }
    }
  },

  /**
   * Generic retry helper with exponential backoff
   * @private
   * @param {Function} fn - Function to retry, receives (attempt)
   * @param {number} maxAttempts - Max retry attempts (default 3)
   * @param {number} baseDelayMs - Base delay in ms (default 100)
   * @returns {*} Result of fn
   */
  _withRetry(fn, maxAttempts = 3, baseDelayMs = 100) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return fn(attempt);
      } catch (e) {
        if (e.retryable === false || e.type !== 'OPTIMISTIC_LOCK_FAILURE') throw e;
        if (attempt >= maxAttempts - 1) {
          const msg = `Conflicto de concurrencia persistente. Operación abortada después de ${maxAttempts} intentos.`;
          const persistentErr = new Error(msg);
          persistentErr.type = 'OPTIMISTIC_LOCK_FAILURE';
          persistentErr.retryable = false;
          throw persistentErr;
        }
        CACHE.refresh(true);
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        Logger.log(`WARN: OptimisticLock retry #${attempt + 1}. Waiting ${Math.round(delay)}ms`);
        Utilities.sleep(delay);
      }
    }
  },

  /**
   * ACTUALIZACIÓN OPTIMIZADA con Optimistic Locking.
   * Lee la columna `version` para cada fila y rechaza la escritura si otra
   * ejecución ya modificó la fila (expectedVersion no coincide con sheet).
   * Lanza OptimisticLockError si hay conflicto; el caller debe reintentar.
   *
   * @param {Array} cambios Lista de objetos con { rowIndex, saldo, estado, expectedVersion?, vencida_timestamp? }
   * @returns {boolean} true si la operación fue exitosa
   * @throws {DAOError} SHEET_WRITE_FAILURE si falla la escritura a la hoja
   * @throws {Error} OPTIMISTIC_LOCK_FAILURE si hay conflicto de versión optimista
   */
  updateCarteraBatch(cambios) {
    const self = this;
    return this._withRetry(function (attempt) {
      if (attempt > 0) self._refreshCambiosVersions(cambios);
      return self._updateCarteraBatch(cambios);
    }, 3, 200);
  },

  _refreshCambiosVersions(cambios) {
    if (!cambios || cambios.length === 0) return;
    try {
      const fresh = CACHE.getCarteraBase();
      if (!fresh || !fresh.length) return;
      const index = {};
      for (const item of fresh) {
        if (item.rowIndex) index[item.rowIndex] = item.version;
      }
      for (const cambio of cambios) {
        if (cambio.expectedVersion !== undefined && index[cambio.rowIndex] !== undefined) {
          cambio.expectedVersion = index[cambio.rowIndex];
        }
      }
    } catch (e) {
      Logger.log("[DAO] WARN: _refreshCambiosVersions failed: " + e.message);
    }
  },

  /**
   * Internal single-attempt batch update for cartera
   * @private
   */
  _updateCarteraBatch(cambios) {
    if (!cambios || cambios.length === 0) return true;
    if (!CACHE.ensureIntegrity('cartera')) {
      throw new Error("Integridad de caché de cartera comprometida.");
    }

    const lock = LOCK_MANAGER.acquireGlobalLock(30000);

    try {
      const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
      const COL = CARTERA_CONFIG.COLUMNS.CARTERA;

      const { minCol, maxCol, numCols: numColsToProcess, hasVersionCheck } = this._calculateColumnRange(cambios, COL);

      let minRow = Infinity;
      let maxRow = -Infinity;
      const rowMap = new Map();
      for (const cambio of cambios) {
        if (cambio.rowIndex > 0) {
          minRow = Math.min(minRow, cambio.rowIndex);
          maxRow = Math.max(maxRow, cambio.rowIndex);
          rowMap.set(cambio.rowIndex, cambio);
        }
      }

      if (minRow === Infinity) return true;

      const numRowsToProcess = maxRow - minRow + 1;
      const targetRange = sheet.getRange(minRow, minCol + 1, numRowsToProcess, numColsToProcess);
      const values = targetRange.getValues();

      // Validate versions BEFORE any write - inside the global lock
      let optimisticLockFailure = null;
      if (hasVersionCheck) {
        for (const [rowIndex, cambio] of rowMap.entries()) {
          if (cambio.expectedVersion === undefined) continue;
          const localRowIndex = rowIndex - minRow;
          const localColVersion = COL.version - minCol;
          const currentVersion = Number(values[localRowIndex][localColVersion]) || 1;
          if (currentVersion !== cambio.expectedVersion) {
            optimisticLockFailure = {
              rowIndex: rowIndex,
              expectedVersion: cambio.expectedVersion,
              actualVersion: currentVersion
            };
            break;
          }
        }
      }

      if (optimisticLockFailure) {
        try {
          const props = PropertiesService.getScriptProperties();
          const currentFailures = Math.min(Number(props.getProperty('OPTIMISTIC_LOCK_FAILURES') || 0), 999999);
          props.setProperty('OPTIMISTIC_LOCK_FAILURES', String(Math.min(currentFailures + 1, 999999)));
        } catch (e) {
          Logger.log("Failed to persist optimistic lock metric: " + e.toString());
        }

        const err = new Error(
          `OptimisticLockError: fila ${optimisticLockFailure.rowIndex} fue modificada concurrentemente ` +
          `(esperada v${optimisticLockFailure.expectedVersion}, actual v${optimisticLockFailure.actualVersion}). Reintente la operación.`
        );
        err.type = 'OPTIMISTIC_LOCK_FAILURE';
        err.retryable = true;
        throw err;
      }

      // Apply changes
      for (const [rowIndex, cambio] of rowMap.entries()) {
        const localRowIndex = rowIndex - minRow;
        if (localRowIndex >= 0 && localRowIndex < numRowsToProcess) {
          const localColIndexSaldo = COL.saldo - minCol;
          const localColIndexEstado = COL.estado - minCol;
          values[localRowIndex][localColIndexSaldo] = cambio.saldo;
          values[localRowIndex][localColIndexEstado] = cambio.estado;
          if (cambio.vencida_timestamp !== undefined) {
            const localColIndexTs = COL.vencida_timestamp - minCol;
            values[localRowIndex][localColIndexTs] = cambio.vencida_timestamp;
          }
          if (hasVersionCheck && cambio.expectedVersion !== undefined) {
            const localColVersion = COL.version - minCol;
            values[localRowIndex][localColVersion] = cambio.expectedVersion + 1;
          }
        }
      }

      Logger.log(`DAO.updateCarteraBatch: ${cambios.length} filas, minRow=${minRow}, maxRow=${maxRow}, versionCheck=${hasVersionCheck}`);

      try {
        targetRange.setValues(values);
      } catch (e) {
        throw new DAOError("Error al escribir en la hoja de cartera", 'SHEET_WRITE_FAILURE', e);
      }

      return true;
    } finally {
      if (lock) {
        lock.releaseLock();
      }
    }
  },


  createMovimiento(mov) {
    if (!CACHE.ensureIntegrity('cartera')) {
      throw new Error("Integridad de caché de cartera comprometida. Se ejecutó recoverFromStale().");
    }
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
      const sheet = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
      const lastRow = sheet.getLastRow() || 0;

      if (lastRow === 0) {
        sheet.appendRow(["ID", "Fecha", "ID_Cartera", "ID_Tercero", "Valor", "Tipo_Mov", "Referencia"]);
      }

      const rowData = [_sanitizeCell(mov.id), mov.fecha, _sanitizeCell(mov.id_cartera), _sanitizeCell(mov.id_tercero), mov.valor, _sanitizeCell(mov.tipo_mov), _sanitizeCell(mov.referencia)];
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setValues([rowData]);
      return true;
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  createCartera(c) {
    if (!CACHE.ensureIntegrity('cartera')) {
      throw new Error("Integridad de caché de cartera comprometida. Se ejecutó recoverFromStale().");
    }
    const lock = LOCK_MANAGER.acquireGlobalLock(30000);
    try {
      const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
      const lastRow = sheet.getLastRow() || 0;

      if (lastRow === 0) {
        sheet.appendRow(["ID", "Fecha", "ID_Tercero", "Origen_ID", "Total", "Saldo", "Tipo", "Estado", "Fecha_Vencimiento", "Vencida_Timestamp", "Version"]);
      }

      const rowData = [_sanitizeCell(c.id), c.fecha, _sanitizeCell(c.id_tercero), _sanitizeCell(c.origen_id), c.total, c.saldo, _sanitizeCell(c.tipo), _sanitizeCell(c.estado), c.fecha_vencimiento, c.vencida_timestamp || null, c.version || 1];
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, 11).setValues([rowData]);
      return true;
    } finally {
      if (lock) lock.releaseLock();
    }
  },

  /**
   * Retrieves libro diario records.
   * @param {number} [maxRows=100] - Max rows to read.
   * @returns {Array<Object>} Libro diario records.
   */
  getLibroDiario(maxRows = 100) {
    try {
      const sheet = getSheet(CONFIG.SHEETS.LIBRO_DIARIO);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return [];
      const COL = CONFIG.COLUMNS.LIBRO_DIARIO;
      const numCols = Math.max.apply(null, Object.values(COL)) + 1;
      const limit = Math.min(maxRows, lastRow - 1);
      const data = sheet.getRange(2, 1, limit, numCols).getValues();
      const result = [];
      for (let i = 0; i < data.length; i++) {
        result.push({
          id: data[i][COL.id],
          fecha: data[i][COL.fecha],
          tipo: data[i][COL.tipo],
          id_referencia: data[i][COL.id_referencia],
          tercero: data[i][COL.tercero],
          monto: data[i][COL.monto],
          usuario: data[i][COL.usuario],
          descripcion: data[i][COL.descripcion]
        });
      }
      return result;
    } catch (e) {
      Logger.log("[DAO.getLibroDiario] Error: " + e.message);
      throw e;
    }
  },
};


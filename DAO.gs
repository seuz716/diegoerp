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
    this.code = code;
    this.name = 'DAOError';
    this.details = details;
  }
}

/**
 * Optimistic lock error for concurrent modification conflicts.
 */
class OptimisticLockError extends DAOError {
  constructor(message, rowIndex, expectedVersion, actualVersion) {
    super(message, 'OPTIMISTIC_LOCK_FAILURE', { rowIndex, expectedVersion, actualVersion });
    this.retryable = true;
    this.type = 'OPTIMISTIC_LOCK_FAILURE';
  }
}

function _daoLogError(message, context) {
  if (typeof LogService !== 'undefined' && LogService && typeof LogService.logError === 'function') {
    LogService.logError(message, context);
  } else {
    Logger.log("[DAO-LOG] ERROR: " + message);
  }
}

// NOTA: _sanitizeCell está definida en Config.gs con lógica más robusta
// que detecta solo valores que empiecen con =, +, -, @ para escaparlos.

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
      _daoLogError('Error en batchInsert', { functionName: 'batchInsert', error: e });
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
    // Validar pageToken negativo
    pageToken = Math.max(0, pageToken || 0);
    pageSize = Math.min(5000, pageSize || 5000);
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const numCols = Math.max(...Object.values(COL)) + 1;
    const lastRow = sheet.getLastRow();

    Logger.log("[DAO.getCartera] filtroTipo=" + filtroTipo + ", filtroEstado=" + filtroEstado + ", lastRow=" + lastRow);

    if (!filtroTipo && !filtroEstado) {
      // Usar caché si está disponible
      CACHE.refresh();
      if (CACHE.cartera && CACHE.cartera.length > 0) {
        const allItems = CACHE.cartera;
        const paginated = allItems.slice(pageToken, pageToken + pageSize);
        const nextPageToken = (pageToken + pageSize < allItems.length) ? pageToken + pageSize : null;
        return { items: paginated, nextPageToken };
      }
      // Fallback: lectura directa con paginación
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
    // AUDIT-011: batch-read todos los grupos contiguos en una sola llamada
    // getRangeList().getValues() en lugar de múltiples getRange() individuales.
    const lastColLetter = this._colNumToLetter(numCols);
    const a1List = groups.map(g => `A${g.start}:${lastColLetter}${g.end}`);
    try {
      const rangeList = sheet.getRangeList(a1List);
      const batched = rangeList.getValues();
      for (let k = 0; k < groups.length; k++) {
        const groupValues = batched[k];
        // Guard de forma: RangeList.getValues() debe devolver un array 2D por rango.
        if (!Array.isArray(groupValues) || groupValues.length === 0 || !Array.isArray(groupValues[0])) {
          throw new Error("RangeList.getValues() forma inesperada");
        }
        for (let i = 0; i < groupValues.length; i++) {
          items.push(this._rowToCarteraItem(groupValues[i], groups[k].start + i));
        }
      }
    } catch (e) {
      // Fallback: lectura secuencial por grupo (comportamiento anterior robusto)
      Logger.log("[DAO.AUDIT-011] Fallback a lectura secuencial: " + e.message);
      for (const group of groups) {
        const values = sheet.getRange(group.start, 1, group.end - group.start + 1, numCols).getValues();
        for (let i = 0; i < values.length; i++) {
          items.push(this._rowToCarteraItem(values[i], group.start + i));
        }
      }
    }

    return items;
  },

  /**
   * Convierte un índice de columna (1-based) a notación de letra A1 (A, B, ..., Z, AA...).
   * @param {number} col - Índice de columna basado en 1.
   * @returns {string} Letra(s) de columna.
   * @private
   */
  _colNumToLetter(col) {
    let letter = '';
    let n = col;
    while (n > 0) {
      const rem = (n - 1) % 26;
      letter = String.fromCharCode(65 + rem) + letter;
      n = Math.floor((n - 1) / 26);
    }
    return letter;
  },

  _rowToCarteraItem(row, rowIndex) {
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    return {
      id: _sanitizeId(_stripLeadingQuote(row[COL.id] || "")),
      rowIndex: rowIndex || 0,
      fecha: _safeDate(row[COL.fecha]),
      id_tercero: _sanitizeId(_stripLeadingQuote(row[COL.id_tercero] || "")),
      origen_id: _sanitizeId(_stripLeadingQuote(row[COL.origen_id] || "")),
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

      // AUDIT-003: Escribir SOLO las filas modificadas (no todo el rango minRow..maxRow).
      // El rango completo se leyó en una sola llamada (eficiente) pero reescribir
      // filas no incluidas en `cambios` desperdicia cuota y riesgo stale-write.
      const colsToWrite = [COL.saldo, COL.estado];
      if (cambios.some(c => c.vencida_timestamp !== undefined)) colsToWrite.push(COL.vencida_timestamp);
      if (hasVersionCheck) colsToWrite.push(COL.version);
      const minWriteCol = Math.min(...colsToWrite);
      const maxWriteCol = Math.max(...colsToWrite);
      const writeNumCols = maxWriteCol - minWriteCol + 1;

      // Construir escrituras por fila: preserva columnas no modificadas dentro del
      // rango de escritura leyéndolas del array `values` ya cargado.
      const rowWrites = [];
      for (const [rowIndex, cambio] of rowMap.entries()) {
        const localRowIndex = rowIndex - minRow;
        if (localRowIndex < 0 || localRowIndex >= numRowsToProcess) continue;

        const rowValues = [];
        for (let c = minWriteCol; c <= maxWriteCol; c++) {
          rowValues.push(values[localRowIndex][c - minCol]);
        }
        rowValues[COL.saldo - minWriteCol] = cambio.saldo;
        rowValues[COL.estado - minWriteCol] = cambio.estado;
        if (cambio.vencida_timestamp !== undefined) {
          rowValues[COL.vencida_timestamp - minWriteCol] = cambio.vencida_timestamp;
        }
        if (hasVersionCheck && cambio.expectedVersion !== undefined) {
          rowValues[COL.version - minWriteCol] = cambio.expectedVersion + 1;
        }
        rowWrites.push({ rowIndex, rowValues });
      }

      // Agrupar filas contiguas para minimizar llamadas setValues
      rowWrites.sort((a, b) => a.rowIndex - b.rowIndex);
      const blocks = [];
      for (const w of rowWrites) {
        const last = blocks[blocks.length - 1];
        if (last && w.rowIndex === last.endRow + 1) {
          last.endRow = w.rowIndex;
          last.rows.push(w.rowValues);
        } else {
          blocks.push({ startRow: w.rowIndex, endRow: w.rowIndex, rows: [w.rowValues] });
        }
      }

      Logger.log(`DAO.updateCarteraBatch: ${cambios.length} filas, minRow=${minRow}, maxRow=${maxRow}, versionCheck=${hasVersionCheck}, writeBlocks=${blocks.length}, writeCols=[${minWriteCol}..${maxWriteCol}]`);

      try {
        for (const b of blocks) {
          sheet.getRange(b.startRow, minWriteCol + 1, b.rows.length, writeNumCols).setValues(b.rows);
        }
      } catch (e) {
        throw new DAOError("Error al escribir en la hoja de cartera", 'SHEET_WRITE_FAILURE', e);
      }

      // M5: Cache consistency - invalidate inside lock before release
      try { CACHE.invalidateCartera(); } catch (e) {
        Logger.log("[M5] Warning: cache invalidation failed: " + e.message);
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

  /**
   * Retrieves terceros filtered by type (CLIENTE, PROVEEDOR, AMBOS).
   * @param {string} tipo - Type to filter: CLIENTE, PROVEEDOR, or AMBOS.
   * @returns {Array<Object>} Filtered list of terceros.
   */
  getTercerosPorTipo(tipo) {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const COL = CARTERA_CONFIG.COLUMNS.TERCEROS;
    const numCols = Math.max(...Object.values(COL)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const tipoUpper = String(tipo || "").toUpperCase();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      const tipoTercero = String(data[i][COL.tipoTercero || COL.tipo] || "").toUpperCase();
      if (tipoUpper === "AMBOS") {
        if (tipoTercero === "PROVEEDOR" || tipoTercero === "CLIENTE") {
          result.push({
            id: _sanitizeId(_stripLeadingQuote(data[i][COL.id] || "")),
            nombre: String(data[i][COL.nombre] || "").trim(),
            telefono: String(data[i][COL.telefono] || "").trim(),
            tipo: tipoTercero,
            limite_credito: _parseMoneda(data[i][COL.limite_credito], 0),
            activo: String(data[i][COL.activo] || "ACTIVO").trim()
          });
        }
      } else if (tipoTercero === tipoUpper) {
        result.push({
          id: _sanitizeId(_stripLeadingQuote(data[i][COL.id] || "")),
          nombre: String(data[i][COL.nombre] || "").trim(),
          telefono: String(data[i][COL.telefono] || "").trim(),
          tipo: tipoTercero,
          limite_credito: _parseMoneda(data[i][COL.limite_credito], 0),
          activo: String(data[i][COL.activo] || "ACTIVO").trim()
        });
      }
    }
    return result;
  },

  /**
   * Retrieves preferred supplier for a product from PRODUCTO_PROVEEDOR sheet.
   * @param {string} idProducto - Product ID.
   * @returns {Object|null} Supplier object with id, nombre, precioUltimaCompra, esPreferido.
   */
  getProveedorPorProducto(idProducto) {
    const idLimpio = _sanitizeId(idProducto);
    if (!idLimpio) return null;
    const sheet = getSheet(PRODUCTO_PROVEEDOR_CONFIG.SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    const COL = PRODUCTO_PROVEEDOR_CONFIG.COLUMNS;
    const numCols = Math.max(...Object.values(COL)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][COL.idProducto] || "").trim() === idLimpio) {
        return {
          id: String(data[i][COL.idProveedor] || "").trim(),
          id_producto: idLimpio,
          precio_ultima_compra: _parseMoneda(data[i][COL.precioUltimaCompra], 0),
          es_preferido: String(data[i][COL.esPreferido] || "").toUpperCase() === "TRUE"
        };
      }
    }
    return null;
  },

  /**
   * Retrieves all products for a supplier from PRODUCTO_PROVEEDOR sheet.
   * @param {string} idProveedor - Supplier ID.
   * @returns {Array<Object>} List of products with supplier pricing info.
   */
  getProductosPorProveedor(idProveedor) {
    const idLimpio = _sanitizeId(idProveedor);
    if (!idLimpio) return [];
    const sheet = getSheet(PRODUCTO_PROVEEDOR_CONFIG.SHEET);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const COL = PRODUCTO_PROVEEDOR_CONFIG.COLUMNS;
    const numCols = Math.max(...Object.values(COL)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][COL.idProveedor] || "").trim() === idLimpio) {
        result.push({
          id_producto: String(data[i][COL.idProducto] || "").trim(),
          id_proveedor: idLimpio,
          precio_ultima_compra: _parseMoneda(data[i][COL.precioUltimaCompra], 0),
          es_preferido: String(data[i][COL.esPreferido] || "").toUpperCase() === "TRUE",
          fecha_ultima_compra: data[i][COL.fechaUltimaCompra] || null
        });
      }
    }
    return result;
  },

  /**
   * Retrieves kardex movements for purchases from a specific provider.
   * Solo lectura: devuelve datos crudos sin lógica de negocio.
   * @param {string} idProveedor - Provider ID.
   * @param {number} [limite=20] - Max results to return.
   * @returns {Array<Object>} Kardex movements from purchases to this provider.
   */
  getMovimientosCompraPorProveedor(idProveedor, limite = 20) {
    const sheetKardex = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const sheetCompras = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    const lastRow = sheetKardex.getLastRow();
    if (lastRow < 2) return [];

    const KC = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const CC = COMPRAS_CONFIG.COLUMNS.COMPRAS;
    const numCols = Math.max(...Object.values(KC)) + 1;

    // Build map of compras by id for efficient lookup
    const comprasData = sheetCompras.getLastRow() > 1 
      ? sheetCompras.getRange(2, 1, sheetCompras.getLastRow() - 1, Math.max(...Object.values(CC)) + 1).getValues()
      : [];
    const compraIndex = {};
    for (let i = 0; i < comprasData.length; i++) {
      compraIndex[String(comprasData[i][CC.id] || "").trim()] = String(comprasData[i][CC.id_proveedor] || "").trim();
    }

    const data = sheetKardex.getRange(2, 1, lastRow - 1, numCols).getValues();
    const resultados = [];

    for (let i = 0; i < data.length; i++) {
      const idCompra = String(data[i][KC.referencia] || "").trim();
      // Check if this kardex movement is linked to a compra from the provider
      if (compraIndex[idCompra] === idProveedor && data[i][KC.tipo_mov] === "ENTRADA") {
        resultados.push({
          id: String(data[i][KC.id] || "").trim(),
          fecha: data[i][KC.fecha],
          id_producto: String(data[i][KC.id_producto] || "").trim(),
          tipo_mov: String(data[i][KC.tipo_mov] || "").trim(),
          cantidad: _parseMoneda(data[i][KC.cantidad], 0),
          stock_anterior: _parseMoneda(data[i][KC.stock_anterior], 0),
          stock_nuevo: _parseMoneda(data[i][KC.stock_nuevo], 0),
          referencia: idCompra,
          origen: String(data[i][KC.origen] || "").trim(),
          usuario: String(data[i][KC.usuario] || "").trim(),
          costo_unitario: _parseMoneda(data[i][KC.costo_unitario], 0),
          precio_unitario: _parseMoneda(data[i][KC.precio_unitario], 0)
        });
      }
      if (resultados.length >= limite) break;
    }
    return resultados;
  },

  /**
   * Retrieves total quantities purchased by product for a specific provider.
   * Solo lectura: suma cantidades sin lógica de negocio.
   * @param {string} idProveedor - Provider ID.
   * @returns {Object} Map of productId -> total cantidad comprada.
   */
  getCantidadesCompradaPorProveedor(idProveedor) {
    const sheetKardex = getSheet(COMPRAS_CONFIG.SHEETS.KARDEX);
    const sheetCompras = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
    const lastRow = sheetKardex.getLastRow();
    if (lastRow < 2) return {};

    const KC = COMPRAS_CONFIG.COLUMNS.KARDEX;
    const CC = COMPRAS_CONFIG.COLUMNS.COMPRAS;
    const numCols = Math.max(...Object.values(KC)) + 1;

    // Build map of compras by id for efficient lookup
    const comprasData = sheetCompras.getLastRow() > 1 
      ? sheetCompras.getRange(2, 1, sheetCompras.getLastRow() - 1, Math.max(...Object.values(CC)) + 1).getValues()
      : [];
    const compraIndex = {};
    for (let i = 0; i < comprasData.length; i++) {
      compraIndex[String(comprasData[i][CC.id] || "").trim()] = String(comprasData[i][CC.id_proveedor] || "").trim();
    }

    const data = sheetKardex.getRange(2, 1, lastRow - 1, numCols).getValues();
    const cantidades = {};

    for (let i = 0; i < data.length; i++) {
      const idCompra = String(data[i][KC.referencia] || "").trim();
      // Only count ENTRADA movements from compras of this provider
      if (compraIndex[idCompra] === idProveedor && String(data[i][KC.tipo_mov] || "").trim() === "ENTRADA") {
        const idProducto = String(data[i][KC.id_producto] || "").trim();
        const cantidad = _parseMoneda(data[i][KC.cantidad], 0);
        if (idProducto) {
          cantidades[idProducto] = (cantidades[idProducto] || 0) + cantidad;
        }
      }
    }
    return cantidades;
  }
};


/**
 * LAYER 3: CACHE LAYER — ÍNDICES EN MEMORIA
 * Resuelve Problemas:
 * - #3: Caché con TTL fijo sin invalidación selectiva
 * - #7: Tiempo de vida del caché sin mecanismo de refresh bajo demanda
 */

class CacheIntegrityError extends Error {
  constructor(kind, currentChecksum, storedChecksum) {
    super(`Cache integrity mismatch for ${kind}: current=${currentChecksum}, stored=${storedChecksum}`);
    this.name = "CacheIntegrityError";
    this.kind = kind;
    this.currentChecksum = currentChecksum;
    this.storedChecksum = storedChecksum;
  }
}

let CACHE = {
  terceros: null,
  terceroIndex: {},  
  cartera: null,
  carteraIndex: {},  
  lastRefreshTerceros: 0,
  lastRefreshCartera: 0,
  CACHE_TTL: 300000,
  MAX_STALE_MS: 900000,
  MAX_CONSECUTIVE_FAILURES: 3,
  tercerosStale: false,
  carteraStale: false,
  tercerosStaleStart: 0,
  carteraStaleStart: 0,
  tercerosFailCount: 0,
  carteraFailCount: 0,
  tercerosCircuitOpen: false,
  carteraCircuitOpen: false,
  // === INICIO FIX C-02 ===
  _circuitOpenTercerosTimestamp: 0,
  _circuitOpenCarteraTimestamp: 0,
  CIRCUIT_AUTO_CLOSE_MS: 300000, // 5 minutes
  // === FIN FIX C-02 ===
  lastChecksumTerceros: "",
  lastChecksumCartera: "",
  _refreshingTerceros: false,
  _refreshingCartera: false,

  /**
   * Invalida SOLO la caché de terceros
   */
  invalidateTerceros() {
    this.terceros = null;
    this.terceroIndex = {};
    this.lastRefreshTerceros = 0;
    this.tercerosStale = false;
    this.tercerosStaleStart = 0;
    this.tercerosFailCount = 0;
    this.tercerosCircuitOpen = false;
    this.lastChecksumTerceros = "";

    try {
      const props = PropertiesService.getScriptProperties();
      const currentVer = Number(props.getProperty("CACHE_VERSION_TERCEROS") || 1);
      props.setProperty("CACHE_VERSION_TERCEROS", String(currentVer + 1));
      
      const key = "terceros_v" + currentVer;
      CacheService.getScriptCache().remove(key);
    } catch (e) {
      Logger.log("CACHE: Error invalidating native terceros cache: " + e.toString());
    }
  },

  invalidateCartera() {
    this.cartera = null;
    this.carteraIndex = {};
    this.lastRefreshCartera = 0;
    this.carteraStale = false;
    this.carteraStaleStart = 0;
    this.carteraFailCount = 0;
    this.carteraCircuitOpen = false;
    this.lastChecksumCartera = "";

    try {
      const props = PropertiesService.getScriptProperties();
      const currentVer = Number(props.getProperty("CACHE_VERSION_CARTERA") || 1);
      props.setProperty("CACHE_VERSION_CARTERA", String(currentVer + 1));
      
      const key = "cartera_v" + currentVer;
      CacheService.getScriptCache().remove(key);
    } catch (e) {
      Logger.log("CACHE: Error invalidating native cartera cache: " + e.toString());
    }
  },

  /**
   * Invalida todo el caché 
   */
  invalidate() {
    this.invalidateTerceros();
    this.invalidateCartera();
  },

  // === INICIO FIX C-02 ===
  _autoRecoverCircuitBreaker(kind) {
    const props = PropertiesService.getScriptProperties();
    const timestampKey = kind === 'terceros' ? 'CIRCUIT_OPEN_TERCEROS_TS' : 'CIRCUIT_OPEN_CARTERA_TS';
    const storedTs = Number(props.getProperty(timestampKey) || '0');
    
    if (kind === 'terceros' && this.tercerosCircuitOpen) {
      if (storedTs > 0 && (Date.now() - storedTs) > this.CIRCUIT_AUTO_CLOSE_MS) {
        Logger.log("[FIX-C-02] Circuit breaker auto-closed for terceros after 5 minutes");
        this.tercerosCircuitOpen = false;
        this.tercerosFailCount = 0;
        this._circuitOpenTercerosTimestamp = 0;
        props.deleteProperty(timestampKey);
      }
    }
    if (kind === 'cartera' && this.carteraCircuitOpen) {
      if (storedTs > 0 && (Date.now() - storedTs) > this.CIRCUIT_AUTO_CLOSE_MS) {
        Logger.log("[FIX-C-02] Circuit breaker auto-closed for cartera after 5 minutes");
        this.carteraCircuitOpen = false;
        this.carteraFailCount = 0;
        this._circuitOpenCarteraTimestamp = 0;
        props.deleteProperty(timestampKey);
      }
    }
  },
  // === FIN FIX C-02 ===

  isTercerosValid() {
    // === INICIO FIX C-02 ===
    if (this.tercerosCircuitOpen) {
      this._autoRecoverCircuitBreaker('terceros');
      if (this.tercerosCircuitOpen) return false;
    }
    // === FIN FIX C-02 ===
    if (this.tercerosStale) {
      if (this.tercerosStaleStart > 0 && (Date.now() - this.tercerosStaleStart) > this.MAX_STALE_MS) {
        return false;
      }
      return true;
    }
    if (this.terceros === null) {
      const cached = this._getNativeCache("terceros");
      if (cached) {
        this.terceros = cached.terceros;
        this.terceroIndex = cached.terceroIndex;
        this.lastRefreshTerceros = cached.lastRefreshTerceros;
        this.lastChecksumTerceros = cached.lastChecksumTerceros;
      }
    }
    return this.terceros !== null && (Date.now() - this.lastRefreshTerceros) < this.CACHE_TTL;
  },

  isCarteraValid() {
    // === INICIO FIX C-02 ===
    if (this.carteraCircuitOpen) {
      this._autoRecoverCircuitBreaker('cartera');
      if (this.carteraCircuitOpen) return false;
    }
    // === FIN FIX C-02 ===
    if (this.carteraStale) {
      if (this.carteraStaleStart > 0 && (Date.now() - this.carteraStaleStart) > this.MAX_STALE_MS) {
        return false;
      }
      return true;
    }
    if (this.cartera === null) {
      const cached = this._getNativeCache("cartera");
      if (cached) {
        this.cartera = cached.cartera;
        this.carteraIndex = cached.carteraIndex;
        this.lastRefreshCartera = cached.lastRefreshCartera;
        this.lastChecksumCartera = cached.lastChecksumCartera;
      }
    }
    return this.cartera !== null && (Date.now() - this.lastRefreshCartera) < this.CACHE_TTL;
  },

  /**
   * Recarga caché (permite forzar refresco)
   */
  refresh(forceRefresh = false) {
    validateAndMapSchemas();

    if (forceRefresh) {
        this.invalidate();
    }

    if (!this.isTercerosValid()) {
      this._refreshTerceros();
    }

    if (!this.isCarteraValid()) {
      this._refreshCartera();
    }
  },

  recoverFromStale() {
    Logger.log("CACHE: Iniciando protocolo de recuperación por datos obsoletos");
    this.invalidate();
    this.tercerosCircuitOpen = false;
    this.carteraCircuitOpen = false;

    const maxAttempts = 3;
    let attempt = 0;
    let restored = false;
    while (attempt < maxAttempts && !restored) {
      attempt++;
      try {
        this._refreshTerceros();
        this._refreshCartera();
        restored = !this.tercerosStale && !this.carteraStale;
      } catch (e) {
        Logger.log(`CACHE: recoverFromStale intento ${attempt} falló: ${e}`);
        if (attempt < maxAttempts) {
          const backoff = 500 * Math.pow(2, attempt - 1); // exponential backoff
          Logger.log(`CACHE: Esperando ${backoff}ms antes del próximo intento`);
          Utilities.sleep(backoff);
        }
      }
    }
    Logger.log(`CACHE: Protocolo de recuperación completado. restaurado=${restored} tras ${attempt} intento(s)`);
    return restored;
  },

  verifyConsistency() {
    const result = { terceros: true, cartera: true, mismatched: false };
    if (this.terceros && this.terceros.length > 0) {
      const currentChecksum = this._computeChecksum(this.terceros);
      if (this.lastChecksumTerceros && this.lastChecksumTerceros !== currentChecksum) {
        result.terceros = false;
        result.mismatched = true;
      }
    }
    if (this.cartera && this.cartera.length > 0) {
      const currentChecksum = this._computeChecksum(this.cartera);
      if (this.lastChecksumCartera && this.lastChecksumCartera !== currentChecksum) {
        result.cartera = false;
        result.mismatched = true;
      }
    }
    return result;
  },

  /**
   * @private
   * Verifica checksum del tipo de datos indicado contra la hoja de cálculo.
   * No tiene side effects (no invalida ni recarga la caché).
   * @param {'terceros'|'cartera'} kind Tipo de datos a verificar.
   * @returns {{valid: boolean, currentChecksum: string, mismatch: boolean}}
   */
  _verifyChecksum(kind) {
    const storedChecksum = kind === 'terceros' ? this.lastChecksumTerceros : this.lastChecksumCartera;
    if (!storedChecksum) {
      return { valid: true, currentChecksum: "", mismatch: false };
    }
    const start = Date.now();
    const sheetName = kind === 'terceros' ? CARTERA_CONFIG.SHEETS.TERCEROS : CARTERA_CONFIG.SHEETS.CARTERA;
    const columnsConfig = kind === 'terceros' ? CARTERA_CONFIG.COLUMNS.TERCEROS : CARTERA_CONFIG.COLUMNS.CARTERA;
    const items = this._readSheetItems(sheetName, columnsConfig);
    const currentChecksum = this._computeChecksum(items);
    const durationMs = Date.now() - start;
    const mismatch = currentChecksum !== storedChecksum;
    const valid = !mismatch;
    Logger.log(`CACHE._verifyChecksum(${kind}): ${durationMs}ms, valid=${valid}`);
    return { valid, currentChecksum, mismatch };
  },

  /**
   * @private
   * Maneja un fallo de integridad: logea, ejecuta recoverFromStale, retorna false.
   * @param {'terceros'|'cartera'} kind Tipo de datos con fallo.
   * @returns {boolean} false
   */
  _handleIntegrityFailure(kind) {
    Logger.log("CACHE: Checksum de " + kind + " no coincide — datos stale detectados. Ejecutando recoverFromStale().");
    this.recoverFromStale();
    return false;
  },

  /**
   * Verifica integridad de la caché contra la hoja de cálculo usando SHA-256.
   * Lee la hoja, reconstruye la estructura de datos, computa el checksum
   * y lo compara con el registrado al cargar la caché. Si no coinciden,
   * ejecuta recoverFromStale() para recargar desde la fuente, a menos que
   * throwOnError esté activo.
   * @param {'terceros'|'cartera'} kind Tipo de datos a verificar.
   * @param {Object} [options] Opciones adicionales.
   * @param {boolean} [options.throwOnError=false] Si es true, lanza CacheIntegrityError en lugar de recuperar.
   * @returns {boolean} true si los datos están íntegros, false si se recuperó.
   * @throws {CacheIntegrityError} Si throwOnError es true y hay mismatch.
   */
  ensureIntegrity(kind, options = {}) {
    const { throwOnError = false } = options;
    const result = this._verifyChecksum(kind);
    if (result.mismatch) {
      if (throwOnError) {
        const storedChecksum = kind === 'terceros' ? this.lastChecksumTerceros : this.lastChecksumCartera;
        throw new CacheIntegrityError(kind, result.currentChecksum, storedChecksum);
      }
      return this._handleIntegrityFailure(kind);
    }
    return true;
  },

  getStalenessInfo() {
    return {
      terceros: {
        valid: this.isTercerosValid(),
        age: this.lastRefreshTerceros > 0 ? Date.now() - this.lastRefreshTerceros : -1,
        stale: this.tercerosStale,
        staleDuration: this.tercerosStale && this.tercerosStaleStart > 0 ? Date.now() - this.tercerosStaleStart : 0,
        maxStaleMs: this.MAX_STALE_MS,
        failCount: this.tercerosFailCount,
        circuitOpen: this.tercerosCircuitOpen,
        count: this.terceros ? this.terceros.length : 0,
      },
      cartera: {
        valid: this.isCarteraValid(),
        age: this.lastRefreshCartera > 0 ? Date.now() - this.lastRefreshCartera : -1,
        stale: this.carteraStale,
        staleDuration: this.carteraStale && this.carteraStaleStart > 0 ? Date.now() - this.carteraStaleStart : 0,
        maxStaleMs: this.MAX_STALE_MS,
        failCount: this.carteraFailCount,
        circuitOpen: this.carteraCircuitOpen,
        count: this.cartera ? this.cartera.length : 0,
      },
      ttl: this.CACHE_TTL,
    };
  },

  _readSheetRaw(sheet, startRow, totalRows, numCols) {
    if (totalRows <= 0) return [];
    // === INICIO FIX M-06 ===
    const ITEMS_PER_BLOCK = 20000;
    if (totalRows <= 50000) {
      return sheet.getRange(startRow, 1, totalRows, numCols).getValues();
    }
    Logger.log("[FIX-M-06] Large sheet: %s rows, reading in blocks of %s", totalRows, ITEMS_PER_BLOCK);
    let result = [];
    for (let offset = 0; offset < totalRows; offset += ITEMS_PER_BLOCK) {
      const blockSize = Math.min(ITEMS_PER_BLOCK, totalRows - offset);
      const block = sheet.getRange(startRow + offset, 1, blockSize, numCols).getValues();
      result = result.concat(block);
    }
    // === FIN FIX M-06 ===
    return result;
  },

  _readSheetItems(sheetName, columnsConfig) {
    const sheet = getSheet(sheetName);
    const columns = columnsConfig;
    const lastRow = sheet.getLastRow();
    const numCols = Math.max(...Object.values(columns)) + 1;
    if (lastRow < 2) return [];
    const totalDataRows = lastRow - 1;
    const data = this._readSheetRaw(sheet, 2, totalDataRows, numCols);
    return this._parseSheetData(data, columns);
  },

  // === INICIO FIX M-06 ===
  _parseSheetData(data, columns) {
    const items = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const id = String(row[columns.id] || "").trim();
      if (!id) continue;
      const item = { id };
      if (columns.saldo !== undefined) {
        item.saldo = _parseMoneda(row[columns.saldo], 0);
        item.estado = String(row[columns.estado] || "ABIERTA").trim();
        item.fecha = _safeDate(row[columns.fecha]);
        item.total = _parseMoneda(row[columns.total], 0);
      } else {
        item.nombre = String(row[columns.nombre] || "").trim();
      }
      items.push(item);
    }
    return items;
  },
  // === FIN FIX M-06 ===

  _computeChecksum(data) {
    if (!data || data.length === 0) return "";
    const concat = data.map(r => {
      const parts = [r.id];
      if (r.nombre !== undefined) parts.push(r.nombre);
      if (r.saldo !== undefined) parts.push(r.saldo);
      if (r.estado !== undefined) parts.push(r.estado);
      if (r.fecha !== undefined) parts.push(r.fecha instanceof Date ? Utilities.formatDate(r.fecha, _getTimeZone(), 'yyyy-MM-dd') : String(r.fecha));
      if (r.total !== undefined) parts.push(r.total);
      return parts.join("|");
    }).join(",");
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, concat)
      .map(b => ("0" + (b & 0xFF).toString(16)).slice(-2)).join("");
  },

  _refreshTerceros() {
    if (this._refreshingTerceros) {
      Logger.log("CACHE: _refreshTerceros ya en progreso, saltando llamada redundante");
      return;
    }
    this._refreshingTerceros = true;
    const sheetTerceros = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
    try {
      const COL_T = CARTERA_CONFIG.COLUMNS.TERCEROS;
      const lastRow = sheetTerceros.getLastRow();
      const numCols = Math.max(...Object.values(COL_T)) + 1;
      const totalDataRows = lastRow - 1;
      const dataTerceros = this._readSheetRaw(sheetTerceros, 2, totalDataRows, numCols);

      const newTerceros = [];
      const newIndex = {};
      for (let i = 0; i < dataTerceros.length; i++) {
        const rowIdx = 1 + i;
        const id = String(dataTerceros[i][COL_T.id]).trim();
        if (!id) continue;
        newIndex[id] = rowIdx;  
        newTerceros.push({
          id,
          rowIndex: rowIdx,
          nombre: String(dataTerceros[i][COL_T.nombre] || "").trim(),
          telefono: String(dataTerceros[i][COL_T.telefono] || "").trim(),
          tipo: String(dataTerceros[i][COL_T.tipo] || "CLIENTE").toUpperCase(),
          limite_credito: _parseMoneda(dataTerceros[i][COL_T.limite_credito], 0),
          activo: String(dataTerceros[i][COL_T.activo] || "").replace(/^'/, "").toUpperCase() !== "INACTIVO",
        });
      }

      this.terceros = newTerceros;
      this.terceroIndex = newIndex;
      this.lastRefreshTerceros = Date.now();
      this.tercerosStale = false;
      this.tercerosStaleStart = 0;
      this.tercerosFailCount = 0;
      this.tercerosCircuitOpen = false;
      this.lastChecksumTerceros = this._computeChecksum(newTerceros);

      this._putNativeCache("terceros", {
        terceros: this.terceros,
        terceroIndex: this.terceroIndex,
        lastRefreshTerceros: this.lastRefreshTerceros,
        lastChecksumTerceros: this.lastChecksumTerceros
      });
    } catch (e) {
      this.tercerosFailCount++;
      Logger.log("ERROR CACHE._refreshTerceros (fail #" + this.tercerosFailCount + "):" + e.toString());
      if (this.terceros === null) {
        this.tercerosStale = false;
        return;
      }
      this.tercerosStale = true;
      if (this.tercerosStaleStart === 0) {
        this.tercerosStaleStart = Date.now();
      }
      if (this.tercerosFailCount >= this.MAX_CONSECUTIVE_FAILURES) {
        this.tercerosCircuitOpen = true;
        // === INICIO FIX C-02 ===
        this._circuitOpenTercerosTimestamp = Date.now();
        try {
          PropertiesService.getScriptProperties().setProperty('CIRCUIT_OPEN_TERCEROS_TS', String(this._circuitOpenTercerosTimestamp));
        } catch (e) {
          Logger.log("[FIX-C-02] Could not persist circuit timestamp: " + e.toString());
        }
        // === FIN FIX C-02 ===
        Logger.log("CACHE: Circuito de terceros abierto tras " + this.tercerosFailCount + " fallos consecutivos");
      }
    } finally {
      this._refreshingTerceros = false;
    }
  },

  _refreshCartera() {
    if (this._refreshingCartera) {
      Logger.log("CACHE: _refreshCartera ya en progreso, saltando llamada redundante");
      return;
    }
    this._refreshingCartera = true;
    const sheetCartera = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    try {
      const COL_C = CARTERA_CONFIG.COLUMNS.CARTERA;
      const numCols = Math.max(...Object.values(COL_C)) + 1;
      const lastRow = sheetCartera.getLastRow();
      const totalDataRows = lastRow - 1;
      const dataCartera = this._readSheetRaw(sheetCartera, 2, totalDataRows, numCols);

      const newCartera = [];
      const newIndex = {};
      for (let i = 0; i < dataCartera.length; i++) {
        const rowIdx = 1 + i;
        const id = String(dataCartera[i][COL_C.id]).trim();
        if (!id) continue;
        newIndex[id] = rowIdx;
        newCartera.push({
          id,
          rowIndex: rowIdx,
          fecha: _safeDate(dataCartera[i][COL_C.fecha]),
          id_tercero: String(dataCartera[i][COL_C.id_tercero]).trim(),
          total: _parseMoneda(dataCartera[i][COL_C.total], 0),
          saldo: _parseMoneda(dataCartera[i][COL_C.saldo], 0),
          tipo: String(dataCartera[i][COL_C.tipo] || "CxC").trim(),
          estado: String(dataCartera[i][COL_C.estado] || "ABIERTA").trim(),
          fecha_vencimiento: _safeDate(dataCartera[i][COL_C.fecha_vencimiento]),
          vencida_timestamp: dataCartera[i][COL_C.vencida_timestamp] || null,
          version: Number(dataCartera[i][COL_C.version]) || 1,
        });
      }

      this.cartera = newCartera;
      this.carteraIndex = newIndex;
      this.lastRefreshCartera = Date.now();
      this.carteraStale = false;
      this.carteraStaleStart = 0;
      this.carteraFailCount = 0;
      this.carteraCircuitOpen = false;
      this.lastChecksumCartera = this._computeChecksum(newCartera);

      this._putNativeCache("cartera", {
        cartera: this.cartera,
        carteraIndex: this.carteraIndex,
        lastRefreshCartera: this.lastRefreshCartera,
        lastChecksumCartera: this.lastChecksumCartera
      });
    } catch (e) {
      this.carteraFailCount++;
      Logger.log("ERROR CACHE._refreshCartera (fail #" + this.carteraFailCount + "):" + e.toString());
      if (this.cartera === null) {
        this.carteraStale = false;
        return;
      }
      this.carteraStale = true;
      if (this.carteraStaleStart === 0) {
        this.carteraStaleStart = Date.now();
      }
      if (this.carteraFailCount >= this.MAX_CONSECUTIVE_FAILURES) {
        this.carteraCircuitOpen = true;
        // === INICIO FIX C-02 ===
        this._circuitOpenCarteraTimestamp = Date.now();
        try {
          PropertiesService.getScriptProperties().setProperty('CIRCUIT_OPEN_CARTERA_TS', String(this._circuitOpenCarteraTimestamp));
        } catch (e) {
          Logger.log("[FIX-C-02] Could not persist circuit timestamp: " + e.toString());
        }
        // === FIN FIX C-02 ===
        Logger.log("CACHE: Circuito de cartera abierto tras " + this.carteraFailCount + " fallos consecutivos");
      }
    } finally {
      this._refreshingCartera = false;
    }
  },

  getTerceroActivo(id) {
    this.refresh();
    const t = this.terceros.find(x => x.id === _sanitizeId(id) && x.activo);
    return t || null;
  },

  getTerceroRAW(id) {
    this.refresh();
    const t = this.terceros.find(x => x.id === _sanitizeId(id));
    return t || null;
  },

  getTerceros() {
    this.refresh();
    return this.terceros.filter(t => t.activo);
  },

  getCarteraPorTercero(idTercero) {
    const idClean = _sanitizeId(idTercero);
    if (!idClean) return [];

    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const numCols = Math.max(...Object.values(COL)) + 1;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const range = sheet.getRange(2, COL.id_tercero + 1, lastRow - 1, 1);
    const matches = range.createTextFinder(idClean)
      .matchEntireCell(true)
      .useRegularExpression(false)
      .findAll();

    if (!matches || matches.length === 0) return [];

    const rowIndexes = matches.map(match => match.getRow());
    const uniqueRows = Array.from(new Set(rowIndexes)).sort((a, b) => a - b);
    const items = [];

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

    for (const group of groups) {
      const values = sheet.getRange(group.start, 1, group.end - group.start + 1, numCols).getValues();
      for (let i = 0; i < values.length; i++) {
        items.push(DAO._rowToCarteraItem(values[i], group.start + i));
      }
    }

    return items;
  },

  getSaldoTercero(idTercero) {
    // === INICIO FIX M-03 ===
    const idClean = _sanitizeId(idTercero);
    if (!idClean) return 0;

    // Try cache first
    if (this.cartera && this.cartera.length > 0) {
      const items = this.cartera.filter(c =>
        c.id_tercero === idClean &&
        c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA
      );
      const saldo = items.reduce((sum, c) => sum + c.saldo, 0);
      Logger.log("[FIX-M-03] getSaldoTercero(%s) from cache: %s items, saldo=%s", idClean, items.length, saldo);
      return saldo;
    }

    // Fallback to sheet-based query if cache not available
    Logger.log("[FIX-M-03] getSaldoTercero(%s) cache miss, falling back to sheet", idClean);
    return this.getCarteraPorTercero(idClean)
      .filter(c => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
      .reduce((sum, c) => sum + c.saldo, 0);
    // === FIN FIX M-03 ===
  },

  getCarteraBase() {
    this.refresh();
    return this.cartera || [];
  },

  _getCacheKey(prefix) {
    const version = PropertiesService.getScriptProperties().getProperty("CACHE_VERSION_" + prefix.toUpperCase()) || "1";
    return prefix + "_v" + version;
  },

  _putNativeCache(keyPrefix, data) {
    try {
      const cache = CacheService.getScriptCache();
      const serialized = JSON.stringify(data);
      // === INICIO FIX m-02 ===
      if (serialized.length < 90000) {
        const key = this._getCacheKey(keyPrefix);
        cache.put(key, serialized, 300);
      } else {
        Logger.log("[FIX-m-02] [WARN] Cache data size %s bytes exceeds 90KB limit, not stored", serialized.length);
      }
      // === FIN FIX m-02 ===
    } catch (e) {
      Logger.log("CACHE: Error in _putNativeCache: " + e.toString());
    }
  },

  _getNativeCache(keyPrefix) {
    try {
      const cache = CacheService.getScriptCache();
      const key = this._getCacheKey(keyPrefix);
      const cached = cache.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      Logger.log("CACHE: Error in _getNativeCache: " + e.toString());
    }
    return null;
  }
};

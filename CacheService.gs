/**
 * LAYER 3: CACHE LAYER — ÍNDICES EN MEMORIA
 * Resuelve Problemas:
 * - #3: Caché con TTL fijo sin invalidación selectiva
 * - #7: Tiempo de vida del caché sin mecanismo de refresh bajo demanda
 */

function _cacheLogWarn(message, context) {
  if (typeof LogService !== 'undefined' && LogService && typeof LogService.logWarn === 'function') {
    LogService.logWarn(message, context);
  } else {
    Logger.log("[CACHE-LOG] WARN: " + message);
  }
}

// Dependencies verified lazily when CACHE.refresh() is called
class CacheIntegrityError extends Error {
  /**
   * Creates a cache integrity error for checksum mismatch.
   * @param {string} kind - Data type ('terceros' or 'cartera').
   * @param {string} currentChecksum - Computed checksum from spreadsheet.
   * @param {string} storedChecksum - Stored checksum from last refresh.
   */
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
   compras: null,
   compraIndex: {},
   productos: null,
   productoIndex: {},
   lastRefreshTerceros: 0,
   lastRefreshCartera: 0,
   lastRefreshCompras: 0,
   lastRefreshProductos: 0,
   CACHE_TTL: 300000,
   MAX_STALE_MS: 900000,
   MAX_CONSECUTIVE_FAILURES: 3,
   tercerosStale: false,
   carteraStale: false,
   comprasStale: false,
   productosStale: false,
   tercerosStaleStart: 0,
   carteraStaleStart: 0,
   comprasStaleStart: 0,
   productosStaleStart: 0,
   tercerosFailCount: 0,
   carteraFailCount: 0,
   comprasFailCount: 0,
   productosFailCount: 0,
   // Cache hit tracking
   _hitsTerceros: 0,
   _missesTerceros: 0,
   _hitsCartera: 0,
   _missesCartera: 0,
   _hitsCompras: 0,
   _missesCompras: 0,
   _hitsProductos: 0,
   _missesProductos: 0,
   // Circuit breaker states
   tercerosCircuitState: 'closed',
   carteraCircuitState: 'closed',
   comprasCircuitState: 'closed',
   productosCircuitState: 'closed',
   tercerosCircuitOpen: false,
   carteraCircuitOpen: false,
   comprasCircuitOpen: false,
   productosCircuitOpen: false,
  // === INICIO FIX C-02 ===
  _circuitOpenTercerosTimestamp: 0,
  _circuitOpenCarteraTimestamp: 0,
  _circuitOpenComprasTimestamp: 0,
  _circuitOpenProductosTimestamp: 0,
  _refreshingTerceros: false,
  _refreshingCartera: false,
  _refreshingCompras: false,
  _refreshingProductos: false,
  CIRCUIT_AUTO_CLOSE_MS: 30000,
  // === FIN FIX C-02 ===
  // === INICIO FIX CACHE-METRICS ===
  circuitOpens: 0,
  circuitCloses: 0,
  _metricsLoaded: false,
  checksumMismatches: 0,
  _checksumMismatchTimestamps: [],
  _CHECKSUM_MISMATCH_THRESHOLD: 5,
  _CHECKSUM_MISMATCH_WINDOW_MS: 60000,
  // === FIN FIX CACHE-METRICS ===
  lastChecksumTerceros: "",
  lastChecksumCartera: "",
  lastChecksumCompras: "",
  lastChecksumProductos: "",

  // === ESTADO DEL CIRCUIT BREAKER ===
  _CIRCUIT_STATES: {
    CLOSED: 'closed',
    OPEN: 'open',
    HALF_OPEN: 'half_open'
  },

  _loadMetrics() {
    try {
      const props = PropertiesService.getScriptProperties();
      this.circuitOpens = Math.min(Number(props.getProperty('CACHE_CIRCUIT_OPENS') || 0), 999999);
      this.circuitCloses = Math.min(Number(props.getProperty('CACHE_CIRCUIT_CLOSES') || 0), 999999);
      this._metricsLoaded = true;
    } catch (e) {
      Logger.log("CACHE: Error loading metrics: " + e.toString());
      _cacheLogWarn("Error loading metrics", { functionName: "_loadMetrics", error: e });
    }
  },

_persistMetric(name) {
    try {
      const props = PropertiesService.getScriptProperties();
      const key = name === 'circuitOpens' ? 'CACHE_CIRCUIT_OPENS' :
                  name === 'circuitCloses' ? 'CACHE_CIRCUIT_CLOSES' :
                  'CACHE_' + name.toUpperCase();
      const value = Number(this[name]);
      const cappedValue = Math.min(value, 999999);
      this[name] = cappedValue;
      props.setProperty(key, String(cappedValue));
    } catch (e) {
      Logger.log("CACHE: Error persisting metric " + name + ": " + e.toString());
    }
  },

_incrementMetric(name) {
      if (!this._metricsLoaded) this._loadMetrics();
      if (this[name] >= 999999) this[name] = 999998;
      this[name]++;
      // Batch: only persist every 10 increments or if critical
      if (this[name] % 10 !== 0 && name !== 'circuitOpens' && name !== 'circuitCloses') return;
      this._persistMetric(name);
    },
  // === FIN FIX CACHE-METRICS ===

  /**
   * Invalidates only the terceros cache and increments cache version.
   */
invalidateTerceros() {
     this.terceros = null;
     this.terceroIndex = {};
     this.lastRefreshTerceros = 0;
     this.tercerosStale = false;
     this.tercerosStaleStart = 0;
     this.tercerosFailCount = 0;
     this.tercerosCircuitOpen = false;
     this.tercerosCircuitState = 'closed';
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

/**
   * Invalidates only the cartera cache and increments cache version.
   */
invalidateCartera() {
     this.cartera = null;
     this.carteraIndex = {};
     this.lastRefreshCartera = 0;
     this.carteraStale = false;
     this.carteraStaleStart = 0;
     this.carteraFailCount = 0;
     this.carteraCircuitOpen = false;
     this.carteraCircuitState = 'closed';
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
   * Invalidates both terceros and cartera caches.
   */
  invalidate() {
    this.invalidateTerceros();
    this.invalidateCartera();
  },

  /**
   * Get circuit state for a given kind
   * @param {string} kind - 'terceros' or 'cartera'
   * @returns {string} Current state: 'closed', 'open', or 'half_open'
   */
  _getCircuitState(kind) {
    return kind === 'terceros' ? this.tercerosCircuitState : this.carteraCircuitState;
  },

  /**
   * Set circuit state for a given kind
   * @param {string} kind - 'terceros' or 'cartera'
   * @param {string} state - new state: 'closed', 'open', or 'half_open'
   */
  _setCircuitState(kind, state) {
    if (kind === 'terceros') {
      this.tercerosCircuitState = state;
    } else {
      this.carteraCircuitState = state;
    }
  },

  /**
   * Executes a function with circuit breaker protection and retry logic.
   * In HALF_OPEN state, allows one test request to verify service recovery.
   * @param {string} kind - 'terceros' or 'cartera'
   * @param {Function} fn - Function to execute
   * @param {number} maxRetries - Maximum retries (default 3)
   * @returns {*} Result of the function
   */
  executeWithCircuit(kind, fn, maxRetries = 3) {
    const state = this._getCircuitState(kind);
    
    // If circuit is OPEN, reject immediately
    if (state === 'open') {
      throw new Error(`Circuit breaker OPEN for ${kind}. Service unavailable.`);
    }
    
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = fn();
        // Success - close circuit (or verify recovery from half_open)
        this._halfOpenCircuit(kind, true);
        return result;
      } catch (e) {
        lastError = e;
        Logger.log(`[FIX-C-02] Attempt ${attempt + 1}/${maxRetries} failed: ${e.message}`);
        if (attempt < maxRetries - 1) {
          Utilities.sleep(1000 * (attempt + 1)); // Exponential backoff
        }
      }
    }
    
    // All retries failed - open circuit
    this._halfOpenCircuit(kind, false);
    throw lastError;
  },

  _halfOpenCircuit(kind, testResult) {
    if (!testResult) {
      this._setCircuitState(kind, 'open');
      this[kind === 'terceros' ? 'tercerosCircuitOpen' : 'carteraCircuitOpen'] = true;
      const props = PropertiesService.getScriptProperties();
      const currentFailures = kind === 'terceros' ? this.tercerosFailCount : this.carteraFailCount;
      const backoffMs = Math.min(60000, 5000 * Math.pow(2, currentFailures));
      const newOpenTs = Date.now() + backoffMs;
      if (kind === 'terceros') {
        this._circuitOpenTercerosTimestamp = newOpenTs;
        props.setProperty('CIRCUIT_OPEN_TERCEROS_TS', String(newOpenTs));
      } else {
        this._circuitOpenCarteraTimestamp = newOpenTs;
        props.setProperty('CIRCUIT_OPEN_CARTERA_TS', String(newOpenTs));
      }
      Logger.log(`[FIX-C-02] HALF_OPEN test failed. Circuit ${kind} back to OPEN with ${backoffMs}ms backoff`);
      return false;
    }

    const staleProp = kind === 'terceros' ? 'tercerosStale' : 'carteraStale';
    const staleStartProp = kind === 'terceros' ? 'tercerosStaleStart' : 'carteraStaleStart';
    const isStale = this[staleProp] && (Date.now() - this[staleStartProp]) > this.MAX_STALE_MS / 2;
    if (isStale) {
      Logger.log(`[FIX-C-02] HALF_OPEN test succeeded but data too stale. Keeping circuit OPEN.`);
      const props = PropertiesService.getScriptProperties();
      const currentFailures = kind === 'terceros' ? this.tercerosFailCount : this.carteraFailCount;
      const backoffMs = Math.min(60000, 5000 * Math.pow(2, currentFailures));
      const newOpenTs = Date.now() + backoffMs;
      if (kind === 'terceros') {
        this._circuitOpenTercerosTimestamp = newOpenTs;
        props.setProperty('CIRCUIT_OPEN_TERCEROS_TS', String(newOpenTs));
      } else {
        this._circuitOpenCarteraTimestamp = newOpenTs;
        props.setProperty('CIRCUIT_OPEN_CARTERA_TS', String(newOpenTs));
      }
      return false;
    }

    this._setCircuitState(kind, 'closed');
    this[kind === 'terceros' ? 'tercerosCircuitOpen' : 'carteraCircuitOpen'] = false;
    this[kind === 'terceros' ? 'tercerosFailCount' : 'carteraFailCount'] = 0;
    if (kind === 'terceros') {
      this._circuitOpenTercerosTimestamp = 0;
      PropertiesService.getScriptProperties().deleteProperty('CIRCUIT_OPEN_TERCEROS_TS');
    } else {
      this._circuitOpenCarteraTimestamp = 0;
      PropertiesService.getScriptProperties().deleteProperty('CIRCUIT_OPEN_CARTERA_TS');
    }
    this._incrementMetric('circuitCloses');
    Logger.log(`[FIX-C-02] HALF_OPEN test succeeded + health verified. Circuit ${kind} CLOSED - service recovered`);
    return true;
  },
  


  /**
   * Force reset circuit breaker (admin function)
   * @param {string} kind - 'terceros', 'cartera', or 'all'
   */
  forceResetCircuit(kind) {
    if (kind === 'terceros' || kind === 'all') {
      this.tercerosCircuitState = 'closed';
      this.tercerosCircuitOpen = false;
      this.tercerosFailCount = 0;
      this._circuitOpenTercerosTimestamp = 0;
      PropertiesService.getScriptProperties().deleteProperty('CIRCUIT_OPEN_TERCEROS_TS');
    }
    if (kind === 'cartera' || kind === 'all') {
      this.carteraCircuitState = 'closed';
      this.carteraCircuitOpen = false;
      this.carteraFailCount = 0;
      this._circuitOpenCarteraTimestamp = 0;
      PropertiesService.getScriptProperties().deleteProperty('CIRCUIT_OPEN_CARTERA_TS');
    }
    Logger.log(`[FIX-C-02] Circuit breaker reset: ${kind}`);
  },

  /**
   * Get current circuit state (health check)
   * @param {string} kind - 'terceros' or 'cartera'
   * @returns {Object} State information
   */
  getCircuitState(kind) {
    const state = this._getCircuitState(kind);
    const timestamp = kind === 'terceros' ? this._circuitOpenTercerosTimestamp : this._circuitOpenCarteraTimestamp;
    const failCount = kind === 'terceros' ? this.tercerosFailCount : this.carteraFailCount;
    // timestamp is either 0 or a future timestamp when circuit is open
    const nextRetryMs = state === 'open' && timestamp > Date.now() ? Math.max(0, timestamp - Date.now()) : 0;
    return {
      state: state,
      failCount: failCount,
      nextRetryMs: nextRetryMs
    };
  },

  // === INICIO FIX C-02 ===
  _autoRecoverCircuitBreaker(kind) {
    const state = this._getCircuitState(kind);
    
    if (state === 'half_open') {
      return;
    }
    
    const props = PropertiesService.getScriptProperties();
    const timestampKey = kind === 'terceros' ? 'CIRCUIT_OPEN_TERCEROS_TS' : 'CIRCUIT_OPEN_CARTERA_TS';
    const storedTs = Number(props.getProperty(timestampKey) || '0');
    
    // Validate timestamp: must be numeric and within reasonable window (max 24h)
    const MAX_BACKOFF_MS = 86400000; // 24h
    const validTs = !isNaN(storedTs) && storedTs > 0 && storedTs <= Date.now() + MAX_BACKOFF_MS;
    
    // storedTs is a future timestamp (circuit opened at Date.now() + backoffMs)
    // Circuit can transition to half_open when current time >= storedTs (backoff elapsed)
    if (state === 'open' && validTs && Date.now() >= storedTs) {
      Logger.log(`[FIX-C-02] Circuit breaker transitioning to HALF_OPEN for ${kind} after backoff elapsed`);
      this._setCircuitState(kind, 'half_open');
      if (kind === 'terceros') {
        this.tercerosCircuitOpen = true;
        this._transitionToHalfOpen('terceros');
      } else {
        this.carteraCircuitOpen = true;
        this._transitionToHalfOpen('cartera');
      }
    }
  },
  
  /**
   * Transition to HALF_OPEN state - allows one test request
   * @private
   */
  _transitionToHalfOpen(kind) {
    Logger.log(`[FIX-C-02] _transitionToHalfOpen: ${kind} entering half_open state`);
    // The actual state change is already done by _setCircuitState
    // This method allows for any additional half-open initialization
  },
  // === FIN FIX C-02 ===

/**
   * Checks whether the terceros cache is valid (not stale, circuit not open/half_open).
   * Automatically attempts circuit recovery if in OPEN state.
   * @returns {boolean} true if cache is usable.
   */
isTercerosValid() {
      if (this.terceros !== null && (Date.now() - this.lastRefreshTerceros) < this.CACHE_TTL) {
       this._hitsTerceros++;
     } else {
       this._missesTerceros++;
     }

     const circuitState = this._getCircuitState('terceros');

     if (circuitState === 'open') {
       this._autoRecoverCircuitBreaker('terceros');
       const newState = this._getCircuitState('terceros');
       if (newState === 'open') {
         return false;
       }
     }

     if (circuitState === 'half_open') {
       Logger.log("[FIX-C-02] Half_open detected, forcing refresh as test request");
       return false;
     }

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

/**
   * Checks whether the cartera cache is valid (not stale, circuit not open/half_open).
   * Automatically attempts circuit recovery if in OPEN state.
   * @returns {boolean} true if cache is usable.
   */
isCarteraValid() {
      if (this.cartera !== null && (Date.now() - this.lastRefreshCartera) < this.CACHE_TTL) {
       this._hitsCartera++;
     } else {
       this._missesCartera++;
     }

     const circuitState = this._getCircuitState('cartera');

     if (circuitState === 'open') {
       this._autoRecoverCircuitBreaker('cartera');
       const newState = this._getCircuitState('cartera');
       if (newState === 'open') {
         return false;
       }
     }

     if (circuitState === 'half_open') {
       Logger.log("[FIX-C-02] Half_open detected, forcing refresh as test request");
       return false;
     }

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
   * Refreshes cache data if stale, expired, or forceRefresh is requested.
   * Checks circuit breaker state and attempts half-open transitions before refresh.
   * @param {boolean} [forceRefresh=false] - If true, invalidates all caches before refresh.
   */
  refresh(forceRefresh = false) {
    validateAndMapSchemas();
    if (!this._metricsLoaded) this._loadMetrics();

    if (forceRefresh) {
      this.invalidate();
    }

    // Check for half-open transition before refresh
    this._autoRecoverCircuitBreaker('terceros');
    if (!this.isTercerosValid()) {
      this._refreshTerceros();
    }

    this._autoRecoverCircuitBreaker('cartera');
    if (!this.isCarteraValid()) {
      this._refreshCartera();
    }
  },

/**
   * Recovers from stale data by invalidating and refreshing all caches.
   * Uses global lock and retries up to 3 times.
   * @returns {boolean} true if recovery succeeded.
   */
recoverFromStale() {
     Logger.log("CACHE: Iniciando protocolo de recuperación por datos obsoletos");
     if (!LOCK_MANAGER._safeTryLock(5000)) {
       Logger.log("CACHE: No se pudo adquirir lock global para recoverFromStale, abortando");
       return false;
     }
     try {
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
           Logger.log("CACHE: recoverFromStale intento " + attempt + " falló: " + e);
           if (attempt < maxAttempts) {
             const backoff = 500 * Math.pow(2, attempt - 1);
             Logger.log("CACHE: Esperando " + backoff + "ms antes del próximo intento");
             Utilities.sleep(backoff);
           }
         }
       }
       Logger.log("CACHE: Protocolo de recuperación completado. restaurado=" + restored + " tras " + attempt + " intento(s)");
       return restored;
     } finally {
       LOCK_MANAGER._safeReleaseLock();
     }
   },

  /**
   * Verifies cache consistency by comparing checksums against spreadsheet data.
   * @returns {{terceros: boolean, cartera: boolean, mismatched: boolean}}
   */
  verifyConsistency() {
    const tResult = this._verifyChecksum('terceros');
    const cResult = this._verifyChecksum('cartera');
    return {
      terceros: !tResult.mismatch,
      cartera: !cResult.mismatch,
      mismatched: tResult.mismatch || cResult.mismatch,
    };
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
     
     // Track checksum mismatch for auto-circuit-breaker
     this.checksumMismatches++;
     this._checksumMismatchTimestamps.push(Date.now());
     this._cleanupChecksumMismatchTimestamps();
     
      if (this._shouldAutoOpenCircuitForChecksum()) {
        Logger.log("CACHE: Checksum mismatches threshold exceeded, opening circuit breaker");
        this._setCircuitState(kind, 'open');
        if (kind === 'terceros') {
          this.tercerosCircuitOpen = true;
          this._incrementMetric('circuitOpens');
          this._circuitOpenTercerosTimestamp = Date.now();
          PropertiesService.getScriptProperties().setProperty('CIRCUIT_OPEN_TERCEROS_TS', String(this._circuitOpenTercerosTimestamp));
        } else {
          this.carteraCircuitOpen = true;
          this._incrementMetric('circuitOpens');
          this._circuitOpenCarteraTimestamp = Date.now();
          PropertiesService.getScriptProperties().setProperty('CIRCUIT_OPEN_CARTERA_TS', String(this._circuitOpenCarteraTimestamp));
        }
      }
     
     this.recoverFromStale();
     return false;
   },

  /**
   * Cleans up old checksum mismatch timestamps
   * @private
   */
  _cleanupChecksumMismatchTimestamps() {
    const now = Date.now();
    this._checksumMismatchTimestamps = this._checksumMismatchTimestamps.filter(
      ts => (now - ts) < this._CHECKSUM_MISMATCH_WINDOW_MS
    );
  },

  /**
   * Checks if checksum mismatches exceed threshold
   * @private
   * @returns {boolean} true if circuit should auto-open
   */
  _shouldAutoOpenCircuitForChecksum() {
    this._cleanupChecksumMismatchTimestamps();
    return this._checksumMismatchTimestamps.length >= this._CHECKSUM_MISMATCH_THRESHOLD;
  },

/**
    * Verifica integridad de la caché contra la hoja de cálculo usando SHA-256.
    * Lee la hoja, reconstruye la estructura de datos, computa el checksum
    * y lo compara con el registrado al cargar la caché. Si no coinciden,
    * ejecuta recoverFromStale() para recargar desde la fuente, a menos que
    * throwOnError esté activo.
    * AUDIT-004: Retries con backoff exponencial anteceden a failure (tolerancia temporal).
    * @param {'terceros'|'cartera'} kind Tipo de datos a verificar.
    * @param {Object} [options] Opciones adicionales.
    * @param {boolean} [options.throwOnError=false] Si es true, lanza CacheIntegrityError en lugar de recuperar.
    * @param {number} [options.maxRetries=2] Número de reintentos (backoff exponencial) antes de failure.
    * @returns {boolean} true si los datos están íntegros, false si se recuperó.
    * @throws {CacheIntegrityError} Si throwOnError es true y hay mismatch.
    */
   ensureIntegrity(kind, options = {}) {
     const { throwOnError = false, maxRetries = 2 } = options;

     for (let attempt = 0; attempt <= maxRetries; attempt++) {
       const result = this._verifyChecksum(kind);

       if (!result.mismatch) {
         return true;
       }

       if (attempt < maxRetries) {
         // Posible race condition temporal → backoff exponencial y reintentar
         const delayMs = 100 * Math.pow(2, attempt) + Math.random() * 50;
         Logger.log(`[AUDIT-004] Checksum mismatch intento ${attempt + 1}/${maxRetries + 1}, backoff ${Math.round(delayMs)}ms`);
         Utilities.sleep(delayMs);
         continue;
       }

       // Mismatch persistente después de retries → realmente hay corrupción
       if (throwOnError) {
         const storedChecksum = kind === 'terceros' ? this.lastChecksumTerceros : this.lastChecksumCartera;
         throw new CacheIntegrityError(kind, result.currentChecksum, storedChecksum);
       }
       return this._handleIntegrityFailure(kind);
     }

     return false;
   },

  /**
   * Returns detailed staleness and health info for terceros and cartera caches.
   * Includes validity, age, stale duration, fail count, circuit state, hit ratios.
   * @returns {Object} Staleness information object with terceros/cartera/metrics/ttl.
   */
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
        circuitState: this.tercerosCircuitState,
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
        circuitState: this.carteraCircuitState,
count: this.cartera ? this.cartera.length : 0,
       },
       metrics: {
         circuitOpens: this.circuitOpens,
         circuitCloses: this.circuitCloses,
         hitRatioTerceros: this._hitsTerceros + this._missesTerceros > 0 
           ? this._hitsTerceros / (this._hitsTerceros + this._missesTerceros) 
           : 0,
         hitRatioCartera: this._hitsCartera + this._missesCartera > 0 
           ? this._hitsCartera / (this._hitsCartera + this._missesCartera) 
           : 0,
       },
ttl: this.CACHE_TTL
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
      Logger.log("CACHE: _refreshTerceros ya en progreso, saltando");
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
        const rowIdx = 2 + i;
        const id = _sanitizeId(_stripLeadingQuote(dataTerceros[i][COL_T.id]));
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
      this.tercerosCircuitState = 'closed';
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
          this.tercerosCircuitState = 'open';
          this._incrementMetric('circuitOpens');
          this._circuitOpenTercerosTimestamp = Date.now();
         try {
           PropertiesService.getScriptProperties().setProperty('CIRCUIT_OPEN_TERCEROS_TS', String(this._circuitOpenTercerosTimestamp));
         } catch (e) {
           Logger.log("[FIX-C-02] Could not persist circuit timestamp: " + e.toString());
         }
         Logger.log("CACHE: Circuito de terceros abierto tras " + this.tercerosFailCount + " fallos consecutivos");
       }
     } finally {
       this._refreshingTerceros = false;
     }
   },

  _refreshCartera() {
    if (this._refreshingCartera) {
      Logger.log("CACHE: _refreshCartera ya en progreso, saltando");
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
        const rowIdx = 2 + i;
        const id = _sanitizeId(_stripLeadingQuote(dataCartera[i][COL_C.id]));
        if (!id) continue;
        const idTercero = _sanitizeId(_stripLeadingQuote(dataCartera[i][COL_C.id_tercero]));
        newIndex[id] = rowIdx;
        newCartera.push({
          id,
          rowIndex: rowIdx,
          fecha: _safeDate(dataCartera[i][COL_C.fecha]),
          id_tercero: idTercero,
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
      this.carteraCircuitState = 'closed';
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
         this.carteraCircuitState = 'open';
         this._incrementMetric('circuitOpens');
         this._circuitOpenCarteraTimestamp = Date.now();
         try {
           PropertiesService.getScriptProperties().setProperty('CIRCUIT_OPEN_CARTERA_TS', String(this._circuitOpenCarteraTimestamp));
         } catch (e) {
           Logger.log("[FIX-C-02] Could not persist circuit timestamp: " + e.toString());
         }
         Logger.log("CACHE: Circuito de cartera abierto tras " + this.carteraFailCount + " fallos consecutivos");
       }
     } finally {
       this._refreshingCartera = false;
     }
   },

  /**
   * Gets an active tercero by ID, refreshing cache if needed.
   * @param {string} id - Tercero ID.
   * @returns {Object|null} Tercero object or null if not found or inactive.
   */
  getTerceroActivo(id) {
    this.refresh();
    const t = this.terceros.find(x => x.id === _sanitizeId(id) && x.activo);
    return t || null;
  },

  /**
   * Gets a tercero by ID regardless of active/inactive status.
   * @param {string} id - Tercero ID.
   * @returns {Object|null} Tercero object or null if not found.
   */
  getTerceroRAW(id) {
    this.refresh();
    const t = this.terceros.find(x => x.id === _sanitizeId(id));
    return t || null;
  },

  /**
   * Gets all active terceros, refreshing cache if needed.
   * @returns {Array<Object>} List of active terceros.
   */
  getTerceros() {
    this.refresh();
    return this.terceros.filter(t => t.activo);
  },

  /**
   * Gets cartera items for a specific tercero, from cache or sheet.
   * @param {string} idTercero - Tercero ID to filter by.
   * @returns {Array<Object>} Cartera items for the given tercero.
   */
  getCarteraPorTercero(idTercero) {
    const idClean = _sanitizeId(idTercero);
    if (!idClean) return [];

    this.refresh();
    if (this.cartera && this.cartera.length > 0) {
      const items = this.cartera
        .filter(c => c.id_tercero === idClean)
        .map(c => ({
          id: c.id,
          rowIndex: c.rowIndex,
          fecha: c.fecha,
          id_tercero: c.id_tercero,
          total: c.total,
          saldo: c.saldo,
          tipo: c.tipo,
          estado: c.estado,
          fecha_vencimiento: c.fecha_vencimiento,
          vencida_timestamp: c.vencida_timestamp,
          version: c.version,
          nombre_tercero: this.terceroIndex && this.terceroIndex[idClean]
            ? this.terceros.find(t => t.id === idClean)?.nombre || ""
            : "",
          dias_vencido: c.fecha_vencimiento
            ? Math.max(0, Math.floor((Date.now() - c.fecha_vencimiento.getTime()) / 86400000))
            : 0,
        }));
      return items;
    }

    return this._getCarteraPorTerceroFromSheet(idClean);
  },

  _getCarteraPorTerceroFromSheet(idClean) {
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
      if (row === end + 1) { end = row; }
      else { groups.push({ start, end }); start = row; end = row; }
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

  /**
   * Gets the current balance (saldo) for a tercero, using pre-built saldo map for O(1) lookup.
   * @param {string} idTercero - Tercero ID.
   * @returns {number} Current balance (0 if not found or canceled).
   */
  getSaldoTercero(idTercero) {
    // === INICIO FIX M-03 ===
    const idClean = _sanitizeId(idTercero);
    if (!idClean) return 0;

    // Try cache first - use index for O(1) lookup
    if (this.cartera && this.cartera.length > 0 && this.carteraIndex) {
      // Build saldo map from index (carteraIndex has id_tercero -> row indexes)
      const saldoMap = this._buildSaldoMap();
      const saldo = saldoMap[idClean] || 0;
      Logger.log("[FIX-M-03] getSaldoTercero(%s) from pre-built map: %s", idClean, saldo);
      return saldo;
    }

    // Fallback: single batch read instead of N+1
    Logger.log("[FIX-M-03] getSaldoTercero(%s) cache miss, sheet fallback", idClean);
    return this._getSaldoFromSheet(idClean);
    // === FIN FIX M-03 ===
  },

  /**
   * Build a saldo map for all terceros - O(N) once instead of O(N) per query
   * @private
   */
  _buildSaldoMap() {
    const saldoMap = {};
    for (const c of this.cartera) {
      if (c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA) {
        const key = c.id_tercero;
        if (!saldoMap[key]) saldoMap[key] = 0;
        saldoMap[key] += c.saldo;
      }
    }
    return saldoMap;
  },

  /**
   * Single sheet read to get saldo for a tercero - avoids N+1
   * @private
   */
  _getSaldoFromSheet(idTercero) {
    const sheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return 0;
    
    // Single read for all rows, filter in memory
    const numCols = Math.max(...Object.values(COL)) + 1;
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    
    let saldo = 0;
    for (const row of data) {
      const rowIdTercero = String(row[COL.id_tercero] || "").trim();
      const estado = String(row[COL.estado] || "").trim();
      if (rowIdTercero === idTercero && estado !== CARTERA_CONFIG.ESTADOS.CANCELADA) {
        saldo += _parseMoneda(row[COL.saldo], 0);
      }
    }
    return saldo;
  },

  /**
   * Gets the full cartera array from cache (all items, no filter).
   * @returns {Array<Object>} Full cartera data.
   */
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
       const chunkSize = 90000;
       const baseKey = this._getCacheKey(keyPrefix);
       if (serialized.length < 90000) {
         cache.put(baseKey, serialized, 300);
         cache.put(baseKey + "_meta", "1", 300);
       } else {
          const totalChunks = Math.ceil(serialized.length / chunkSize);
          for (let c = 0; c < totalChunks; c++) {
            const chunk = serialized.substring(c * chunkSize, (c + 1) * chunkSize);
           cache.put(baseKey + "_c" + c, chunk, 300);
         }
         cache.put(baseKey + "_meta", String(totalChunks), 300);
         Logger.log("CACHE: Fragmentado en " + totalChunks + " chunks");
       }
     } catch (e) {
       Logger.log("CACHE: Error in _putNativeCache: " + e.toString());
     }
   },

  _getNativeCache(keyPrefix) {
    try {
      const cache = CacheService.getScriptCache();
      const baseKey = this._getCacheKey(keyPrefix);
      const meta = cache.get(baseKey + "_meta");
      if (!meta) return null;
      const totalChunks = parseInt(meta, 10);
      if (totalChunks <= 1) {
        const cached = cache.get(baseKey);
        return cached ? JSON.parse(cached) : null;
      }
      const parts = [];
      for (let c = 0; c < totalChunks; c++) {
        const chunk = cache.get(baseKey + "_c" + c);
        if (!chunk) return null;
        parts.push(chunk);
      }
      return JSON.parse(parts.join(""));
} catch (e) {
       Logger.log("CACHE: Error in _getNativeCache: " + e.toString());
     }
 return null;
     },

    /**
   * Computes estimated memory usage for cache data
   * @private
   */
  _estimateMemoryUsage() {
    let size = 0;
    if (this.terceros) size += JSON.stringify(this.terceros).length;
    if (this.terceroIndex) size += JSON.stringify(this.terceroIndex).length;
    if (this.cartera) size += JSON.stringify(this.cartera).length;
    if (this.carteraIndex) size += JSON.stringify(this.carteraIndex).length;
    if (this.compras) size += JSON.stringify(this.compras).length;
    if (this.compraIndex) size += JSON.stringify(this.compraIndex).length;
    if (this.productos) size += JSON.stringify(this.productos).length;
    if (this.productoIndex) size += JSON.stringify(this.productoIndex).length;
    size += JSON.stringify(this._cache || {}).length;
    size += JSON.stringify(this._metadata || {}).length;
    return size;
  },

  /**
   * Counts stale entries in cache
   * @private
   */
  _countStaleEntries() {
    let count = 0;
    if (this.tercerosStale) {
      count += this.terceros ? this.terceros.length : 0;
    }
    if (this.carteraStale) {
      count += this.cartera ? this.cartera.length : 0;
    }
    if (this.comprasStale) {
      count += this.compras ? this.compras.length : 0;
    }
    if (this.productosStale) {
      count += this.productos ? this.productos.length : 0;
    }
    return count;
  },

  /**
   * Returns comprehensive health status for both caches.
   * Includes hit rates, circuit states, stale counts, memory usage, fail counts.
   * @returns {Object} Health info for terceros, cartera, and global.
   */
  getHealth() {
    const tState = this.getCircuitState('terceros');
    const cState = this.getCircuitState('cartera');
    const tHitRatio = this._hitsTerceros + this._missesTerceros > 0
      ? this._hitsTerceros / (this._hitsTerceros + this._missesTerceros)
      : 0;
    const cHitRatio = this._hitsCartera + this._missesCartera > 0
      ? this._hitsCartera / (this._hitsCartera + this._missesCartera)
      : 0;
    
    return {
      terceros: {
        cacheHitRate: tHitRatio * 100,
        circuitState: tState.state,
        staleEntriesCount: this.tercerosStale ? (this.terceros ? this.terceros.length : 0) : 0,
        memoryUsage: this.terceros ? JSON.stringify(this.terceros).length : 0,
        failCount: this.tercerosFailCount,
        nextRetryMs: tState.nextRetryMs,
        checksumValidationStatus: this.lastChecksumTerceros ? 'valid' : 'not_initialized'
      },
      cartera: {
        cacheHitRate: cHitRatio * 100,
        circuitState: cState.state,
        staleEntriesCount: this.carteraStale ? (this.cartera ? this.cartera.length : 0) : 0,
        memoryUsage: this.cartera ? JSON.stringify(this.cartera).length : 0,
        failCount: this.carteraFailCount,
        nextRetryMs: cState.nextRetryMs,
        checksumValidationStatus: this.lastChecksumCartera ? 'valid' : 'not_initialized'
      },
      compras: {
        cacheHitRate: (this._hitsCompras + this._missesCompras > 0) ? (this._hitsCompras / (this._hitsCompras + this._missesCompras)) * 100 : 0,
        circuitState: this.getCircuitState('compras').state,
        staleEntriesCount: this.comprasStale ? (this.compras ? this.compras.length : 0) : 0,
        memoryUsage: this.compras ? JSON.stringify(this.compras).length : 0,
        failCount: this.comprasFailCount,
        nextRetryMs: this.getCircuitState('compras').nextRetryMs,
        checksumValidationStatus: this.lastChecksumCompras ? 'valid' : 'not_initialized'
      },
      productos: {
        cacheHitRate: (this._hitsProductos + this._missesProductos > 0) ? (this._hitsProductos / (this._hitsProductos + this._missesProductos)) * 100 : 0,
        circuitState: this.getCircuitState('productos').state,
        staleEntriesCount: this.productosStale ? (this.productos ? this.productos.length : 0) : 0,
        memoryUsage: this.productos ? JSON.stringify(this.productos).length : 0,
        failCount: this.productosFailCount,
        nextRetryMs: this.getCircuitState('productos').nextRetryMs,
        checksumValidationStatus: this.lastChecksumProductos ? 'valid' : 'not_initialized'
      },
      global: {
        staleEntriesCount: this._countStaleEntries(),
        memoryUsage: this._estimateMemoryUsage()
      }
    };
  },

  // === ÍNDICES PARA COMPRAS Y PRODUCTOS ===

  /**
   * Gets compra index for O(1) lookup by ID.
   * @param {string} id - Compra ID.
   * @returns {number|null} Row index or null if not found.
   */
  getCompraIndex(id) {
    if (!id) return null;
    this._ensureComprasLoaded();
    return this.compraIndex[_sanitizeId(id)] || null;
  },

  /**
   * Gets producto index for O(1) lookup by ID.
   * @param {string} id - Producto ID.
   * @returns {number|null} Row index or null if not found.
   */
  getProductoIndex(id) {
    if (!id) return null;
    this._ensureProductosLoaded();
    return this.productoIndex[_sanitizeId(id)] || null;
  },

  /**
   * Ensures compras are loaded in cache.
   * @private
   */
  _ensureComprasLoaded() {
    if (!this.compras || this.compras.length === 0 || this.comprasStale) {
      this._refreshCompras();
    }
  },

  /**
   * Ensures productos are loaded in cache.
   * @private
   */
  _ensureProductosLoaded() {
    if (!this.productos || this.productos.length === 0 || this.productosStale) {
      this._refreshProductos();
    }
  },

  /**
   * Refreshes only compras entity.
   * @private
   */
  _refreshCompras() {
    if (this._refreshingCompras) return;
    this._refreshingCompras = true;
    try {
      const sheet = getSheet(COMPRAS_CONFIG.SHEETS.COMPRAS);
      const C = COMPRAS_CONFIG.COLUMNS.COMPRAS;
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        this.compras = [];
        this.compraIndex = {};
        this._refreshingCompras = false;
        return;
      }
      const numCols = Math.max(...Object.values(C)) + 1;
      const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

      const newCompras = [];
      const newIndex = {};
      for (let i = 0; i < data.length; i++) {
        const rowIdx = 2 + i;
        const id = _sanitizeId(_stripLeadingQuote(data[i][C.id] || ""));
        if (!id) continue;
        newIndex[id] = rowIdx;
        newCompras.push({
          id,
          rowIndex: rowIdx,
          fecha: data[i][C.fecha],
          id_proveedor: _sanitizeId(_stripLeadingQuote(data[i][C.id_proveedor] || "")),
          id_factura: _sanitizeId(_stripLeadingQuote(data[i][C.id_factura] || "")),
          total: _parseMoneda(data[i][C.total], 0),
          saldo: _parseMoneda(data[i][C.saldo], 0),
          estado: String(data[i][C.estado] || "").trim(),
          version: parseInt(data[i][C.version]) || 1
        });
      }
      this.compras = newCompras;
      this.compraIndex = newIndex;
      this.lastRefreshCompras = Date.now();
      this.comprasStale = false;
      this.lastChecksumCompras = this._computeChecksum(newCompras);
    } catch (e) {
      this.comprasFailCount++;
      this.comprasStale = true;
      Logger.log("CACHE: Error _refreshCompras #" + this.comprasFailCount + ": " + e.toString());
    } finally {
      this._refreshingCompras = false;
    }
  },

  /**
   * Refreshes only productos entity.
   * @private
   */
  _refreshProductos() {
    if (this._refreshingProductos) return;
    this._refreshingProductos = true;
    try {
      const sheet = getSheet(DAO_PRODUCTOS.SHEET);
      const C = DAO_PRODUCTOS.COL;
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        this.productos = [];
        this.productoIndex = {};
        this._refreshingProductos = false;
        return;
      }
      const numCols = Math.max(...Object.values(C)) + 1;
      const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

      const newProductos = [];
      const newIndex = {};
      for (let i = 0; i < data.length; i++) {
        const rowIdx = 2 + i;
        const id = _sanitizeId(_stripLeadingQuote(data[i][C.id] || ""));
        if (!id) continue;
        newIndex[id] = rowIdx;
        newProductos.push({
          id,
          rowIndex: rowIdx,
          nombre: String(data[i][C.nombre] || "").trim(),
          stock: _parseMoneda(data[i][C.stock], 0),
          version: _parseMoneda(data[i][C.version], 1)
        });
      }
      this.productos = newProductos;
      this.productoIndex = newIndex;
      this.lastRefreshProductos = Date.now();
      this.productosStale = false;
      this.lastChecksumProductos = this._computeChecksum(newProductos);
    } catch (e) {
      this.productosFailCount++;
      this.productosStale = true;
      Logger.log("CACHE: Error _refreshProductos #" + this.productosFailCount + ": " + e.toString());
    } finally {
      this._refreshingProductos = false;
    }
  },

  // === MÉTODO DE REFRESCO SELECTIVO ===

  /**
   * Refreshes a specific entity by kind.
   * @param {string} kind - Entity kind ('terceros', 'cartera', 'compras', 'productos').
   */
  refreshEntity(kind) {
    if (kind === 'terceros') this._refreshTerceros();
    else if (kind === 'cartera') this._refreshCartera();
    else if (kind === 'compras') this._refreshCompras();
    else if (kind === 'productos') this._refreshProductos();
  }
};

/**
 * LAYER 3: CACHE LAYER — ÍNDICES EN MEMORIA
 * Resuelve Problemas:
 * - #3: Caché con TTL fijo sin invalidación selectiva
 * - #7: Tiempo de vida del caché sin mecanismo de refresh bajo demanda
 */

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
  lastChecksumTerceros: "",
  lastChecksumCartera: "",

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
  },

  /**
   * Invalida todo el caché 
   */
  invalidate() {
    this.invalidateTerceros();
    this.invalidateCartera();
  },

  isTercerosValid() {
    if (this.tercerosCircuitOpen) return false;
    if (this.tercerosStale) {
      if (this.tercerosStaleStart > 0 && (Date.now() - this.tercerosStaleStart) > this.MAX_STALE_MS) {
        return false;
      }
      return false;
    }
    return this.terceros !== null && (Date.now() - this.lastRefreshTerceros) < this.CACHE_TTL;
  },

  isCarteraValid() {
    if (this.carteraCircuitOpen) return false;
    if (this.carteraStale) {
      if (this.carteraStaleStart > 0 && (Date.now() - this.carteraStaleStart) > this.MAX_STALE_MS) {
        return false;
      }
      return false;
    }
    return this.cartera !== null && (Date.now() - this.lastRefreshCartera) < this.CACHE_TTL;
  },

  /**
   * Recarga caché (permite forzar refresco)
   */
  refresh(forceRefresh = false) {
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
    this._refreshTerceros();
    this._refreshCartera();
    const restored = !this.tercerosStale || !this.carteraStale;
    Logger.log("CACHE: Protocolo de recuperación completado. restaurado=" + restored);
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

  _computeChecksum(data) {
    if (!data || data.length === 0) return "";
    const concat = data.map(r => r.id + "|" + (r.saldo !== undefined ? r.saldo : "") + "|" + (r.estado || "")).join(",");
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, concat)
      .map(b => ("0" + (b & 0xFF).toString(16)).slice(-2)).join("");
  },

  _refreshTerceros() {
    const sheetTerceros = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
    try {
      const COL_T = CARTERA_CONFIG.COLUMNS.TERCEROS;
      const lastRow = sheetTerceros.getLastRow();
      const numCols = Math.max(...Object.values(COL_T)) + 1;
      const dataTerceros = lastRow < 2 ? [] : sheetTerceros.getRange(2, 1, lastRow - 1, numCols).getValues();

      const newTerceros = [];
      const newIndex = {};
      for (let i = 0; i < dataTerceros.length; i++) {
        const rowIdx = i + 1;
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
          activo: String(dataTerceros[i][COL_T.activo] || "ACTIVO").toUpperCase() !== "INACTIVO",
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
        Logger.log("CACHE: Circuito de terceros abierto tras " + this.tercerosFailCount + " fallos consecutivos");
      }
    }
  },

  _refreshCartera() {
    const sheetCartera = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    try {
      const COL_C = CARTERA_CONFIG.COLUMNS.CARTERA;
      const numCols = Math.max(...Object.values(COL_C)) + 1;
      const lastRow = sheetCartera.getLastRow();
      const dataCartera = lastRow < 2 ? [] : sheetCartera.getRange(2, 1, lastRow - 1, numCols).getValues();

      const newCartera = [];
      const newIndex = {};
      for (let i = 0; i < dataCartera.length; i++) {
        const rowIdx = i + 1;
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
        Logger.log("CACHE: Circuito de cartera abierto tras " + this.carteraFailCount + " fallos consecutivos");
      }
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
    this.refresh();
    return this.cartera.filter(c => c.id_tercero === _sanitizeId(idTercero));
  },

  getSaldoTercero(idTercero) {
    this.refresh();
    return this.getCarteraPorTercero(idTercero)
      .filter(c => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
      .reduce((sum, c) => sum + c.saldo, 0);
  },

  getCarteraBase() {
    this.refresh();
    return this.cartera || [];
  }
};

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
  tercerosStale: false,
  carteraStale: false,

  /**
   * Invalida SOLO la caché de terceros
   */
  invalidateTerceros() {
    this.terceros = null;
    this.terceroIndex = {};
    this.lastRefreshTerceros = 0;
    this.tercerosStale = false;
  },

  /**
   * Invalida SOLO la caché de cartera
   */
  invalidateCartera() {
    this.cartera = null;
    this.carteraIndex = {};
    this.lastRefreshCartera = 0;
    this.carteraStale = false;
  },

  /**
   * Invalida todo el caché 
   */
  invalidate() {
    this.invalidateTerceros();
    this.invalidateCartera();
  },

  /**
   * Retorna TRUE si caché de terceros es válido
   */
  isTercerosValid() {
    return (Date.now() - this.lastRefreshTerceros) < this.CACHE_TTL && this.terceros !== null && !this.tercerosStale;
  },

  /**
   * Retorna TRUE si caché de cartera es válido
   */
  isCarteraValid() {
    return (Date.now() - this.lastRefreshCartera) < this.CACHE_TTL && this.cartera !== null && !this.carteraStale;
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
        const rowIdx = i + 1; // 1-based index relative to data array (sheet row = i+1 + header)
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

      // Commit only on success
      this.terceros = newTerceros;
      this.terceroIndex = newIndex;
      this.lastRefreshTerceros = Date.now();
      this.tercerosStale = false;
    } catch (e) {
      Logger.log("ERROR CACHE._refreshTerceros:" + e.toString());
      // Mantener la caché previa si existe y marcar como stale para visibilidad
      this.tercerosStale = true;
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
    } catch (e) {
      Logger.log("ERROR CACHE._refreshCartera:" + e.toString());
      // Mantener la caché previa si existe y marcar como stale
      this.carteraStale = true;
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

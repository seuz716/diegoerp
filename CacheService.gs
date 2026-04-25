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
  CACHE_TTL: 60000,  

  /**
   * Invalida SOLO la caché de terceros
   */
  invalidateTerceros() {
    this.terceros = null;
    this.terceroIndex = {};
    this.lastRefreshTerceros = 0;
  },

  /**
   * Invalida SOLO la caché de cartera
   */
  invalidateCartera() {
    this.cartera = null;
    this.carteraIndex = {};
    this.lastRefreshCartera = 0;
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
    return (Date.now() - this.lastRefreshTerceros) < this.CACHE_TTL && this.terceros !== null;
  },

  /**
   * Retorna TRUE si caché de cartera es válido
   */
  isCarteraValid() {
    return (Date.now() - this.lastRefreshCartera) < this.CACHE_TTL && this.cartera !== null;
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
      const dataTerceros = sheetTerceros.getDataRange().getValues();
      const COL_T = CARTERA_CONFIG.COLUMNS.TERCEROS;
      this.terceros = [];
      this.terceroIndex = {};

      for (let i = 1; i < dataTerceros.length; i++) {
        const id = String(dataTerceros[i][COL_T.id]).trim();
        if (!id) continue;
        this.terceroIndex[id] = i;  
        this.terceros.push({
          id,
          rowIndex: i,
          nombre: String(dataTerceros[i][COL_T.nombre] || "").trim(),
          telefono: String(dataTerceros[i][COL_T.telefono] || "").trim(),
          tipo: String(dataTerceros[i][COL_T.tipo] || "CLIENTE").toUpperCase(),
          limite_credito: _parseMoneda(dataTerceros[i][COL_T.limite_credito], 0),
          activo: String(dataTerceros[i][COL_T.activo] || "ACTIVO").toUpperCase() !== "INACTIVO",
        });
      }
      this.lastRefreshTerceros = Date.now();
    } catch (e) {
      Logger.log("ERROR CACHE._refreshTerceros:" + e.toString());
      this.terceros = [];
    }
  },

  _refreshCartera() {
    const sheetCartera = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
    try {
      const dataCartera = sheetCartera.getDataRange().getValues();
      const COL_C = CARTERA_CONFIG.COLUMNS.CARTERA;
      this.cartera = [];
      this.carteraIndex = {};

      for (let i = 1; i < dataCartera.length; i++) {
        const id = String(dataCartera[i][COL_C.id]).trim();
        if (!id) continue;
        this.carteraIndex[id] = i;  
        this.cartera.push({
          id,
          rowIndex: i,
          fecha: _safeDate(dataCartera[i][COL_C.fecha]),
          id_tercero: String(dataCartera[i][COL_C.id_tercero]).trim(),
          total: _parseMoneda(dataCartera[i][COL_C.total], 0),
          saldo: _parseMoneda(dataCartera[i][COL_C.saldo], 0),
          tipo: String(dataCartera[i][COL_C.tipo] || "CxC").trim(),
          estado: String(dataCartera[i][COL_C.estado] || "ABIERTA").trim(),
          fecha_vencimiento: _safeDate(dataCartera[i][COL_C.fecha_vencimiento]),
        });
      }
      this.lastRefreshCartera = Date.now();
    } catch (e) {
      Logger.log("ERROR CACHE._refreshCartera:" + e.toString());
      this.cartera = [];
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

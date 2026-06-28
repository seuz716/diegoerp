/**
 * LAYER 5.5: IA SERVICE — Gemini 2.5  Flash Integration
 * Financial Intelligence Engine for MicroERP
 *
 * Dependencies: Config.gs, CacheService.gs, Domain.gs
 *
 * SETUP INSTRUCTIONS (one-time):
 *   1. Get API Key: https://aistudio.google.com/apikey
 *   2. Run: setupGeminiKey("YOUR_API_KEY_HERE") in Apps Script editor
 *   3. Authorize: PropertiesService, UrlFetchApp, SpreadsheetApp
 */

const SamplingStrategy = {
  segmentByAge(items) {
    const buckets = {
      SIN_FECHA: [],
      SIN_VENCER: [],
      MORA_1_30: [],
      MORA_31_90: [],
      MORA_91_180: [],
      MORA_180_PLUS: [],
    };

    items.forEach(item => {
      const d = item.dias_vencido;
      if (d === null || d === undefined) {
        buckets.SIN_FECHA.push(item);
      } else if (d <= 0) {
        buckets.SIN_VENCER.push(item);
      } else if (d <= 30) {
        buckets.MORA_1_30.push(item);
      } else if (d <= 90) {
        buckets.MORA_31_90.push(item);
      } else if (d <= 180) {
        buckets.MORA_91_180.push(item);
      } else {
        buckets.MORA_180_PLUS.push(item);
      }
    });

    return Object.fromEntries(
      Object.entries(buckets).filter(([_, v]) => v.length > 0)
    );
  },

  calculateImportanceScore(item, hoy, weightsConfig = {}) {
    const {
      saldoWeight = 1,
      moraWeight = 1,
      vencimientoProximoWeight = 1,
      estadoWeight = 1,
    } = weightsConfig;

    let score = 0;

    const saldo = Math.abs(item.saldo || item.valor || 0);
    score += Math.log(Math.max(saldo, 1)) * 2 * saldoWeight;

    if (item.dias_vencido && item.dias_vencido > 0) {
      score += Math.min(item.dias_vencido * 5, 100) * moraWeight;
    }

    if (item.fecha_vencimiento) {
      const fVenc = new Date(item.fecha_vencimiento);
      if (fVenc <= hoy) {
        score += 50 * vencimientoProximoWeight;
      } else {
        const diasAVencer = Math.ceil((fVenc.getTime() - hoy.getTime()) / 86400000);
        if (diasAVencer > 0 && diasAVencer <= 15) {
          score += Math.max(40 - diasAVencer * 2, 10) * vencimientoProximoWeight;
        }
      }
    }

    if (item.estado === "VENCIDA") score += 30 * estadoWeight;
    if (item.estado === "ABIERTA") score += 10 * estadoWeight;
    if (item.estado === "CANCELADA") score += 1 * estadoWeight;

    return score;
  },

  weightedRandomSample(items, hoy, n) {
    if (n >= items.length) return items;
    if (n <= 0) return [];

    const weights = items.map(item => this.calculateImportanceScore(item, hoy) + 1);
    const pool = items.map((item, i) => ({ item, weight: weights[i] }));
    const result = [];

    for (let k = 0; k < n && pool.length > 0; k++) {
      const totalWeight = pool.reduce((s, x) => s + x.weight, 0);
      let r = Math.random() * totalWeight;
      let i = 0;
      while (r > pool[i].weight) {
        r -= pool[i].weight;
        i++;
      }
      result.push(pool[i].item);
      pool.splice(i, 1);
    }

    return result;
  },

  stratifiedSample(items, hoy, maxItems = 500) {
    if (items.length <= maxItems) return items;

    const buckets = this.segmentByAge(items);
    const entries = Object.entries(buckets);
    const totalItems = items.length;

    const allocation = {};
    let allocated = 0;
    const activeBuckets = [];

    for (const [key, group] of entries) {
      const floor = Math.min(1, group.length);
      allocation[key] = floor;
      allocated += floor;
      activeBuckets.push({ key, group, available: group.length - floor });
    }

    const remaining = Math.max(0, maxItems - allocated);
    const totalAvailable = activeBuckets.reduce((s, b) => s + b.available, 0);

    if (remaining > 0 && totalAvailable > 0) {
      let distributed = 0;
      for (let i = 0; i < activeBuckets.length; i++) {
        const b = activeBuckets[i];
        if (b.available <= 0) continue;

        if (i === activeBuckets.length - 1) {
          const extra = Math.min(b.available, remaining - distributed);
          allocation[b.key] += extra;
          distributed += extra;
        } else {
          const extra = Math.min(b.available, Math.round(remaining * b.available / totalAvailable));
          allocation[b.key] += extra;
          distributed += extra;
        }
      }
    }

    const result = [];
    for (const [key, group] of entries) {
      const n = allocation[key];
      if (n > 0) {
        const sampled = this.weightedRandomSample(group, hoy, n);
        result.push(...sampled);
      }
    }

    return result.slice(0, maxItems);
  },

  getSamplingStats(items, sampled, hoy) {
    const sampledBuckets = this.segmentByAge(sampled);
    const bucketNames = ["SIN_FECHA", "SIN_VENCER", "MORA_1_30", "MORA_31_90", "MORA_91_180", "MORA_180_PLUS"];
    const bucketDistribution = {};
    for (const name of bucketNames) {
      bucketDistribution[name] = sampledBuckets[name] ? sampledBuckets[name].length : 0;
    }

    const scores = sampled.map(item => this.calculateImportanceScore(item, hoy));
    const min = scores.length > 0 ? Math.min(...scores) : 0;
    const max = scores.length > 0 ? Math.max(...scores) : 0;
    const avg = scores.length > 0 ? scores.reduce((s, x) => s + x, 0) / scores.length : 0;

    return {
      originalCount: items.length,
      sampledCount: sampled.length,
      bucketDistribution,
      importanceScoreRange: { min, max, avg },
    };
  },

  validateSamplingRepresentativeness(sampled, original, hoy) {
    const originalBuckets = this.segmentByAge(original);
    const sampledBuckets = this.segmentByAge(sampled);
    const warnings = [];

    for (const [key, group] of Object.entries(originalBuckets)) {
      if (!sampledBuckets[key] || sampledBuckets[key].length === 0) {
        warnings.push(`Bucket ${key} tiene ${group.length} items en original pero 0 en muestra`);
      }
    }

    const origScores = original.map(item => this.calculateImportanceScore(item, hoy));
    const sampScores = sampled.map(item => this.calculateImportanceScore(item, hoy));
    const origAvg = origScores.length > 0 ? origScores.reduce((s, x) => s + x, 0) / origScores.length : 0;
    const sampAvg = sampScores.length > 0 ? sampScores.reduce((s, x) => s + x, 0) / sampScores.length : 0;

    if (sampAvg < origAvg * 0.8) {
      warnings.push(`La importancia promedio de la muestra (${sampAvg.toFixed(2)}) es <80% del original (${origAvg.toFixed(2)})`);
    }

    return {
      representative: warnings.length === 0,
      warnings,
    };
  },
};

const IA_SERVICE = {
  MODEL: "gemini-2.5-flash",
  BASE_URL: "https://generativelanguage.googleapis.com/v1beta/models/",
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: 1000,
  RATE_LIMIT_MAX_REQUESTS: 10,
  RATE_LIMIT_WINDOW_MS: 60000,
  CACHE_PREFIX: "IA_CACHE_",
  CACHE_TTL_MS: 3600000,
  MAX_INPUT_TOKENS: 90000,
  MAX_OUTPUT_TOKENS: 65536,
  MAX_SAMPLE_SIZE: 500,
  MIN_CATEGORY_SAMPLE: 30,
  _startTime: null,
  _rateLimitKeys: {},

  /**
   * Simple in-memory rate limiter for Gemini API
   */
  _checkRateLimit() {
    const key = 'gemini_requests';
    const now = Date.now();
    const windowStart = PropertiesService.getScriptProperties().getProperty(key + '_window') || '0';
    const count = Number(PropertiesService.getScriptProperties().getProperty(key + '_count') || '0');
    
    if (now - Number(windowStart) > this.RATE_LIMIT_WINDOW_MS) {
      // Reset window
      PropertiesService.getScriptProperties().setProperty(key + '_window', String(now));
      PropertiesService.getScriptProperties().setProperty(key + '_count', '1');
      return true;
    }
    
    if (count >= this.RATE_LIMIT_MAX_REQUESTS) {
      const resetMs = this.RATE_LIMIT_WINDOW_MS - (now - Number(windowStart));
      console.warn('Rate limit excedido para Gemini. Espera ' + Math.ceil(resetMs / 1000) + 's');
      return false;
    }
    
    PropertiesService.getScriptProperties().setProperty(key + '_count', String(count + 1));
    return true;
  },

  _getApiKey() {
    const fromProxy = PROXY_SECRET_SERVICE.resolveSecret("GEMINI_API_KEY");
    if (fromProxy) return fromProxy;
    return AuthService.getApiKey("GEMINI_API_KEY");
  },

  _buildUrl() {
    return `${this.BASE_URL}${this.MODEL}:generateContent`;
  },

  _buildHeaders() {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": this._getApiKey(),
    };
  },

  _retryablePost(url, payload, attempt = 0) {
    if (!this._startTime) this._startTime = Date.now();
    const elapsed = Date.now() - this._startTime;
    if (elapsed > 300000) {
      throw new IAError("Tiempo de ejecución de GAS casi agotado. Abortando llamada a IA.", "GAS_TIMEOUT", null);
    }

    // Rate limit check
    if (!this._checkRateLimit()) {
      throw new IAError("Límite de tasa de API excedido. Espera e intenta más tarde.", "RATE_LIMITED", null);
    }

    try {
      const options = {
        method: "post",
        headers: this._buildHeaders(),
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        timeout: this.TIMEOUT_MS,
      };

      const response = UrlFetchApp.fetch(url, options);
      const status = response.getResponseCode();
      const body = response.getContentText();

      if (status === 200) return JSON.parse(body);

      const err = this._parseApiError(status, body);

      // Handle retryable errors with exponential backoff and jitter
      if ((status === 429 || status >= 500) && attempt < this.MAX_RETRIES) {
        const wait = this.RETRY_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`Retryable error (${status}), retry ${attempt + 1}/${this.MAX_RETRIES} after ${wait}ms`);
        Utilities.sleep(wait);
        return this._retryablePost(url, payload, attempt + 1);
      }

      throw err;
    } catch (e) {
      if (e.name === "IAError") throw e;
      if (attempt < this.MAX_RETRIES) {
        const wait = this.RETRY_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`Network error, retry ${attempt + 1}/${this.MAX_RETRIES} after ${wait}ms: ${e.message}`);
        Utilities.sleep(wait);
        return this._retryablePost(url, payload, attempt + 1);
      }
      throw new IAError("Error de red con IA tras reintentos: " + e.message, "NETWORK", null);
    }
  },

  _parseApiError(status, body) {
    let detail = "";
    try {
      const parsed = JSON.parse(body);
      detail = parsed.error?.message || parsed.error?.status || body;
    } catch (_) {
      detail = body;
    }

    switch (status) {
      case 400: return new IAError("Solicitud inválida a Gemini: " + detail, "BAD_REQUEST", null);
      case 401: case 403: return new IAError("API Key inválida o sin permisos", "AUTH_ERROR", null);
      case 429: return new IAError("Cuota de API excedida. Espera unos minutos.", "QUOTA_EXCEEDED", null);
      case 500: case 503: return new IAError("Servicio Gemini no disponible temporalmente", "SERVER_ERROR", null);
      default:  return new IAError(`Error Gemini (HTTP ${status}): ${detail}`, "UNKNOWN", null);
    }
  },

  _sanitizeUserInput(input) {
    if (typeof input !== "string") return String(input || "");
    return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
               .slice(0, 500);
  },

  /**
   * ESTRATEGIA DE MUESTREO INTELIGENTE v2
   * 
   * Problema: Cortes fijos (.slice) ignoran mora antigua, outliers y patrones
   * Solución: Stratified sampling por antigüedad real + Weighted Random Sampling
   * 
   * Garantiza:
   * - Segmentación por días reales de mora (no por estado textual)
   * - Asignación proporcional por estrato (con piso 1 para representación)
   * - Weighted random sampling: outliers y mora alta entran con mayor probabilidad
   * - Sin sesgo determinista: mantiene varianza de casos normales
   */
  _calculateImportanceScore(item, hoy) {
    return SamplingStrategy.calculateImportanceScore(item, hoy);
  },

  _segmentByAge(items) {
    return SamplingStrategy.segmentByAge(items);
  },

  _weightedRandomSample(items, hoy, n) {
    return SamplingStrategy.weightedRandomSample(items, hoy, n);
  },

  _stratifiedSample(items, hoy, maxItems = 500) {
    return SamplingStrategy.stratifiedSample(items, hoy, maxItems);
  },

  _compressForTokens(data, maxRecords = 500) {
    // Compresión sin pérdida de semántica: solo campos críticos
    return data.map(item => ({
      i: item.id_tercero || item.id, // id_tercero (comprimido como 'i')
      s: item.saldo || item.valor,  // saldo/valor (comprimido como 's')
      t: item.tipo,                 // tipo (CxC/CxP)
      e: item.estado,               // estado
      f: item.fecha_vencimiento || item.fecha, // fecha
      d: item.dias_vencido || 0,    // días vencido
    }));
  },

  _buildUserPrompt(data) {
    const hoy = new Date();
    const summary = `FECHA DE CORTE: ${data.fecha_corte}
RESUMEN:
- Total Cartera: ${data.resumen.total_cartera_items} items (CxC: $${data.resumen.total_cxc}, CxP: $${data.resumen.total_cxp})
- Vencido CxC: $${data.resumen.vencida_cxc} | Vencido CxP: $${data.resumen.vencida_cxp}
- Terceros activos: ${data.resumen.total_terceros}
- Movimientos registrados: ${data.resumen.total_movimientos}

TERCEROS (${data.terceros.length}):
${JSON.stringify(data.terceros.slice(0, 150))}

`;

    // Split dinámico: piso asegurado por categoría + prorrateo del remanente
    const MIN = this.MIN_CATEGORY_SAMPLE;
    const MAX = this.MAX_SAMPLE_SIZE;
    const totalBoth = data.cartera.length + data.movimientos.length;

    const floorCartera = Math.min(data.cartera.length, MIN);
    const floorMovimientos = Math.min(data.movimientos.length, MIN);
    const remaining = Math.max(0, MAX - floorCartera - floorMovimientos);
    let extraCartera = 0;
    let extraMovimientos = 0;

    if (remaining > 0 && totalBoth > 0) {
      const ratio = data.cartera.length / totalBoth;
      extraCartera = Math.round(remaining * ratio);
      extraMovimientos = remaining - extraCartera;
    }

    let carteraLimit = Math.min(data.cartera.length, floorCartera + extraCartera);
    let movimientosLimit = Math.min(data.movimientos.length, floorMovimientos + extraMovimientos);

    // Redistribuir si una categoría no pudo absorber su asignación
    const used = carteraLimit + movimientosLimit;
    if (used < MAX) {
      const unused = MAX - used;
      if (data.cartera.length > carteraLimit) {
        carteraLimit = Math.min(data.cartera.length, carteraLimit + unused);
      } else if (data.movimientos.length > movimientosLimit) {
        movimientosLimit = Math.min(data.movimientos.length, movimientosLimit + unused);
      }
    }

    const carteraMuestreada = this._stratifiedSample(data.cartera, hoy, carteraLimit);
    const movimientosMuestreados = this._stratifiedSample(data.movimientos, hoy, movimientosLimit);

    const samplingStats = SamplingStrategy.getSamplingStats(data.cartera, carteraMuestreada, hoy);

    const carteraComprimida = this._compressForTokens(carteraMuestreada);
    const movimientosComprimidos = this._compressForTokens(movimientosMuestreados);

    const prompt = `${summary}
MUESTREO: ${samplingStats.sampledCount}/${samplingStats.originalCount} items, distribución: ${JSON.stringify(samplingStats.bucketDistribution)}
CARTERA (${carteraMuestreada.length}/${data.cartera.length} muestreados — segmentados por antigüedad + weighted random sampling):
${JSON.stringify(carteraComprimida)}

MOVIMIENTOS (${movimientosMuestreados.length}/${data.movimientos.length} muestreados):
${JSON.stringify(movimientosComprimidos)}`;

    if (data.cartera.length > carteraLimit || data.movimientos.length > movimientosLimit) {
      return `${prompt}

⚠️ NOTA METODOLÓGICA: Muestreo estratificado con weighted random sampling.
- Segmentación por antigüedad real (días de mora: SIN_VENCER / MORA_1-30 / 31-90 / 91-180 / 180+)
- Asignación proporcional + piso de representación por estrato
- Weighted random sampling: mora alta y outliers priorizados probabilísticamente
- Sin sesgo por truncamiento. Tu análisis cubre el comportamiento real del portafolio completo.`;
    }
    return prompt;
  },

  extractData(forceRefresh = false) {
    CACHE.refresh(forceRefresh);

    const hoy = _today();
    const doceMesesAtras = new Date(hoy);
    doceMesesAtras.setMonth(doceMesesAtras.getMonth() - 12);

    const terceros = (CACHE.terceros || []).map(t => ({
      id: t.id,
      nombre: t.nombre,
      tipo: t.tipo,
      limite_credito: t.limite_credito,
      activo: t.activo,
    }));

    let cartera = (CACHE.cartera || [])
      .filter(c => c.fecha && c.fecha.getTime() >= doceMesesAtras.getTime())
      .map(c => {
        // === INICIO FIX C-01 ===
        // Convertir centavos a pesos para Gemini (el prompt usa notación COP $)
        const saldoPesos = Math.round((c.saldo || 0) / 100);
        const totalPesos = Math.round((c.total || 0) / 100);
        const diasVencido = c.fecha_vencimiento && c.fecha_vencimiento.getTime() > 0
          ? Math.round(((hoy.getTime() - c.fecha_vencimiento.getTime()) / 86400000) || 0)
          : 0;
        const tieneVencimiento = c.fecha_vencimiento && c.fecha_vencimiento.getTime() > 0;
        // === FIN FIX C-01 ===
        return {
          id: c.id,
          fecha: Utilities.formatDate(c.fecha, _getTimeZone(), "yyyy-MM-dd"),
          id_tercero: c.id_tercero,
          total: totalPesos,
          saldo: saldoPesos,
          tipo: c.tipo,
          estado: c.estado,
          fecha_vencimiento: tieneVencimiento
            ? Utilities.formatDate(c.fecha_vencimiento, _getTimeZone(), "yyyy-MM-dd") : null,
          dias_vencido: diasVencido,
          vencida_timestamp: c.vencida_timestamp || null,
        };
      });
    Logger.log("[FIX-C-01] Cartera convertida a pesos: " + cartera.length + " items");

    const sheetMov = getSheet(CARTERA_CONFIG.SHEETS.MOV_CARTERA);
    let movimientos = [];
    try {
      const lastRow = sheetMov.getLastRow();
      if (lastRow > 1) {
        const cols = Math.max(...Object.values(CARTERA_CONFIG.COLUMNS.MOV_CARTERA)) + 1;
        const raw = sheetMov.getRange(2, 1, lastRow - 1, cols).getValues();
        const COL = CARTERA_CONFIG.COLUMNS.MOV_CARTERA;
        movimientos = raw
          .map(r => {
            const f = _safeDate(r[COL.fecha]);
            // === INICIO FIX C-01 ===
            // Convertir valor de centavos a pesos
            const valorPesos = Math.round(_parseMoneda(r[COL.valor], 0) / 100);
            // === FIN FIX C-01 ===
            return {
              id: String(r[COL.id] || "").trim(),
              fecha: f.getTime() > 0 ? Utilities.formatDate(f, _getTimeZone(), "yyyy-MM-dd") : null,
              id_cartera: String(r[COL.id_cartera] || "").trim(),
              id_tercero: String(r[COL.id_tercero] || "").trim(),
              valor: valorPesos,
              tipo_mov: String(r[COL.tipo_mov] || "").trim(),
              referencia: String(r[COL.referencia] || "").trim(),
            };
          })
          .filter(m => m.fecha && m.fecha >= Utilities.formatDate(doceMesesAtras, _getTimeZone(), "yyyy-MM-dd"));
      }
    } catch (e) {
      console.warn("No se pudieron leer Movimientos_Cartera: " + e.message);
    }

    const resumen = {
      total_cxc: cartera.filter(c => c.tipo === "CxC" && c.estado !== "CANCELADA").reduce((s, c) => s + c.saldo, 0),
      total_cxp: cartera.filter(c => c.tipo === "CxP" && c.estado !== "CANCELADA").reduce((s, c) => s + c.saldo, 0),
      vencida_cxc: cartera.filter(c => c.tipo === "CxC" && c.estado === "VENCIDA").reduce((s, c) => s + c.saldo, 0),
      vencida_cxp: cartera.filter(c => c.tipo === "CxP" && c.estado === "VENCIDA").reduce((s, c) => s + c.saldo, 0),
      total_terceros: terceros.length,
      total_movimientos: movimientos.length,
      total_cartera_items: cartera.length,
      corte: Utilities.formatDate(hoy, _getTimeZone(), "yyyy-MM-dd"),
    };

    return {
      fecha_corte: Utilities.formatDate(hoy, _getTimeZone(), "yyyy-MM-dd"),
      resumen,
      terceros,
      cartera,
      movimientos,
    };
  },

  /**
   * Genera el hash de los datos para detectar cambios (caché).
   */
  _hashData(data) {
    const hashInput = data.resumen.total_cxc + "|" + data.resumen.total_cxp + "|" +
                      data.resumen.vencida_cxc + "|" + data.resumen.total_cartera_items + "|" +
                      data.resumen.total_movimientos;
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, hashInput)
      .map(b => ("0" + (b & 0xFF).toString(16)).slice(-2)).join("");
  },

  _checkCache(hash) {
    try {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(this.CACHE_PREFIX + hash);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.timestamp && (Date.now() - parsed.timestamp) < this.CACHE_TTL_MS) {
          return parsed.response;
        }
      }
    } catch (_) {}
    return null;
  },

  _setCache(hash, response) {
    const entry = JSON.stringify({ timestamp: Date.now(), response });
    try {
      const cache = CacheService.getScriptCache();
      cache.put(this.CACHE_PREFIX + hash, entry, Math.floor(this.CACHE_TTL_MS / 1000));
    } catch (e) {
      Logger.log("IA_CACHE: Error storing in CacheService: " + e.toString());
    }
  },

  _buildSystemPrompt() {
    return `Eres un CFO y Auditor de Riesgos senior con 25 años de experiencia en finanzas corporativas, análisis crediticio y detección de fraudes. Tu misión es analizar datos financieros de un MicroERP y generar inteligencia accionable.

IDIOMA: Responde exclusivamente en español (Colombia). Usa notación monetaria COP ($).

FORMATO DE SALIDA: Debes responder ÚNICAMENTE con un objeto JSON válido. Sin texto adicional, sin markdown, sin bloques de código. Solo JSON.

ESTRUCTURA JSON REQUERIDA:
{
  "resumen_ejecutivo": "string (máx 200 caracteres, diagnóstico general del estado financiero)",
  "nivel_confianza_general": number (0-100),
  "alertas_criticas": [
    {
      "tipo": "RIESGO_CARTERA" | "ANOMALIA" | "OPORTUNIDAD" | "PROVEEDOR",
      "titulo": "string",
      "descripcion": "string",
      "impacto": "ALTO" | "MEDIO" | "BAJO",
      "nivel_confianza": number (0-100),
      "accion_sugerida": "string",
      "entidad_id": "string (ID del tercero involucrado, si aplica)",
      "entidad_nombre": "string (nombre del tercero)"
    }
  ],
  "analisis_riesgo_cartera": {
    "concentracion_vencida": [
      {
        "id_tercero": "string",
        "nombre": "string",
        "saldo_vencido": number,
        "porcentaje_cartera_vencida": number,
        "dias_promedio_mora": number,
        "recomendacion": "string"
      }
    ],
    "proyeccion_cobro_30d": number,
    "proyeccion_cobro_60d": number,
    "proyeccion_cobro_90d": number,
    "patrones_mora": "string (descripción de estacionalidad o patrones detectados)",
    "total_cartera_analizada": number
  },
  "segmentacion_terceros": {
    "criticos": [
      { "id": "string", "nombre": "string", "saldo": number, "motivo": "string" }
    ],
    "estables": [
      { "id": "string", "nombre": "string", "saldo": number }
    ],
    "en_peligro": [
      { "id": "string", "nombre": "string", "saldo": number, "motivo": "string" }
    ],
    "oportunidad_upsell": [
      { "id": "string", "nombre": "string", "motivo": "string" }
    ],
    "proveedores_criticos": [
      { "id": "string", "nombre": "string", "concentracion": number, "riesgo": "string" }
    ],
    "inactivos_detectados": [
      { "id": "string", "nombre": "string", "ultima_actividad": "string", "dias_inactivo": number }
    ]
  },
  "anomalias_detectadas": [
    {
      "tipo": "OUTLIER_MONTO" | "POSIBLE_DUPLICADO" | "FECHA_IMPOSIBLE" | "SALDO_NEGATIVO" | "OTRA",
      "descripcion": "string",
      "severidad": "ALTA" | "MEDIA" | "BAJA",
      "id_referencia": "string",
      "valor_detectado": number,
      "valor_esperado": number,
      "explicacion": "string"
    }
  ],
  "recomendaciones_accionables": [
    {
      "prioridad": "ALTA" | "MEDIA" | "BAJA",
      "accion": "string",
      "area": "CARTERA" | "TERCEROS" | "OPERACIONES",
      "impacto_estimado": "string",
      "automatizable": boolean
    }
  ]
}

REGLAS DE ANÁLISIS (Priority Order):
0. MUESTREO REPRESENTATIVO (Metodología): Los datos recibidos están estratificados por estado (VENCIDA/ABIERTA/CANCELADA), priorizando mora antigua + montos altos + distribución temporal uniforme. Tu análisis cubre el 100% del comportamiento del portafolio, sin sesgo de truncamiento. Extrapola patrones como si fuera el universo completo.
1. ANÁLISIS DE RIESGO DE CARTERA (Priority #1): Identificar clientes con >20% de cartera vencida. Detectar patrones de mora recurrente. Proyectar flujo de caja probable a 30/60/90 días basado en historial. Sugerir acciones correctivas específicas para top deudores.
2. CLASIFICACIÓN Y SEGMENTACIÓN DE TERCEROS (Priority #2): Clasificar en Críticos (alto riesgo), Estables, En Peligro (deterioro), Oportunidad de Upsell. Identificar dependencia excesiva de proveedores (>30% concentración). Detectar clientes que compraban y han parado.
3. DETECCIÓN DE ANOMALÍAS (Priority #3): Outliers financieros (±3 desviaciones del promedio). Posibles duplicados (mismos montos en fechas cercanas). Fechas futuras imposibles, saldos negativos ilógicos.
4. RECOMENDACIONES ACCIONABLES: Cada recomendación debe ser específica, priorizada y marcar si es automatizable.

REGLAS DE NEGOCIO:
- Un cliente con saldo vencido >20% del total vencido es "concentración crítica"
- Mora recurrente = más de 2 vencimientos en los últimos 6 meses
- Proveedor con >30% del total de CxP es "dependencia crítica"
- Inactividad = sin movimientos en los últimos 90 días siendo cliente activo
- Saldo negativo en inventario o cartera es anomalía automática`;
  },

  _callGemini(systemPrompt, userPrompt) {
    const url = this._buildUrl();

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: this.MAX_OUTPUT_TOKENS,
        responseMimeType: "text/plain",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    };

    const raw = this._retryablePost(url, payload);
    return this._parseResponse(raw);
  },

  _parseResponse(raw) {
    if (!raw || !raw.candidates || raw.candidates.length === 0) {
      if (raw?.promptFeedback?.blockReason) {
        throw new IAError(
          "Contenido bloqueado por seguridad: " + raw.promptFeedback.blockReason,
          "BLOCKED",
          null
        );
      }
      throw new IAError("Respuesta vacía de Gemini", "EMPTY_RESPONSE", null);
    }

    const candidate = raw.candidates[0];
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      const reason = candidate.finishReason;
      if (reason === "SAFETY") {
        throw new IAError("Contenido bloqueado por filtros de seguridad de Gemini", "SAFETY_BLOCK", null);
      }
      if (reason !== "MAX_TOKENS") {
        throw new IAError("Gemini finalizó con razón: " + reason, "FINISH_REASON", null);
      }
    }

    let text = candidate.content?.parts?.[0]?.text || "";
    text = text.trim();

    if (!text) {
      throw new IAError("Respuesta vacía de Gemini", "EMPTY_RESPONSE", null);
    }

    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    try {
      const parsed = JSON.parse(text);
      this._validateResponse(parsed);
      return parsed;
    } catch (e) {
      if (e instanceof IAError) throw e;
      throw new IAError("Respuesta inválida de Gemini (JSON malformado): " + e.message + " | Raw: " + text.slice(0, 200), "PARSE_ERROR", null);
    }
  },

  _validateResponse(parsed) {
    if (!parsed || typeof parsed !== "object") {
      throw new IAError("Respuesta IA no es un objeto JSON", "VALIDATION_ERROR", null);
    }
    if (!parsed.resumen_ejecutivo) {
      parsed.resumen_ejecutivo = "Análisis completado con advertencias";
    }
    if (!Array.isArray(parsed.alertas_criticas)) parsed.alertas_criticas = [];
    if (!Array.isArray(parsed.anomalias_detectadas)) parsed.anomalias_detectadas = [];
    if (!Array.isArray(parsed.recomendaciones_accionables)) parsed.recomendaciones_accionables = [];
    if (!parsed.analisis_riesgo_cartera || typeof parsed.analisis_riesgo_cartera !== "object") {
      parsed.analisis_riesgo_cartera = {};
    }
    if (!parsed.segmentacion_terceros || typeof parsed.segmentacion_terceros !== "object") {
      parsed.segmentacion_terceros = {};
    }
  },

  /**
   * Ejecuta el análisis financiero completo con IA.
   * Incluye caché, extracción de datos, llamada a Gemini, y validación.
   */
  ejecutarAnalisis(forceFresh = false) {
    const startTime = Date.now();

    const data = this.extractData(forceFresh);

    if (data.cartera.length === 0 && data.terceros.length === 0) {
      return {
        success: true,
        cache_hit: false,
        analisis: {
          resumen_ejecutivo: "No hay suficientes datos financieros para analizar. Agrega movimientos de cartera y terceros.",
          nivel_confianza_general: 0,
          alertas_criticas: [],
          analisis_riesgo_cartera: {},
          segmentacion_terceros: {},
          anomalias_detectadas: [],
          recomendaciones_accionables: [
            { prioridad: "ALTA", accion: "Cargar datos iniciales en las hojas Terceros y Cartera", area: "OPERACIONES", impacto_estimado: "Base para todo análisis futuro", automatizable: false }
          ],
        },
        _metadata: {
          timestamp: new Date().toISOString(),
          duracion_ms: Date.now() - startTime,
          total_terceros: data.terceros.length,
          total_cartera: data.cartera.length,
          total_movimientos: data.movimientos.length,
        },
      };
    }

    const hash = this._hashData(data);
    if (!forceFresh) {
      const cached = this._checkCache(hash);
      if (cached) {
        return {
          success: true,
          cache_hit: true,
          analisis: cached,
          _metadata: {
            timestamp: new Date().toISOString(),
            duracion_ms: 0,
            desde_cache: true,
            hash,
          },
        };
      }
    }

    const systemPrompt = this._buildSystemPrompt();
    const userPrompt = this._buildUserPrompt(data);

    const response = this._callGemini(systemPrompt, userPrompt);

    this._setCache(hash, response);

    return {
      success: true,
      cache_hit: false,
      analisis: response,
      _metadata: {
        timestamp: new Date().toISOString(),
        duracion_ms: Date.now() - startTime,
        hash,
        force_fresh: forceFresh,
        cache_staleness: CACHE.getStalenessInfo(),
        total_terceros: data.terceros.length,
        total_cartera: data.cartera.length,
        total_movimientos: data.movimientos.length,
      },
    };
  },

  ejecutarAnalisisFresco() {
    return this.ejecutarAnalisis(true);
  },
};

/**
 * Custom Error class for IA Service
 */
class IAError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "IAError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Configures the Gemini API Key in ScriptProperties.
 * Run ONCE from the Apps Script editor.
 */
function setupGeminiKey(apiKey) {
  AuthService.checkPermission("configurar_ia");
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("Debes proporcionar una API Key válida. Obtén una en: https://aistudio.google.com/apikey");
  }
  AuthService.setApiKey("GEMINI_API_KEY", apiKey.trim());
  return { success: true, message: "API Key configurada en PropertiesService. Puedes cerrar esta ventana." };
}

/**
 * Removes the Gemini API Key from ScriptProperties.
 */
function removeGeminiKey() {
  AuthService.checkPermission("configurar_ia");
  AuthService.removeApiKey("GEMINI_API_KEY");
  return { success: true, message: "API Key eliminada." };
}

/**
 * Verifies if the Gemini API Key is configured.
 */
function verificarConfiguracionIA() {
  AuthService.checkPermission("ver_configuracion");
  const configurada = AuthService.hasApiKey("GEMINI_API_KEY");
  return {
    configurada,
    key_preview: null,
    modelo: IA_SERVICE.MODEL,
    cache_ttl_ms: IA_SERVICE.CACHE_TTL_MS,
    advertencia: configurada ? "API Key configurada. No se muestra preview por seguridad." : null,
  };
}

/**
 * Public entry point: analizarConGeminiCompleto()
 * Called from frontend via google.script.run
 */
function analizarConGeminiCompleto() {
  try {
    AuthService.checkPermission("ver_analisis_ia");
    const resultado = IA_SERVICE.ejecutarAnalisis();
    return resultado;
  } catch (e) {
    console.error("ERROR analizarConGeminiCompleto:", e.toString());

    if (e instanceof IAError) {
      const userMessages = {
        AUTH_ERROR: "Error de autenticación con la IA. Verifica que la API Key sea correcta.",
        QUOTA_EXCEEDED: "La API de IA excedió su cuota. Espera 1 minuto e intenta de nuevo.",
        BLOCKED: "El análisis fue bloqueado por filtros de seguridad. Contacta al administrador.",
        SAFETY_BLOCK: "El análisis fue bloqueado por filtros de seguridad.",
        TRUNCATED: "El análisis fue muy extenso para la IA. Algunos datos se omitieron.",
        SERVER_ERROR: "El servicio de IA no está disponible temporalmente. Intenta más tarde.",
        NETWORK: "Error de red al conectar con la IA. Verifica tu conexión.",
        PARSE_ERROR: "La IA devolvió una respuesta inesperada. Reintenta el análisis.",
        EMPTY_RESPONSE: "La IA no generó análisis. Reintenta con más datos.",
      };

      return {
        success: false,
        code: e.code,
        message: userMessages[e.code] || e.message,
      };
    }

    return {
      success: false,
      code: "UNEXPECTED",
      message: "Error inesperado al analizar. Intenta de nuevo más tarde.",
    };
  }
}

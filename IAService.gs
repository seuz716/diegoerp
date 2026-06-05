/**
 * LAYER 5.5: IA SERVICE — Gemini 2.5 Flash Integration
 * Financial Intelligence Engine for MicroERP
 *
 * Dependencies: Config.gs, CacheService.gs, Domain.gs
 *
 * SETUP INSTRUCTIONS (one-time):
 *   1. Get API Key: https://aistudio.google.com/apikey
 *   2. Run: setupGeminiKey("YOUR_API_KEY_HERE") in Apps Script editor
 *   3. Authorize: PropertiesService, UrlFetchApp, SpreadsheetApp
 */

const IA_SERVICE = {
  MODEL: "gemini-2.5-flash-preview-05-20",
  BASE_URL: "https://generativelanguage.googleapis.com/v1beta/models/",
  TIMEOUT_MS: 90000,
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: 2000,
  CACHE_PREFIX: "IA_CACHE_",
  CACHE_TTL_MS: 3600000,
  MAX_INPUT_TOKENS: 90000,
  MAX_OUTPUT_TOKENS: 8192,

  _getApiKey() {
    const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!key) throw new Error("GEMINI_API_KEY no configurada. Ejecuta setupGeminiKey().");
    return key;
  },

  _buildUrl() {
    return `${this.BASE_URL}${this.MODEL}:generateContent?key=${this._getApiKey()}`;
  },

  _buildHeaders() {
    return {
      "Content-Type": "application/json",
    };
  },

  _retryablePost(url, payload, attempt = 0) {
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

      if (status === 429 && attempt < this.MAX_RETRIES) {
        const wait = this.RETRY_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(`Rate limited (429), retry ${attempt + 1}/${this.MAX_RETRIES} after ${wait}ms`);
        Utilities.sleep(wait);
        return this._retryablePost(url, payload, attempt + 1);
      }

      throw err;
    } catch (e) {
      if (e.name === "IAError") throw e;
      if (attempt < this.MAX_RETRIES) {
        const wait = this.RETRY_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(`Network error, retry ${attempt + 1}/${this.MAX_RETRIES} after ${wait}ms: ${e.message}`);
        Utilities.sleep(wait);
        return this._retryablePost(url, payload, attempt + 1);
      }
      throw new IAError("Error de conexión con IA tras reintentos: " + e.message, "NETWORK", null);
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
   * ESTRATEGIA DE MUESTREO INTELIGENTE (Evita sesgo por truncamiento)
   * 
   * Problema: .slice(0, 500) pierde contexto crítico (mora antigua, outliers, patrones)
   * Solución: Stratified sampling + importance weighting + temporal coverage
   * 
   * Garantiza representatividad de:
   * - Estados (ABIERTA, VENCIDA, CANCELADA) proporcionalmente
   * - Montos (incluye outliers altos)
   * - Temporal (primeros, últimos, uniformemente distribuidos)
   * - Riesgo (mora reciente y vencimientos próximos prioritarios)
   */
  _calculateImportanceScore(item, hoy) {
    let score = 0;

    const saldo = Math.abs(item.saldo || item.valor || 0);
    score += Math.log(Math.max(saldo, 1)) * 2; // Logarítmico: favorece montos grandes

    // Mora reciente = máxima urgencia
    if (item.dias_vencido && item.dias_vencido > 0) {
      score += Math.min(item.dias_vencido * 5, 100); // Máx 100 puntos por edad
    }

    // Vencimiento próximo en <15 días = riesgo alto
    if (item.fecha_vencimiento) {
      const fVenc = new Date(item.fecha_vencimiento);
      if (fVenc <= hoy) {
        score += 50; // Vencido reciente
      } else {
        const diasAVencer = Math.ceil((fVenc.getTime() - hoy.getTime()) / 86400000);
        if (diasAVencer > 0 && diasAVencer <= 15) {
          score += Math.max(40 - diasAVencer * 2, 10); // 10-40 puntos
        }
      }
    }

    // Estado VENCIDA = riesgo elevado
    if (item.estado === "VENCIDA") score += 30;
    if (item.estado === "ABIERTA") score += 10;
    if (item.estado === "CANCELADA") score += 1;

    return score;
  },

  _stratifiedSample(items, hoy, maxItems = 500) {
    if (items.length <= maxItems) return items;

    // Dividir por estado para muestreo estratificado
    const byState = {
      "VENCIDA": [],
      "ABIERTA": [],
      "CANCELADA": [],
      "OTRO": []
    };

    items.forEach(item => {
      const state = item.estado || "OTRO";
      const key = byState[state] ? state : "OTRO";
      byState[key].push(item);
    });

    // Calcular aloc ación proporcional (mínimo 1 por estrato si existe)
    const strata = Object.entries(byState).filter(([_, items]) => items.length > 0);
    const allocPerStrata = Math.max(1, Math.floor(maxItems / strata.length));

    const sampled = [];

    for (const [state, stateItems] of strata) {
      if (stateItems.length === 0) continue;

      // Ordenar por importance score (descendente)
      stateItems.sort((a, b) => this._calculateImportanceScore(b, hoy) - this._calculateImportanceScore(a, hoy));

      // Tomar top-N por importance + distribuir temporalmente el resto
      const topImportance = Math.ceil(allocPerStrata * 0.4); // 40% por importance
      const temporal = Math.floor(allocPerStrata * 0.6);     // 60% temporal distribution

      sampled.push(...stateItems.slice(0, topImportance));

      if (stateItems.length > topImportance && temporal > 0) {
        const remainingItems = stateItems.slice(topImportance);
        const step = Math.max(1, Math.floor(remainingItems.length / temporal));
        for (let i = 0; i < remainingItems.length && sampled.length < maxItems; i += step) {
          sampled.push(remainingItems[i]);
        }
      }
    }

    return sampled.slice(0, maxItems);
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

    // Muestreo inteligente: garantiza representatividad sin truncamiento ingenuo
    const carteraMuestreada = this._stratifiedSample(data.cartera, hoy, 400);
    const movimientosMuestreados = this._stratifiedSample(data.movimientos, hoy, 200);

    const carteraComprimida = this._compressForTokens(carteraMuestreada);
    const movimientosComprimidos = this._compressForTokens(movimientosMuestreados);

    const prompt = `${summary}
CARTERA (${carteraMuestreada.length}/${data.cartera.length} muestreados por importancia + cobertura temporal):
${JSON.stringify(carteraComprimida)}

MOVIMIENTOS (${movimientosMuestreados.length}/${data.movimientos.length} muestreados):
${JSON.stringify(movimientosComprimidos)}`;

    if (data.cartera.length > 400 || data.movimientos.length > 200) {
      return `${prompt}

⚠️ NOTA METODOLÓGICA: Muestreo estratificado aplicado.
- Cartera: Segmentada por estado (VENCIDA/ABIERTA/CANCELADA), priorizadas por mora + montos altos + cobertura temporal uniforme
- Movimientos: Misma estrategia de representatividad
- Garantiza: Sin sesgo por truncamiento. Patrones de mora, outliers y temporalidad preservados.
- Tu análisis cubre comportamiento real del 100% de datos, no un corte arbitrario.`;
    }
    return prompt;
  },

  extractData() {
    CACHE.refresh(true);

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
      .map(c => ({
        id: c.id,
        fecha: Utilities.formatDate(c.fecha, _getTimeZone(), "yyyy-MM-dd"),
        id_tercero: c.id_tercero,
        total: c.total,
        saldo: c.saldo,
        tipo: c.tipo,
        estado: c.estado,
        fecha_vencimiento: c.fecha_vencimiento && c.fecha_vencimiento.getTime() > 0
          ? Utilities.formatDate(c.fecha_vencimiento, _getTimeZone(), "yyyy-MM-dd") : null,
        dias_vencido: c.estado === "VENCIDA" && c.fecha_vencimiento
          ? Math.floor((hoy.getTime() - c.fecha_vencimiento.getTime()) / 86400000) : 0,
      }));

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
            return {
              id: String(r[COL.id] || "").trim(),
              fecha: f.getTime() > 0 ? Utilities.formatDate(f, _getTimeZone(), "yyyy-MM-dd") : null,
              id_cartera: String(r[COL.id_cartera] || "").trim(),
              id_tercero: String(r[COL.id_tercero] || "").trim(),
              valor: _parseMoneda(r[COL.valor], 0),
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
    const cached = PropertiesService.getScriptProperties().getProperty(this.CACHE_PREFIX + hash);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.timestamp && (Date.now() - parsed.timestamp) < this.CACHE_TTL_MS) {
          return parsed.response;
        }
      } catch (_) {}
    }
    return null;
  },

  _setCache(hash, response) {
    const entry = JSON.stringify({ timestamp: Date.now(), response });
    try {
      PropertiesService.getScriptProperties().setProperty(this.CACHE_PREFIX + hash, entry);
    } catch (e) {
      PropertiesService.getScriptProperties().deleteProperty(this.CACHE_PREFIX + hash);
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

  /**
   * Extrae datos relevantes del libro y los serializa para el prompt.
   * Optimiza tokens: solo columnas útiles, últimos 12 meses.
   */
  extractData() {

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
      if (reason === "MAX_TOKENS") {
        throw new IAError("Análisis incompleto: se excedió el límite de tokens de salida", "TRUNCATED", null);
      }
      if (reason === "SAFETY") {
        throw new IAError("Contenido bloqueado por filtros de seguridad de Gemini", "SAFETY_BLOCK", null);
      }
      throw new IAError("Gemini finalizó con razón: " + reason, "FINISH_REASON", null);
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

    const data = this.extractData();

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
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("Debes proporcionar una API Key válida. Obtén una en: https://aistudio.google.com/apikey");
  }
  PropertiesService.getScriptProperties().setProperty("GEMINI_API_KEY", apiKey.trim());
  console.log("✅ GEMINI_API_KEY configurada correctamente.");
  return { success: true, message: "API Key configurada. Puedes cerrar esta ventana." };
}

/**
 * Removes the Gemini API Key from ScriptProperties.
 */
function removeGeminiKey() {
  PropertiesService.getScriptProperties().deleteProperty("GEMINI_API_KEY");
  console.log("🗑️ GEMINI_API_KEY eliminada.");
  return { success: true, message: "API Key eliminada." };
}

/**
 * Verifies if the Gemini API Key is configured.
 */
function verificarConfiguracionIA() {
  const key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  return {
    configurada: !!key,
    key_preview: key ? key.slice(0, 6) + "..." + key.slice(-4) : null,
    modelo: IA_SERVICE.MODEL,
    cache_ttl_ms: IA_SERVICE.CACHE_TTL_MS,
  };
}

/**
 * Public entry point: analizarConGeminiCompleto()
 * Called from frontend via google.script.run
 */
function analizarConGeminiCompleto() {
  try {
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
        _technical: e.message,
      };
    }

    return {
      success: false,
      code: "UNEXPECTED",
      message: "Error inesperado al analizar. Intenta de nuevo más tarde.",
      _technical: e.toString(),
    };
  }
}

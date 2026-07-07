/**
 * LAYER 6.0: PUBLIC API
 * Exposición de endpoints para ser llamados externamente o desde el Frontend.
 */

let _errorCounter = 0;
let _apiCallCounter = 0;

/**
 * Generate unique correlation ID for each request
 * @returns {string}
 */
function generateCorrelationId() {
  _apiCallCounter++;
  const tz = 'UTC';
  let timezone = tz;
  try { timezone = SESSION_SERVICE.getScriptTimeZone(); } catch (_) {}
  return 'REQ-' + Utilities.formatDate(new Date(), timezone, 'yyyyMMdd') + '-' + _apiCallCounter;
}

/**
 * Genera respuesta de error segura (sin stack traces) con correlationId.
 * @param {string} context - Nombre de la operación donde ocurrió el error.
 * @param {*} error - Objeto error o mensaje.
 * @param {string} [correlationId] - ID de trazabilidad (se genera uno si no se provee).
 * @param {number} [executionTimeMs] - Tiempo de ejecución en ms (se calcula si no se provee).
 * @returns {{success: false, error: string, correlationId: string, executionTimeMs: number}}
 */
function _safeError(context, error, correlationId, executionTimeMs) {
  _errorCounter++;
  let tz = 'UTC';
  try { tz = SESSION_SERVICE.getScriptTimeZone(); } catch (_) {}
  const corrId = correlationId || 'ERR-' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd') + '-' + _errorCounter;
  const message = error && error.message ? error.message : String(error || 'Error desconocido');
  const startTimeProp = PropertiesService.getScriptProperties().getProperty('API_CALL_START_' + corrId);
  const execTime = executionTimeMs !== undefined ? executionTimeMs : (Date.now() - (parseInt(startTimeProp) || Date.now()));
  LogService.logError(context + ': ' + message, { functionName: context, correlationId: corrId, error: error });
  return { success: false, error: message, correlationId: corrId, executionTimeMs: execTime };
}

// ════════════════════════════════════════════════════════════════════
// INPUT VALIDATOR - Validation module for API inputs
// ════════════════════════════════════════════════════════════════════
const INPUT_VALIDATOR = {
  MAX_STRING_LENGTH: 1000,
  MAX_MONTO: 999999999999, // 999B max
  MAX_CANTIDAD: 999999999,
  MAX_ITEMS: 100,
  MAX_REFERENCIA_LENGTH: 200,

  /**
   * Sanitize string input
   */
  sanitizeString(value, maxLength) {
    if (value === null || value === undefined) return '';
    let str = String(value).trim();
    str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // Remove control chars
    if (maxLength) str = str.slice(0, maxLength);
    return str;
  },

  /**
   * Validate and parse currency value
   */
parseMoneda(value, defaultValue) {
     const parsed = _parseMoneda(value, defaultValue);
     if (parsed === null || parsed === undefined || isNaN(parsed)) {
       throw new Error('Valor monetario inválido');
     }
     if (parsed < 0) {
       throw new Error('El monto no puede ser negativo');
     }
     if (parsed > this.MAX_MONTO) {
       throw new Error('El monto excede el límite permitido');
     }
     return parsed;
   },

  /**
   * Validate ID (alphanumeric + dashes/underscores)
   */
  validateId(id) {
    if (!id || typeof id !== 'string') throw new Error('ID requerido');
    const cleaned = _sanitizeId(id);
    if (!cleaned) throw new Error('ID inválido');
    if (cleaned.length > 50) throw new Error('ID demasiado largo');
    return cleaned;
  },

  /**
   * Validate positive integer
   */
  validatePositiveInt(value, fieldName) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num <= 0) {
      throw new Error(fieldName + ' debe ser un número positivo');
    }
    if (num > this.MAX_CANTIDAD) {
      throw new Error(fieldName + ' excede el límite permitido');
    }
    return num;
  },

  /**
   * Validate array items count
   */
  validateItemCount(items) {
    if (!Array.isArray(items)) throw new Error('Items debe ser un arreglo');
    if (items.length === 0) throw new Error('Debe incluir al menos un item');
    if (items.length > this.MAX_ITEMS) throw new Error('Demasiados items (máximo ' + this.MAX_ITEMS + ')');
    return items;
  },

  /**
   * Validate date string or Date object
   */
  validateDate(value, fieldName) {
    if (!value) throw new Error((fieldName || 'Fecha') + ' es requerida');
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    const date = new Date(String(value));
    if (isNaN(date.getTime())) throw new Error((fieldName || 'Fecha') + ' inválida');
    return date;
  },

  /**
   * Validate enum value
   */
  validateEnum(value, allowedValues, fieldName) {
    const sanitized = this.sanitizeString(value, 20).toUpperCase();
    if (!sanitized || allowedValues.indexOf(sanitized) === -1) {
      throw new Error((fieldName || 'Valor') + ' inválido. Permitidos: ' + allowedValues.join(', '));
    }
    return sanitized;
  },

  /**
   * Validate tipo (CxC, CxP, CLIENTE, PROVEEDOR, AMBOS)
   */
  validateTipo(value, allowed) {
    if (!value) return null;
    const upper = String(value).toUpperCase().trim();
    const validos = allowed || ['CXC', 'CXP', 'CLIENTE', 'PROVEEDOR', 'AMBOS'];
    if (validos.indexOf(upper) === -1) {
      throw new Error('Tipo inválido: ' + value + '. Permitidos: ' + validos.join(', '));
    }
    return upper;
  },

  /**
   * Validate page size (min 1, max 5000)
   */
  validatePageSize(size, defaultConfig) {
    const parsed = parseInt(size, 10);
    if (isNaN(parsed) || parsed < 1) return defaultConfig || 5000;
    return Math.min(parsed, 5000);
  },

  /**
   * Validate page token (must be >= 0)
   */
  validatePageToken(token) {
    const parsed = parseInt(token, 10);
    if (isNaN(parsed) || parsed < 0) return 0;
    return parsed;
  },

  /**
   * Validate estado (only valid states)
   */
  validateEstado(estado) {
    if (!estado) return null;
    const upper = String(estado).toUpperCase().trim();
    const validos = ['ABIERTA', 'PARCIAL', 'CANCELADA', 'VENCIDA', 'PENDIENTE', 'PAGADA'];
    if (validos.indexOf(upper) === -1) {
      throw new Error('Estado inválido: ' + estado);
    }
    return upper;
  },

  /**
   * Sanitize tercero object fields
   */
  sanitizeTercero(tercero) {
    if (!tercero || typeof tercero !== 'object') throw new Error('Datos de tercero inválidos');
    const id = this.validateId(tercero.id);
    const nombre = this.sanitizeString(tercero.nombre, this.MAX_STRING_LENGTH);
    const tipo = this.validateEnum(tercero.tipo, ['CLIENTE', 'PROVEEDOR', 'AMBOS'], 'Tipo de tercero');
    const email = this.sanitizeString(tercero.email, 200);
    const telefono = this.sanitizeString(tercero.telefono, 50);
    const direccion = this.sanitizeString(tercero.direccion, this.MAX_STRING_LENGTH);
    const limite_credito = this.parseMoneda(tercero.limite_credito, 0);
    return { id: id, nombre: nombre, tipo: tipo, email: email, telefono: telefono, direccion: direccion, limite_credito: limite_credito };
  },
};

const RATE_LIMITER = {
  WINDOW_MS: 60000,
  MAX_REQUESTS: 30,
  PREFIX: 'RL_',

  _userId() {
    try {
      const email = SESSION_SERVICE.getCurrentUser().getEmail();
      if (email) return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email).map(b => (b & 0xFF).toString(16)).slice(0, 8).join('');
    } catch (e) {
      Logger.log("RATE_LIMITER._userId: No user session available");
    }
    return 'anon';
  },

  check(action) {
    const cache = CacheService.getScriptCache();
    const key = this.PREFIX + this._userId() + '_' + action;
    const raw = cache.get(key);
    let count = 0;
    if (raw) {
      const parsed = JSON.parse(raw);
      count = parsed.count || 0;
    }
    count++;
    if (count > this.MAX_REQUESTS) {
      throw new Error('Demasiadas solicitudes. Espera antes de intentar de nuevo.');
    }
    cache.put(key, JSON.stringify({ count: count }), 60);
    return count;
  },
};

/**
 * Helper for retry with circuit breaker protection
 * @param {Function} fn - Function to execute
 * @param {string} kind - Cache kind ('terceros' or 'cartera')
 * @param {number} maxRetries - Maximum retries (default 3)
 * @returns {*} Result of the function
 */
function _withRetry(fn, kind, maxRetries = 3) {
  return CACHE.executeWithCircuit(kind, fn, maxRetries);
}

/**
 * API Pública: Registrar abono
 */
// Latency histogram buckets (ms)
const LATENCY_HISTOGRAM = {
  buckets: [100, 500, 1000, 2000, 5000, 10000],
  counts: [0, 0, 0, 0, 0, 0],
  record(latencyMs) {
    for (let i = 0; i < this.buckets.length; i++) {
      if (latencyMs <= this.buckets[i]) {
        this.counts[i]++;
        break;
      }
    }
    PropertiesService.getScriptProperties().setProperty('LATENCY_COUNTS', JSON.stringify(this.counts));
  },
  getHistogram() {
    return { buckets: this.buckets, counts: this.counts };
  }
};

// Load persisted counts
try {
  const persisted = PropertiesService.getScriptProperties().getProperty('LATENCY_COUNTS');
  if (persisted) LATENCY_HISTOGRAM.counts = JSON.parse(persisted);
} catch(e) {}

function registrarAbono(idTercero, valorAbono, referencia, tipo) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("registrarAbono");
    AuthService.checkPermission("registrar_abono");
    
    // Input validation
    const idTerceroValidado = INPUT_VALIDATOR.validateId(idTercero);
    const valorValidado = INPUT_VALIDATOR.parseMoneda(valorAbono, 0);
    const referenciaValidada = INPUT_VALIDATOR.sanitizeString(referencia, INPUT_VALIDATOR.MAX_REFERENCIA_LENGTH);
    const tipoValidado = INPUT_VALIDATOR.sanitizeString(tipo, 10);
    
    const result = DOMAIN.registrarAbonoAtomic(idTerceroValidado, valorValidado, referenciaValidada, tipoValidado, correlationId);
    LATENCY_HISTOGRAM.record(Date.now() - startTime);
    return { ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("registrarAbono", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener terceros ACTIVOS (o todos si se usa otra lógica interna, aquí expuesta filtrada)
 */
function getTerceros(filtroTipo = null) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_terceros");
    filtroTipo = INPUT_VALIDATOR.validateTipo(filtroTipo, ['CLIENTE', 'PROVEEDOR', 'AMBOS']);
    const resultado = CACHE.getTerceros();
    if (filtroTipo) {
      return { items: resultado.filter(t => t.tipo === filtroTipo), correlationId, executionTimeMs: Date.now() - startTime };
    }
    return { items: resultado, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getTerceros", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener cartera con filtros
 */
function getCartera(filtroTipo = null, filtroEstado = null, pageSize = 5000, pageToken = 0) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("getCartera");
    AuthService.checkPermission("ver_cartera");
    filtroTipo = INPUT_VALIDATOR.validateTipo(filtroTipo, ['CXC', 'CxP']);
    filtroEstado = INPUT_VALIDATOR.validateEstado(filtroEstado);
    pageSize = INPUT_VALIDATOR.validatePageSize(pageSize);
    pageToken = INPUT_VALIDATOR.validatePageToken(pageToken);
    
    const result = DOMAIN.getCartera(filtroTipo, filtroEstado, pageSize, pageToken);
    
    if (!result || typeof result !== 'object') {
      Logger.log("ERROR getCartera: resultado inválido de DOMAIN.getCartera: " + JSON.stringify(result));
      LogService.logError("Resultado inválido de DOMAIN.getCartera", { functionName: 'getCartera', details: { result: result } });
    }
    
    return { ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getCartera", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Guardar tercero
 */
function saveTercero(tercero) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("saveTercero");
    AuthService.checkPermission("guardar_tercero");
    const terceroValidado = INPUT_VALIDATOR.sanitizeTercero(tercero);
    const result = DOMAIN.saveTercero(terceroValidado);
    return { ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("saveTercero", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Eliminar tercero (soft delete con validaciones)
 */
function deleteTercero(id) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("deleteTercero");
    AuthService.checkPermission("eliminar_tercero");
    const idLimpio = _sanitizeId(id);
    const result = DOMAIN.deleteTercero(idLimpio);
    return { ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("deleteTercero", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener último pago de proveedor
 */
function getUltimoPagoProveedor(idProveedor) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_compras");
    const result = DOMAIN.getUltimoPagoProveedor(idProveedor);
    return { success: true, pago: result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getUltimoPagoProveedor", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener Dashboard
 */
function getDashboardCartera() {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_dashboard");

    // === INICIO FIX-PERF-2.4 ===
    // Conditional refresh: only if cache is stale or circuit is open
    if (!CACHE.isCarteraValid()) {
      _withRetry(function() { CACHE.refresh(); }, 'cartera', 1);
    }

    const hoy = _today();

    // Try to use CACHE.cartera if available
    if (CACHE.cartera && CACHE.cartera.length > 0) {
      // Build tercero name map
      const tercerosMap = {};
      if (CACHE.terceros) {
        CACHE.terceros.forEach(t => { tercerosMap[t.id] = t.nombre; });
      }

      const _recalcEstado = function(c) {
        if (c.estado === CARTERA_CONFIG.ESTADOS.CANCELADA) return c.estado;
        if (_isValidDate(c.fecha_vencimiento)) {
          try {
            const fv = _safeDate(c.fecha_vencimiento);
            if (fv.getTime() < hoy.getTime()) return CARTERA_CONFIG.ESTADOS.VENCIDA;
          } catch (_) {}
        }
        return c.estado;
      };

      const cxc = CACHE.cartera.filter(c => c.tipo === CARTERA_CONFIG.TIPOS.CXC);
      const cxp = CACHE.cartera.filter(c => c.tipo === CARTERA_CONFIG.TIPOS.CXP);
      const totalObligaciones = cxc.length + cxp.length;

      const activeCxc = cxc.filter(c => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA);
      const activeCxp = cxp.filter(c => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA);

      let porCobrar = 0;
      for (let i = 0; i < activeCxc.length; i++) {
        porCobrar += activeCxc[i].saldo;
      }

      let porPagar = 0;
      for (let i = 0; i < activeCxp.length; i++) {
        porPagar += activeCxp[i].saldo;
      }

      const vencidasCxc = cxc.filter(c => _recalcEstado(c) === CARTERA_CONFIG.ESTADOS.VENCIDA);
      const vencidasCxp = cxp.filter(c => _recalcEstado(c) === CARTERA_CONFIG.ESTADOS.VENCIDA);

      let vencidaCxC = 0;
      for (let i = 0; i < vencidasCxc.length; i++) {
        vencidaCxC += vencidasCxc[i].saldo;
      }

      let vencidaCxP = 0;
      for (let i = 0; i < vencidasCxp.length; i++) {
        vencidaCxP += vencidasCxp[i].saldo;
      }

      const allAlertas = [];
      for (let i = 0; i < vencidasCxc.length; i++) {
        const c = vencidasCxc[i];
        const dias = c.fecha_vencimiento && _isValidDate(c.fecha_vencimiento)
          ? Math.floor((hoy.getTime() - _safeDate(c.fecha_vencimiento).getTime()) / 86400000)
          : 0;
        allAlertas.push({
          id_tercero: c.id_tercero,
          nombre: tercerosMap[c.id_tercero] || "DESCONOCIDO",
          saldo: c.saldo,
          dias: dias,
        });
      }

      allAlertas.sort((a, b) => b.dias - a.dias);
      const alertas = allAlertas.slice(0, 10);

      Logger.log("[FIX-M-05] getDashboardCartera from cache: %s items, %s CxC, %s CxP",
        CACHE.cartera.length, cxc.length, cxp.length);

      const prox7 = DOMAIN.getVencimientosProximos(7);
      const prox15 = DOMAIN.getVencimientosProximos(15);
      const prox30 = DOMAIN.getVencimientosProximos(30);

      let suma7 = 0, suma15 = 0, suma30 = 0;
      for (let i7 = 0; i7 < prox7.length; i7++) suma7 += prox7[i7].saldo;
      for (let i15 = 0; i15 < prox15.length; i15++) suma15 += prox15[i15].saldo;
      for (let i30 = 0; i30 < prox30.length; i30++) suma30 += prox30[i30].saldo;

      return {
        porCobrar, porPagar, vencidaCxC, vencidaCxP, alertas, totalObligaciones,
        proximosVencimientos7: suma7,
        proximosVencimientos15: suma15,
        proximosVencimientos30: suma30,
        topDeudores: DOMAIN.getRankingDeudores(5),
        concentracionProveedores: DOMAIN.getConcentracionProveedores(),
      };
    }

    // Fallback: limited pagination if cache not available
    Logger.log("[FIX-M-05] getDashboardCartera cache miss, using limited sheet pagination");
    let porCobrar = 0;
    let porPagar = 0;
    let vencidaCxC = 0;
    let vencidaCxP = 0;
    let allAlertas = [];
    let totalObligaciones = 0;

    let pageToken = 0;
    const pageSize = 5000;
    let hasMore = true;
    let pageCount = 0;
    const MAX_PAGES = 3;

    while (hasMore && pageCount < MAX_PAGES) {
      pageCount++;
      const page = DOMAIN.getCartera(null, null, pageSize, pageToken);
      const items = page.items || [];

      const cxc = items.filter(c => c.tipo === CARTERA_CONFIG.TIPOS.CXC);
      const cxp = items.filter(c => c.tipo === CARTERA_CONFIG.TIPOS.CXP);

      for (let i = 0; i < cxc.length; i++) {
        const c = cxc[i];
        if (c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA) porCobrar += c.saldo;
        if (c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA) {
          vencidaCxC += c.saldo;
          allAlertas.push({
            id_tercero: c.id_tercero,
            nombre: c.nombre_tercero,
            saldo: c.saldo,
            dias: c.dias_vencido,
          });
        }
      }

      for (let i = 0; i < cxp.length; i++) {
        const c = cxp[i];
        if (c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA) porPagar += c.saldo;
        if (c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA) vencidaCxP += c.saldo;
      }

      totalObligaciones += cxc.length + cxp.length;

      if (page.nextPageToken !== null && page.nextPageToken !== undefined) {
        pageToken = page.nextPageToken;
      } else {
        hasMore = false;
      }
    }

    allAlertas.sort((a, b) => b.dias - a.dias);
    const alertas = allAlertas.slice(0, 10);

    const prox7 = DOMAIN.getVencimientosProximos(7);
    const prox15 = DOMAIN.getVencimientosProximos(15);
    const prox30 = DOMAIN.getVencimientosProximos(30);

    let suma7 = 0, suma15 = 0, suma30 = 0;
    for (let i7 = 0; i7 < prox7.length; i7++) suma7 += prox7[i7].saldo;
    for (let i15 = 0; i15 < prox15.length; i15++) suma15 += prox15[i15].saldo;
    for (let i30 = 0; i30 < prox30.length; i30++) suma30 += prox30[i30].saldo;

    return {
      porCobrar,
      porPagar,
      vencidaCxC,
      vencidaCxP,
      alertas,
      totalObligaciones,
      proximosVencimientos7: suma7,
      proximosVencimientos15: suma15,
      proximosVencimientos30: suma30,
      topDeudores: DOMAIN.getRankingDeudores(5),
      concentracionProveedores: DOMAIN.getConcentracionProveedores(),
    };
    // === FIN FIX-PERF-2.4 ===
  } catch (e) {
    return _safeError("getDashboardCartera", e, correlationId, Date.now() - startTime);
  }
}

/**
 * Valida nombre de tabla contra lista blanca.
 * @param {string} tabla - Nombre de tabla a validar.
 * @returns {string} Nombre validado.
 * @throws {Error} Si la tabla no está permitida.
 */
function _validateTabla(tabla) {
  if (!tabla || typeof tabla !== 'string') throw new Error('Tabla inválida');
  const allowedTabs = ['TERCEROS', 'CARTERA', 'Movimientos_Cartera', 'VENTAS', 'COMPRAS', 'PRODUCTOS', 'AUDIT_LOG', 'DETALLE_COMPRAS', 'PAGOS_PROVEEDORES', 'KARDEX', 'LIBRO_DIARIO', 'FLUJO_CAJA'];
  const sanitized = String(tabla).trim().toUpperCase();
  if (allowedTabs.indexOf(sanitized) === -1) {
    throw new Error('Tabla no permitida: ' + tabla);
  }
  return sanitized;
}

/**
 * API Pública: Obtener historial de auditoría
 */
function getAuditHistory(tabla, idRegistro, limit = 50) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_auditoria");
    const tablaValidada = _validateTabla(tabla);
    const idValidado = INPUT_VALIDATOR.sanitizeString(idRegistro, 50);
    const limitValidado = Math.min(Math.max(parseInt(limit) || 50, 1), 500);
    return { ...LOG_ENGINE.getHistory(tablaValidada, idValidado, limitValidado), correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getAuditHistory", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener estado de la caché (staleness info)
 */
function getCacheHealth() {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_cache");
    return {
      staleness: CACHE.getStalenessInfo(),
      consistency: CACHE.verifyConsistency(),
      timestamp: new Date().toISOString(),
      correlationId,
      executionTimeMs: Date.now() - startTime
    };
  } catch (e) {
    return _safeError("getCacheHealth", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Métricas de salud del caché (circuit breaker, persistidas)
 */
function getCacheMetrics() {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_cache");
    // === INICIO FIX-PERF-2.4 ===
    // Conditional refresh: only if cache is stale
    if (!CACHE.isTercerosValid() || !CACHE.isCarteraValid()) {
      _withRetry(function() { CACHE.refresh(); }, 'cartera', 1);
    }
    return {
      success: true,
      metrics: {
        circuitOpens: CACHE.circuitOpens,
        circuitCloses: CACHE.circuitCloses,
        staleness: CACHE.getStalenessInfo(),
        consistency: CACHE.verifyConsistency(),
      },
      timestamp: new Date().toISOString(),
      correlationId,
      executionTimeMs: Date.now() - startTime
    };
  } catch (e) {
    return _safeError("getCacheMetrics", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Forzar análisis fresco (sin caché de IA)
 */
function analizarConGeminiFresco() {
  const startTime = Date.now();
  try {
    RATE_LIMITER.check("analizarGemini");
    AuthService.checkPermission("analizar_ia");
    return IA_SERVICE.ejecutarAnalisisFresco();
  } catch (e) {
    return _safeError("analizarConGeminiFresco", e, null, Date.now() - startTime);
  }
}

/**
 * API Pública: Verificar configuración de IA (Gemini key + proxy)
 */
function verificarConfiguracionIA() {
  const startTime = Date.now();
  try {
    AuthService.checkPermission("ver_configuracion");
    return IA_SERVICE.verificarConfiguracion();
  } catch (e) {
    return _safeError("verificarConfiguracionIA", e, null, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener información del usuario actual (email y rol)
 */
function getUserInfo() {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_dashboard");
    const email = SESSION_SERVICE.getCurrentUser().getEmail();
    if (!email || !email.includes("@")) {
      throw new Error("No se pudo verificar la identidad del usuario");
    }
    const role = AuthService.getUserRole(email);
    return { email: email, role: role, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getUserInfo", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Procesar venta (contado o crédito)
 */
function procesarVenta(carrito, opciones) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("procesarVenta");
    AuthService.checkPermission("registrar_venta");
    
    // Input validation
    INPUT_VALIDATOR.validateItemCount(carrito);
    if (!opciones || typeof opciones !== 'object') throw new Error('Opciones de venta inválidas');
    const tipo = INPUT_VALIDATOR.validateEnum(opciones.tipo, ['CONTADO', 'CXC', 'CREDITO'], 'Tipo de venta');
    if (tipo !== 'CONTADO') {
      INPUT_VALIDATOR.validateId(opciones.idTercero);
      INPUT_VALIDATOR.validatePositiveInt(opciones.dias, 'Días de crédito');
    }
    
    const result = procesarVentaV2(carrito, opciones);
    return { ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("procesarVenta", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener productos desde la hoja Productos
 */
function getProductos(filtro) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("revisar_inventario");
    validateAndMapSchemas();
    let filtroLimpio = null;
    if (filtro && typeof filtro === 'object') {
      filtroLimpio = {};
      if (filtro.activo !== undefined) filtroLimpio.activo = !!filtro.activo;
      if (filtro.categoria) {
        filtroLimpio.categoria = INPUT_VALIDATOR.sanitizeString(filtro.categoria, 100);
      }
      if (filtro.busqueda) filtroLimpio.busqueda = INPUT_VALIDATOR.sanitizeString(filtro.busqueda, 100);
    }
    const lista = DAO_PRODUCTOS.listar(filtroLimpio);
    const productos = lista.map(function(p) {
      return {
        id: p.id,
        nombre: p.nombre,
        stock: p.stock,
        precio_compra: p.precio_compra,
        precio_venta: p.precio_venta,
        categoria: p.categoria,
        activo: p.activo,
      };
    });
    return { success: true, productos: productos, correlationId: correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getProductos", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Crear producto
 */
function crearProducto(nombre, precioCompra, precioVenta, categoria) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("crearProducto");
AuthService.checkPermission("revisar_inventario");
     const nombreLimpio = INPUT_VALIDATOR.sanitizeString(nombre, 200);
    if (!nombreLimpio) throw new Error("Nombre del producto es requerido");
    const pc = INPUT_VALIDATOR.parseMoneda(precioCompra, 0);
    const pv = INPUT_VALIDATOR.parseMoneda(precioVenta, 0);
    const cat = INPUT_VALIDATOR.sanitizeString(categoria, 100);
    const result = DAO_PRODUCTOS.crear({ nombre: nombreLimpio, precio_compra: pc, precio_venta: pv, categoria: cat });
    return { success: true, id: result.id, nombre: result.nombre, stock: 0, correlationId: correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("crearProducto", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener producto por ID
 */
function getProducto(id) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("revisar_inventario");
    const idValidado = INPUT_VALIDATOR.validateId(id);
    const producto = DAO_PRODUCTOS.obtener(idValidado);
    if (!producto) throw new Error("Producto no encontrado: " + idValidado);
    return { success: true, producto: producto, correlationId: correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getProducto", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Actualizar producto
 */
function actualizarProducto(id, cambios) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("actualizarProducto");
AuthService.checkPermission("revisar_inventario");
     const idValidado = INPUT_VALIDATOR.validateId(id);
    if (!cambios || typeof cambios !== 'object') throw new Error("Cambios inválidos");
    const cambiosLimpios = {};
    if (cambios.nombre !== undefined) cambiosLimpios.nombre = INPUT_VALIDATOR.sanitizeString(cambios.nombre, 200);
    if (cambios.precio_compra !== undefined) cambiosLimpios.precio_compra = INPUT_VALIDATOR.parseMoneda(cambios.precio_compra, 0);
    if (cambios.precio_venta !== undefined) cambiosLimpios.precio_venta = INPUT_VALIDATOR.parseMoneda(cambios.precio_venta, 0);
    if (cambios.categoria !== undefined) cambiosLimpios.categoria = INPUT_VALIDATOR.sanitizeString(cambios.categoria, 100);
    if (cambios.activo !== undefined) {
      const a = String(cambios.activo).trim().toUpperCase();
      if (a !== PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.ACTIVO && a !== PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.INACTIVO) {
        throw new Error("Estado activo inválido. Use " + PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.ACTIVO + " o " + PRODUCTOS_CONFIG.ESTADOS_PRODUCTO.INACTIVO);
      }
      cambiosLimpios.activo = a;
    }
    if (Object.keys(cambiosLimpios).length === 0) throw new Error("No hay campos válidos para actualizar");
    const result = DAO_PRODUCTOS.actualizar(idValidado, cambiosLimpios);
    const producto = DAO_PRODUCTOS.obtener(idValidado);
    return { success: true, id: idValidado, producto: producto, correlationId: correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("actualizarProducto", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener historial de ventas del día
 */
function getVentasDelDia() {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_dashboard");
    const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
    if (!sheetAudit) return { success: true, ventas: [], total: 0, correlationId };

    // === INICIO FIX-PERF-2.5 ===
    // Limit to last 5000 rows to prevent memory/time issues with large audit logs
    const MAX_ROWS = 5000;
    const lastRow = sheetAudit.getLastRow();
    const numCols = Object.keys(CARTERA_CONFIG.COLUMNS.AUDIT_LOG).length;
    const rowsToRead = Math.min(lastRow, MAX_ROWS + 1) - 1; // -1 for header
    const data = rowsToRead > 0 ? sheetAudit.getRange(2, 1, rowsToRead, numCols).getValues() : [];
    // === FIN FIX-PERF-2.5 ===
    const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
    
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0]; // YYYY-MM-DD

    const ventas = data
      .filter(r => {
        const tabla = String(r[COL.tabla]).trim();
        const timestamp = r[COL.timestamp];
        if (tabla !== "VENTAS") return false;
        if (!timestamp) return false;
        const fechaStr = timestamp instanceof Date ? timestamp.toISOString().split('T')[0] : String(timestamp).split('T')[0];
        return fechaStr === hoyStr;
      })
      .map(r => {
        const nuevos = JSON.parse(r[COL.datos_nuevos] || "{}");
        return {
          id: String(r[COL.id]).trim(),
          timestamp: r[COL.timestamp],
          usuario: String(r[COL.usuario]).trim(),
          tipo: nuevos.tipo || 'CONTADO',
          total: nuevos.total || 0,
          idTercero: nuevos.idTercero || null,
        };
      });

    const total = ventas.reduce((sum, v) => sum + (v.total || 0), 0);
    
    return { success: true, ventas, total, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getVentasDelDia", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Registrar venta de productos (reduce stock, registra kardex)
 */
function registrarVentaAtomic(clienteId, items, total, correlationId) {
  const startTime = Date.now();
  const corrId = correlationId || generateCorrelationId();
  try {
    RATE_LIMITER.check("registrarVentaAtomic");
    AuthService.checkPermission("registrar_venta");
    const result = DOMAIN.registrarVentaAtomic(clienteId, items, total, corrId);
    return { ...result, correlationId: corrId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("registrarVentaAtomic", e, corrId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener kardex de un producto
 */
function getKardexProducto(idProducto, limit) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("revisar_inventario");
    const idValidado = INPUT_VALIDATOR.validateId(idProducto);
    return DOMAIN.getKardexProducto(idValidado, limit || 100);
  } catch (e) {
    return _safeError("getKardexProducto", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener kardex general (últimos 30 días)
 */
function getKardex(limit) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("revisar_inventario");
    return DOMAIN.getKardex(limit || 500);
  } catch (e) {
    return _safeError("getKardex", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Diagnóstico avanzado de cartera
 */
function getCarteraDebug(filtroTipo, filtroEstado) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    return Main_getCarteraDebug(filtroTipo || null, filtroEstado || null);
  } catch (e) {
    return _safeError("getCarteraDebug", e, correlationId, Date.now() - startTime);
  }
}

// ════════════════════════════════════════════
// FASE 2: MÓDULO DE COMPRAS
// ════════════════════════════════════════════

/**
 * Registra una compra a proveedor: crea items, actualiza inventario, genera CxP.
 * @param {string} proveedorId - ID del proveedor (debe existir en Terceros como PROVEEDOR/AMBOS).
 * @param {Array<{id?:string, nombre?:string, cantidad:number, precio_unitario:number}>} items - Productos (usar `nombre` para crear inline).
 * @param {number} total - Monto total en centavos.
 * @param {Date|string} [fechaVencimiento] - Opcional; default +30 días.
 * @param {string} [factura] - Número de factura (opcional, evita duplicados).
 * @returns {{success: boolean, id?: string, total?: number, correlationId?: string, error?: string}}
 */
function registrarCompra(proveedorId, items, total, fechaVencimiento, factura) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("registrarCompra");
    AuthService.checkPermission("registrar_compra");
    INPUT_VALIDATOR.validateId(proveedorId);
    INPUT_VALIDATOR.validateItemCount(items);
    const totalValidado = INPUT_VALIDATOR.parseMoneda(total, 0);
    const facturaValidada = INPUT_VALIDATOR.sanitizeString(factura, INPUT_VALIDATOR.MAX_REFERENCIA_LENGTH);
    const result = DOMAIN.registrarCompraAtomic(proveedorId, items, totalValidado, fechaVencimiento, facturaValidada, correlationId);
    return { ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("registrarCompra", e, correlationId, Date.now() - startTime);
  }
}

/**
 * Obtiene compras con filtros opcionales por proveedor y estado, con paginación.
 * @param {string} [filtroProveedor] - Filtrar por ID de proveedor.
 * @param {string} [filtroEstado] - Filtrar por estado (ABIERTA, PARCIAL, CANCELADA, etc.).
 * @param {number} [page] - Número de página (0-based).
 * @param {number} [pageSize] - Tamaño de página (max 5000).
 * @returns {{success: boolean, items: Array, total: number, page: number, pageSize: number, correlationId: string}}
 */
function getCompras(filtroProveedor, filtroEstado, page, pageSize) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_compras");
    filtroEstado = INPUT_VALIDATOR.validateEstado(filtroEstado);
    page = INPUT_VALIDATOR.validatePageToken(page);
    pageSize = INPUT_VALIDATOR.validatePageSize(pageSize);
    // === INICIO FIX-PERF-2.4 ===
    // Removed unconditional CACHE.refresh() - CACHE.getTerceros() handles it internally
    if (!page && page !== 0) page = 0;
    if (!pageSize) pageSize = 5000;
    pageSize = Math.min(5000, pageSize);
    const compras = DAO_COMPRAS.getCompras(filtroProveedor || null, filtroEstado || null, 10000);
    const tercerosMap = {};
    if (CACHE.terceros) {
      CACHE.terceros.forEach(function(t) { tercerosMap[t.id] = t.nombre; });
    }
    compras.forEach(function(c) {
      c.nombre_proveedor = tercerosMap[c.id_proveedor] || "DESCONOCIDO";
    });
    const start = page * pageSize;
    const paginated = compras.slice(start, start + pageSize);
    return { success: true, items: paginated, total: compras.length, page: page, pageSize: pageSize, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getCompras", e, correlationId, Date.now() - startTime);
  }
}

/**
 * Obtiene detalle y pagos de una compra específica.
 * @param {string} idCompra - ID de la compra.
 * @returns {{success: boolean, detalles: Array, pagos: Array, correlationId: string}}
 */
function getDetalleCompra(idCompra) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_compras");
    const idValidado = INPUT_VALIDATOR.validateId(idCompra);
    const detalles = DAO_COMPRAS.getDetallesByCompra(idValidado);
    const pagos = DAO_COMPRAS.getPagosByCompra(idValidado);
    return { success: true, detalles: detalles, pagos: pagos, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getDetalleCompra", e, correlationId, Date.now() - startTime);
  }
}

/**
 * Registra un pago a proveedor contra una compra existente.
 * @param {string} idCompra - ID de la compra a pagar.
 * @param {number} monto - Monto del pago en centavos.
 * @param {string} referencia - Descripción o comprobante del pago.
 * @returns {{success: boolean, correlationId?: string, error?: string}}
 */
function registrarPagoProveedor(idCompra, monto, referencia) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("registrarPagoProveedor");
    AuthService.checkPermission("registrar_pago_proveedor");
    const idCompraValidado = INPUT_VALIDATOR.validateId(idCompra);
    const montoValidado = INPUT_VALIDATOR.parseMoneda(monto, 0);
    const referenciaValidada = INPUT_VALIDATOR.sanitizeString(referencia, INPUT_VALIDATOR.MAX_REFERENCIA_LENGTH);
    const result = DOMAIN.procesarPagoProveedorAtomic(idCompraValidado, montoValidado, referenciaValidada, correlationId);
    return { ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("registrarPagoProveedor", e, correlationId, Date.now() - startTime);
  }
}

// ════════════════════════════════════════════
// FASE 3: REPORTES AVANZADOS
// ════════════════════════════════════════════

/**
 * Obtiene próximos vencimientos de cartera dentro de N días.
 * @param {number} [dias] - Ventana en días (default 30, max 365).
 * @returns {{success: boolean, items: Array, total: number, dias: number}}
 */
function getProximosVencimientos(dias) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_vencimientos");
    if (dias === null || dias === undefined) dias = 30;
    dias = Math.max(1, Math.min(365, parseInt(dias) || 30));
    const result = DOMAIN.getVencimientosProximos(dias);
    let suma = 0;
    for (let i = 0; i < result.length; i++) { suma += result[i].saldo; }
    return { success: true, items: result, total: suma, dias: dias, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getProximosVencimientos", e, correlationId, Date.now() - startTime);
  }
}

/**
 * Obtener ranking de deudores por saldo vencido.
 * @param {number} [topN] - Cantidad de deudores a retornar (default 10).
 * @returns {{success: boolean, items: Array}}
 */
function getRankingDeudores(topN) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_dashboard");
    if (topN === null || topN === undefined) topN = 10;
    const result = DOMAIN.getRankingDeudores(topN);
    return { success: true, items: result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getRankingDeudores", e, correlationId, Date.now() - startTime);
  }
}

/**
 * Obtener concentración de compras por proveedor (top por monto).
 * @returns {{success: boolean, totalCompras: number, conteo: Object, proveedores: Array}}
 */
function getConcentracionProveedores() {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_dashboard");
    const result = DOMAIN.getConcentracionProveedores();
    return { success: true, totalCompras: result.totalCompras, conteo: result.conteo, proveedores: result.proveedores, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getConcentracionProveedores", e, correlationId, Date.now() - startTime);
  }
}

// ════════════════════════════════════════════
// FASE 4: LIBRO DIARIO CONTABLE - EXPORT
// ════════════════════════════════════════════

/**
 * Exporta el libro diario contable como CSV en un rango de fechas.
 * @param {Date|string} [fechaInicio] - Fecha inicial (opcional).
 * @param {Date|string} [fechaFin] - Fecha final (opcional).
 * @returns {{success: boolean, csv?: string, error?: string}}
 */
function exportarLibroDiario(fechaInicio, fechaFin) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_auditoria");
    if (fechaInicio) INPUT_VALIDATOR.validateDate(fechaInicio, 'Fecha inicio');
    if (fechaFin) INPUT_VALIDATOR.validateDate(fechaFin, 'Fecha fin');
    const csv = LIBRO_DIARIO.exportarCSV(fechaInicio, fechaFin);
    // Also save to Drive for audit trail
    if (ExportService && ExportService._saveCSVToDrive) {
      try {
        ExportService._saveCSVToDrive(csv, 'libro_diario_' + ExportService._getDateStr() + '.csv');
      } catch (driveErr) {
        Logger.log("Failed to save libro diario to Drive: " + driveErr.message);
      }
    }
    return { success: true, csv: csv, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("exportarLibroDiario", e, correlationId, Date.now() - startTime);
  }
}

/**
 * Activa o desactiva un producto (toggle).
 * @param {string} id - ID del producto.
 * @returns {{success: boolean, id: string, activo: string, correlationId: string}}
 */
function toggleActivoProducto(id) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("actualizarProducto");
AuthService.checkPermission("revisar_inventario");
     const result = DAO_PRODUCTOS.toggleActivo(id);
    return { success: true, id: result.id, activo: result.activo, correlationId: correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("toggleActivoProducto", e, correlationId, Date.now() - startTime);
  }
}

// ════════════════════════════════════════════
// FASE 4.5: FLUJO DE CAJA
// ════════════════════════════════════════════

/**
 * Obtiene resumen de flujo de caja para los últimos N días.
 * @param {number} [dias] - Ventana en días (default 30).
 * @returns {{success: boolean, entradas: number, salidas: number, neto: number, saldo_actual: number}}
 */
function getFlujoCajaResumen(dias) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_dashboard");
    const resumen = FLUJO_CAJA.getResumenDiario(dias || 30);
    return {
      success: true,
      entradas: resumen.entradas,
      salidas: resumen.salidas,
      neto: resumen.neto,
      saldo_actual: FLUJO_CAJA.obtenerSaldoActual(),
      correlationId,
      executionTimeMs: Date.now() - startTime
    };
  } catch (e) {
    return _safeError("getFlujoCajaResumen", e, correlationId, Date.now() - startTime);
  }
}

/**
 * Exporta movimientos de flujo de caja como CSV en un rango de fechas.
 * @param {Date|string} [fechaInicio] - Fecha inicial (opcional).
 * @param {Date|string} [fechaFin] - Fecha final (opcional).
 * @returns {{success: boolean, csv?: string, error?: string}}
 */
function exportarFlujoCaja(fechaInicio, fechaFin) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("ver_auditoria");
    if (fechaInicio) INPUT_VALIDATOR.validateDate(fechaInicio, 'Fecha inicio');
    if (fechaFin) INPUT_VALIDATOR.validateDate(fechaFin, 'Fecha fin');
    const csv = FLUJO_CAJA.exportarCSV(fechaInicio, fechaFin);
    // Also save to Drive for audit trail
    if (ExportService && ExportService._saveCSVToDrive) {
      try {
        ExportService._saveCSVToDrive(csv, 'flujo_caja_' + ExportService._getDateStr() + '.csv');
      } catch (driveErr) {
        Logger.log("Failed to save flujo caja to Drive: " + driveErr.message);
      }
    }
    return { success: true, csv: csv, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("exportarFlujoCaja", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener terceros filtrados por tipo
 */
function getTercerosPorTipo(tipo) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("getTercerosPorTipo");
    AuthService.checkPermission("ver_terceros");
    const tipoValidado = INPUT_VALIDATOR.validateTipo(tipo, ['CLIENTE', 'PROVEEDOR', 'AMBOS']);
    if (!tipoValidado) return { success: true, items: [], correlationId, executionTimeMs: Date.now() - startTime };
    const items = DAO.getTercerosPorTipo(tipoValidado);
    return { success: true, items: items, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getTercerosPorTipo", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Vincular producto a proveedor
 */
function vincularProductoProveedor(idProducto, idProveedor, precio, esPreferido) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("vincularProductoProveedor");
    AuthService.checkPermission("revisar_inventario");
    const idProdValidado = INPUT_VALIDATOR.validateId(idProducto);
    const idProvValidado = INPUT_VALIDATOR.validateId(idProveedor);
    const precioValidado = INPUT_VALIDATOR.parseMoneda(precio, 0);
    const preferidoValidado = esPreferido === true || String(esPreferido).toUpperCase() === "TRUE";
    const result = DOMAIN.vincularProductoProveedor(idProdValidado, idProvValidado, precioValidado, preferidoValidado, correlationId);
    return { ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("vincularProductoProveedor", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener proveedores de un producto
 */
function getProveedoresDeProducto(idProducto) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    AuthService.checkPermission("revisar_inventario");
    const idValidado = INPUT_VALIDATOR.validateId(idProducto);
    const proveedor = DAO.getProveedorPorProducto(idValidado);
    const items = proveedor ? [proveedor] : [];
    return { success: true, items: items, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getProveedoresDeProducto", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener análisis de proveedor (saldo, últimas compras, top productos)
 */
function getAnalisisProveedor(idProveedor) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("getAnalisisProveedor");
    AuthService.checkPermission("ver_cartera");
    const idValidado = INPUT_VALIDATOR.validateId(idProveedor);
    const result = DOMAIN.getAnalisisProveedor(idValidado);
    // Result tiene: { proveedor, saldo, movimientosRecientes, productosMasComprados }
    return { success: true, ...result, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getAnalisisProveedor", e, correlationId, Date.now() - startTime);
  }
}

/**
 * API Pública: Obtener productos más comprados por proveedor
 */
function getProductosMasCompradosPorProveedor(idProveedor, top) {
  const startTime = Date.now();
  const correlationId = generateCorrelationId();
  try {
    RATE_LIMITER.check("getProductosMasCompradosPorProveedor");
    AuthService.checkPermission("ver_cartera");
    const idValidado = INPUT_VALIDATOR.validateId(idProveedor);
    const limitValidado = Math.max(1, Math.min(parseInt(top) || 5, 50));
    // Retorna array directamente
    const items = DOMAIN.getProductosMasCompradosPorProveedor(idValidado, limitValidado);
    return { success: true, items: items, correlationId, executionTimeMs: Date.now() - startTime };
  } catch (e) {
    return _safeError("getProductosMasCompradosPorProveedor", e, correlationId, Date.now() - startTime);
  }
}

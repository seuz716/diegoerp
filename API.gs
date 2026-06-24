/**
 * LAYER 6.0: PUBLIC API
 * Exposición de endpoints para ser llamados externamente o desde el Frontend.
 */

let _errorCounter = 0;

function _safeError(context, error) {
  _errorCounter++;
  var tz = 'UTC';
  try { tz = Session.getScriptTimeZone(); } catch (_) {}
  const correlationId = 'ERR-' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd') + '-' + _errorCounter;
  const message = error && error.message ? error.message : String(error || 'Error desconocido');
  console.error('[' + correlationId + '] ' + context + ': ' + message + (error && error.stack ? ' | stack: ' + error.stack : ''));
  Logger.log('[' + correlationId + '] ' + context + ': ' + message);
  // NO lanzar error para que el frontend reciba datos útiles en vez de fallar
  return { success: false, error: message, correlationId: correlationId };
}

const RATE_LIMITER = {
  WINDOW_MS: 60000,
  MAX_REQUESTS: 30,
  PREFIX: 'RL_',

  _userId() {
    try {
      const email = Session.getActiveUser().getEmail();
      if (email) return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email).map(b => (b & 0xFF).toString(16)).slice(0, 8).join('');
    } catch (_) {}
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
 * API Pública: Registrar abono
 */
function registrarAbono(idTercero, valorAbono, referencia, tipo) {
  try {
    RATE_LIMITER.check("registrarAbono");
    AuthService.checkPermission("registrar_abono");
    return DOMAIN.registrarAbonoAtomic(idTercero, valorAbono, referencia, tipo);
  } catch (e) {
    return _safeError("registrarAbono", e);
  }
}

/**
 * API Pública: Obtener terceros ACTIVOS (o todos si se usa otra lógica interna, aquí expuesta filtrada)
 */
function getTerceros(filtroTipo = null) {
  try {
    AuthService.checkPermission("ver_terceros");
    const resultado = CACHE.getTerceros();
    if (filtroTipo) {
      return resultado.filter(t => t.tipo === filtroTipo.toUpperCase());
    }
    return resultado;
  } catch (e) {
    return _safeError("getTerceros", e);
  }
}

/**
 * API Pública: Obtener cartera con filtros
 */
function getCartera(filtroTipo = null, filtroEstado = null, pageSize = 5000, pageToken = 0) {
  try {
    AuthService.checkPermission("ver_cartera");
    
    const result = DOMAIN.getCartera(filtroTipo, filtroEstado, pageSize, pageToken);
    
    if (!result || typeof result !== 'object') {
      Logger.log("ERROR getCartera: resultado inválido de DOMAIN.getCartera: " + JSON.stringify(result));
      return { items: [], nextPageToken: null, error: "Error al obtener cartera. Intente de nuevo." };
    }
    
    return result;
  } catch (e) {
    Logger.log("ERROR getCartera: " + e.toString());
    return { items: [], nextPageToken: null, error: _safeError("getCartera", e).error };
  }
}

/**
 * API Pública: Guardar tercero
 */
function saveTercero(tercero) {
  try {
    RATE_LIMITER.check("saveTercero");
    AuthService.checkPermission("guardar_tercero");
    return DOMAIN.saveTercero(tercero);
  } catch (e) {
    return _safeError("saveTercero", e);
  }
}

/**
 * API Pública: Obtener Dashboard
 */
function getDashboardCartera() {
  try {
    AuthService.checkPermission("ver_dashboard");

    // === INICIO FIX M-05 ===
    // Ensure cache is fresh
    CACHE.refresh();

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

      var prox7 = DOMAIN.getVencimientosProximos(7);
      var prox15 = DOMAIN.getVencimientosProximos(15);
      var prox30 = DOMAIN.getVencimientosProximos(30);

      var suma7 = 0, suma15 = 0, suma30 = 0;
      for (var i7 = 0; i7 < prox7.length; i7++) suma7 += prox7[i7].saldo;
      for (var i15 = 0; i15 < prox15.length; i15++) suma15 += prox15[i15].saldo;
      for (var i30 = 0; i30 < prox30.length; i30++) suma30 += prox30[i30].saldo;

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

    var prox7 = DOMAIN.getVencimientosProximos(7);
    var prox15 = DOMAIN.getVencimientosProximos(15);
    var prox30 = DOMAIN.getVencimientosProximos(30);

    var suma7 = 0, suma15 = 0, suma30 = 0;
    for (var i7 = 0; i7 < prox7.length; i7++) suma7 += prox7[i7].saldo;
    for (var i15 = 0; i15 < prox15.length; i15++) suma15 += prox15[i15].saldo;
    for (var i30 = 0; i30 < prox30.length; i30++) suma30 += prox30[i30].saldo;

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
    // === FIN FIX M-05 ===
  } catch (e) {
    return _safeError("getDashboardCartera", e);
  }
}

/**
 * API Pública: Obtener historial de auditoría
 */
function getAuditHistory(tabla, idRegistro, limit = 50) {
  try {
    AuthService.checkPermission("ver_auditoria");
    return LOG_ENGINE.getHistory(tabla, idRegistro, limit);
  } catch (e) {
    return _safeError("getAuditHistory", e);
  }
}

/**
 * API Pública: Obtener estado de la caché (staleness info)
 */
function getCacheHealth() {
  try {
    AuthService.checkPermission("ver_cache");
    return {
      staleness: CACHE.getStalenessInfo(),
      consistency: CACHE.verifyConsistency(),
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return _safeError("getCacheHealth", e);
  }
}

/**
 * API Pública: Forzar análisis fresco (sin caché de IA)
 */
function analizarConGeminiFresco() {
  try {
    RATE_LIMITER.check("analizarGemini");
    AuthService.checkPermission("analizar_ia");
    return IA_SERVICE.ejecutarAnalisisFresco();
  } catch (e) {
    return _safeError("analizarConGeminiFresco", e);
  }
}

/**
 * API Pública: Obtener información del usuario actual (email y rol)
 */
function getUserInfo() {
  try {
    AuthService.checkPermission("ver_dashboard");
    const email = Session.getActiveUser().getEmail();
    if (!email || !email.includes("@")) {
      throw new Error("No se pudo verificar la identidad del usuario");
    }
    const role = AuthService.getUserRole(email);
    return { email: email, role: role };
  } catch (e) {
    return _safeError("getUserInfo", e);
  }
}

/**
 * API Pública: Procesar venta (contado o crédito)
 */
function procesarVenta(carrito, opciones) {
  try {
    RATE_LIMITER.check("procesarVenta");
    AuthService.checkPermission("registrar_venta");
    return procesarVentaV2(carrito, opciones);
  } catch (e) {
    return _safeError("procesarVenta", e);
  }
}

/**
 * API Pública: Obtener productos desde la hoja Productos
 */
function getProductos() {
  try {
    AuthService.checkPermission("revisar_inventario");
    validateAndMapSchemas();
    const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
    const data = sheet.getDataRange().getValues();
    const COL = CONFIG.COLUMNS.PRODUCTOS;
    const productos = [];
    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][COL.id] || "").trim();
      const nombre = String(data[i][COL.nombre] || "").trim();
      if (!id || !nombre) continue;
      productos.push({
        id: id,
        nombre: nombre,
        stock: parseInt(data[i][COL.stock]) || 0,
        precio: parseFloat(data[i][COL.precio]) || 0,
      });
    }
    return productos;
  } catch (e) {
    return _safeError("getProductos", e);
  }
}

/**
 * API Pública: Obtener historial de ventas del día
 */
function getVentasDelDia() {
  try {
    const sheetAudit = getSheet(CARTERA_CONFIG.SHEETS.AUDIT_LOG);
    if (!sheetAudit) return { success: true, ventas: [], total: 0 };

    const data = sheetAudit.getDataRange().getValues();
    const COL = CARTERA_CONFIG.COLUMNS.AUDIT_LOG;
    
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0]; // YYYY-MM-DD

    const ventas = data.slice(1)
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
    
    return { success: true, ventas, total };
  } catch (e) {
    Logger.log("ERROR getVentasDelDia: " + e.toString());
    return { success: false, ventas: [], total: 0, error: e.message };
  }
}

/**
 * API Pública: Verificar configuración de IA
 */
function verificarConfiguracionIA() {
  try {
    const checks = {
      geminiKeyConfigured: false,
      proxyConfigured: false,
      error: null,
    };
    
    // Check proxy
    const proxyUrl = PropertiesService.getScriptProperties().getProperty("SECRET_PROXY_URL");
    checks.proxyConfigured = !!proxyUrl;
    
    // Check Gemini API key
    try {
      const key = AuthService.getApiKey("GEMINI_API_KEY");
      checks.geminiKeyConfigured = !!key;
    } catch (keyErr) {
      checks.error = "GEMINI_API_KEY error: " + keyErr.message;
    }
    
    return { success: true, checks };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * API Pública: Diagnóstico avanzado de cartera
 */
function getCarteraDebug(filtroTipo, filtroEstado) {
  try {
    return Main_getCarteraDebug(filtroTipo || null, filtroEstado || null);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ════════════════════════════════════════════
// FASE 2: MÓDULO DE COMPRAS
// ════════════════════════════════════════════

function registrarCompra(proveedorId, items, total, fechaVencimiento, factura) {
  try {
    RATE_LIMITER.check("registrarCompra");
    AuthService.checkPermission("registrar_compra");
    return DOMAIN.registrarCompraAtomic(proveedorId, items, total, fechaVencimiento, factura);
  } catch (e) {
    return _safeError("registrarCompra", e);
  }
}

function getCompras(filtroProveedor, filtroEstado) {
  try {
    AuthService.checkPermission("ver_compras");
    CACHE.refresh();
    var compras = DAO_COMPRAS.getCompras(filtroProveedor || null, filtroEstado || null);
    var tercerosMap = {};
    if (CACHE.terceros) {
      CACHE.terceros.forEach(function(t) { tercerosMap[t.id] = t.nombre; });
    }
    compras.forEach(function(c) {
      c.nombre_proveedor = tercerosMap[c.id_proveedor] || "DESCONOCIDO";
    });
    return { success: true, items: compras };
  } catch (e) {
    return _safeError("getCompras", e);
  }
}

function getDetalleCompra(idCompra) {
  try {
    AuthService.checkPermission("ver_compras");
    var detalles = DAO_COMPRAS.getDetallesByCompra(idCompra);
    var pagos = DAO_COMPRAS.getPagosByCompra(idCompra);
    return { success: true, detalles: detalles, pagos: pagos };
  } catch (e) {
    return _safeError("getDetalleCompra", e);
  }
}

function registrarPagoProveedor(idCompra, monto, referencia) {
  try {
    RATE_LIMITER.check("registrarPagoProveedor");
    AuthService.checkPermission("registrar_pago_proveedor");
    return DOMAIN.procesarPagoProveedorAtomic(idCompra, monto, referencia);
  } catch (e) {
    return _safeError("registrarPagoProveedor", e);
  }
}

// ════════════════════════════════════════════
// FASE 3: REPORTES AVANZADOS
// ════════════════════════════════════════════

function getProximosVencimientos(dias) {
  try {
    AuthService.checkPermission("ver_vencimientos");
    if (dias === null || dias === undefined) dias = 30;
    dias = Math.max(1, Math.min(365, parseInt(dias) || 30));
    var result = DOMAIN.getVencimientosProximos(dias);
    var suma = 0;
    for (var i = 0; i < result.length; i++) { suma += result[i].saldo; }
    return { success: true, items: result, total: suma, dias: dias };
  } catch (e) {
    return _safeError("getProximosVencimientos", e);
  }
}

function getRankingDeudores(topN) {
  try {
    AuthService.checkPermission("ver_dashboard");
    if (topN === null || topN === undefined) topN = 10;
    var result = DOMAIN.getRankingDeudores(topN);
    return { success: true, items: result };
  } catch (e) {
    return _safeError("getRankingDeudores", e);
  }
}

function getConcentracionProveedores() {
  try {
    AuthService.checkPermission("ver_dashboard");
    return DOMAIN.getConcentracionProveedores();
  } catch (e) {
    return _safeError("getConcentracionProveedores", e);
  }
}

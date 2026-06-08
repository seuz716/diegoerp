/**
 * LAYER 6.0: PUBLIC API
 * Exposición de endpoints para ser llamados externamente o desde el Frontend.
 */

/**
 * API Pública: Registrar abono
 */
function registrarAbono(idTercero, valorAbono, referencia, tipo) {
  try {
    AuthService.checkPermission("registrar_abono");
    return DOMAIN.registrarAbonoAtomic(idTercero, valorAbono, referencia, tipo);
  } catch (e) {
    Logger.log("ERROR registrarAbono: " + e.toString());
    throw new Error(e.message || e.toString());
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
    Logger.log("ERROR getTerceros:" + e.toString());
    throw new Error(e.message || e.toString());
  }
}

/**
 * API Pública: Obtener cartera con filtros
 */
function getCartera(filtroTipo = null, filtroEstado = null, pageSize = 5000, pageToken = 0) {
  try {
    AuthService.checkPermission("ver_cartera");
    return DOMAIN.getCartera(filtroTipo, filtroEstado, pageSize, pageToken);
  } catch (e) {
    Logger.log("ERROR getCartera:" + e.toString());
    throw new Error(e.message || e.toString());
  }
}

/**
 * API Pública: Guardar tercero
 */
function saveTercero(tercero) {
  try {
    AuthService.checkPermission("guardar_tercero");
    return DOMAIN.saveTercero(tercero);
  } catch (e) {
    Logger.log("ERROR saveTercero: " + e.toString());
    throw new Error(e.message || e.toString());
  }
}

/**
 * API Pública: Obtener Dashboard
 */
function getDashboardCartera() {
  try {
    AuthService.checkPermission("ver_dashboard");
    
    let porCobrar = 0;
    let porPagar = 0;
    let vencidaCxC = 0;
    let vencidaCxP = 0;
    let allAlertas = [];
    let totalObligaciones = 0;

    let pageToken = 0;
    const pageSize = 5000;
    let hasMore = true;

    while (hasMore) {
      const page = DOMAIN.getCartera(null, null, pageSize, pageToken);
      const items = page.items || [];
      
      const cxc = items.filter(c => c.tipo === CARTERA_CONFIG.TIPOS.CXC);
      const cxp = items.filter(c => c.tipo === CARTERA_CONFIG.TIPOS.CXP);

      porCobrar += cxc
        .filter(c => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
        .reduce((s, c) => s + c.saldo, 0);

      porPagar += cxp
        .filter(c => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
        .reduce((s, c) => s + c.saldo, 0);

      vencidaCxC += cxc
        .filter(c => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
        .reduce((s, c) => s + c.saldo, 0);

      vencidaCxP += cxp
        .filter(c => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
        .reduce((s, c) => s + c.saldo, 0);

      cxc
        .filter(c => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
        .forEach(c => allAlertas.push({
          id_tercero: c.id_tercero,
          nombre: c.nombre_tercero,
          saldo: c.saldo,
          dias: c.dias_vencido,
        }));

      totalObligaciones += cxc.length + cxp.length;

      if (page.nextPageToken !== null && page.nextPageToken !== undefined) {
        pageToken = page.nextPageToken;
      } else {
        hasMore = false;
      }
    }

    const alertas = allAlertas
      .sort((a, b) => b.dias - a.dias)
      .slice(0, 10);

    return {
      porCobrar,
      porPagar,
      vencidaCxC,
      vencidaCxP,
      alertas,
      totalObligaciones,
    };
  } catch (e) {
    console.error("ERROR getDashboardCartera:" + e.toString());
    throw new Error(e.message || e.toString());
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
    Logger.log("ERROR getAuditHistory: " + e.toString());
    throw new Error(e.message || e.toString());
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
    Logger.log("ERROR getCacheHealth: " + e.toString());
    throw new Error(e.message || e.toString());
  }
}

/**
 * API Pública: Forzar análisis fresco (sin caché de IA)
 */
function analizarConGeminiFresco() {
  try {
    AuthService.checkPermission("analizar_ia");
    return IA_SERVICE.ejecutarAnalisisFresco();
  } catch (e) {
    Logger.log("ERROR analizarConGeminiFresco: " + e.toString());
    throw new Error(e.message || e.toString());
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
    Logger.log("ERROR getUserInfo: " + e.toString());
    throw new Error(e.message || e.toString());
  }
}

/**
 * API Pública: Procesar venta (contado o crédito)
 */
function procesarVenta(carrito, opciones) {
  try {
    AuthService.checkPermission("registrar_venta");
    return procesarVentaV2(carrito, opciones);
  } catch (e) {
    Logger.log("ERROR procesarVenta: " + e.toString());
    throw new Error(e.message || e.toString());
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
    Logger.log("ERROR getProductos: " + e.toString());
    return [];
  }
}

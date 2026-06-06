/**
 * LAYER 6: PUBLIC API
 * Exposición de endpoints para ser llamados externamente o desde el Frontend.
 */

/**
 * API Pública: Registrar abono
 */
function registrarAbono(idTercero, valorAbono, referencia, tipo) {
  AuthService.checkPermission("registrar_abono");
  return DOMAIN.registrarAbonoAtomic(idTercero, valorAbono, referencia, tipo);
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
function getCartera(filtroEstado = null, filtroTipo = null) {
  try {
    AuthService.checkPermission("ver_cartera");
    return DOMAIN.getCartera(filtroEstado, filtroTipo);
  } catch (e) {
    Logger.log("ERROR getCartera:" + e.toString());
    throw new Error(e.message || e.toString());
  }
}

/**
 * API Pública: Guardar tercero
 */
function saveTercero(tercero) {
  AuthService.checkPermission("guardar_tercero");
  return DOMAIN.saveTercero(tercero);
}

/**
 * API Pública: Obtener Dashboard
 */
function getDashboardCartera() {
  try {
    AuthService.checkPermission("ver_dashboard");
    const cartera = DOMAIN.getCartera();
    // const hoy = _today(); // disponible para filtrar por fecha si se necesita

    const cxc = cartera.filter(c => c.tipo === CARTERA_CONFIG.TIPOS.CXC);
    const cxp = cartera.filter(c => c.tipo === CARTERA_CONFIG.TIPOS.CXP);

    const porCobrar = cxc
      .filter(c => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
      .reduce((s, c) => s + c.saldo, 0);

    const porPagar = cxp
      .filter(c => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
      .reduce((s, c) => s + c.saldo, 0);

    const vencidaCxC = cxc
      .filter(c => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
      .reduce((s, c) => s + c.saldo, 0);

    const vencidaCxP = cxp
      .filter(c => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
      .reduce((s, c) => s + c.saldo, 0);

    const alertas = cxc
      .filter(c => c.estado === CARTERA_CONFIG.ESTADOS.VENCIDA)
      .sort((a, b) => b.dias_vencido - a.dias_vencido)
      .slice(0, 10)
      .map(c => ({
        id_tercero: c.id_tercero,
        nombre: c.nombre_tercero,
        saldo: c.saldo,
        dias: c.dias_vencido,
      }));

    return {
      porCobrar,
      porPagar,
      vencidaCxC,
      vencidaCxP,
      alertas,
      totalObligaciones: cxc.length + cxp.length,
    };
  } catch (e) {
    Logger.log("ERROR getDashboardCartera:" + e.toString());
    return {
      porCobrar: 0,
      porPagar: 0,
      vencidaCxC: 0,
      vencidaCxP: 0,
      alertas: [],
      totalObligaciones: 0,
    };
  }
}

/**
 * API Pública: Obtener historial de auditoría
 */
function getAuditHistory(tabla, idRegistro, limit = 50) {
  AuthService.checkPermission("ver_auditoria");
  return LOG_ENGINE.getHistory(tabla, idRegistro, limit);
}

/**
 * API Pública: Obtener estado de la caché (staleness info)
 */
function getCacheHealth() {
  AuthService.checkPermission("ver_cache");
  return {
    staleness: CACHE.getStalenessInfo(),
    consistency: CACHE.verifyConsistency(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * API Pública: Forzar análisis fresco (sin caché de IA)
 */
function analizarConGeminiFresco() {
  AuthService.checkPermission("analizar_ia");
  return IA_SERVICE.ejecutarAnalisisFresco();
}

/**
 * API Pública: Obtener información del usuario actual (email y rol)
 */
function getUserInfo() {
  AuthService.checkPermission("ver_dashboard");
  const email = Session.getActiveUser().getEmail();
  const role = AuthService.getUserRole(email);
  return { email: email, role: role };
}

/**
 * API Pública: Procesar venta (contado o crédito)
 */
function procesarVenta(carrito, opciones) {
  AuthService.checkPermission("registrar_venta");
  return procesarVentaV2(carrito, opciones);
}

/**
 * API Pública: Obtener productos desde la hoja Productos
 */
function getProductos() {
  try {
    AuthService.checkPermission("revisar_inventario");
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

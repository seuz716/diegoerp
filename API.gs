/**
 * LAYER 6: PUBLIC API
 * Exposición de endpoints para ser llamados externamente o desde el Frontend.
 */

/**
 * API Pública: Registrar abono
 */
function registrarAbono(idTercero, valorAbono, referencia, tipo) {
  return DOMAIN.registrarAbonoAtomic(idTercero, valorAbono, referencia, tipo);
}

/**
 * API Pública: Obtener terceros ACTIVOS (o todos si se usa otra lógica interna, aquí expuesta filtrada)
 */
function getTerceros(filtroTipo = null) {
  try {
    const resultado = CACHE.getTerceros();
    if (filtroTipo) {
      return resultado.filter(t => t.tipo === filtroTipo.toUpperCase());
    }
    return resultado;
  } catch (e) {
    Logger.log("ERROR getTerceros:" + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * API Pública: Obtener cartera con filtros
 */
function getCartera(filtroEstado = null, filtroTipo = null) {
  try {
    return DOMAIN.getCartera(filtroTipo, filtroEstado);
  } catch (e) {
    Logger.log("ERROR getCartera:" + e.toString());
    return { success: false, message: e.toString() };
  }
}

/**
 * API Pública: Guardar tercero
 */
function saveTercero(tercero) {
  return DOMAIN.saveTercero(tercero);
}

/**
 * API Pública: Obtener Dashboard
 */
function getDashboardCartera() {
  try {
    const cartera = DOMAIN.getCartera();
    const hoy = _today();

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
  return LOG_ENGINE.getHistory(tabla, idRegistro, limit);
}

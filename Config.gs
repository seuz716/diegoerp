/**
 * LAYER 1: CONFIG + UTILIDADES BASE
 */

const CARTERA_CONFIG = {
  SHEETS: {
    TERCEROS: "Terceros",
    CARTERA: "Cartera",
    MOV_CARTERA: "Movimientos_Cartera",
    AUDIT_LOG: "AUDIT_LOG",
  },
  COLUMNS: {
    TERCEROS:    { id: 0, nombre: 1, telefono: 2, tipo: 3, limite_credito: 4, activo: 5 },
    CARTERA:     { id: 0, fecha: 1, id_tercero: 2, origen_id: 3, total: 4, saldo: 5, tipo: 6, estado: 7, fecha_vencimiento: 8 },
    MOV_CARTERA: { id: 0, fecha: 1, id_cartera: 2, id_tercero: 3, valor: 4, tipo_mov: 5, referencia: 6 },
    AUDIT_LOG:   { id: 0, timestamp: 1, operacion: 2, tabla: 3, id_registro: 4, usuario: 5, datos_previos: 6, datos_nuevos: 7, estado: 8 },
  },
  ESTADOS: { ABIERTA: "ABIERTA", PARCIAL: "PARCIAL", CANCELADA: "CANCELADA", VENCIDA: "VENCIDA" },
  TIPOS:   { CXC: "CxC", CXP: "CxP" },
};

// ─ UTILIDADES BÁSICAS ─

/**
 * Obtiene una hoja de cálculo por nombre
 * Resuelve Problema #1: VIOLACIÓN SEPARACIÓN DE CAPAS
 */
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function _sanitizeId(id) { return String(id || "").trim(); }

function _parseMoneda(v, defaultVal) {
  const n = parseInt(v, 10);
  return (isNaN(n) ? (typeof defaultVal === 'number' ? defaultVal : NaN) : n);
}

function _isValidDate(d) { return d instanceof Date && !isNaN(d.getTime()); }

function _error(msg) { return { success: false, message: String(msg || "Error desconocido"), code: "ERROR" }; }

function _safeDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  return _isValidDate(d) ? d : new Date(0);
}

function _formatMoneda(centavos) {
  return (centavos / 100).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

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
    CARTERA:     { id: 0, fecha: 1, id_tercero: 2, origen_id: 3, total: 4, saldo: 5, tipo: 6, estado: 7, fecha_vencimiento: 8, vencida_timestamp: 9 },
    MOV_CARTERA: { id: 0, fecha: 1, id_cartera: 2, id_tercero: 3, valor: 4, tipo_mov: 5, referencia: 6 },
    AUDIT_LOG:   { id: 0, timestamp: 1, operacion: 2, tabla: 3, id_registro: 4, usuario: 5, datos_previos: 6, datos_nuevos: 7, estado: 8 },
  },
  ESTADOS: { ABIERTA: "ABIERTA", PARCIAL: "PARCIAL", CANCELADA: "CANCELADA", VENCIDA: "VENCIDA" },
  TIPOS:   { CXC: "CxC", CXP: "CxP" },
};

const CONFIG = {
  SHEETS: {
    PRODUCTOS: "Productos",
  },
  COLUMNS: {
    PRODUCTOS: { id: 0, nombre: 1, stock: 2, precio: 3 },
  },
  STOCK_MINIMO: 5,
};

const ROLES = {
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
};

const ROLE_HIERARCHY = { ADMIN: 3, OPERATOR: 2, VIEWER: 1 };

// ─ UTILIDADES BÁSICAS ─

// Cache global para objetos Sheet
let _SHEETS_CACHE = {};

/**
 * Obtiene una hoja de cálculo por nombre, utilizando un caché.
 * Resuelve Problema #1: VIOLACIÓN SEPARACIÓN DE CAPAS
 * Resuelve Problema #5: getSheet() sin cacheo del objeto Sheet
 */
function getSheet(name) {
  if (!_SHEETS_CACHE[name]) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    _SHEETS_CACHE[name] = spreadsheet.getSheetByName(name);
    if (!_SHEETS_CACHE[name]) {
      console.error("Error: Hoja no encontrada: " + name);
      throw new Error("Hoja no encontrada: " + name);
    }
  }
  return _SHEETS_CACHE[name];
}

function _sanitizeId(id) { return String(id || "").trim(); }

/**
 * Convierte un valor del sheet a centavos (entero).
 * Usa parseInt porque el sheet almacena montos en centavos sin decimales.
 */
function _parseMoneda(v, defaultVal) {
  const n = parseInt(v, 10);
  return isNaN(n) ? (defaultVal || 0) : n;
}

function _isValidDate(d) { return d instanceof Date && !isNaN(d.getTime()); }

function _error(msg) { return { success: false, message: String(msg || "Error desconocido"), code: "ERROR" }; }

function _getTimeZone() {
  try {
    return Session.getScriptTimeZone() || SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  } catch (e) {
    return 'UTC';
  }
}

function _today() {
  const tz = _getTimeZone();
  const s = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return new Date(s + 'T00:00:00');
}

/**
 * Normaliza un valor a la fecha (medianoche) en la zona horaria del script/spreadsheet.
 * Devuelve Date(0) si no es una fecha válida.
 */
function _safeDate(v) {
  try {
    const tz = _getTimeZone();
    const d = v instanceof Date ? v : new Date(v);
    if (!_isValidDate(d)) return new Date(0);
    const s = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    return new Date(s + 'T00:00:00');
  } catch (e) {
    return new Date(0);
  }
}

/**
 * Formatea centavos a moneda COP para display.
 * Divide por 100 porque el sheet almacena valores en centavos (enteros).
 */
function _formatMoneda(centavos) {
  return (centavos / 100).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}



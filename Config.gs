/**
 * LAYER 1: CONFIG + UTILIDADES BASE
 * v2.5.1 - Load order fixed via filePushOrder
 */

/** Configuración de copias de seguridad automatizadas. */
const BACKUP_CONFIG = {
  FOLDER_NAME: "MicroERP_Backups",
  EXPORT_FOLDER_NAME: "MicroERP_Exportaciones",
  MAX_BACKUPS: 7,
  BACKUP_SHEETS: [],
};

const CARTERA_CONFIG = {
  SHEETS: {
    TERCEROS: "Terceros",
    CARTERA: "Cartera",
    MOV_CARTERA: "Movimientos_Cartera",
    AUDIT_LOG: "AUDIT_LOG",
  },
  COLUMNS: {
    TERCEROS:    { id: 0, nombre: 1, telefono: 2, tipo: 3, limite_credito: 4, activo: 5 },
    CARTERA:     { id: 0, fecha: 1, id_tercero: 2, origen_id: 3, total: 4, saldo: 5, tipo: 6, estado: 7, fecha_vencimiento: 8, vencida_timestamp: 9, version: 10 },
    MOV_CARTERA: { id: 0, fecha: 1, id_cartera: 2, id_tercero: 3, valor: 4, tipo_mov: 5, referencia: 6 },
    AUDIT_LOG:   { id: 0, timestamp: 1, operacion: 2, tabla: 3, id_registro: 4, usuario: 5, datos_previos: 6, datos_nuevos: 7, estado: 8 },
  },
  ESTADOS: { ABIERTA: "ABIERTA", PARCIAL: "PARCIAL", CANCELADA: "CANCELADA", VENCIDA: "VENCIDA" },
  TIPOS:   { CXC: "CxC", CXP: "CxP" },
};

/** Tipos de tercero (CLIENTE, PROVEEDOR, AMBOS) con lista de válidos. */
const TIPO_TERCERO = {
  CLIENTE: "CLIENTE",
  PROVEEDOR: "PROVEEDOR",
  AMBOS: "AMBOS",
  VALIDOS: ["CLIENTE", "PROVEEDOR", "AMBOS"],
};

/** Configuración de la hoja de vinculación producto-proveedor. */
const PRODUCTO_PROVEEDOR_CONFIG = {
  SHEET: "Producto_Proveedor",
  COLUMNS: {
    idProducto: 0,
    idProveedor: 1,
    precioUltimaCompra: 2,
    esPreferido: 3,
    fechaUltimaCompra: 4,
  },
};

const COMPRAS_CONFIG = {
  SHEETS: {
    COMPRAS: "Compras",
    DETALLE_COMPRAS: "Detalle_Compras",
    PAGOS_PROVEEDORES: "Pagos_Proveedores",
    KARDEX: "Kardex_Movilizaciones",
  },
  COLUMNS: {
    COMPRAS: { id: 0, fecha: 1, id_proveedor: 2, id_factura: 3, total: 4, saldo: 5, estado: 6, fecha_vencimiento: 7, vencida_timestamp: 8, version: 9 },
    DETALLE_COMPRAS: { id: 0, id_compra: 1, id_producto: 2, cantidad: 3, precio_unitario: 4, subtotal: 5 },
    PAGOS_PROVEEDORES: { id: 0, fecha: 1, id_compra: 2, id_proveedor: 3, valor: 4, referencia: 5, metodo_pago: 6 },
    KARDEX: { id: 0, fecha: 1, id_producto: 2, tipo_mov: 3, cantidad: 4, stock_anterior: 5, stock_nuevo: 6, referencia: 7, origen: 8, usuario: 9, costo_unitario: 10, precio_unitario: 11 },
  },
  ESTADOS: { ABIERTA: "PENDIENTE", PARCIAL: "PARCIAL", PAGADA: "PAGADA", CANCELADA: "CANCELADA" },
};

/** Configuración de la hoja de productos. */
const PRODUCTOS_CONFIG = {
  SHEET: "Productos",
  ESTADOS_PRODUCTO: { ACTIVO: "ACTIVO", INACTIVO: "INACTIVO" },
};

/**
 * Configuración de concurrencia para LockManager.
 * Estos valores son defaults; pueden overridearse vía LOCK_OVERRIDE_* en PropertiesService.
 * @see LockManager.gs
 */
const LOCK_CONFIG = {
  GLOBAL_TIMEOUT: 60000,
  MAX_RETRIES: 4,
  BASE_BACKOFF: 500,
  RESOURCE_LOCK_WAIT: 1500,
  RESOURCE_LOCK_TIMEOUT: 60000,
  RESOURCE_TTL_MS: 45000,
  RESOURCE_LOCK_MAX_TTL_MS: 120000,
  PROPAGATION_DELAY_MS: 50,
};

const CONFIG = {
  SHEETS: {
    PRODUCTOS: "Productos",
    LIBRO_DIARIO: "Libro_Diario",
    FLUJO_CAJA: "Flujo_Caja",
  },
  COLUMNS: {
    PRODUCTOS: { id: 0, nombre: 1, stock: 2, precio_compra: 3, precio_venta: 4, categoria: 5, activo: 6, fecha_creacion: 7, version: 8 },
    LIBRO_DIARIO: { id: 0, fecha: 1, tipo: 2, id_referencia: 3, tercero: 4, monto: 5, usuario: 6, descripcion: 7 },
    FLUJO_CAJA: { id: 0, fecha: 1, tipo: 2, concepto: 3, monto: 4, referencia: 5, usuario: 6 },
  },
  STOCK_MINIMO: 5,
  MATERIALITY_THRESHOLD: 100000, // 1,000 COP en centavos
  SCHEMA_definitions: {
    TERCEROS: { id: "ID", nombre: "Nombre", telefono: "Teléfono", tipo: "Tipo", limite_credito: "Límite_Crédito", activo: "Activo" },
    CARTERA: { id: "ID", fecha: "Fecha", id_tercero: "ID_Tercero", origen_id: "Origen_ID", total: "Total", saldo: "Saldo", tipo: "Tipo", estado: "Estado", fecha_vencimiento: "Fecha_Vencimiento", vencida_timestamp: "Vencida_Timestamp", version: "Version" },
    MOV_CARTERA: { id: "ID", fecha: "Fecha", id_cartera: "ID_Cartera", id_tercero: "ID_Tercero", valor: "Valor", tipo_mov: "Tipo_Mov", referencia: "Referencia" },
    AUDIT_LOG: { id: "ID", timestamp: "Timestamp", operacion: "Operacion", tabla: "Tabla", id_registro: "ID_Registro", usuario: "Usuario", datos_previos: "Datos_Previos", datos_nuevos: "Datos_Nuevos", estado: "Estado" },
    PRODUCTOS: { id: "ID", nombre: "Nombre", stock: "Stock", precio_compra: "Precio_Compra", precio_venta: "Precio_Venta", categoria: "Categoria", activo: "Activo", fecha_creacion: "Fecha_Creacion", version: "Version" },
    COMPRAS: { id: "ID", fecha: "Fecha", id_proveedor: "ID_Proveedor", id_factura: "ID_Factura", total: "Total", saldo: "Saldo", estado: "Estado", fecha_vencimiento: "Fecha_Vencimiento", vencida_timestamp: "Vencida_Timestamp", version: "Version" },
    DETALLE_COMPRAS: { id: "ID", id_compra: "ID_Compra", id_producto: "ID_Producto", cantidad: "Cantidad", precio_unitario: "Precio_Unitario", subtotal: "Subtotal" },
    PAGOS_PROVEEDORES: { id: "ID", fecha: "Fecha", id_compra: "ID_Compra", id_proveedor: "ID_Proveedor", valor: "Valor", referencia: "Referencia", metodo_pago: "Metodo_Pago" },
    KARDEX: { id: "ID", fecha: "Fecha", id_producto: "ID_Producto", tipo_mov: "Tipo_Mov", cantidad: "Cantidad", stock_anterior: "Stock_Anterior", stock_nuevo: "Stock_Nuevo", referencia: "Referencia", origen: "Origen", usuario: "Usuario", costo_unitario: "Costo_Unitario", precio_unitario: "Precio_Unitario" },
    LIBRO_DIARIO: { id: "ID", fecha: "Fecha", tipo: "Tipo", id_referencia: "ID_Referencia", tercero: "Tercero", monto: "Monto", usuario: "Usuario", descripcion: "Descripcion" },
    FLUJO_CAJA: { id: "ID", fecha: "Fecha", tipo: "Tipo", concepto: "Concepto", monto: "Monto", referencia: "Referencia", usuario: "Usuario" },
    PRODUCTO_PROVEEDOR: { idProducto: "ID_Producto", idProveedor: "ID_Proveedor", precioUltimaCompra: "Precio_Ultima_Compra", esPreferido: "Es_Preferido", fechaUltimaCompra: "Fecha_Ultima_Compra" },
  },
};



// ─ GLOBALES DE ESQUEMA ─

let _schemaVersion = 0;
let _schemaValidated = false;

function _loadSchemaVersion() {
  try {
    const props = PropertiesService.getScriptProperties();
    const stored = props.getProperty('SCHEMA_VERSION');
    if (stored) {
      _schemaVersion = Number(stored);
      return _schemaVersion;
    }
  } catch (e) {
    Logger.log("Error loading schema version: " + e.toString());
  }
  return 0;
}

function _saveSchemaVersion(version) {
  try {
    PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', String(version));
  } catch (e) {
    Logger.log("Error saving schema version: " + e.toString());
  }
}

_schemaVersion = _loadSchemaVersion();

// TTL para cache de schema (5 minutos)
const SHEET_CACHE_TTL = 300;

/** Nombres de hojas — única fuente de verdad. */
const SHEET_NAMES = {
  REQUIRED: ['Terceros', 'Cartera', 'Movimientos_Cartera', 'AUDIT_LOG', 'Productos'],
  OPTIONAL: ['Compras', 'Detalle_Compras', 'Pagos_Proveedores', 'Kardex_Movilizaciones', 'Libro_Diario', 'Flujo_Caja', 'Producto_Proveedor'],
};
SHEET_NAMES.ALL = SHEET_NAMES.REQUIRED.concat(SHEET_NAMES.OPTIONAL);
SHEET_NAMES.CRITICAL = SHEET_NAMES.ALL.slice();
SHEET_NAMES.ALL_NAMES = SHEET_NAMES.ALL;

BACKUP_CONFIG.BACKUP_SHEETS = SHEET_NAMES.ALL.slice();

/**
 * Obtiene el spreadsheet activo.
 * Usa PropertiesService para ID configurado, fallback a hoja vinculada.
 * Nota: No cacheamos el objeto SpreadsheetApp (evita stale references en GAS).
 */
function getActiveSpreadsheet() {
  const ssId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  
  if (ssId) {
    return SpreadsheetApp.openById(ssId);
  }
  
  // Fallback para desarrollo: hoja vinculada al script
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error("No spreadsheet available");
    Logger.log("[DEV MODE] Usando spreadsheet vinculada. Para producción, configurar SPREADSHEET_ID vía generateSetupToken().");
    return ss;
  } catch (err) {
    throw new Error("SPREADSHEET_ID no configurado. Ejecutar generateSetupToken() desde el editor.");
  }
}

/**
 * Obtiene una hoja de cálculo por nombre.
 * Nota: No cacheamos objetos Sheet (pueden volverse stale), llamamos directo a SpreadsheetApp.
 */
function getSheet(name) {
  const spreadsheet = getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    throw new Error("Hoja no encontrada: " + name);
  }
  return sheet;
}


/** Cache de columnas mutables para reloadSchema. Se clona de const en init. */
var _MUTABLE_COLUMNS = null;

/**
 * Inicializa _MUTABLE_COLUMNS clonando las configs const.
 * reloadSchema muta estas copias en vez de los objetos originales.
 */
function _initMutableColumns() {
  if (_MUTABLE_COLUMNS) return;
  _MUTABLE_COLUMNS = {};
  function clone(obj) {
    var c = {};
    for (var k in obj) { if (obj.hasOwnProperty(k)) c[k] = obj[k]; }
    return c;
  }
  _MUTABLE_COLUMNS.TERCEROS = clone(CARTERA_CONFIG.COLUMNS.TERCEROS);
  _MUTABLE_COLUMNS.CARTERA = clone(CARTERA_CONFIG.COLUMNS.CARTERA);
  _MUTABLE_COLUMNS.MOV_CARTERA = clone(CARTERA_CONFIG.COLUMNS.MOV_CARTERA);
  _MUTABLE_COLUMNS.AUDIT_LOG = clone(CARTERA_CONFIG.COLUMNS.AUDIT_LOG);
  _MUTABLE_COLUMNS.PRODUCTOS = clone(CONFIG.COLUMNS.PRODUCTOS);
  _MUTABLE_COLUMNS.COMPRAS = clone(COMPRAS_CONFIG.COLUMNS.COMPRAS);
  _MUTABLE_COLUMNS.DETALLE_COMPRAS = clone(COMPRAS_CONFIG.COLUMNS.DETALLE_COMPRAS);
  _MUTABLE_COLUMNS.PAGOS_PROVEEDORES = clone(COMPRAS_CONFIG.COLUMNS.PAGOS_PROVEEDORES);
  _MUTABLE_COLUMNS.KARDEX = clone(COMPRAS_CONFIG.COLUMNS.KARDEX);
  _MUTABLE_COLUMNS.LIBRO_DIARIO = clone(CONFIG.COLUMNS.LIBRO_DIARIO);
  _MUTABLE_COLUMNS.FLUJO_CAJA = clone(CONFIG.COLUMNS.FLUJO_CAJA);
  _MUTABLE_COLUMNS.PRODUCTO_PROVEEDOR = clone(PRODUCTO_PROVEEDOR_CONFIG.COLUMNS);
}

/**
 * Mapea nombre de hoja → { conf, key } para recorrer schemas.
 * conf apunta a _MUTABLE_COLUMNS para evitar mutar const (CFG-004).
 * @returns {Object<string, {conf: Object, key: string}>}
 */
function _getSheetsMapping() {
  _initMutableColumns();
  return {
    [CARTERA_CONFIG.SHEETS.TERCEROS]: { conf: _MUTABLE_COLUMNS, key: 'TERCEROS' },
    [CARTERA_CONFIG.SHEETS.CARTERA]: { conf: _MUTABLE_COLUMNS, key: 'CARTERA' },
    [CARTERA_CONFIG.SHEETS.MOV_CARTERA]: { conf: _MUTABLE_COLUMNS, key: 'MOV_CARTERA' },
    [CARTERA_CONFIG.SHEETS.AUDIT_LOG]: { conf: _MUTABLE_COLUMNS, key: 'AUDIT_LOG' },
    [CONFIG.SHEETS.PRODUCTOS]: { conf: _MUTABLE_COLUMNS, key: 'PRODUCTOS' },
    [COMPRAS_CONFIG.SHEETS.COMPRAS]: { conf: _MUTABLE_COLUMNS, key: 'COMPRAS' },
    [COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS]: { conf: _MUTABLE_COLUMNS, key: 'DETALLE_COMPRAS' },
    [COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES]: { conf: _MUTABLE_COLUMNS, key: 'PAGOS_PROVEEDORES' },
    [COMPRAS_CONFIG.SHEETS.KARDEX]: { conf: _MUTABLE_COLUMNS, key: 'KARDEX' },
    [CONFIG.SHEETS.LIBRO_DIARIO]: { conf: _MUTABLE_COLUMNS, key: 'LIBRO_DIARIO' },
    [CONFIG.SHEETS.FLUJO_CAJA]: { conf: _MUTABLE_COLUMNS, key: 'FLUJO_CAJA' },
    [PRODUCTO_PROVEEDOR_CONFIG.SHEET]: { conf: _MUTABLE_COLUMNS, key: 'PRODUCTO_PROVEEDOR' },
  };
}

// ─ MÉTODOS DE ESQUEMA EN CONFIG ─

CONFIG.reloadSchema = function() {
  const sheets = _getSheetsMapping();

  const spreadsheet = getActiveSpreadsheet();
  const changes = [];

  for (const [sheetName, mapping] of Object.entries(sheets)) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      if (SHEET_NAMES.OPTIONAL.includes(sheetName)) continue;
      throw new Error('Hoja obligatoria "' + sheetName + '" no encontrada.');
    }

    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) continue;

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
    const cache = CacheService.getScriptCache();
    const expected = CONFIG.SCHEMA_definitions[mapping.key];

    cache.put(sheetName + '_meta', JSON.stringify({ lastRow: sheet.getLastRow(), lastCol: lastCol, headers: headers }), SHEET_CACHE_TTL);

    const sheetChanges = { sheet: sheetName, changes: [] };

    for (const [key, expectedName] of Object.entries(expected)) {
      const idx = headers.indexOf(expectedName);
      if (idx === -1) {
        continue;
      }
      var colObj = mapping.conf[mapping.key];
      var oldIdx = colObj[key];
      if (oldIdx !== idx) {
        sheetChanges.changes.push({ key: key, from: oldIdx, to: idx });
      }
      colObj[key] = idx; // mutable clone, no const mutation (CFG-004)
    }

    const expectedNames = Object.values(expected);
    const extraCols = headers.filter(h => h && !expectedNames.includes(h));
    sheetChanges.extraColumns = extraCols;

    if (sheetChanges.changes.length > 0 || extraCols.length > 0) {
      changes.push(sheetChanges);
    }
  }

  _schemaVersion = Date.now();
  _schemaValidated = true;
  _saveSchemaVersion(_schemaVersion);

  return { success: true, changes: changes };
};

CONFIG.isSchemaStale = function(maxAgeMs) {
  if (!_schemaVersion) _loadSchemaVersion();
  if (maxAgeMs === undefined) maxAgeMs = 3600000;
  if (!_schemaVersion) return true;
  if (Date.now() - _schemaVersion > maxAgeMs) return true;

  const cache = CacheService.getScriptCache();
  const allSheets = getActiveSpreadsheet().getSheets();
  const sheetMap = {};
  for (let i = 0; i < allSheets.length; i++) sheetMap[allSheets[i].getName()] = allSheets[i];

  for (const name of SHEET_NAMES.CRITICAL) {
    const sheet = sheetMap[name];
    if (!sheet) continue;
    const metaRaw = cache.get(name + '_meta');
    const meta = metaRaw ? JSON.parse(metaRaw) : null;
    if (!meta) return true;
    if (sheet.getLastRow() !== meta.lastRow || sheet.getLastColumn() !== meta.lastCol) return true;
  }

  return false;
};

CONFIG.getSchemaReport = function() {
  const report = {
    version: _schemaVersion,
    sheetsValidated: [],
    missingColumns: [],
    extraColumns: [],
    columnMappings: {}
  };

  const sheets = _getSheetsMapping();

  for (const [sheetName, mapping] of Object.entries(sheets)) {
    report.sheetsValidated.push(sheetName);
    report.columnMappings[sheetName] = Object.assign({}, mapping.conf[mapping.key]);

    const sheet = getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) continue;
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) continue;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
    const cache = CacheService.getScriptCache();
    const expected = CONFIG.SCHEMA_definitions[mapping.key];
    const expectedNames = Object.values(expected);

    for (const [key, expectedName] of Object.entries(expected)) {
      if (!headers.includes(expectedName)) {
        report.missingColumns.push({ sheet: sheetName, key, expected: expectedName });
      }
    }

    const extra = headers.filter(h => h && !expectedNames.includes(h));
    if (extra.length > 0) {
      report.extraColumns.push({ sheet: sheetName, columns: extra });
    }
  }

  return report;
};

CONFIG.checkHeaderChanges = function() {
  const cache = CacheService.getScriptCache();
  const spreadsheet = getActiveSpreadsheet();
  let changed = false;

  for (const name of SHEET_NAMES.CRITICAL) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) continue;
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) continue;
    const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
    const metaRaw = cache.get(name + '_meta');
    const meta = metaRaw ? JSON.parse(metaRaw) : null;
    if (!meta) {
      _schemaValidated = false;
      changed = true;
      continue;
    }
    if (JSON.stringify(meta.headers) !== JSON.stringify(currentHeaders)) {
      _schemaValidated = false;
      changed = true;
    }
  }

  return changed;
};

// ─ FUNCIÓN LEGACY: DELEGADA A CONFIG.reloadSchema ─

function validateAndMapSchemas() {
  if (_schemaValidated) return;
  CONFIG.reloadSchema();
}

/** Sanitiza un ID: uppercase, solo A-Z0-9_- */
function _sanitizeId(id) { return String(id || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""); }

/**
 * Sanitiza un valor para escritura segura en hoja.
 * Protege contra inyección de fórmulas y caracteres de control.
 * @param {*} v - Valor a sanitizar
 * @returns {string|number|boolean} Valor seguro para hoja
 */
function _sanitizeCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    // Proteger contra fórmulas
    const needsEscape = /^[=+\-@]/.test(v);
    let sanitized = needsEscape ? "'" + v : v;
    // Normalizar whitespace (protege saltos de línea y tabs)
    sanitized = sanitized.replace(/[\u0000-\u001F\u007F]/g, '');
    return sanitized;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    return JSON.stringify(v);
  }
  return String(v);
}

/**
 * Elimina la comilla simple inicial de un valor leído del sheet.
 * Los valores con comilla se usan para prevenir inyección de fórmulas.
 * @param {*} v - Valor a normalizar
 * @returns {*} Valor sin comilla inicial
 */
function _stripLeadingQuote(v) {
  if (typeof v === 'string' && v.length > 1 && v[0] === "'") {
    return v.substring(1);
  }
  return v;
}

/**
 * Convierte un valor del sheet a centavos (entero).
 * Maneja formatos: "100" (número), "1.000" (US), "1.000,00" (español)
 * Divide por 100 si el valor parece tener decimales (ej: "100,50" -> 10050 centavos)
 * @param {*} v - Valor a parsear
 * @param {number} [defaultVal=0] - Valor por defecto si inválido
 * @returns {number} Valor en centavos (entero)
 */
function _parseMoneda(v, defaultVal) {
  if (v === null || v === undefined) return defaultVal || 0;
  let raw = String(v).trim();
  if (raw === "") return defaultVal || 0;
  
  // Detectar formato español: "1.000,50" o "1,50"
  // Si tiene coma como separador decimal y no punto, es formato español
  // Si tiene punto y coma en posición típica de miles, es formato US con coma decimal
  const hasCommaDecimal = /,\d{1,2}$/.test(raw);
  const hasDotDecimal = /\.\d{1,2}$/.test(raw) && !/,\d/.test(raw);
  
  if (hasCommaDecimal) {
    // Formato español: "1.000,50" o "100,50"
    // Remover separadores de miles (puntos), convertir coma decimal a punto
    raw = raw.replace(/\./g, '').replace(/,(\d{1,2})$/, '.$1');
  } else if (hasDotDecimal && /,\d{1,2}$/.test(raw) === false && raw.includes(',')) {
    // Formato US con separador de miles: "1,000"
    raw = raw.replace(/,/g, '');
  }
  
  const num = Number(raw);
  if (isNaN(num)) return defaultVal || 0;
  
  // Si el valor original parece tener decimales, asumir que está en unidades
  // y multiplicar por 100 para convertir a centavos
  if (/\.\d+$/.test(raw) || /\.0+$/.test(raw) === false) {
    Logger.log('Valor con decimales convertido: ' + v + ' -> ' + Math.round(num * 100) + ' centavos');
    return Math.round(num * 100);
  }
  
  return Math.round(num);
}

/** Valida que un valor sea una Date no inválida. */
function _isValidDate(d) { return d instanceof Date && !isNaN(d.getTime()); }

/** Retorna un objeto de error estándar {success: false, message, code}. */
function _error(msg) { return { success: false, message: String(msg || "Error desconocido"), code: "ERROR" }; }

function _captureError(context, error) {
  var stack = error && error.stack ? error.stack : (error ? String(error) : 'Unknown error');
  var corrId = error && error.correlationId ? error.correlationId : 'NO_CORR_ID';
  Logger.log('[' + context + '] ' + stack + ' (corr: ' + corrId + ')');
}

let _CACHED_TIMEZONE = null;

function _getTimeZone() {
  if (_CACHED_TIMEZONE) return _CACHED_TIMEZONE;
  try {
    _CACHED_TIMEZONE = SESSION_SERVICE.getScriptTimeZone() || SpreadsheetApp.getActive().getSpreadsheetTimeZone();
    return _CACHED_TIMEZONE;
  } catch (e) {
    return 'UTC';
  }
}

/** Retorna la fecha actual a medianoche (zona horaria del script). */
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
  if (v === null || v === undefined || String(v).trim() === "") {
    return null;
  }
  try {
    const tz = _getTimeZone();
    let d = v instanceof Date ? v : new Date(v);
    
    // Si es string en formato dd/mm/yyyy, convertir
    if (typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v.trim())) {
      const parts = v.trim().split('/');
      d = new Date(parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0'));
    }
    
    if (!_isValidDate(d)) {
      return null;
    }
    const s = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const normalized = new Date(s + 'T00:00:00');
    const minDate = new Date(2000, 0, 1);
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 5);
    if (normalized.getTime() < minDate.getTime() || normalized.getTime() > maxDate.getTime()) {
      return null;
    }
    return normalized;
  } catch (e) {
    return null;
  }
}

/**
 * Formatea centavos a moneda COP para display.
 * Divide por 100 porque el sheet almacena valores en centavos (enteros).
 */
function _formatMoneda(centavos) {
  return (centavos / 100).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

/** Crea una copia de seguridad del spreadsheet y rota las antiguas. @returns {{success, name, url}} */
function crearBackup() {
  if (typeof AuthService !== 'undefined' && AuthService && AuthService.checkPermission) {
    try { AuthService.checkPermission("ejecutar_mantenimiento"); } catch (e) { Logger.log("[CFG-002] Backup sin permiso: " + e.message); }
  }
  const ss = getActiveSpreadsheet();
  const backupName = 'BACKUP_' + ss.getName() + '_' + Utilities.formatDate(new Date(), _getTimeZone(), 'yyyy-MM-dd_HHmmss');
  const backupId = ss.getId();
  const backupFolder = DriveApp.getRootFolder();
  const backupFile = DriveApp.getFileById(backupId).makeCopy(backupName, backupFolder);
  const backupUrl = backupFile.getUrl();
  Logger.log('Backup creado: ' + backupName + ' -> ' + backupUrl);

  const prefix = 'BACKUP_' + ss.getName() + '_';
  const allFiles = backupFolder.getFiles();
  const backups = [];
  while (allFiles.hasNext()) {
    const f = allFiles.next();
    if (f.getName().indexOf(prefix) === 0) backups.push(f);
  }
  backups.sort(function(a, b) { return a.getDateCreated() - b.getDateCreated(); });
  while (backups.length > BACKUP_CONFIG.MAX_BACKUPS) {
    const old = backups.shift();
    old.setTrashed(true);
    Logger.log('Backup rotado: ' + old.getName());
  }

  return { success: true, name: backupName, url: backupUrl };
}

/** Gestor de transacciones con snapshot de cartera para rollback. */
 const TransactionManager = {
   _currentCorrelationId: null,

   begin(id) {
     this._currentCorrelationId = id || ('txn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));
     const snapshot = this._takeSnapshot();
     const self = this;
     return {
       snapshot: snapshot,
       correlationId: this._currentCorrelationId,
       commit: function() {
         self._currentCorrelationId = null;
       },
       rollback: function() {
         self._currentCorrelationId = null;
       }
     };
   },

   getCorrelationId() {
     return this._currentCorrelationId;
   },

    _takeSnapshot() {
      const carteraSnapshot = [];
      try {
        const carteraSheet = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);
        const lastRow = carteraSheet ? carteraSheet.getLastRow() : 0;
        if (lastRow > 1) {
          const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
          const neededCols = Math.max(COL.id, COL.saldo, COL.estado) + 1;
          const data = carteraSheet.getRange(2, 1, lastRow - 1, neededCols).getValues();
          for (let i = 0; i < data.length; i++) {
            carteraSnapshot.push({
              rowIndex: i + 2,
              id: String(data[i][COL.id] || "").trim(),
              saldo: _parseMoneda(data[i][COL.saldo], 0),
              estado: String(data[i][COL.estado] || "").trim()
            });
          }
        }
      } catch (e) {
        Logger.log("TransactionManager: error snapshot cartera: " + e.toString());
      }
      return { cartera: carteraSnapshot };
    }
 };

/**
 * Servicio de sesión singleton.
 * Expone getCurrentUser(), getScriptTimeZone() — reemplaza acceso directo a Session.
 * Única instancia en la aplicación (ver AGENTS.md).
 */
const SESSION_SERVICE = {
  _mockUser: null,

  _resetMock() {
    this._mockUser = null;
  },

  _setMockUser(email) {
    this._mockUser = email;
  },

  getCurrentUser() {
    if (this._mockUser) {
      return { getEmail: () => this._mockUser };
    }
    try {
      return Session.getActiveUser();
    } catch (e) {
      return { getEmail: () => null };
    }
  },

  getScriptTimeZone() {
    if (this._mockUser) {
      return "UTC";
    }
    try {
      return Session.getScriptTimeZone();
    } catch (e) {
      return "UTC";
    }
  },

  /**
   * Obtiene el email del usuario activo.
   * @returns {string|null}
   */
  getActiveUserEmail() {
    const user = this.getCurrentUser();
    return user ? user.getEmail() : null;
  },

  /**
   * Obtiene el rol del usuario activo.
   * @returns {string|null}
   */
  getActiveUserRole() {
    const email = this.getActiveUserEmail();
    if (!email) return null;
    if (typeof AuthService !== 'undefined' && AuthService.getUserRole) {
      return AuthService.getUserRole(email);
    }
    return null;
  }
};

// ─ SETUP INICIAL (consolidado) ─

/** Inicializa hoja y configuración básica del sistema. Crea columnas faltantes. @returns {{success, spreadsheetId, sheets, message}} */
function setupSistema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return { 
      success: false, 
      error: "No hay spreadsheet activo. Vincule el script a un spreadsheet desde Archivo > Nuevo > Proyecto de Apps Script desde una hoja de cálculo." 
    };
  }
  const ssId = ss.getId();
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ssId);

  Logger.log("=== SETUP MICROERP ===");
  Logger.log("Spreadsheet: " + ss.getName());
  Logger.log("ID: " + ssId);

  const requiredSheets = SHEET_NAMES.REQUIRED;
  let mensaje = "\nHOJAS:\n";

  for (const nombre of requiredSheets) {
    const hoja = ss.getSheetByName(nombre);
    if (hoja) {
      mensaje += "✅ " + nombre + ": " + hoja.getLastRow() + " filas\n";
      if (nombre === "Productos") {
        let lastCol = hoja.getLastColumn();
        const expected = CONFIG.SCHEMA_definitions.PRODUCTOS;
        const expectedNames = Object.values(expected);
        if (lastCol > 0) {
          const headers = hoja.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || "").trim(); });
          const missing = [];
          for (const key in expected) {
            if (headers.indexOf(expected[key]) === -1) missing.push(expected[key]);
          }
          if (missing.length > 0) {
            hoja.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
          }
        } else {
          if (expectedNames.length > 0) {
            hoja.getRange(1, 1, 1, expectedNames.length).setValues([expectedNames]);
          }
        }
      }
    } else {
      mensaje += "❌ " + nombre + ": NO EXISTE\n";
    }
  }

  Logger.log(mensaje);
  CONFIG.reloadSchema();

  return {
    success: true,
    spreadsheetId: ssId,
    spreadsheetName: ss.getName(),
    sheets: requiredSheets.map(n => ({ name: n, exists: !!ss.getSheetByName(n) })),
    message: "Sistema configurado correctamente"
  };
}

/**
 * Valida que un valor sea un tipo de tercero permitido (CLIENTE, PROVEEDOR, AMBOS).
 * @param {string} value - Valor a validar
 * @returns {string|null} - Valor normalizado en uppercase o null si es inválido
 */
/** Valida que un valor sea un tipo de tercero permitido. @returns {string|null} normalizado o null. */
function _validateTipoTercero(value) {
  if (!value) return null;
  const upper = String(value).toUpperCase().trim();
  return TIPO_TERCERO.VALIDOS.indexOf(upper) !== -1 ? upper : null;
}

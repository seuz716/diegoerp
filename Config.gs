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
    CARTERA:     { id: 0, fecha: 1, id_tercero: 2, origen_id: 3, total: 4, saldo: 5, tipo: 6, estado: 7, fecha_vencimiento: 8, vencida_timestamp: 9, version: 10 },
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
    PRODUCTOS: { id: 0, nombre: 1, stock: 2, precio: 3, version: 4 },
  },
  STOCK_MINIMO: 5,
  SCHEMA_definitions: {
    TERCEROS: { id: "ID", nombre: "Nombre", telefono: "Teléfono", tipo: "Tipo", limite_credito: "Límite_Crédito", activo: "Activo" },
    CARTERA: { id: "ID", fecha: "Fecha", id_tercero: "ID_Tercero", origen_id: "Origen_ID", total: "Total", saldo: "Saldo", tipo: "Tipo", estado: "Estado", fecha_vencimiento: "Fecha_Vencimiento", vencida_timestamp: "Vencida_Timestamp", version: "Version" },
    MOV_CARTERA: { id: "ID", fecha: "Fecha", id_cartera: "ID_Cartera", id_tercero: "ID_Tercero", valor: "Valor", tipo_mov: "Tipo_Mov", referencia: "Referencia" },
    AUDIT_LOG: { id: "ID", timestamp: "Timestamp", operacion: "Operacion", tabla: "Tabla", id_registro: "ID_Registro", usuario: "Usuario", datos_previos: "Datos_Previos", datos_nuevos: "Datos_Nuevos", estado: "Estado" },
    PRODUCTOS: { id: "ID", nombre: "Nombre", stock: "Stock", precio: "Precio", version: "Version" },
  },
};

const ROLES = {
  ADMIN: 'ADMIN',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
};

const ROLE_HIERARCHY = { ADMIN: 3, OPERATOR: 2, VIEWER: 1 };

// ─ GLOBALES DE ESQUEMA ─

let _schemaVersion = 0;
let _schemaValidated = false;

// ─ UTILIDADES BÁSICAS ─

// Cache global para objetos Sheet y Spreadsheet
let _SHEETS_CACHE = {};
let _SPREADSHEET_CACHE = null;

function getActiveSpreadsheet() {
  if (!_SPREADSHEET_CACHE) {
    _SPREADSHEET_CACHE = SpreadsheetApp.getActiveSpreadsheet();
  }
  return _SPREADSHEET_CACHE;
}

/**
 * Obtiene una hoja de cálculo por nombre, utilizando un caché.
 * Resuelve Problema #1: VIOLACIÓN SEPARACIÓN DE CAPAS
 * Resuelve Problema #5: getSheet() sin cacheo del objeto Sheet
 */
function getSheet(name) {
  if (_SHEETS_CACHE[name]) return _SHEETS_CACHE[name];

  const spreadsheet = getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    console.error("Error: Hoja no encontrada: " + name);
    throw new Error("Hoja no encontrada: " + name);
  }

  // Limitar caché a 10 hojas, eliminar la más antigua (orden de inserción)
  const keys = Object.keys(_SHEETS_CACHE);
  if (keys.length >= 10) {
    delete _SHEETS_CACHE[keys[0]];
  }

  _SHEETS_CACHE[name] = sheet;
  return sheet;
}

// ─ MÉTODOS DE ESQUEMA EN CONFIG ─

CONFIG.reloadSchema = function() {
  const sheets = {
    [CARTERA_CONFIG.SHEETS.TERCEROS]: { conf: CARTERA_CONFIG.COLUMNS, key: 'TERCEROS' },
    [CARTERA_CONFIG.SHEETS.CARTERA]: { conf: CARTERA_CONFIG.COLUMNS, key: 'CARTERA' },
    [CARTERA_CONFIG.SHEETS.MOV_CARTERA]: { conf: CARTERA_CONFIG.COLUMNS, key: 'MOV_CARTERA' },
    [CARTERA_CONFIG.SHEETS.AUDIT_LOG]: { conf: CARTERA_CONFIG.COLUMNS, key: 'AUDIT_LOG' },
    [CONFIG.SHEETS.PRODUCTOS]: { conf: CONFIG.COLUMNS, key: 'PRODUCTOS' }
  };

  const spreadsheet = getActiveSpreadsheet();
  const changes = [];

  for (const [sheetName, mapping] of Object.entries(sheets)) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      if (sheetName === 'Productos') continue;
      throw new Error(`Hoja obligatoria "${sheetName}" no encontrada.`);
    }

    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) continue;

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
    const expected = CONFIG.SCHEMA_definitions[mapping.key];

    _SHEETS_CACHE[sheetName + '_meta'] = { lastRow: sheet.getLastRow(), lastCol: lastCol, headers: headers };

    const sheetChanges = { sheet: sheetName, changes: [] };

    for (const [key, expectedName] of Object.entries(expected)) {
      const idx = headers.indexOf(expectedName);
      if (idx === -1) {
        throw new Error(`Columna obligatoria "${expectedName}" no encontrada en "${sheetName}".`);
      }
      const oldIdx = mapping.conf[mapping.key][key];
      if (oldIdx !== idx) {
        sheetChanges.changes.push({ key, from: oldIdx, to: idx });
      }
      mapping.conf[mapping.key][key] = idx;
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

  return { success: true, changes: changes };
};

CONFIG.isSchemaStale = function(maxAgeMs) {
  if (maxAgeMs === undefined) maxAgeMs = 3600000;
  if (!_schemaVersion) return true;
  if (Date.now() - _schemaVersion > maxAgeMs) return true;

  const criticalSheets = ['Terceros', 'Cartera', 'Movimientos_Cartera', 'AUDIT_LOG', 'Productos'];
  for (const name of criticalSheets) {
    const sheet = getActiveSpreadsheet().getSheetByName(name);
    if (!sheet) continue;
    const meta = _SHEETS_CACHE[name + '_meta'];
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

  const sheets = {
    'Terceros': { conf: CARTERA_CONFIG.COLUMNS, key: 'TERCEROS' },
    'Cartera': { conf: CARTERA_CONFIG.COLUMNS, key: 'CARTERA' },
    'Movimientos_Cartera': { conf: CARTERA_CONFIG.COLUMNS, key: 'MOV_CARTERA' },
    'AUDIT_LOG': { conf: CARTERA_CONFIG.COLUMNS, key: 'AUDIT_LOG' },
    'Productos': { conf: CONFIG.COLUMNS, key: 'PRODUCTOS' }
  };

  for (const [sheetName, mapping] of Object.entries(sheets)) {
    report.sheetsValidated.push(sheetName);
    report.columnMappings[sheetName] = Object.assign({}, mapping.conf[mapping.key]);

    const sheet = getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) continue;
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) continue;
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
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
  const criticalSheets = ['Terceros', 'Cartera', 'Movimientos_Cartera', 'AUDIT_LOG', 'Productos'];
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let changed = false;

  for (const name of criticalSheets) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) continue;
    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) continue;
    const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
    const meta = _SHEETS_CACHE[name + '_meta'];
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

function _sanitizeId(id) { return String(id || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ""); }

/**
 * Convierte un valor del sheet a centavos (entero).
 * Usa parseInt porque el sheet almacena montos en centavos sin decimales.
 */
function _parseMoneda(v, defaultVal) {
  if (v === null || v === undefined) return defaultVal || 0;
  const raw = String(v).trim();
  if (raw === "") return defaultVal || 0;
  const num = Number(raw);
  if (isNaN(num)) return defaultVal || 0;
  if (num % 1 !== 0) {
    console.warn(`Valor con decimales rechazado: ${raw}. Use centavos (entero).`);
    throw new Error(`Monto inválido: ${raw}. Ingrese valores en centavos (sin decimales).`);
  }
  return num;
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
  if (v === null || v === undefined || String(v).trim() === "") {
    return null;
  }
  try {
    const tz = _getTimeZone();
    const d = v instanceof Date ? v : new Date(v);
    if (!_isValidDate(d)) {
      throw new Error(`Fecha inválida: ${v}`);
    }
    const s = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const normalized = new Date(s + 'T00:00:00');
    const minDate = new Date(2000, 0, 1);
    const maxDate = new Date();
    maxDate.setFullYear(maxDate.getFullYear() + 5);
    if (normalized.getTime() < minDate.getTime() || normalized.getTime() > maxDate.getTime()) {
      throw new Error(`Fecha fuera de rango permitido (2000-${maxDate.getFullYear()}): ${v}`);
    }
    return normalized;
  } catch (e) {
    console.error(`Fecha inválida detectada: ${v}`);
    throw new Error(`No se puede procesar fecha: ${v}. Corrija el dato en la hoja.`);
  }
}

/**
 * Formatea centavos a moneda COP para display.
 * Divide por 100 porque el sheet almacena valores en centavos (enteros).
 */
function _formatMoneda(centavos) {
  return (centavos / 100).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

function crearBackup() {
  AuthService.checkPermission("ejecutar_mantenimiento");
  const ss = getActiveSpreadsheet();
  const backupName = 'BACKUP_' + ss.getName() + '_' + Utilities.formatDate(new Date(), _getTimeZone(), 'yyyy-MM-dd_HHmmss');
  const backupId = ss.getId();
  const backupFolder = DriveApp.getRootFolder();
  const backupFile = DriveApp.getFileById(backupId).makeCopy(backupName, backupFolder);
  const backupUrl = backupFile.getUrl();
  Logger.log('Backup creado: ' + backupName + ' -> ' + backupUrl);
  return { success: true, name: backupName, url: backupUrl };
}

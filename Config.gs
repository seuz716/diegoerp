/**
 * LAYER 1: CONFIG + UTILIDADES BASE
 * v2.5.1 - Load order fixed via filePushOrder
 */

const BACKUP_CONFIG = {
  FOLDER_NAME: "MicroERP_Backups",
  EXPORT_FOLDER_NAME: "MicroERP_Exportaciones",
  MAX_BACKUPS: 7,
  BACKUP_SHEETS: ["Cartera", "Terceros", "Productos", "Compras", "Detalle_Compras", "Libro_Diario", "Flujo_Caja", "AUDIT_LOG", "Producto_Proveedor"],
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

const TIPO_TERCERO = {
  CLIENTE: "CLIENTE",
  PROVEEDOR: "PROVEEDOR",
  AMBOS: "AMBOS",
  VALIDOS: ["CLIENTE", "PROVEEDOR", "AMBOS"],
};

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

const PRODUCTOS_CONFIG = {
  SHEET: "Productos",
  ESTADOS_PRODUCTO: { ACTIVO: "ACTIVO", INACTIVO: "INACTIVO" },
};

const LOCK_CONFIG = {
  GLOBAL_TIMEOUT: 30000,
  MAX_RETRIES: 4,
  BASE_BACKOFF: 500,
  RESOURCE_LOCK_WAIT: 1500,
  RESOURCE_LOCK_TIMEOUT: 25000,
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
    TERCEROS: { id: "ID", nombre: "Nombre", telefono: "Teléfono", tipo: "Tipo", tipoTercero: "Tipo", limite_credito: "Límite_Crédito", activo: "Activo" },
    CARTERA: { id: "ID", fecha: "Fecha", id_tercero: "ID_Tercero", origen_id: "Origen_ID", total: "Total", saldo: "Saldo", tipo: "Tipo", estado: "Estado", fecha_vencimiento: "Fecha_Vencimiento", vencida_timestamp: "Vencida_Timestamp", version: "Version" },
    MOV_CARTERA: { id: "ID", fecha: "Fecha", id_cartera: "ID_Cartera", id_tercero: "ID_Tercero", valor: "Valor", tipo_mov: "Tipo_Mov", referencia: "Referencia" },
    AUDIT_LOG: { id: "ID", timestamp: "Timestamp", operacion: "Operacion", tabla: "Tabla", id_registro: "ID_Registro", usuario: "Usuario", datos_previos: "Datos_Previos", datos_nuevos: "Datos_Nuevos", estado: "Estado" },
    PRODUCTOS: { id: "ID", nombre: "Nombre", stock: "Stock", precio_compra: "Precio_Compra", precio_venta: "Precio_Venta", categoria: "Categoria", activo: "Activo", fecha_creacion: "Fecha_Creacion", version: "Version" },
    COMPRAS: { id: "ID", fecha: "Fecha", id_proveedor: "ID_Proveedor", id_factura: "ID_Factura", total: "Total", saldo: "Saldo", estado: "Estado", fecha_vencimiento: "Fecha_Vencimiento", vencida_timestamp: "Vencida_Timestamp", version: "Version" },
    DETALLE_COMPRAS: { id: "ID", id_compra: "ID_Compra", id_producto: "ID_Producto", cantidad: "Cantidad", precio_unitario: "Precio_Unitario", subtotal: "Subtotal" },
    PAGOS_PROVEEDORES: { id: "ID", fecha: "Fecha", id_compra: "ID_Compra", id_proveedor: "ID_Proveedor", valor: "Valor", referencia: "Referencia", metodo_pago: "Metodo_Pago" },
    KARDEX: { id: "ID", fecha: "Fecha", id_producto: "ID_Producto", tipo_mov: "Tipo_Mov", cantidad: "Cantidad", stock_anterior: "Stock_Anterior", stock_nuevo: "Stock_Nuevo", referencia: "Referencia", origen: "Origen", usuario: "Usuario" },
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

// ─ UTILIDADES BÁSICAS ─

// Cache global para objetos Sheet y Spreadsheet
let _SHEETS_CACHE = {};
let _SPREADSHEET_CACHE = null;

/**
 * SPREADSHEET_ID HARDCODED - Para funcionamiento inmediato
 * Reemplaza con el ID de tu spreadsheet si es necesario
 */
const SPREADSHEET_ID_FALLBACK = "1hPpL-9ay6DNRDTBKy84r_M3pCnEGU6hJRdCzUQyJFoc";

function getActiveSpreadsheet() {
  if (!_SPREADSHEET_CACHE) {
    const ssId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (ssId) {
      _SPREADSHEET_CACHE = SpreadsheetApp.openById(ssId);
    } else if (SPREADSHEET_ID_FALLBACK) {
      // Fallback hardcoded
      try {
        _SPREADSHEET_CACHE = SpreadsheetApp.openById(SPREADSHEET_ID_FALLBACK);
        Logger.log("[FALLBACK] Usando SPREADSHEET_ID hardcoded: " + SPREADSHEET_ID_FALLBACK);
      } catch (fallbackErr) {
        Logger.log("[FALLBACK ERROR] No se pudo abrir spreadsheet: " + fallbackErr.message);
        throw new Error("Error al abrir spreadsheet con ID hardcoded. Comparte el spreadsheet con el script o configura SPREADSHEET_ID manualmente.");
      }
    } else {
      _SPREADSHEET_CACHE = SpreadsheetApp.getActiveSpreadsheet();
    }
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
    Logger.log("Error: Hoja no encontrada: " + name);
    throw new Error("Hoja no encontrada: " + name);
  }

  const keys = Object.keys(_SHEETS_CACHE);
  if (keys.length >= 20) {
    delete _SHEETS_CACHE[keys[0]];
  }

  _SHEETS_CACHE[name] = sheet;
  return sheet;
}

// ─ MÉTODOS DE ESQUEMA EN CONFIG ─

CONFIG.reloadSchema = function() {
   const optionalSheets = ['Productos', 'Compras', 'Detalle_Compras', 'Pagos_Proveedores', 'Kardex_Movilizaciones', 'Libro_Diario', 'Flujo_Caja', 'Producto_Proveedor'];
   const sheets = {
     [CARTERA_CONFIG.SHEETS.TERCEROS]: { conf: CARTERA_CONFIG.COLUMNS, key: 'TERCEROS' },
     [CARTERA_CONFIG.SHEETS.CARTERA]: { conf: CARTERA_CONFIG.COLUMNS, key: 'CARTERA' },
     [CARTERA_CONFIG.SHEETS.MOV_CARTERA]: { conf: CARTERA_CONFIG.COLUMNS, key: 'MOV_CARTERA' },
     [CARTERA_CONFIG.SHEETS.AUDIT_LOG]: { conf: CARTERA_CONFIG.COLUMNS, key: 'AUDIT_LOG' },
     [CONFIG.SHEETS.PRODUCTOS]: { conf: CONFIG.COLUMNS, key: 'PRODUCTOS' },
     [COMPRAS_CONFIG.SHEETS.COMPRAS]: { conf: COMPRAS_CONFIG.COLUMNS, key: 'COMPRAS' },
     [COMPRAS_CONFIG.SHEETS.DETALLE_COMPRAS]: { conf: COMPRAS_CONFIG.COLUMNS, key: 'DETALLE_COMPRAS' },
     [COMPRAS_CONFIG.SHEETS.PAGOS_PROVEEDORES]: { conf: COMPRAS_CONFIG.COLUMNS, key: 'PAGOS_PROVEEDORES' },
     [COMPRAS_CONFIG.SHEETS.KARDEX]: { conf: COMPRAS_CONFIG.COLUMNS, key: 'KARDEX' },
     [CONFIG.SHEETS.LIBRO_DIARIO]: { conf: CONFIG.COLUMNS, key: 'LIBRO_DIARIO' },
     [CONFIG.SHEETS.FLUJO_CAJA]: { conf: CONFIG.COLUMNS, key: 'FLUJO_CAJA' },
     [PRODUCTO_PROVEEDOR_CONFIG.SHEET]: { conf: { PRODUCTO_PROVEEDOR: PRODUCTO_PROVEEDOR_CONFIG.COLUMNS }, key: 'PRODUCTO_PROVEEDOR' },
   };

  const spreadsheet = getActiveSpreadsheet();
  const changes = [];

  for (const [sheetName, mapping] of Object.entries(sheets)) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      if (optionalSheets.includes(sheetName)) continue;
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
        continue;
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
  // === INICIO FIX m-03 ===
  _saveSchemaVersion(_schemaVersion);
  // === FIN FIX m-03 ===

  return { success: true, changes: changes };
};

CONFIG.isSchemaStale = function(maxAgeMs) {
  if (!_schemaVersion) _loadSchemaVersion();
  if (maxAgeMs === undefined) maxAgeMs = 3600000;
  if (!_schemaVersion) return true;
  if (Date.now() - _schemaVersion > maxAgeMs) return true;

  const criticalSheets = ['Terceros', 'Cartera', 'Movimientos_Cartera', 'AUDIT_LOG', 'Productos', 'Compras', 'Detalle_Compras', 'Pagos_Proveedores', 'Producto_Proveedor'];
  const allSheets = getActiveSpreadsheet().getSheets();
  const sheetMap = {};
  for (let i = 0; i < allSheets.length; i++) sheetMap[allSheets[i].getName()] = allSheets[i];

  for (const name of criticalSheets) {
    const sheet = sheetMap[name];
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
     'Productos': { conf: CONFIG.COLUMNS, key: 'PRODUCTOS' },
     'Compras': { conf: COMPRAS_CONFIG.COLUMNS, key: 'COMPRAS' },
     'Detalle_Compras': { conf: COMPRAS_CONFIG.COLUMNS, key: 'DETALLE_COMPRAS' },
     'Pagos_Proveedores': { conf: COMPRAS_CONFIG.COLUMNS, key: 'PAGOS_PROVEEDORES' },
     'Libro_Diario': { conf: CONFIG.COLUMNS, key: 'LIBRO_DIARIO' },
     'Flujo_Caja': { conf: CONFIG.COLUMNS, key: 'FLUJO_CAJA' },
     'Producto_Proveedor': { conf: { PRODUCTO_PROVEEDOR: PRODUCTO_PROVEEDOR_CONFIG.COLUMNS }, key: 'PRODUCTO_PROVEEDOR' },
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
   const criticalSheets = ['Terceros', 'Cartera', 'Movimientos_Cartera', 'AUDIT_LOG', 'Productos', 'Compras', 'Detalle_Compras', 'Pagos_Proveedores', 'Libro_Diario', 'Flujo_Caja', 'Producto_Proveedor'];
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
 * Sanitiza un valor para escritura segura en hoja.
 * Protege contra inyección de fórmulas (=, +, -, @, tab) en Google Sheets.
 * Devuelve el valor apropiado según su tipo.
 */
function _sanitizeCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") {
    const needsEscape = /^[=+\-@]/.test(v);
    return needsEscape ? "'" + v : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    return JSON.stringify(v);
  }
  return String(v);
}

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
    Logger.log(`Valor con decimales convertido: ${raw} -> ${Math.round(num)}`);
    return Math.round(num);
  }
  return num;
}

function _isValidDate(d) { return d instanceof Date && !isNaN(d.getTime()); }

function _error(msg) { return { success: false, message: String(msg || "Error desconocido"), code: "ERROR" }; }

function _captureError(context, error) {
  const stack = error && error.stack ? error.stack : (error ? String(error) : 'Unknown error');
  const corrId = error && error.correlationId ? error.correlationId : 'NO_CORR_ID';
  Logger.log(`[${context}] ${stack} (corr: ${corrId})`);
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

function crearBackup() {
  AuthService.checkPermission("ejecutar_mantenimiento");
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

 // ─ TRANSACTION MANAGER ─

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
       if (carteraSheet && carteraSheet.getLastRow() > 1) {
         const COL = CARTERA_CONFIG.COLUMNS.CARTERA;
         const data = carteraSheet.getDataRange().getValues();
         for (let i = 1; i < data.length; i++) {
           carteraSnapshot.push({
             rowIndex: i + 1,
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

// ─ SESSION SERVICE (singleton) ─
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
  }
};

// ─ SETUP INICIAL (consolidado) ─

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

  const requiredSheets = ["Terceros", "Cartera", "Movimientos_Cartera", "AUDIT_LOG", "Productos"];
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
function _validateTipoTercero(value) {
  if (!value) return null;
  const upper = String(value).toUpperCase().trim();
  return TIPO_TERCERO.VALIDOS.indexOf(upper) !== -1 ? upper : null;
}

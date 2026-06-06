/**
 * LAYER 1.5: SCHEMA VALIDATION & DYNAMIC COLUMN MAPPING
 * Prevents errors if columns are moved in the sheet.
 */

let _schemaValidated = false;

function validateAndMapSchemas() {
  if (_schemaValidated) return;

  const sheets = {
    'Terceros': { conf: CARTERA_CONFIG.COLUMNS, key: 'TERCEROS' },
    'Cartera': { conf: CARTERA_CONFIG.COLUMNS, key: 'CARTERA' },
    'Movimientos_Cartera': { conf: CARTERA_CONFIG.COLUMNS, key: 'MOV_CARTERA' },
    'AUDIT_LOG': { conf: CARTERA_CONFIG.COLUMNS, key: 'AUDIT_LOG' },
    'Productos': { conf: CONFIG.COLUMNS, key: 'PRODUCTOS' }
  };

  const expectedHeaders = {
    TERCEROS: {
      id: "ID",
      nombre: "Nombre",
      telefono: "Teléfono",
      tipo: "Tipo",
      limite_credito: "Límite_Crédito",
      activo: "Activo"
    },
    CARTERA: {
      id: "ID",
      fecha: "Fecha",
      id_tercero: "ID_Tercero",
      origen_id: "Origen_ID",
      total: "Total",
      saldo: "Saldo",
      tipo: "Tipo",
      estado: "Estado",
      fecha_vencimiento: "Fecha_Vencimiento",
      vencida_timestamp: "Vencida_Timestamp"
    },
    MOV_CARTERA: {
      id: "ID",
      fecha: "Fecha",
      id_cartera: "ID_Cartera",
      id_tercero: "ID_Tercero",
      valor: "Valor",
      tipo_mov: "Tipo_Mov",
      referencia: "Referencia"
    },
    AUDIT_LOG: {
      id: "ID",
      timestamp: "Timestamp",
      operacion: "Operacion",
      tabla: "Tabla",
      id_registro: "ID_Registro",
      usuario: "Usuario",
      datos_previos: "Datos_Previos",
      datos_nuevos: "Datos_Nuevos",
      estado: "Estado"
    },
    PRODUCTOS: {
      id: "ID",
      nombre: "Nombre",
      stock: "Stock",
      precio: "Precio"
    }
  };

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  for (const [sheetName, mapping] of Object.entries(sheets)) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      if (sheetName === 'Productos') continue;
      throw new Error(`Hoja obligatoria "${sheetName}" no encontrada en el documento.`);
    }

    const lastCol = sheet.getLastColumn();
    if (lastCol === 0) continue; // Nueva hoja vacía, se inicializará después

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || "").trim());
    const expected = expectedHeaders[mapping.key];

    for (const [key, expectedName] of Object.entries(expected)) {
      const idx = headers.indexOf(expectedName);
      if (idx === -1) {
        throw new Error(`Columna obligatoria "${expectedName}" no encontrada en la hoja "${sheetName}".`);
      }
      // Re-mapear dinámicamente el índice detectado en la hoja al config de columnas
      mapping.conf[mapping.key][key] = idx;
    }
  }

  _schemaValidated = true;
}

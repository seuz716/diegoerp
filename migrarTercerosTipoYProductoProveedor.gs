/**
 * Script de migración: Clasificación de Terceros + Producto_Proveedor.
 * Idempotente — verifica flag MIGRACION_TERCEROS_V1_3_DONE en ScriptProperties.
 * Crea la hoja Producto_Proveedor y backfillea tipoTercero en registros existentes.
 */

/**
 * Función principal de migración - alias para compatibilidad con SchemaManager.
 * Migración V1.3: Clasificación automática de terceros por historial.
 */
function migrarTercerosTipoYProductoProveedor() {
  return migrarClasificacionTerceros();
}

/**
 * Revierte la migración usando el snapshot guardado.
 * @param {string} snapshotKey - Nombre de la hoja snapshot (default: SNAPSHOT_TERCEROS_V1)
 */
function revertirMigracionTerceros(snapshotKey) {
  const MIGRATION_FLAG = 'MIGRACION_TERCEROS_V1_3_DONE';
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(MIGRATION_FLAG) !== 'true') {
    // Try legacy flag for backwards compatibility
    if (props.getProperty('MIGRACION_TERCEROS_V1_DONE') !== 'true') {
      return { success: false, message: 'No hay migración para revertir.' };
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = snapshotKey || 'SNAPSHOT_TERCEROS_V1';
  const snapshotSheet = ss.getSheetByName(sheetName);
  if (!snapshotSheet || snapshotSheet.getLastRow() < 2) {
    return { success: false, message: 'No se encontró snapshot ' + sheetName + '.' };
  }

  const tercerosSheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
  const snapLastRow = snapshotSheet.getLastRow();
  const snapLastCol = snapshotSheet.getLastColumn();
  const snapData = snapshotSheet.getRange(1, 1, snapLastRow, snapLastCol).getValues();

  tercerosSheet.clear();
  const restoreRange = tercerosSheet.getRange(1, 1, snapData.length, snapData[0].length);
  restoreRange.setValues(snapData);
  restoreRange.setFontWeight('bold').setFontWeight(null);
  tercerosSheet.getRange(1, 1, 1, snapLastCol).setFontWeight('bold');

  props.deleteProperty(MIGRATION_FLAG);
  props.deleteProperty('MIGRACION_TERCEROS_V1_DONE');
  Logger.log('[MIGRACION] Reversión completada — datos de Terceros restaurados desde ' + sheetName);
  return { success: true, message: 'Terceros restaurados desde snapshot. Flag de migración eliminado.' };
}

function migrarClasificacionTerceros() {
  const MIGRATION_FLAG = 'MIGRACION_TERCEROS_V1_3_DONE';
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(MIGRATION_FLAG) === 'true') {
    Logger.log('[MIGRACION] Flag ya presente — migración omitida.');
    return { success: true, skipped: true, message: 'Migración ya ejecutada previamente.' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = { creados: [], clasificados: [], errores: [], sinHistorial: [] };
  const COL = CARTERA_CONFIG.COLUMNS.TERCEROS;

  // ── PRODUCTO_PROVEEDOR sheet creation ──
  let ppSheet = ss.getSheetByName(PRODUCTO_PROVEEDOR_CONFIG.SHEET);
  if (ppSheet) {
    report.creados.push(PRODUCTO_PROVEEDOR_CONFIG.SHEET + ': ya existe');
  } else {
    ppSheet = ss.insertSheet(PRODUCTO_PROVEEDOR_CONFIG.SHEET);
    const headers = ['ID_Producto', 'ID_Proveedor', 'Precio_Ultima_Compra', 'Es_Preferido', 'Fecha_Ultima_Compra'];
    const headerRange = ppSheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    ppSheet.setFrozenRows(1);
    report.creados.push(PRODUCTO_PROVEEDOR_CONFIG.SHEET + ': creada');
  }

  // ── SNAPSHOT antes de escribir ──
  const snapshotSheetName = 'SNAPSHOT_TERCEROS_V1';
  let snapshotSheet = ss.getSheetByName(snapshotSheetName);
  if (!snapshotSheet) {
    snapshotSheet = ss.insertSheet(snapshotSheetName);
  }
  const tercerosSheet = getSheet(CARTERA_CONFIG.SHEETS.TERCEROS);
  const lastRow = tercerosSheet.getLastRow();
  const lastCol = tercerosSheet.getLastColumn();
  if (lastRow > 0) {
    const snapshotData = tercerosSheet.getRange(1, 1, lastRow, lastCol).getValues();
    snapshotSheet.clear();
    const snapRange = snapshotSheet.getRange(1, 1, snapshotData.length, snapshotData[0].length);
    snapRange.setValues(snapshotData);
    snapRange.setFontWeight('bold').setFontWeight(null);
    snapshotSheet.getRange(1, 1, 1, lastCol).setFontWeight('bold');
    Logger.log('[MIGRACION] Snapshot guardado en hoja "' + snapshotSheetName + '" (' + lastRow + ' filas)');
  }

  // ── Leer compras y cartera para inferencia ──
  const proveedoresSet = _loadProveedoresSet(ss);
  const clientesSet = _loadClientesSet(ss);
  const carteraCxpSet = _loadCarteraCxpSet(ss);

  // ── Clasificar terceros ──
  if (lastRow < 2) {
    Logger.log('[MIGRACION] No hay terceros para clasificar.');
  } else {
    const dataRange = tercerosSheet.getRange(2, 1, lastRow - 1, lastCol);
    const tercerosData = dataRange.getValues();
    let cambios = 0;

    for (let i = 0; i < tercerosData.length; i++) {
      const row = tercerosData[i];
      const id = String(row[COL.id] || '').trim();
      if (!id) continue;
      const tipoActual = String(row[COL.tipoTercero] || row[COL.tipo] || '').trim().toUpperCase();
      if (tipoActual && TIPO_TERCERO.VALIDOS.indexOf(tipoActual) !== -1) continue;

      const esProveedor = proveedoresSet.has(id);
      const esCliente = clientesSet.has(id);
      const tieneCxP = carteraCxpSet.has(id);
      let tipoAsignado;
      let sinHistorial = false;

      if (esProveedor && esCliente) {
        tipoAsignado = TIPO_TERCERO.AMBOS;
      } else if (esProveedor || tieneCxP) {
        tipoAsignado = TIPO_TERCERO.PROVEEDOR;
      } else if (esCliente) {
        tipoAsignado = TIPO_TERCERO.CLIENTE;
      } else {
        tipoAsignado = TIPO_TERCERO.CLIENTE;
        sinHistorial = true;
        report.sinHistorial.push(id);
      }

      tercerosData[i][COL.tipoTercero] = tipoAsignado;
      cambios++;

      const logEntry = {
        idTercero: id,
        tipoAnterior: tipoActual || '(vacio)',
        tipoAsignado: tipoAsignado,
        inferidoDe: esProveedor && esCliente ? 'compras+y-cartera' :
                       esProveedor ? 'compras' :
                       tieneCxP ? 'cartera-cxp' :
                       esCliente ? 'cartera-cxc' :
                       'default-sin-historial',
      };
      report.clasificados.push(logEntry);

      try {
        LOG_ENGINE.logEvent(
          'MIGRACION_CLASIFICAR_TERCERO',
          'Terceros',
          id,
          { tipoTercero: tipoActual || '(vacio)' },
          { tipoTercero: tipoAsignado },
          sinHistorial ? 'WARNING' : 'SUCCESS',
          { correlationId: 'MIG_V1_' + id }
        );
      } catch (logErr) {
        Logger.log('[MIGRACION] Error logueando clasificación de ' + id + ': ' + logErr.message);
      }
    }

    if (cambios > 0) {
      const writeRange = tercerosSheet.getRange(2, 1, tercerosData.length, lastCol);
      writeRange.setValues(tercerosData);
      Logger.log('[MIGRACION] Actualizados ' + cambios + ' terceros con tipoTercero.');
    } else {
      Logger.log('[MIGRACION] Todos los terceros ya tienen tipoTercero asignado.');
    }
  }

  props.setProperty(MIGRATION_FLAG, 'true');
  Logger.log('[MIGRACION] Flag MIGRACION_TERCEROS_V1_3_DONE = true');

  Logger.log('[MIGRACION] Resumen: ' + report.clasificados.length + ' clasificados, ' +
    report.sinHistorial.length + ' sin historial, ' + report.errores.length + ' errores.');

  return {
    success: true,
    skipped: false,
    resumen: {
      hojaCreada: report.creados,
      clasificados: report.clasificados.length,
      sinHistorial: report.sinHistorial.length,
      errores: report.errores.length,
    },
    clasificados: report.clasificados,
    sinHistorial: report.sinHistorial,
  };
}

/**
 * Carga un Set con IDs de proveedores que aparecen en compras.
 * @param {Spreadsheet} ss - Spreadsheet instance.
 * @returns {Set<string>} Set of provider IDs.
 */
function _loadProveedoresSet(ss) {
  const comprasSheet = ss.getSheetByName(COMPRAS_CONFIG.SHEETS.COMPRAS);
  if (!comprasSheet || comprasSheet.getLastRow() < 2) return new Set();
  const C = COMPRAS_CONFIG.COLUMNS.COMPRAS;
  const data = comprasSheet.getRange(2, 1, comprasSheet.getLastRow() - 1, C.id_proveedor + 1).getValues();
  const set = new Set();
  for (let i = 0; i < data.length; i++) {
    const pid = String(data[i][C.id_proveedor] || '').trim().toUpperCase();
    if (pid) set.add(pid);
  }
  return set;
}

/**
 * Carga un Set con IDs de terceros que tienen cartera CxC (clientes).
 */
function _loadClientesSet(ss) {
  const carteraSheet = ss.getSheetByName(CARTERA_CONFIG.SHEETS.CARTERA);
  if (!carteraSheet || carteraSheet.getLastRow() < 2) return new Set();
  const C = CARTERA_CONFIG.COLUMNS.CARTERA;
  const data = carteraSheet.getRange(2, 1, carteraSheet.getLastRow() - 1, C.tipo + 1).getValues();
  const set = new Set();
  for (let i = 0; i < data.length; i++) {
    const tipo = String(data[i][C.tipo] || '').trim().toUpperCase();
    if (tipo === 'CXC') {
      const tid = String(data[i][C.id_tercero] || '').trim().toUpperCase();
      if (tid) set.add(tid);
    }
  }
  return set;
}

/**
 * Carga un Set con IDs de terceros que tienen cartera CxP (cuentas por pagar a proveedores).
 */
function _loadCarteraCxpSet(ss) {
  const carteraSheet = ss.getSheetByName(CARTERA_CONFIG.SHEETS.CARTERA);
  if (!carteraSheet || carteraSheet.getLastRow() < 2) return new Set();
  const C = CARTERA_CONFIG.COLUMNS.CARTERA;
  const data = carteraSheet.getRange(2, 1, carteraSheet.getLastRow() - 1, C.tipo + 1).getValues();
  const set = new Set();
  for (let i = 0; i < data.length; i++) {
    const tipo = String(data[i][C.tipo] || '').trim().toUpperCase();
    if (tipo === 'CXP') {
      const tid = String(data[i][C.id_tercero] || '').trim().toUpperCase();
      if (tid) set.add(tid);
    }
  }
  return set;
}

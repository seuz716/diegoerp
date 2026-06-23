/**
 * Script de migración: crea las hojas del módulo de Compras si no existen.
 * Idempotente — se puede ejecutar múltiples veces sin dañar datos.
 */
function migrarDatosCompras() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var resultados = [];
  var hojas = [
    {
      nombre: "Compras",
      columnas: ["ID", "Fecha", "ID_Proveedor", "ID_Factura", "Total", "Saldo", "Estado", "Fecha_Vencimiento", "Vencida_Timestamp", "Version"]
    },
    {
      nombre: "Detalle_Compras",
      columnas: ["ID", "ID_Compra", "ID_Producto", "Cantidad", "Precio_Unitario", "Subtotal"]
    },
    {
      nombre: "Pagos_Proveedores",
      columnas: ["ID", "Fecha", "ID_Compra", "ID_Proveedor", "Valor", "Referencia", "Metodo_Pago"]
    }
  ];
  for (var i = 0; i < hojas.length; i++) {
    var h = hojas[i];
    var sheet = ss.getSheetByName(h.nombre);
    if (sheet) {
      resultados.push(h.nombre + ": ya existe");
      continue;
    }
    sheet = ss.insertSheet(h.nombre);
    var headerRange = sheet.getRange(1, 1, 1, h.columnas.length);
    headerRange.setValues([h.columnas]);
    headerRange.setFontWeight("bold");
    sheet.setFrozenRows(1);
    resultados.push(h.nombre + ": creada");
  }
  Logger.log("[MIGRACION] migrarDatosCompras: " + resultados.join(", "));
  return { success: true, resultados: resultados };
}

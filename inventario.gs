/**
 * Módulo de Validación de Inventario - MicroERP Premium
 * Capa 1: Validación por lotes + alertas
 * Capa 2: Bloqueo en tiempo real (onEdit)
 * Capa 3: Auto-revisión programada
 * 
 * @author César Andrés Abadía
 * @version 1.0
 */

// ─────────────────────────────────────────────
// 🔍 CAPA 1: VALIDACIÓN POR LOTES
// ─────────────────────────────────────────────

function revisarInventario() {
  AuthService.checkPermission("revisar_inventario");
  try {
    const sheet = getSheet(CONFIG.SHEETS.PRODUCTOS);
    const data = sheet.getDataRange().getValues();
    const COL = CONFIG.COLUMNS.PRODUCTOS;

    const STOCK_MINIMO = CONFIG.STOCK_MINIMO || 5;
    const alertas = [];
    let correcciones = 0;

    for (let i = 1; i < data.length; i++) {
      const id = String(data[i][COL.id] ?? "").trim();
      const nombre = String(data[i][COL.nombre] ?? "").trim();
      let stock = parseInt(data[i][COL.stock]) || 0;
      const precio = parseFloat(data[i][COL.precio]) || 0;

      // 🔴 CORRECCIÓN: Negativos → 0 + registro
      if (stock < 0) {
        sheet.getRange(i + 1, COL.stock + 1).setValue(0);
        stock = 0;
        correcciones++;
        alertas.push(`❌ Stock negativo corregido → ${nombre} (${id})`);
      }

      // 🟡 ALERTAS por nivel de stock (solo productos activos)
      if (stock === 0 && precio > 0) {
        alertas.push(`🚨 SIN STOCK (producto activo) → ${nombre} (${id})`);
      } else if (stock > 0 && stock <= STOCK_MINIMO) {
        alertas.push(`⚠️ Stock bajo (${stock}/${STOCK_MINIMO}) → ${nombre} (${id})`);
      }
    }

    return {
      success: true,
      timestamp: new Date().toISOString(),
      totalProductos: data.length - 1,
      correcciones: correcciones,
      alertas: alertas,
      resumen: {
        sinStock: alertas.filter(a => a.includes("🚨")).length,
        stockBajo: alertas.filter(a => a.includes("⚠️")).length,
        corregidos: correcciones
      }
    };

  } catch (e) {
    Logger.log("ERROR revisarInventario: " + e.toString());
    return { 
      success: false, 
      message: e.toString(),
      timestamp: new Date().toISOString()
    };
  }
}

// ─────────────────────────────────────────────
// ⚡ CAPA 2: BLOQUEO EN TIEMPO REAL (onEdit)
// ⚠️ LIMITACIÓN DE PLATAFORMA: onEdit(e) es un trigger simple que SOLO se
// ejecuta cuando un usuario edita una celda manualmente en la interfaz/editor
// de Google Sheets. NO se ejecuta para ediciones realizadas a través de la API
// o la Web App (ej. llamadas de servicio programáticas).
// ─────────────────────────────────────────────

function onEdit(e) {
  // ⚠️ onEdit NO puede usar LockService ni llamadas externas
  try {
    const range = e.range;
    const sheet = range.getSheet();
    
    // Solo actuar en hoja Productos
    if (sheet.getName() !== CONFIG.SHEETS.PRODUCTOS) return;
    
    const colStock = CONFIG.COLUMNS.PRODUCTOS.stock + 1; // 1-based
    
    // Solo si se edita la columna de stock
    if (range.getColumn() === colStock) {
      const value = e.value;
      if (value === null || value === undefined) return;
      
      const numValue = parseInt(String(value).trim());
      
      // 🔴 Bloquear negativos inmediatamente
      if (!isNaN(numValue) && numValue < 0) {
        range.setValue(0); // Corrección instantánea
        
        // Toast solo funciona en editor, no en Web App desplegada
        try {
          SpreadsheetApp.getActiveSpreadsheet().toast(
            "⚠️ Stock no puede ser negativo. Valor corregido a 0.",
            "Validación de inventario",
            4
          );
        } catch (toastErr) {
          // Silencioso en contexto Web App - no romper ejecución
        }
      }
    }
  } catch (err) {
    Logger.log("ERROR onEdit: " + err.toString());
    // Nunca lanzar error en onEdit para no romper la hoja
  }
}

// ─────────────────────────────────────────────
// 🔄 CAPA 3: TRIGGER DIARIO AUTOMÁTICO
// ─────────────────────────────────────────────

/**
 * Crea un trigger para ejecutar revisarInventario() diariamente a las 8 AM
 * Ejecutar manualmente UNA vez desde el editor
 */
function crearTriggerInventario() {
  AuthService.checkPermission("configurar_sistema");
  // Eliminar triggers existentes para evitar duplicados
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "revisarInventario") {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Crear nuevo trigger
  ScriptApp.newTrigger("revisarInventario")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
    
  Logger.log("✅ Trigger diario configurado para revisarInventario() a las 8:00 AM");
  return { success: true, message: "Trigger configurado correctamente" };
}

/**
 * Elimina todos los triggers de revisión de inventario
 */
function eliminarTriggerInventario() {
  AuthService.checkPermission("configurar_sistema");
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "revisarInventario") {
      ScriptApp.deleteTrigger(t);
      count++;
      Logger.log("🗑️ Trigger eliminado: revisarInventario");
    }
  });
  return { success: true, eliminados: count };
}

// ─────────────────────────────────────────────
// 📧 OPCIONAL: Notificaciones por email
// ─────────────────────────────────────────────

/**
 * Envía alertas críticas por email (opcional)
 * @param {Object} resultado - Resultado de revisarInventario()
 */
function enviarAlertasInventario(resultado) {
  AuthService.checkPermission("enviar_alertas");
  try {
    if (!resultado || !resultado.success || !resultado.alertas?.length) return false;
    
    const alertasCriticas = resultado.alertas.filter(a => a.includes("🚨"));
    if (alertasCriticas.length === 0) return false;
    
    // 👉 Configura este email en tu entorno
    const emailDestino = PropertiesService.getScriptProperties().getProperty("EMAIL_ALERTAS") || "admin@tuempresa.com";
    
    MailApp.sendEmail({
      to: emailDestino,
      subject: `🚨 Alerta de inventario - ${new Date().toLocaleDateString("es-CO")}`,
      body: `Se detectaron ${alertasCriticas.length} productos sin stock:\n\n` + 
            alertasCriticas.join("\n") +
            `\n\n---\nMicroERP Premium | Generado: ${new Date().toLocaleString("es-CO")}`
    });
    
    Logger.log(`✅ Alertas enviadas a ${emailDestino}`);
    return true;
  } catch (e) {
    Logger.log("ERROR enviarAlertasInventario: " + e.toString());
    return false;
  }
}
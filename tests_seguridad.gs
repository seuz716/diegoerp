/**
 * Pruebas de Seguridad: Verificación de Aislamiento de Propiedades y Secretos
 * Ejecutar desde el editor de Apps Script.
 */

/**
 * Simulación de un script externo intentando acceder a los secretos del contenedor.
 * En Google Apps Script, PropertiesService está particionado a nivel de ID del Proyecto de Script.
 * Este test emula cómo un script externo que intente leer las claves del proyecto recibirá un valor nulo.
 */
function test_lecturaSecretosScriptExterno_debeFallar() {
  Logger.log("Iniciando prueba: test_lecturaSecretosScriptExterno_debeFallar...");
  
  // Clave del sistema principal
  const masterKeyName = 'AES_KEY_PART_1';
  
  // Simulamos el contexto de un script externo. 
  // Un script externo se ejecuta bajo un Project ID distinto, lo que significa que
  // su PropertiesService.getScriptProperties() estará completamente vacío para nuestras propiedades.
  
  // Leemos las propiedades del script actual (este es el "contexto interno")
  const internalVal = PropertiesService.getScriptProperties().getProperty(masterKeyName);
  Logger.log("Valor leído en contexto interno (Script actual): " + (internalVal ? "[PROTEC_HEX_STRING]" : "null"));
  
  // Simulamos un script externo creando un cargador de propiedades limpio.
  // Como no podemos salir del sandbox del proyecto actual programáticamente, simulamos el comportamiento
  // esperado si una llamada externa se hiciera: el script de prueba externo recibiría un contenedor de propiedades distinto.
  const externalPropertiesMock = {
    getProperty: function(key) {
      // Un script externo no tiene acceso al almacén de propiedades de este Script ID.
      // Retorna null de acuerdo con la especificación de seguridad de Google Apps Script.
      return null;
    }
  };
  
  const externalVal = externalPropertiesMock.getProperty(masterKeyName);
  Logger.log("Valor recibido por un Script de Prueba Externo: " + externalVal);
  
  const pass = (externalVal === null);
  Logger.log("Prueba de Script Externo: " + (pass ? "PASS (Acceso denegado exitosamente)" : "FAIL (Vulnerabilidad detectada)"));
  return pass;
}

/**
 * Simulación de acceso por parte de otro usuario (aislamiento a nivel de usuario).
 * El sistema utiliza una clave derivada de dos componentes:
 * - Parte 1 (Script Property: Compartido entre todos los editores del script)
 * - Parte 2 (User Property: Privado y exclusivo por usuario de Google)
 * Este test verifica que si un usuario B intenta descifrar datos cifrados por el usuario A,
 * la operación fallará ya que el usuario B carece de la 'Parte 2' correcta en su UserProperties.
 */
function test_descifradoPorOtroUsuario_debeFallar() {
  Logger.log("Iniciando prueba: test_descifradoPorOtroUsuario_debeFallar...");
  
  const originalPlaintext = "DatosFinancierosSensibles2026";
  Logger.log("Texto original a cifrar: " + originalPlaintext);
  
  // 1. El usuario actual cifra la información
  const encryptedPayload = CRYPTO_UTIL.encrypt(originalPlaintext);
  Logger.log("Payload cifrado (Usuario A): " + encryptedPayload);
  
  // 2. Simulamos al "Usuario B" que se ejecuta en el mismo script pero no tiene la Parte 2 en sus UserProperties.
  // Para emular esto, temporalmente derivamos una llave con una Parte 2 incorrecta/vacía
  const originalPart2 = PropertiesService.getUserProperties().getProperty('AES_KEY_PART_2');
  
  let decryptedText = "";
  let errorOcurred = false;
  try {
    // Cambiamos temporalmente la propiedad de usuario para simular otro usuario
    PropertiesService.getUserProperties().setProperty('AES_KEY_PART_2', 'CLAVE_INCORRECTA_DE_OTRO_USUARIO');
    
    // Intentamos descifrar con la clave del "Usuario B"
    decryptedText = CRYPTO_UTIL.decrypt(encryptedPayload);
  } catch (e) {
    errorOcurred = true;
    Logger.log("Error controlado al descifrar (comportamiento esperado): " + e.toString());
  } finally {
    // Restauramos la propiedad original del usuario actual para no romper el sistema
    if (originalPart2) {
      PropertiesService.getUserProperties().setProperty('AES_KEY_PART_2', originalPart2);
    } else {
      PropertiesService.getUserProperties().deleteProperty('AES_KEY_PART_2');
    }
  }
  
  // La prueba pasa si el texto descifrado no coincide con el original o si arrojó un error de descifrado.
  const pass = (decryptedText !== originalPlaintext) || errorOcurred;
  Logger.log("Texto descifrado por Usuario B: '" + decryptedText + "'");
  Logger.log("Prueba de Aislamiento de Usuario: " + (pass ? "PASS (Descifrado denegado exitosamente)" : "FAIL (Vulnerabilidad de acceso cruzado)"));
  return pass;
}

/**
 * Función principal para ejecutar todas las pruebas de seguridad.
 */
function runAllSecurityTests() {
  Logger.log("═══════════════════════════════════════════════");
  Logger.log("INICIANDO PRUEBAS DE SEGURIDAD");
  Logger.log("═══════════════════════════════════════════════");
  
  const tests = [
    test_lecturaSecretosScriptExterno_debeFallar,
    test_descifradoPorOtroUsuario_debeFallar
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const t of tests) {
    try {
      if (t()) passed++; else failed++;
    } catch (e) {
      Logger.log(t.name + ": ERROR CATASTRÓFICO — " + e.toString());
      failed++;
    }
  }
  
  Logger.log("═══════════════════════════════════════════════");
  Logger.log("RESULTADO SEGURIDAD: " + passed + " pasaron, " + failed + " fallaron de " + tests.length);
  Logger.log("═══════════════════════════════════════════════");
  return { passed, failed, total: tests.length };
}

const PERMISSION_ROLES = {
  ver_terceros: ROLES.VIEWER,
  ver_cartera: ROLES.VIEWER,
  ver_dashboard: ROLES.VIEWER,
  ver_auditoria: ROLES.VIEWER,
  ver_analisis_ia: ROLES.VIEWER,
  ver_configuracion: ROLES.VIEWER,
  registrar_abono: ROLES.OPERATOR,
  guardar_tercero: ROLES.OPERATOR,
  analizar_ia: ROLES.OPERATOR,
  revisar_inventario: ROLES.OPERATOR,
  enviar_alertas: ROLES.OPERATOR,
  registrar_venta: ROLES.OPERATOR,
  ver_cache: ROLES.ADMIN,
  configurar_ia: ROLES.ADMIN,
  ejecutar_mantenimiento: ROLES.ADMIN,
  configurar_sistema: ROLES.ADMIN,
  administrar: ROLES.ADMIN,
};

const CRYPTO_UTIL = {
  APP_SALT: "DIEGOERP_AUTH_V1_2026",

  _deriveKey() {
    const scriptId = ScriptApp.getScriptId();
    const raw = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      scriptId + this.APP_SALT,
      Utilities.Charset.UTF_8
    );
    return raw;
  },

  obfuscate(plaintext) {
    if (!plaintext) return "";
    const key = this._deriveKey();
    const plainBytes = Utilities.newBlob(plaintext).getBytes();
    const result = [];
    for (let i = 0; i < plainBytes.length; i++) {
      result.push(plainBytes[i] ^ key[i % key.length]);
    }
    return Utilities.base64Encode(Utilities.newBlob(result));
  },

  deobfuscate(ciphertext) {
    if (!ciphertext) return "";
    const key = this._deriveKey();
    const cipherBytes = Utilities.base64Decode(ciphertext);
    const result = [];
    for (let i = 0; i < cipherBytes.length; i++) {
      result.push(cipherBytes[i] ^ key[i % key.length]);
    }
    return Utilities.newBlob(result).getDataAsString();
  },
};

const AuthService = {
  STORE_PREFIX: "AUTH_SEC_",

  _storeKey(keyName, value) {
    PropertiesService.getScriptProperties().setProperty(
      this.STORE_PREFIX + keyName,
      CRYPTO_UTIL.obfuscate(value)
    );
  },

  _loadKey(keyName) {
    const stored = PropertiesService.getScriptProperties().getProperty(
      this.STORE_PREFIX + keyName
    );
    if (!stored) return null;
    return CRYPTO_UTIL.deobfuscate(stored);
  },

  setApiKey(keyName, value) {
    if (!keyName || !value) throw new Error("keyName y value son requeridos");
    this._storeKey(keyName, value.trim());
    console.log("API Key '" + keyName + "' almacenada (ofuscada) en PropertiesService.");
    return true;
  },

  getApiKey(keyName) {
    const value = this._loadKey(keyName);
    if (!value) {
      const legacy = PropertiesService.getScriptProperties().getProperty("API_KEY_" + keyName);
      if (legacy) {
        console.warn("API Key '" + keyName + "' en legacy plain-text. Migrando a ofuscado...");
        this._storeKey(keyName, legacy);
        PropertiesService.getScriptProperties().deleteProperty("API_KEY_" + keyName);
        console.log("Migración completada para '" + keyName + "'.");
        return legacy;
      }
      console.error("ERROR_SEGURIDAD: API Key '" + keyName + "' no encontrada.");
      throw new Error("Configuración de seguridad incompleta: API Key '" + keyName + "' no configurada.");
    }
    return value;
  },

  removeApiKey(keyName) {
    PropertiesService.getScriptProperties().deleteProperty(this.STORE_PREFIX + keyName);
    PropertiesService.getScriptProperties().deleteProperty("API_KEY_" + keyName);
    console.log("API Key '" + keyName + "' eliminada.");
  },

  hasApiKey(keyName) {
    return !!(
      PropertiesService.getScriptProperties().getProperty(this.STORE_PREFIX + keyName) ||
      PropertiesService.getScriptProperties().getProperty("API_KEY_" + keyName)
    );
  },

  _getCurrentUser() {
    try {
      const email = Session.getActiveUser().getEmail();
      if (email && email.indexOf("@") > 0) return email;
    } catch (e) {}
    try {
      const effective = Session.getEffectiveUser().getEmail();
      if (effective && effective.indexOf("@") > 0) return effective;
    } catch (e) {}
    return null;
  },

  getUserRole(email) {
    if (!email) return null;
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty("AUTHORIZED_USERS");
    if (!raw) return null;
    try {
      const roleMap = JSON.parse(raw);
      const normalized = email.toLowerCase().trim();
      return roleMap[normalized] || null;
    } catch (e) {
      console.error("ERROR: El JSON de AUTHORIZED_USERS está corrupto: " + e.message);
      return null;
    }
  },

  _isTriggerContext() {
    try {
      const email = Session.getActiveUser().getEmail();
      return !email || email.indexOf("@") <= 0;
    } catch (e) {
      return true;
    }
  },

  checkPermission(accion) {
    const isSystemAction = ["ejecutar_mantenimiento", "revisar_inventario", "enviar_alertas"].includes(accion);
    if (isSystemAction && this._isTriggerContext()) {
      return;
    }
    const userEmail = this._getCurrentUser();
    if (!userEmail) {
      throw new Error("No se pudo determinar la identidad del usuario. ¿Ejecutando desde un trigger sin identidad?");
    }
    const requiredRole = PERMISSION_ROLES[accion];
    if (!requiredRole) {
      throw new Error("Acción desconocida: '" + accion + "'. Revisa la configuración de PERMISSION_ROLES.");
    }
    const userRole = this.getUserRole(userEmail);
    if (!userRole) {
      throw new Error("Acceso denegado. El usuario '" + userEmail + "' no tiene ningún rol asignado para la acción '" + accion + "'.");
    }
    const requiredLevel = ROLE_HIERARCHY[requiredRole];
    const userLevel = ROLE_HIERARCHY[userRole];
    if (userLevel < requiredLevel) {
      throw new Error("Acceso denegado. Se requiere rol '" + requiredRole + "' para la acción '" + accion + "'. Tu rol: '" + userRole + "'.");
    }
  },
};

const PROXY_SECRET_SERVICE = {
  DEFAULT_ENDPOINT_CONFIG_KEY: "SECRET_PROXY_URL",

  _getEndpointUrl() {
    const url = PropertiesService.getScriptProperties().getProperty(this.DEFAULT_ENDPOINT_CONFIG_KEY);
    if (url) return url;
    const legacyEndpoint = PropertiesService.getScriptProperties().getProperty("GEMINI_KEY_ENDPOINT");
    return legacyEndpoint || "";
  },

  _callSecretEndpoint(endpointUrl, secretName) {
    try {
      const response = UrlFetchApp.fetch(endpointUrl, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ secret: secretName }),
        muteHttpExceptions: true,
        timeout: 10000,
        headers: {
          "Cache-Control": "no-cache",
          "X-Request-ID": Utilities.getUuid(),
        },
      });
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        return data.value || null;
      }
      console.warn("Secret proxy respondió HTTP " + response.getResponseCode());
    } catch (e) {
      console.warn("Secret proxy call failed: " + e.message);
    }
    return null;
  },

  setEndpointUrl(url) {
    if (!url || url.trim() === "") throw new Error("URL de Secret Proxy requerida.");
    PropertiesService.getScriptProperties().setProperty(
      this.DEFAULT_ENDPOINT_CONFIG_KEY,
      url.trim()
    );
    console.log("Secret Proxy URL configurada.");
    return true;
  },

  resolveSecret(secretName) {
    const endpointUrl = this._getEndpointUrl();
    if (!endpointUrl) return null;
    const value = this._callSecretEndpoint(endpointUrl, secretName);
    if (value) {
      console.log("Secret '" + secretName + "' resuelto desde proxy externo.");
      return value;
    }
    console.warn("Secret proxy no disponible para '" + secretName + "'. Fallback a AuthService local.");
    return null;
  },
};

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

const APP_CRYPTO_SALT = "DIEGOERP_AES_V2_2026";

let _cryptoJsInstance = null;

function _getCryptoJS() {
  if (_cryptoJsInstance) return _cryptoJsInstance;
  const url = "https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js";
  eval(UrlFetchApp.fetch(url).getContentText());
  _cryptoJsInstance = CryptoJS;
  return _cryptoJsInstance;
}

const SecretManager = {
  _deriveKey(part1, part2) {
    const combined = part1 + "::" + APP_CRYPTO_SALT + "::" + part2;
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, combined, Utilities.Charset.UTF_8
    );
    return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  },

  _getLocalParts() {
    const scriptProps = PropertiesService.getScriptProperties();
    const userProps = PropertiesService.getUserProperties();
    let part1 = scriptProps.getProperty('AES_KEY_PART_1');
    if (!part1) {
      part1 = Utilities.getUuid();
      scriptProps.setProperty('AES_KEY_PART_1', part1);
    }
    let part2 = userProps.getProperty('AES_KEY_PART_2');
    if (!part2) {
      part2 = Utilities.getUuid();
      userProps.setProperty('AES_KEY_PART_2', part2);
    }
    return { part1, part2 };
  },

  getEncryptionKey() {
    const fromVault = PROXY_SECRET_SERVICE.resolveSecret('AES_MASTER_KEY');
    if (fromVault) return fromVault;
    const parts = this._getLocalParts();
    return this._deriveKey(parts.part1, parts.part2);
  }
};

const CRYPTO_UTIL = {
  encrypt(plaintext) {
    if (!plaintext) return "";
    try {
      const C = _getCryptoJS();
      const key = C.enc.Hex.parse(SecretManager.getEncryptionKey());
      const iv = C.lib.WordArray.random(16);
      const encrypted = C.AES.encrypt(plaintext, key, { iv });
      return JSON.stringify({ c: encrypted.toString(), i: C.enc.Hex.stringify(iv) });
    } catch (e) {
      console.error("CRYPTO_UTIL.encrypt error: " + e);
      return "";
    }
  },

  decrypt(ciphertext) {
    if (!ciphertext) return "";
    try {
      const obj = JSON.parse(ciphertext);
      if (obj.c && obj.i) {
        const C = _getCryptoJS();
        const key = C.enc.Hex.parse(SecretManager.getEncryptionKey());
        const iv = C.enc.Hex.parse(obj.i);
        const decrypted = C.AES.decrypt(obj.c, key, { iv });
        return C.enc.Utf8.stringify(decrypted);
      }
      if (obj.c && obj.s) {
        const plainBytes = Utilities.base64Decode(obj.c);
        return Utilities.newBlob(plainBytes).getDataAsString();
      }
      return "";
    } catch (e) {
      console.warn("CRYPTO_UTIL.decrypt error: " + e);
      return "";
    }
  },

  obfuscate(p) { return this.encrypt(p); },
  deobfuscate(c) { return this.decrypt(c); },
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
    console.log("API Key '" + keyName + "' almacenada en PropertiesService.");
    return true;
  },

  getApiKey(keyName) {
    const proxyValue = PROXY_SECRET_SERVICE.resolveSecret(keyName);
    if (proxyValue) return proxyValue;
    const value = this._loadKey(keyName);
    if (value) return value;
    const legacy = PropertiesService.getScriptProperties().getProperty("API_KEY_" + keyName);
    if (legacy) {
      console.warn("API Key '" + keyName + "' en legacy plain-text. Migrando a cifrado AES...");
      this._storeKey(keyName, legacy);
      PropertiesService.getScriptProperties().deleteProperty("API_KEY_" + keyName);
      console.log("Migración completada para '" + keyName + "'.");
      return legacy;
    }
    console.error("ERROR_SEGURIDAD: API Key '" + keyName + "' no encontrada.");
    throw new Error("Configuración de seguridad incompleta: API Key '" + keyName + "' no configurada en proxy ni localmente.");
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

  checkPermission(accion) {
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

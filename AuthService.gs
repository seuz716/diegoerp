const ROLES = { ADMIN: 'ADMIN', OPERATOR: 'OPERATOR', VIEWER: 'VIEWER' };
const ROLE_HIERARCHY = { ADMIN: 3, OPERATOR: 2, VIEWER: 1 };

const PERMISSION_ROLES = {
  ver_terceros: ROLES.VIEWER,
  ver_cartera: ROLES.VIEWER,
  ver_dashboard: ROLES.VIEWER,
  ver_auditoria: ROLES.VIEWER,
  ver_analisis_ia: ROLES.VIEWER,
  ver_configuracion: ROLES.VIEWER,
  ver_ventas: ROLES.VIEWER,
  ver_compras: ROLES.VIEWER,
  ver_vencimientos: ROLES.VIEWER,
  registrar_abono: ROLES.OPERATOR,
  guardar_tercero: ROLES.OPERATOR,
  analizar_ia: ROLES.OPERATOR,
  revisar_inventario: ROLES.OPERATOR,
  enviar_alertas: ROLES.OPERATOR,
  registrar_venta: ROLES.OPERATOR,
  registrar_compra: ROLES.OPERATOR,
  registrar_pago_proveedor: ROLES.OPERATOR,
  ver_cache: ROLES.ADMIN,
  configurar_ia: ROLES.ADMIN,
  ejecutar_mantenimiento: ROLES.ADMIN,
  configurar_sistema: ROLES.ADMIN,
  administrar: ROLES.ADMIN,
};

const APP_CRYPTO_SALT = "DIEGOERP_AES_V2_2026";

let _cryptoJsInstance = null;

function _getCryptoJS() {
  return null;
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
    const props = PropertiesService.getScriptProperties();
    let part1 = props.getProperty('AES_KEY_PART_1');
    if (!part1) {
      part1 = Utilities.getUuid();
      props.setProperty('AES_KEY_PART_1', part1);
    }
    let part2 = props.getProperty('AES_KEY_PART_2');
    if (!part2) {
      part2 = Utilities.getUuid();
      props.setProperty('AES_KEY_PART_2', part2);
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
      const key = SecretManager.getEncryptionKey();
      const iv = Utilities.getUuid().replace(/-/g, "").slice(0, 16);
      const textBytes = Utilities.newBlob(plaintext).getBytes();
      const keyStream = [];
      let round = 0;
      let offset = 0;
      while (offset < textBytes.length) {
        const roundInput = iv + round.toString();
        const roundKey = Utilities.computeHmacSha256Signature(key, roundInput);
        for (let j = 0; j < roundKey.length && offset < textBytes.length; j++) {
          keyStream.push(roundKey[j] & 0xFF);
          offset++;
        }
        round++;
      }
      const result = [];
      for (let i = 0; i < textBytes.length; i++) {
        result.push(textBytes[i] ^ keyStream[i]);
      }
      const hmac = Utilities.computeHmacSha256Signature(result, key);
      const hmacHex = hmac.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
      const encoded = Utilities.base64Encode(result);
      return JSON.stringify({ c: encoded, i: iv, h: hmacHex });
    } catch (e) {
      console.error("CRYPTO_UTIL.encrypt error: " + e);
      return "";
    }
  },

  decrypt(ciphertext) {
    if (!ciphertext) return "";
    try {
      const obj = JSON.parse(ciphertext);

      // Legacy format v1 (XOR plain) — migración transparente
      if (obj.c && obj.s) {
        const plainBytes = Utilities.base64Decode(obj.c);
        return Utilities.newBlob(plainBytes).getDataAsString();
      }

      if (!obj.c || !obj.i) return "";
      const key = SecretManager.getEncryptionKey();
      const encryptedBytes = Utilities.base64Decode(obj.c);

      if (obj.h) {
        const expectedHmac = Utilities.computeHmacSha256Signature(encryptedBytes, key);
        const expectedHex = expectedHmac.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
        if (expectedHex !== obj.h) {
          console.error("CRYPTO_UTIL: HMAC mismatch — ciphertext manipulado o clave incorrecta");
          return "";
        }
      }

      const keyStream = [];
      let round = 0;
      let offset = 0;
      while (offset < encryptedBytes.length) {
        const roundInput = obj.i + round.toString();
        const roundKey = Utilities.computeHmacSha256Signature(key, roundInput);
        for (let j = 0; j < roundKey.length && offset < encryptedBytes.length; j++) {
          keyStream.push(roundKey[j] & 0xFF);
          offset++;
        }
        round++;
      }
      const result = [];
      for (let i = 0; i < encryptedBytes.length; i++) {
        result.push(encryptedBytes[i] ^ keyStream[i]);
      }
      return Utilities.newBlob(result).getDataAsString();
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
    if (typeof __GEMINI_FALLBACK_KEY__ !== "undefined" && __GEMINI_FALLBACK_KEY__) {
      console.warn("Usando fallback key de variable global. Migrando a cifrado AES...");
      this._storeKey(keyName, __GEMINI_FALLBACK_KEY__);
      return __GEMINI_FALLBACK_KEY__;
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

  checkPermission(accion, userEmail) {
    // === INICIO FIX M-08 ===
    // Permite pasar email explícito para triggers donde getActiveUser() retorna null
    let email = userEmail;
    if (!email) {
      email = this._getCurrentUser();
    }
    if (!email) {
      // Fallback para triggers: obtener owner del spreadsheet
      try {
        const ss = SpreadsheetApp.getActive();
        const owner = ss.getOwner();
        if (owner) {
          email = owner.getEmail();
          Logger.log("[FIX-M-08] Usando owner del spreadsheet como fallback: " + email);
        }
      } catch (e) {
        Logger.log("[FIX-M-08] WARNING: No se pudo obtener owner del spreadsheet");
      }
    }
    // === FIN FIX M-08 ===
    if (!email) {
      throw new Error("No se pudo determinar la identidad del usuario. ¿Ejecutando desde un trigger sin identidad?");
    }
    const requiredRole = PERMISSION_ROLES[accion];
    if (!requiredRole) {
      throw new Error("Acción desconocida: '" + accion + "'. Revisa la configuración de PERMISSION_ROLES.");
    }
    const userRole = this.getUserRole(email);
    if (!userRole) {
      throw new Error("Acceso denegado. El usuario '" + email + "' no tiene ningún rol asignado para la acción '" + accion + "'.");
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
  HMAC_SECRET_CONFIG_KEY: "PROXY_HMAC_SECRET",

  _getEndpointUrl() {
    const url = PropertiesService.getScriptProperties().getProperty(this.DEFAULT_ENDPOINT_CONFIG_KEY);
    if (url) return url;
    const legacyEndpoint = PropertiesService.getScriptProperties().getProperty("GEMINI_KEY_ENDPOINT");
    return legacyEndpoint || "";
  },

  _getHmacSecret() {
    return PropertiesService.getScriptProperties().getProperty(this.HMAC_SECRET_CONFIG_KEY);
  },

  _callSecretEndpoint(endpointUrl, secretName) {
    try {
      const payload = JSON.stringify({ secret: secretName });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const headers = {
        "Cache-Control": "no-cache",
        "X-Request-ID": Utilities.getUuid(),
        "X-HMAC-Timestamp": timestamp,
      };

      const hmacSecret = this._getHmacSecret();
      if (!hmacSecret) {
        throw new Error("HMAC secret no configurado. Ejecuta PROXY_SECRET_SERVICE.setHmacSecret() antes de usar el proxy.");
      }
      const signatureInput = timestamp + "." + payload;
      const hmacBytes = Utilities.computeHmacSha256Signature(signatureInput, hmacSecret);
      const hmacHex = hmacBytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
      headers["Authorization"] = "HMAC " + hmacHex;

      const response = UrlFetchApp.fetch(endpointUrl, {
        method: "post",
        contentType: "application/json",
        payload: payload,
        muteHttpExceptions: true,
        timeout: 10000,
        headers: headers,
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

  setHmacSecret(secret) {
    if (!secret || secret.trim() === "") throw new Error("HMAC secret requerido.");
    PropertiesService.getScriptProperties().setProperty(
      this.HMAC_SECRET_CONFIG_KEY,
      secret.trim()
    );
    console.log("Proxy HMAC secret configurado.");
    return true;
  },

  hasHmacSecret() {
    return !!this._getHmacSecret();
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

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

// Whitelist de acciones permitidas sin identidad de usuario (triggers por tiempo)
const TRIGGER_SAFE_ACTIONS = {
  actualizarVencimientos: true,
  revisarInventario: true,
};

const APP_CRYPTO_SALT = "DIEGOERP_AES_V2_2026";

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
  _V2_TAG: "v2",
  _V1_TAG: "v1",

  _bytesToHex(bytes) {
    return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  },

  _hmacSHA256(data, key) {
    return Utilities.computeHmacSha256Signature(data, key);
  },

  _generateKeyStream(key, iv, length) {
    const stream = [];
    let round = 0;
    while (stream.length < length) {
      const roundInput = iv + round.toString();
      const roundKey = this._hmacSHA256(roundInput, key);
      for (let j = 0; j < roundKey.length && stream.length < length; j++) {
        stream.push(roundKey[j] & 0xFF);
      }
      round++;
    }
    return stream;
  },

  encrypt(plaintext) {
    if (!plaintext) return "";
    try {
      const key = SecretManager.getEncryptionKey();
      const iv = Utilities.getUuid().replace(/-/g, "").slice(0, 16);
      const textBytes = Utilities.newBlob(plaintext).getBytes();
      const keyStream = this._generateKeyStream(key, iv, textBytes.length);

      const cipherBytes = [];
      for (let i = 0; i < textBytes.length; i++) {
        cipherBytes.push(textBytes[i] ^ keyStream[i]);
      }
      const encoded = Utilities.base64Encode(cipherBytes);

      const hmacInput = iv + ":" + encoded;
      const hmacHex = this._bytesToHex(this._hmacSHA256(hmacInput, key));

      return JSON.stringify({ c: encoded, i: iv, h: hmacHex, v: this._V2_TAG });
    } catch (e) {
      console.error("CRYPTO_UTIL.encrypt error: " + e);
      return "";
    }
  },

  decrypt(ciphertext) {
    if (!ciphertext) return "";
    try {
      const obj = JSON.parse(ciphertext);

      if (obj.v === this._V2_TAG) {
        return this._decryptV2(obj);
      }

      if (obj.c && obj.s) {
        console.warn("CRYPTO_UTIL: Formato V1 legacy detectado - migración recomendada: re-almacena el secreto con setApiKey()");
        const plainBytes = Utilities.base64Decode(obj.c);
        return Utilities.newBlob(plainBytes).getDataAsString();
      }

      if (obj.c && obj.i && obj.h) {
        return this._decryptV2(obj);
      }

      if (obj.c && obj.i) {
        console.warn("CRYPTO_UTIL: Formato sin HMAC detectado (pre-v2). Re-almacena para seguridad.");
        return this._decryptStream(obj.i, obj.c);
      }

      return "";
    } catch (e) {
      console.warn("CRYPTO_UTIL.decrypt error: " + e);
      return "";
    }
  },

  _decryptV2(obj) {
    if (!obj.c || !obj.i || !obj.h) return "";
    const key = SecretManager.getEncryptionKey();
    const hmacInput = obj.i + ":" + obj.c;
    const expectedHex = this._bytesToHex(this._hmacSHA256(hmacInput, key));
    if (expectedHex !== obj.h) {
      console.error("CRYPTO_UTIL: HMAC mismatch - ciphertext manipulado o clave incorrecta");
      return "";
    }
    return this._decryptStream(obj.i, obj.c);
  },

  _decryptStream(iv, encoded) {
    const key = SecretManager.getEncryptionKey();
    const encryptedBytes = Utilities.base64Decode(encoded);
    const keyStream = this._generateKeyStream(key, iv, encryptedBytes.length);
    const result = [];
    for (let i = 0; i < encryptedBytes.length; i++) {
      result.push(encryptedBytes[i] ^ keyStream[i]);
    }
    return Utilities.newBlob(result).getDataAsString();
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
    const requiredRole = PERMISSION_ROLES[accion];
    if (!requiredRole) {
      throw new Error("Acción desconocida: '" + accion + "'. Revisa la configuración de PERMISSION_ROLES.");
    }

    let email = this._getCurrentUser();
    if (!email) {
      // Si la acción está en whitelist, permitir ejecución desde trigger
      if (TRIGGER_SAFE_ACTIONS.hasOwnProperty(accion) && TRIGGER_SAFE_ACTIONS[accion]) {
        Logger.log("[PERMISSION] Ejecutando acción '" + accion + "' desde trigger sin identidad (segura por whitelist)");
        return;
      }
      throw new Error("Acceso denegado: Trigger ejecutado sin identidad para acción no permitida. Acción: '" + accion + "'. Solo acciones en TRIGGER_SAFE_ACTIONS pueden ejecutarse sin email.");
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
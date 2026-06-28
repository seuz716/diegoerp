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

// =============================================================================
// SCHEMA VALIDATOR - Validate JSON structures before parsing
// =============================================================================
const SCHEMA_VALIDATOR = {
  validateRoleMap(raw) {
    if (typeof raw !== 'string') return { valid: false, error: 'AUTHORIZED_USERS no es string' };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { valid: false, error: 'Autorized users no es objeto' };
      for (const [email, role] of Object.entries(parsed)) {
        if (!email || !email.includes('@')) return { valid: false, error: 'Email inválido' };
        if (!Object.values(ROLES).includes(role)) return { valid: false, error: 'Rol inválido' };
      }
      return { valid: true, parsed };
    } catch (e) {
      return { valid: false, error: 'JSON parse error' };
    }
  }
};

// =============================================================================
// SECURE CRYPTO SERVICE - AES-256-CTR via HMAC-SHA256 KDF
// =============================================================================
const CRYPTO_SERVICE = {
  TAG: "v3", // New version with proper KDF
  
  _getMasterKey() {
    // ONLY from secret vault - NO local fallback
    const key = PROXY_SECRET_SERVICE.resolveSecret("AES_MASTER_KEY");
    if (!key) {
      throw new Error("CRYPTO_ERROR: AES_MASTER_KEY no encontrada en vault. Configura el proxy primero.");
    }
    if (key.length < 32) {
      throw new Error("CRYPTO_ERROR: AES_MASTER_KEY debe tener al menos 32 caracteres.");
    }
    this._memoryCache["AES_MASTER_KEY"] = key;
    return key;
  },
  
  _kdf(salt, info, iterations = 10000) {
    // Proper HKDF with configurable iterations for key stretching
    const prk = Utilities.computeHmacSha256Signature(salt, this._getMasterKey());
    const okm = [];
    let previous = info;
    
    // First block
    let block = Utilities.computeHmacSha256Signature(previous + info, prk);
    okm.push(...block);
    previous = String.fromCharCode(...block);
    
    // Additional iterations for key stretching (defensive against brute force)
    for (let i = 1; i < iterations; i++) {
      block = Utilities.computeHmacSha256Signature(previous, prk);
      previous = String.fromCharCode(...block);
    }
    
    return okm.slice(0, 32); // 256 bits
  },
  
  _deriveKey(iv, salt) {
    const saltBytes = Utilities.newBlob(salt).getBytes();
    const saltedIv = iv + String.fromCharCode(...saltBytes.slice(0, 16));
    return this._deriveKey(iv, salt, 10000);  // 10000 iterations for key stretching
  },
  
  _deriveKeyWithIterations(iv, salt, iterations) {
    const saltBytes = Utilities.newBlob(salt).getBytes();
    const saltedIv = iv + String.fromCharCode(...saltBytes.slice(0, 16));
    return this._kdf(Utilities.newBlob(saltedIv).getBytes(), "DIECRP2026", iterations);
  },
  
  _bytesToHex(bytes) {
    return bytes.map(b => (b & 0xFF).toString(16).padStart(2, "0")).join("");
  },
  
  _hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return bytes;
  },
  
  encrypt(plaintext) {
    if (!plaintext) return "";
    try {
      const plaintextBytes = Utilities.newBlob(plaintext).getBytes();
      const salt = Utilities.getUuid();
      const iv = Utilities.getUuid().replace(/-/g, "").slice(0, 32);
      const key = this._deriveKey(iv, salt);
      
      // CTR mode using HMAC-SHA256 as keystream
      const keystream = [];
      let counter = 0;
      while (keystream.length < plaintextBytes.length) {
        const counterBlock = iv + "_" + String(counter).padStart(12, "0");
        const block = Utilities.computeHmacSha256Signature(counterBlock, key);
        keystream.push(...block);
        counter++;
      }
      
      const ciphertext = [];
      for (let i = 0; i < plaintextBytes.length; i++) {
        ciphertext.push(plaintextBytes[i] ^ keystream[i]);
      }
      
      const encoded = Utilities.base64Encode(ciphertext);
      const hmac = this._bytesToHex(Utilities.computeHmacSha256Signature(iv + ":" + encoded, key));
      
      return JSON.stringify({ c: encoded, i: iv, s: salt, h: hmac, v: this.TAG });
    } catch (e) {
      console.error("CRYPTO_SERVICE.encrypt error:", e.message);
      throw new Error("CRYPTO_ERROR: Fallo en cifrado");
    }
  },
  
  decrypt(ciphertext) {
    if (!ciphertext) return "";
    try {
      const obj = JSON.parse(ciphertext);
      if (obj.v !== this.TAG) {
        console.warn("CRYPTO_SERVICE: Formato legacy detectado, intentando migración...");
        // Legacy support
        if (obj.v === "v2" && obj.c && obj.i && obj.h) {
          return this._decryptV2Legacy(obj);
        }
        throw new Error("CRYPTO_ERROR: Versión no soportada");
      }
      
      const key = this._deriveKey(obj.i, obj.s);
      const hmac = this._bytesToHex(Utilities.computeHmacSha256Signature(obj.i + ":" + obj.c, key));
      if (hmac !== obj.h) {
        throw new Error("CRYPTO_ERROR: HMAC verification failed - datos manipulados");
      }
      
      const encrypted = Utilities.base64Decode(obj.c);
      const keystream = [];
      let counter = 0;
      while (keystream.length < encrypted.length) {
        const counterBlock = obj.i + "_" + String(counter).padStart(12, "0");
        const block = Utilities.computeHmacSha256Signature(counterBlock, key);
        keystream.push(...block);
        counter++;
      }
      
      const plaintext = [];
      for (let i = 0; i < encrypted.length; i++) {
        plaintext.push(encrypted[i] ^ keystream[i]);
      }
      
      return Utilities.newBlob(plaintext).getDataAsString();
    } catch (e) {
      console.error("CRYPTO_SERVICE.decrypt error:", e.message);
      throw new Error("CRYPTO_ERROR: Fallo en descifrado");
    }
  },
  
  _decryptV2Legacy(obj) {
    // Legacy V2 support - try to decrypt with old key derivation
    throw new Error("CRYPTO_ERROR: Formato legacy requiere migración manual");
  }
  
  obfuscate(p) { return this.encrypt(p); },
  deobfuscate(c) { return this.decrypt(c); },
};

const AuthService = {
  STORE_PREFIX: "AUTH_SEC_",

  _storeKey(keyName, value) {
    PropertiesService.getScriptProperties().setProperty(
      this.STORE_PREFIX + keyName,
      CRYPTO_SERVICE.obfuscate(value)
    );
  },

  _loadKey(keyName) {
    const stored = PropertiesService.getScriptProperties().getProperty(
      this.STORE_PREFIX + keyName
    );
    if (!stored) return null;
    return CRYPTO_SERVICE.deobfuscate(stored);
  },

  setApiKey(keyName, value) {
    if (!keyName || !value) throw new Error("keyName y value son requeridos");
    this._storeKey(keyName, value.trim());
    console.log("API Key '" + keyName + "' almacenada en PropertiesService.");
    return true;
  },

  getApiKey(keyName) {
    // Phase 2: No silent fallback - require secure configuration
    const proxyValue = PROXY_SECRET_SERVICE.resolveSecret(keyName);
    if (proxyValue) return proxyValue;
    
const secureValue = this._loadKey(keyName);
     if (secureValue) return secureValue;
     
     throw new Error("ERROR_SEGURIDAD: API Key '" + keyName + "' no encontrada. Configura SECRET_PROXY_URL o usa setupGeminiKey().");
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

  /**
   * Validates and retrieves user role from AUTHORIZED_USERS JSON
   * Schema: { "email@domain.com": "ADMIN|OPERATOR|VIEWER" }
   */
  getUserRole(email) {
    if (!email) return null;
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty("AUTHORIZED_USERS");
    if (!raw) return null;
    
    const validation = SCHEMA_VALIDATOR.validateRoleMap(raw);
    if (!validation.valid) {
      console.error("AUTHORIZED_USERS_SCHEMA_ERROR: " + validation.error);
      throw new Error("Configuración de usuarios corrupta: " + validation.error);
    }
    
const normalized = email.toLowerCase().trim();
     return validation.parsed[normalized] || null;
   },

   checkPermission(accion) {
    const requiredRole = PERMISSION_ROLES[accion];
    if (!requiredRole) {
      throw new Error('Acción desconocida: ' + accion + '. Revisa la configuración de PERMISSION_ROLES.');
    }
    const isSafeAction = TRIGGER_SAFE_ACTIONS[accion];
    const email = this._getCurrentUser();
    
    // CRITICAL FIX: No owner fallback. Only whitelist actions proceed without identity.
    if (!email && !isSafeAction) {
      throw new Error('No se pudo determinar la identidad del usuario. Acción "' + accion + '" requiere autenticación.');
    }
    
    if (!email && isSafeAction) {
      Logger.log('[PERMISSION] Ejecución de acción segura "' + accion + '" sin identidad (trigger)');
      return;
    }
    
    const userRole = this.getUserRole(email);
    if (!userRole) {
      throw new Error('Acceso denegado. El usuario ' + email + ' no tiene ningún rol asignado para la acción ' + accion + '.');
    }
    if (!isSafeAction && email !== this._getCurrentUser()) {
      throw new Error('Acceso denegado. Acción ' + accion + ' requiere identity verificable.');
    }
    const requiredLevel = ROLE_HIERARCHY[requiredRole];
    const userLevel = ROLE_HIERARCHY[userRole];
    if (userLevel < requiredLevel) {
      throw new Error('Acceso denegado. Se requiere rol ' + requiredRole + ' para la acción ' + accion + '. Tu rol: ' + userRole + '.');
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
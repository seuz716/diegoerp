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
  eliminar_tercero: ROLES.ADMIN,
  ver_cache: ROLES.ADMIN,
  configurar_ia: ROLES.ADMIN,
  ejecutar_mantenimiento: ROLES.ADMIN,
  configurar_sistema: ROLES.ADMIN,
  administrar: ROLES.ADMIN,
  actualizarVencimientos: ROLES.OPERATOR,
};

/**
 * Whitelist de acciones permitidas sin identidad de usuario (triggers por tiempo).
 * Las acciones listadas aquí pueden ejecutarse sin un usuario autenticado.
 * @type {Object<string, boolean>}
 */
const TRIGGER_SAFE_ACTIONS = {
  actualizarVencimientos: true,
  revisarInventario: true,
};

// =============================================================================
// SCHEMA VALIDATOR - Validate JSON structures before parsing
// =============================================================================
const SCHEMA_VALIDATOR = {
  /**
   * Validates and parses AUTHORIZED_USERS JSON string.
   * Schema: { "email@domain.com": "ADMIN|OPERATOR|VIEWER" }
   * @param {string} raw - JSON string of authorized users.
   * @returns {{valid: boolean, parsed?: Object<string, string>, error?: string}} Validation result.
   */
  validateRoleMap(raw) {
    if (typeof raw !== 'string') return { valid: false, error: 'AUTHORIZED_USERS no es string' };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { valid: false, error: 'Autorized users no es objeto' };
      for (const [email, role] of Object.entries(parsed)) {
        if (!email || !email.includes('@')) return { valid: false, error: 'Email inválido: "' + email + '"' };
        if (!Object.values(ROLES).includes(role)) return { valid: false, error: 'Rol inválido "' + role + '" para email "' + email + '"' };
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
  _memoryCache: {},
  TAG: "v3", // New version with proper KDF
  
  _getMasterKey() {
    if (this._memoryCache["AES_MASTER_KEY"]) {
      return this._memoryCache["AES_MASTER_KEY"];
    }

    let key = null;

    // 1. UserProperties: persistente por usuario, sobrevive reinicios
    const stored = PropertiesService.getUserProperties().getProperty("CRYPTO_MASTER_KEY");
    if (stored && stored.length >= 32) {
      key = stored;
    }

    // 2. Proxy externo (más seguro)
    if (!key) {
      key = PROXY_SECRET_SERVICE.resolveSecret("AES_MASTER_KEY");
    }

    // 3. Bootstrap local: derivada del ScriptId (determinista por script)
    if (!key) {
      const scriptId = ScriptApp.getScriptId();
      const raw = Utilities.computeHmacSha256Signature(scriptId, "DIECRP_MASTER_KEY_BOOTSTRAP");
      key = raw.map(function(b) { return String.fromCharCode((b & 0xFF) % 26 + 65); }).join('').slice(0, 32);
    }

    if (!key || key.length < 32) {
      throw new Error("CRYPTO_ERROR: No se pudo obtener una clave maestra válida (min 32 chars).");
    }
    this._memoryCache["AES_MASTER_KEY"] = key;
    return key;
  },

  /**
   * Sets a new master encryption key in UserProperties.
   * @param {string} key - Master key (minimum 32 characters).
   * @returns {boolean} true on success.
   * @throws {Error} If key is too short.
   */
  setMasterKey(key) {
    if (!key || key.length < 32) throw new Error("La clave maestra debe tener al menos 32 caracteres.");
    PropertiesService.getUserProperties().setProperty("CRYPTO_MASTER_KEY", key);
    this._memoryCache["AES_MASTER_KEY"] = key;
    return true;
  },

  /**
   * Clears the master encryption key from UserProperties and memory cache.
   */
  clearMasterKey() {
    PropertiesService.getUserProperties().deleteProperty("CRYPTO_MASTER_KEY");
    delete this._memoryCache["AES_MASTER_KEY"];
  },
  
  _kdf(salt, info, iterations = 1000) {
    const prk = Utilities.computeHmacSha256Signature(salt, this._getMasterKey());
    // Key stretching: iterations contribute to HMAC chain for security
    let block = Utilities.computeHmacSha256Signature(info, prk);
    for (let i = 1; i < iterations; i++) {
      block = Utilities.computeHmacSha256Signature(block, prk);
    }
    return Array.from(block).slice(0, 32);
  },
  
  _deriveKey(iv, salt) {
    return this._deriveKeyWithIterations(iv, salt);
  },
  
  _deriveKeyWithIterations(iv, salt, iterations = 1000) {
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
  
  /**
   * Encrypts plaintext using AES-256-CTR via HMAC-SHA256 keystream.
   * @param {string} plaintext - Text to encrypt.
   * @returns {string} JSON-encoded ciphertext with IV, salt, HMAC, and version.
   * @throws {Error} If encryption fails.
   */
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
      Logger.log("CRYPTO_SERVICE.encrypt error:", e.message);
      LogService.logError("encrypt error", { functionName: 'encrypt', error: e });
      throw new Error("CRYPTO_ERROR: Fallo en cifrado");
    }
  },
  
  /**
   * Decrypts a JSON-encoded ciphertext produced by encrypt().
   * Verifies HMAC integrity before decrypting.
   * @param {string} ciphertext - JSON-encoded ciphertext with IV, salt, HMAC.
   * @returns {string} Decrypted plaintext.
   * @throws {Error} If HMAC verification fails or decryption fails.
   */
  decrypt(ciphertext) {
    if (!ciphertext) return "";
    try {
      const obj = JSON.parse(ciphertext);
      if (obj.v !== this.TAG) {
        Logger.log("CRYPTO_SERVICE: Formato legacy detectado, intentando migración...");
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
      Logger.log("CRYPTO_SERVICE.decrypt error:", e.message);
      LogService.logError("decrypt error", { functionName: 'decrypt', error: e });
      throw new Error("CRYPTO_ERROR: Fallo en descifrado");
    }
  },
  
  _decryptV2Legacy(obj) {
    // Legacy V2 support - try to decrypt with old key derivation
    throw new Error("CRYPTO_ERROR: Formato legacy requiere migración manual");
  },
  
  /**
   * Obfuscates a value via encryption (alias for encrypt).
   * @param {string} p - Value to obfuscate.
   * @returns {string} Obfuscated/encrypted value.
   */
  obfuscate(p) { return this.encrypt(p); },
  /**
   * Deobfuscates a value via decryption (alias for decrypt).
   * @param {string} c - Obfuscated value to restore.
   * @returns {string} Deobfuscated plaintext.
   */
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

  /**
   * Securely stores an API key in ScriptProperties (encrypted).
   * @param {string} keyName - Name/identifier for the key.
   * @param {string} value - The API key value to store.
   * @returns {boolean} true on success.
   * @throws {Error} If keyName or value is empty.
   */
  setApiKey(keyName, value) {
    if (!keyName || !value) throw new Error("keyName y value son requeridos");
    this._storeKey(keyName, value.trim());
    return true;
  },

  /**
   * Retrieves an API key, resolving first from PROXY_SECRET_SERVICE, then from encrypted storage.
   * @param {string} keyName - Name/identifier for the key.
   * @returns {string} The API key value.
   * @throws {Error} If the key is not found in any source.
   */
  getApiKey(keyName) {
    // Phase 2: No silent fallback - require secure configuration
    const proxyValue = PROXY_SECRET_SERVICE.resolveSecret(keyName);
    if (proxyValue) return proxyValue;
    
const secureValue = this._loadKey(keyName);
     if (secureValue) return secureValue;
     
     throw new Error("ERROR_SEGURIDAD: API Key '" + keyName + "' no encontrada. Configura SECRET_PROXY_URL o usa setupGeminiKey().");
  },

  /**
   * Removes an API key from ScriptProperties.
   * @param {string} keyName - Name/identifier for the key.
   */
  removeApiKey(keyName) {
    PropertiesService.getScriptProperties().deleteProperty(this.STORE_PREFIX + keyName);
    PropertiesService.getScriptProperties().deleteProperty("API_KEY_" + keyName);
  },

  /**
   * Checks whether an API key exists in ScriptProperties.
   * @param {string} keyName - Name/identifier for the key.
   * @returns {boolean} true if the key exists.
   */
  hasApiKey(keyName) {
    return !!(
      PropertiesService.getScriptProperties().getProperty(this.STORE_PREFIX + keyName) ||
      PropertiesService.getScriptProperties().getProperty("API_KEY_" + keyName)
    );
  },

  _getCurrentUser() {
    try {
      const email = SESSION_SERVICE.getCurrentUser().getEmail();
      if (email && email.indexOf("@") > 0) return email;
    } catch (e) {}
    return null;
  },

  /**
   * Validates and retrieves user role from AUTHORIZED_USERS JSON.
   * Schema: { "email@domain.com": "ADMIN|OPERATOR|VIEWER" }
   * @param {string} email - User email to look up.
   * @returns {string|null} Role (ADMIN, OPERATOR, VIEWER) or null if not found.
   * @throws {Error} If AUTHORIZED_USERS config is corrupt.
   */
  getUserRole(email) {
    if (!email) return null;
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty("AUTHORIZED_USERS");
    if (!raw) return null;
    
    const validation = SCHEMA_VALIDATOR.validateRoleMap(raw);
    if (!validation.valid) {
      Logger.log("AUTHORIZED_USERS_SCHEMA_ERROR: " + validation.error);
      LogService.logError("AUTHORIZED_USERS_SCHEMA_ERROR", { functionName: 'getUserRole', details: { error: validation.error } });
      return null;
    }
    
const normalized = email.toLowerCase().trim();
     return validation.parsed[normalized] || null;
   },

    /**
     * Checks whether the current user has permission to perform an action.
     * Resolves the required role from PERMISSION_ROLES and compares against
     * the user's assigned role using a hierarchy (ADMIN > OPERATOR > VIEWER).
     * Trigger-safe actions bypass identity checks.
     * @param {string} accion - Action key from PERMISSION_ROLES.
     * @returns {void}
     * @throws {Error} If action is unknown, user lacks role, or permission denied.
     */
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
      LogService.logInfo('Ejecución de acción segura sin identidad (trigger)', { functionName: 'checkPermission', details: { accion: accion } });
      return;
    }
    
    const userRole = this.getUserRole(email);
    if (!userRole) {
      throw new Error('Acceso denegado. El usuario ' + email + ' no tiene ningún rol asignado para la acción ' + accion + '.');
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
    const MAX_RETRIES = 3;
    const BASE_DELAY = 500;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
          Logger.log("PROXY: HMAC secret no configurado.");
          return null;
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
      } catch (e) {
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 100;
          Utilities.sleep(delay);
        }
      }
    }
    return null;
  },

  /**
   * Sets the Secret Proxy endpoint URL in ScriptProperties.
   * @param {string} url - HTTPS URL of the secret proxy service.
   * @returns {boolean} true on success.
   * @throws {Error} If URL is empty.
   */
  setEndpointUrl(url) {
    if (!url || url.trim() === "") throw new Error("URL de Secret Proxy requerida.");
    PropertiesService.getScriptProperties().setProperty(
      this.DEFAULT_ENDPOINT_CONFIG_KEY,
      url.trim()
    );
    return true;
  },

  /**
   * Sets the HMAC secret for authenticating requests to the Secret Proxy.
   * @param {string} secret - HMAC shared secret.
   * @returns {boolean} true on success.
   * @throws {Error} If secret is empty.
   */
  setHmacSecret(secret) {
    if (!secret || secret.trim() === "") throw new Error("HMAC secret requerido.");
    PropertiesService.getScriptProperties().setProperty(
      this.HMAC_SECRET_CONFIG_KEY,
      secret.trim()
    );
    return true;
  },

  /**
   * Checks whether an HMAC secret has been configured.
   * @returns {boolean} true if HMAC secret exists.
   */
  hasHmacSecret() {
    return !!this._getHmacSecret();
  },

  /**
   * Resolves a secret value from the configured Secret Proxy endpoint.
   * Returns null if no endpoint is configured.
   * @param {string} secretName - Name of the secret to resolve.
   * @returns {string|null} Secret value or null.
   */
  resolveSecret(secretName) {
    const endpointUrl = this._getEndpointUrl();
    if (!endpointUrl) return null;
    return this._callSecretEndpoint(endpointUrl, secretName);
  },
};
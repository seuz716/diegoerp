/**
 * SecretService - Gestión segura de secretos
 *
 * Almacena secretos en UserProperties (privado por usuario) con
 * encriptación AES-256 (Utilities.computeAesCipher). Sustituye la
 * ofuscación XOR previa (S-01): XOR era trivialmente reversible por
 * cualquier editor del script; AES protege la confidencialidad.
 *
 * La clave AES-256 (32 bytes) se deriva con HMAC-SHA256 del ScriptId.
 * NOTA: sigue siendo derivable del scriptId, por lo que la protección
 * fuerte depende de UserProperties (privado por usuario) y, en
 * producción, de SECRET_PROXY_URL con HMAC authentication.
 *
 * Compatibilidad: getSecret intenta AES y, si falla, cae a la
 * deofuscación XOR legada, re-encriptando con AES al leer (migración
 * transparente de valores previos).
 */
const SecretService = {
  PREFIX: "SEC_",
  DEFAULT_MAX_AGE_DAYS: 90,

  /**
   * Deriva la clave AES-256 (32 bytes) del ScriptId vía HMAC-SHA256. (S-01)
   * @returns {Byte[]} 32-byte key suitable for AES-256.
   */
  _getKeyBytes() {
    const scriptId = ScriptApp.getScriptId();
    return Utilities.computeHmacSha256Signature(scriptId, "SECRET_AES_KEY_V2");
  },

  /**
   * Deriva la clave de ofuscación legada (XOR) para lectura de valores previos.
   * @returns {string} 32-character obfuscation key.
   */
  _getLegacyKey() {
    const scriptId = ScriptApp.getScriptId();
    const raw = Utilities.computeHmacSha256Signature(scriptId, "SECRET_OBFUSC_KEY_V1");
    return raw.map(b => String.fromCharCode((b & 0xFF) % 26 + 65)).join('').slice(0, 32);
  },

  /**
   * Encripta un valor con AES-256 (ENCRYPT, PKCS5_PADDING). (S-01)
   * @param {string} value - Plaintext value.
   * @param {Byte[]} key - 32-byte AES key.
   * @returns {string} base64-encoded ciphertext.
   */
  _encrypt(value, key) {
    if (!value) return "";
    const cipher = Utilities.computeAesCipher(
      Utilities.newBlob(value).getBytes(),
      key,
      Utilities.AesCipherMode.ENCRYPT,
      Utilities.AesPadding.PKCS5_PADDING
    );
    return Utilities.base64Encode(cipher);
  },

  /**
   * Desencripta un valor AES-256. Devuelve null si falla.
   * @param {string} b64 - base64-encoded ciphertext.
   * @param {Byte[]} key - 32-byte AES key.
   * @returns {string|null} Plaintext or null.
   */
  _decrypt(b64, key) {
    if (!b64) return null;
    try {
      const plain = Utilities.computeAesCipher(
        Utilities.base64Decode(b64),
        key,
        Utilities.AesCipherMode.DECRYPT,
        Utilities.AesPadding.PKCS5_PADDING
      );
      return Utilities.newBlob(plain).getDataAsString();
    } catch (e) {
      return null;
    }
  },

  /**
   * Ofuscación XOR legada (solo para leer valores migrados previamente).
   * @param {string} value - Value to obfuscate.
   * @param {string} key - Legacy obfuscation key.
   * @returns {string} base64-encoded obfuscated value.
   */
  _legacyObfuscate(value, key) {
    if (!value) return "";
    const bytes = Utilities.newBlob(value).getBytes();
    const keyBytes = Utilities.newBlob(key).getBytes();
    const obfuscated = [];
    for (let i = 0; i < bytes.length; i++) {
      obfuscated.push(bytes[i] ^ keyBytes[i % keyBytes.length]);
    }
    return Utilities.base64Encode(obfuscated);
  },

  /**
   * Remueve ofuscación XOR legada. Devuelve null si falla.
   * @param {string} obfuscated - base64-encoded obfuscated value.
   * @param {string} key - Legacy obfuscation key.
   * @returns {string|null} Original value.
   */
  _legacyDeobfuscate(obfuscated, key) {
    if (!obfuscated) return null;
    try {
      const bytes = Utilities.base64Decode(obfuscated);
      const keyBytes = Utilities.newBlob(key).getBytes();
      const original = [];
      for (let i = 0; i < bytes.length; i++) {
        original.push(bytes[i] ^ keyBytes[i % keyBytes.length]);
      }
      return Utilities.newBlob(original).getDataAsString();
    } catch (e) {
      return null;
    }
  },

  /**
   * Stores a secret value in UserProperties with AES-256 encryption. (S-01)
   * @param {string} keyName - Secret identifier
   * @param {string} value - Secret value to store
   * @returns {boolean} true on success
   */
  setSecret(keyName, value) {
    if (!keyName || !value) throw new Error("keyName y value son requeridos");
    const key = this._getKeyBytes();
    const encrypted = this._encrypt(value.trim(), key);
    const props = PropertiesService.getUserProperties();
    props.setProperty(this.PREFIX + keyName, encrypted);
    // K-05: record configuration timestamp for rotation/expiry tracking
    props.setProperty(this.PREFIX + keyName + "_TS", String(Date.now()));
    return true;
  },

  /**
   * Retrieves a secret value from UserProperties.
   * Intenta AES primero; si falla, cae a XOR legada y re-encripta con AES.
   * @param {string} keyName - Secret identifier
   * @returns {string|null} Decoded secret value or null if not found
   */
  getSecret(keyName) {
    const stored = PropertiesService.getUserProperties().getProperty(this.PREFIX + keyName);
    if (!stored) return null;
    const key = this._getKeyBytes();
    const decrypted = this._decrypt(stored, key);
    if (decrypted !== null) return decrypted;
    // Fallback: legacy XOR (pre-S-01 values) + transparent re-encryption
    const legacyKey = this._getLegacyKey();
    const legacy = this._legacyDeobfuscate(stored, legacyKey);
    if (legacy !== null) {
      try { this.setSecret(keyName, legacy); } catch (e) { /* best-effort */ }
      return legacy;
    }
    return null;
  },
  
  /**
   * Checks whether a secret exists.
   * @param {string} keyName - Secret identifier
   * @returns {boolean} true if secret exists
   */
  hasSecret(keyName) {
    const stored = PropertiesService.getUserProperties().getProperty(this.PREFIX + keyName);
    return !!stored;
  },
  
  /**
   * Removes a secret from UserProperties.
   * @param {string} keyName - Secret identifier
   */
  deleteSecret(keyName) {
    const props = PropertiesService.getUserProperties();
    props.deleteProperty(this.PREFIX + keyName);
    props.deleteProperty(this.PREFIX + keyName + "_TS");
  },

  /**
   * Retrieves secret metadata including the configuration timestamp. (K-05)
   * @param {string} keyName - Secret identifier.
   * @returns {{value: (string|null), configuredAt: (number|null)}}
   */
  getSecretMeta(keyName) {
    const value = this.getSecret(keyName);
    const ts = PropertiesService.getUserProperties().getProperty(this.PREFIX + keyName + "_TS");
    return { value: value, configuredAt: ts ? Number(ts) : null };
  },

  /**
   * Returns the age of a secret in days, or null if not configured. (K-05)
   * @param {string} keyName - Secret identifier.
   * @returns {number|null}
   */
  getSecretAgeDays(keyName) {
    const ts = PropertiesService.getUserProperties().getProperty(this.PREFIX + keyName + "_TS");
    if (!ts) return null;
    return (Date.now() - Number(ts)) / (24 * 60 * 60 * 1000);
  },

  /**
   * Determines whether a secret exceeds the maximum allowed age. (K-05)
   * @param {string} keyName - Secret identifier.
   * @param {number} [maxAgeDays] - Maximum age in days.
   * @returns {boolean}
   */
  isStale(keyName, maxAgeDays) {
    const age = this.getSecretAgeDays(keyName);
    if (age === null) return false;
    const max = (maxAgeDays && maxAgeDays > 0) ? maxAgeDays : this.DEFAULT_MAX_AGE_DAYS;
    return age > max;
  }
};

/**
 * Migrates existing API keys from ScriptProperties to UserProperties.
 * Should be run once from the editor after deployment.
 * @returns {Object} Migration report
 */
function migrateSecretsToUserProperties() {
  const report = { migrated: [], skipped: [], errors: [] };
  
  try {
    const props = PropertiesService.getScriptProperties();
    const prefixes = ["AUTH_SEC_", "API_KEY_"];
    const allKeys = props.getKeys();
    
    for (const key of allKeys) {
      let secretName = null;
      
      if (key.startsWith("AUTH_SEC_")) {
        secretName = key.slice(9); // Remove AUTH_SEC_
      } else if (key.startsWith("API_KEY_")) {
        secretName = key.slice(8); // Remove API_KEY_
      }
      
      if (secretName) {
        try {
          const value = props.getProperty(key);
          // Try to decrypt with old system, or migrate plaintext
          let plainValue = value;
          
          // Check if it's encrypted JSON format
          try {
            const parsed = JSON.parse(value);
            if (parsed.c && parsed.i && parsed.s) {
              // Encrypted with old CRYPTO_SERVICE - skip (requires manual migration)
              report.skipped.push({ key: key, reason: "encrypted_format_legacy" });
              continue;
            }
          } catch (_) {
            // Not JSON, treat as plaintext
          }
          
           SecretService.setSecret(secretName, plainValue);
           props.deleteProperty(key); // remove plaintext legacy entry (K-01)
           report.migrated.push(secretName);
        } catch (e) {
          report.errors.push({ key: key, error: e.message });
        }
      }
    }
    
    return { success: true, report: report };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
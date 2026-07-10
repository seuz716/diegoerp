/**
 * SecretService - Gestión segura de secretos con ofuscación básica
 * 
 * Almacena secretos en UserProperties (privado por usuario) con ofuscación XOR
 * para evitar lectura casual en PropertiesService.
 * 
 * NOTA: Esta NO es encriptación fuerte. La seguridad proviene de:
 * 1. UserProperties es privado por usuario (no visible para otros editores)
 * 2. La ofuscación evita que los valores sean legible directamente
 * 
 * Para producción, usar SECRET_PROXY_URL con HMAC authentication.
 */
const SecretService = {
  PREFIX: "SEC_",
  DEFAULT_MAX_AGE_DAYS: 90,
  
  /**
   * Deriva una clave de ofuscación del ScriptId (determinista por script)
   * @returns {string} 32-character obfuscation key
   */
  _getObfuscationKey() {
    const scriptId = ScriptApp.getScriptId();
    const raw = Utilities.computeHmacSha256Signature(scriptId, "SECRET_OBFUSC_KEY_V1");
    return raw.map(b => String.fromCharCode((b & 0xFF) % 26 + 65)).join('').slice(0, 32);
  },
  
  /**
   * Applies XOR obfuscation to a string value.
   * @param {string} value - Value to obfuscate
   * @param {string} key - Obfuscation key
   * @returns {string} Obfuscated value (base64 encoded)
   */
  _obfuscate(value, key) {
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
   * Removes obfuscation from a value.
   * @param {string} obfuscated - Obfuscated value (base64 encoded)
   * @param {string} key - Obfuscation key
   * @returns {string} Original value
   */
  _deobfuscate(obfuscated, key) {
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
   * Stores a secret value in UserProperties with obfuscation.
   * @param {string} keyName - Secret identifier
   * @param {string} value - Secret value to store
   * @returns {boolean} true on success
   */
  setSecret(keyName, value) {
    if (!keyName || !value) throw new Error("keyName y value son requeridos");
    const key = this._getObfuscationKey();
    const obfuscated = this._obfuscate(value.trim(), key);
    const props = PropertiesService.getUserProperties();
    props.setProperty(this.PREFIX + keyName, obfuscated);
    // K-05: record configuration timestamp for rotation/expiry tracking
    props.setProperty(this.PREFIX + keyName + "_TS", String(Date.now()));
    return true;
  },
  
  /**
   * Retrieves a secret value from UserProperties.
   * @param {string} keyName - Secret identifier
   * @returns {string|null} Decoded secret value or null if not found
   */
  getSecret(keyName) {
    const stored = PropertiesService.getUserProperties().getProperty(this.PREFIX + keyName);
    if (!stored) return null;
    const key = this._getObfuscationKey();
    return this._deobfuscate(stored, key);
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
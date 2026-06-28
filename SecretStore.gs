/**
 * LAYER 0.6: SECRET STORE - Secure secret management
 * No local fallback - relies on external proxy or AWS Secrets Manager
 */

const SECRET_STORE = {
  PREFIX: 'SECURE_',
  
  resolve(secretName, fallbackAllowed = false) {
    const proxyUrl = PropertiesService.getScriptProperties().getProperty('SECRET_PROXY_URL');
    
    if (proxyUrl) {
      return this._fetchFromProxy(secretName, proxyUrl);
    }
    
    if (!fallbackAllowed) {
      throw new Error('Secret "' + secretName + '" requires external proxy. No local fallback allowed.');
    }
    
    const local = PropertiesService.getScriptProperties().getProperty(this.PREFIX + secretName);
    if (!local) {
      throw new Error('Secret "' + secretName + '" not found in any store');
    }
    
    return local;
  },
  
  _fetchFromProxy(secretName, proxyUrl) {
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({ secret: secretName });
      
      const hmacSecret = PropertiesService.getScriptProperties().getProperty('PROXY_HMAC_SECRET');
      if (!hmacSecret) {
        throw new Error('HMAC secret not configured - cannot authenticate to proxy');
      }
      
      const signature = Utilities.computeHmacSha256Signature(timestamp + '.' + payload, hmacSecret);
      const hmacHex = signature.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
      
      const response = UrlFetchApp.fetch(proxyUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: payload,
        muteHttpExceptions: true,
        timeout: 8000,
        headers: {
          'X-Request-ID': Utilities.getUuid(),
          'X-HMAC-Timestamp': timestamp,
          'Authorization': 'HMAC ' + hmacHex,
          'Cache-Control': 'no-cache'
        }
      });
      
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        return data.value;
      }
      
      throw new Error('Proxy returned HTTP ' + response.getResponseCode());
    } catch (e) {
      console.warn('SECRET_STORE proxy error: ' + e.message);
      throw e;
    }
  },
  
  setLocal(secretName, value) {
    PropertiesService.getScriptProperties().setProperty(this.PREFIX + secretName, value);
  },
  
  removeLocal(secretName) {
    PropertiesService.getScriptProperties().deleteProperty(this.PREFIX + secretName);
  },
  
  hasLocal(secretName) {
    return !!PropertiesService.getScriptProperties().getProperty(this.PREFIX + secretName);
  }
};

/**
 * Backward-compatible wrapper for AuthService methods
 * @deprecated Use SECRET_STORE directly
 */
const SecretManager = {
  _deriveKey(part1, part2) {
    console.warn('SecretManager._deriveKey is deprecated. Use CRYPTO_SERVICE or SECRET_STORE.');
    const combined = part1 + '::DIEGOERP_AES_V2_2026::' + part2;
    return Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      combined,
      Utilities.Charset.UTF_8
    ).map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  },
  
  _getLocalParts() {
    const props = PropertiesService.getScriptProperties();
    let part1 = props.getProperty('AES_KEY_PART_1');
    let part2 = props.getProperty('AES_KEY_PART_2');
    
    if (!part1 || !part2) {
      throw new Error('Encryption key parts not initialized. Run setupSecureCrypto() first.');
    }
    
    return { part1, part2 };
  },
  
  getEncryptionKey() {
    const proxyKey = SECRET_STORE.resolve('AES_MASTER_KEY', false);
    if (proxyKey) return proxyKey;
    
    const parts = this._getLocalParts();
    return this._deriveKey(parts.part1, parts.part2);
  }
};
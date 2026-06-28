/**
 * LAYER 0.5: CRYPTO SERVICE - AES-GCM Implementation
 */

const CRYPTO_SERVICE = {
  ALGORITHM: 'AES_GCM_V1',
  SALT: 'DIEGOERP_SECURE_2026',
  
  _bytesToHex(bytes) {
    return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  },
  
  _generateIV() {
    return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  },
  
  _deriveKey(password) {
    const combined = password + '::' + this.SALT + '::' + 'derive';
    return Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      combined,
      Utilities.Charset.UTF_8
    );
  },
  
  encrypt(plaintext, key) {
    if (!plaintext) return '';
    try {
      const plainBytes = Utilities.newBlob(plaintext).getBytes();
      const derivedKey = this._deriveKey(key);
      const iv = this._generateIV();
      
      const cipherBytes = Utilities.computeAes(plainBytes, derivedKey, Utilities.AesAlgorithm.AES_256, iv, Utilities.CipherMode.ENCRYPT);
      const cipherB64 = Utilities.base64Encode(cipherBytes);
      
      const hmacHex = this._bytesToHex(Utilities.computeHmacSha256Signature(iv + ':' + cipherB64, derivedKey));
      
      return JSON.stringify({
        v: this.ALGORITHM,
        c: cipherB64,
        i: iv,
        h: hmacHex
      });
    } catch (e) {
      console.error('CRYPTO_SERVICE.encrypt error: ' + e);
      throw new Error('Encryption failed');
    }
  },
  
  decrypt(ciphertext, key) {
    if (!ciphertext) return '';
    try {
      const obj = JSON.parse(ciphertext);
      
      if (obj.v !== this.ALGORITHM) {
        throw new Error('Unsupported encryption version');
      }
      
      if (!obj.c || !obj.i || !obj.h) {
        throw new Error('Invalid encrypted format');
      }
      
      const derivedKey = this._deriveKey(key);
      const expectedHmac = this._bytesToHex(Utilities.computeHmacSha256Signature(obj.i + ':' + obj.c, derivedKey));
      
      if (expectedHmac !== obj.h) {
        console.error('HMAC mismatch - data tampered or key incorrect');
        return '';
      }
      
      const cipherBytes = Utilities.base64Decode(obj.c);
      const plainBytes = Utilities.computeAes(cipherBytes, derivedKey, Utilities.AesAlgorithm.AES_256, obj.i, Utilities.CipherMode.DECRYPT);
      
      return Utilities.newBlob(plainBytes).getDataAsString();
    } catch (e) {
      console.warn('CRYPTO_SERVICE.decrypt error: ' + e);
      return '';
    }
  }
};
const ROLE_HIERARCHY = { ADMIN: 3, OPERATOR: 2, VIEWER: 1 };

const AuthService = {
  _getMasterKey() {
    const props = PropertiesService.getScriptProperties();
    let key = props.getProperty("_AUTH_MASTER_KEY");
    if (!key) {
      key = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
      props.setProperty("_AUTH_MASTER_KEY", key);
    }
    return key;
  },

  _encryptValue(plaintext) {
    if (!plaintext) return null;
    const masterKey = this._getMasterKey();
    const iv = Utilities.getUuid().replace(/-/g, "").slice(0, 16);
    const kdf = Utilities.computeHmacSha256Signature(iv, masterKey);
    const plainBytes = Utilities.newBlob(plaintext).getBytes();
    const cipherBytes = plainBytes.map((b, i) => {
      const x = (b ^ (kdf[i % kdf.length] & 0xFF)) & 0xFF;
      return x > 127 ? x - 256 : x;
    });
    return iv + ":" + Utilities.base64Encode(Utilities.newBlob(cipherBytes));
  },

  _decryptValue(ciphertext) {
    if (!ciphertext || typeof ciphertext !== "string") return null;
    const sep = ciphertext.indexOf(":");
    if (sep < 1) return null;
    const iv = ciphertext.substring(0, sep);
    const b64 = ciphertext.substring(sep + 1);
    try {
      const cipherBytes = Utilities.base64Decode(b64);
      const masterKey = this._getMasterKey();
      const kdf = Utilities.computeHmacSha256Signature(iv, masterKey);
      const plainBytes = cipherBytes.map((b, i) => {
        const x = (b ^ (kdf[i % kdf.length] & 0xFF)) & 0xFF;
        return x > 127 ? x - 256 : x;
      });
      return Utilities.newBlob(plainBytes).getDataAsString();
    } catch (e) {
      console.error("ERROR_DECRYPT: Fallo al descifrar valor: " + e.message);
      return null;
    }
  },

  setApiKey(keyName, value) {
    if (!keyName || !value) throw new Error("keyName y value son requeridos");
    const encrypted = this._encryptValue(value.trim());
    PropertiesService.getScriptProperties().setProperty("_ENC_" + keyName, encrypted);
    console.log("API Key '" + keyName + "' almacenada de forma cifrada.");
    return true;
  },

  getApiKey(keyName) {
    const encrypted = PropertiesService.getScriptProperties().getProperty("_ENC_" + keyName);
    if (!encrypted) {
      console.error("ERROR_SEGURIDAD: API Key cifrada '" + keyName + "' no encontrada en ScriptProperties.");
      throw new Error("Configuración de seguridad incompleta: API Key '" + keyName + "' no configurada.");
    }
    const decrypted = this._decryptValue(encrypted);
    if (!decrypted) {
      PropertiesService.getScriptProperties().deleteProperty("_ENC_" + keyName);
      throw new Error("Error de descifrado: API Key '" + keyName + "' corrupta. Reconfigura la key.");
    }
    return decrypted;
  },

  removeApiKey(keyName) {
    PropertiesService.getScriptProperties().deleteProperty("_ENC_" + keyName);
    console.log("API Key cifrada '" + keyName + "' eliminada.");
  },

  hasApiKey(keyName) {
    return !!PropertiesService.getScriptProperties().getProperty("_ENC_" + keyName);
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
    const normalized = email.toLowerCase().trim();
    for (const role of ["ADMIN", "OPERATOR", "VIEWER"]) {
      const prop = props.getProperty("AUTHORIZED_USERS_" + role);
      if (!prop) continue;
      const emails = prop.split(",").map(e => e.trim().toLowerCase());
      if (emails.includes(normalized)) return role;
    }
    return null;
  },

  isAuthorized(requiredRole) {
    const userEmail = this._getCurrentUser();
    if (!userEmail) {
      console.error("ERROR_AUTORIZACION: No se pudo determinar la identidad del usuario. ¿Ejecutando desde un trigger sin identidad?");
      return false;
    }
    const requiredLevel = ROLE_HIERARCHY[requiredRole];
    if (!requiredLevel) {
      console.warn("ADVERTENCIA_SEGURIDAD: Rol desconocido '" + requiredRole + "'");
      return false;
    }
    const props = PropertiesService.getScriptProperties();
    const normalized = userEmail.toLowerCase().trim();
    for (const [role, level] of Object.entries(ROLE_HIERARCHY)) {
      if (level < requiredLevel) continue;
      const prop = props.getProperty("AUTHORIZED_USERS_" + role);
      if (!prop) continue;
      const emails = prop.split(",").map(e => e.trim().toLowerCase());
      if (emails.includes(normalized)) return true;
    }
    console.warn("ACCESO_DENEGADO: '" + userEmail + "' intentó operación rol='" + requiredRole + "' sin autorización.");
    return false;
  },

  checkAuthorization(requiredRole) {
    if (!this.isAuthorized(requiredRole)) {
      const userEmail = this._getCurrentUser() || "unknown";
      throw new Error("Acceso denegado. Se requiere rol " + requiredRole + " para esta operación. Usuario: " + userEmail);
    }
  },

  requireAdmin() { this.checkAuthorization("ADMIN"); },
  requireOperator() { this.checkAuthorization("OPERATOR"); },
  requireViewer() { this.checkAuthorization("VIEWER"); },
};

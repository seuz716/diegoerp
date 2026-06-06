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

const AuthService = {
  setApiKey(keyName, value) {
    if (!keyName || !value) throw new Error("keyName y value son requeridos");
    PropertiesService.getScriptProperties().setProperty("API_KEY_" + keyName, value.trim());
    console.log("API Key '" + keyName + "' almacenada en PropertiesService.");
    return true;
  },

  getApiKey(keyName) {
    const value = PropertiesService.getScriptProperties().getProperty("API_KEY_" + keyName);
    if (!value) {
      console.error("ERROR_SEGURIDAD: API Key '" + keyName + "' no encontrada en ScriptProperties.");
      throw new Error("Configuración de seguridad incompleta: API Key '" + keyName + "' no configurada.");
    }
    return value;
  },

  removeApiKey(keyName) {
    PropertiesService.getScriptProperties().deleteProperty("API_KEY_" + keyName);
    console.log("API Key '" + keyName + "' eliminada.");
  },

  hasApiKey(keyName) {
    return !!PropertiesService.getScriptProperties().getProperty("API_KEY_" + keyName);
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

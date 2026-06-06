# Plan: Manejo global de autenticación y estado de sesión

## 1. Crear/actualizar `.opencode/opencode.json`

Para que opencode pueda aplicar los cambios automáticamente, crea este archivo:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "allow",
    "bash": "allow"
  }
}
```

Luego **reinicia opencode** para que los cambios surtan efecto.

## 2. API.gs — Agregar endpoint `getUserInfo()`

**Archivo:** `/home/cesar/mis_proyectos/diegoerp/API.gs`

**Insertar al final del archivo** (después de `analizarConGeminiFresco`):

```javascript
/**
 * API Pública: Obtener información del usuario autenticado
 */
function getUserInfo() {
  try {
    AuthService.checkPermission("ver_dashboard");
    const email = Session.getActiveUser().getEmail();
    if (!email || email.indexOf("@") < 0)
      throw new Error("No se pudo determinar la identidad del usuario");
    const role = AuthService.getUserRole(email);
    return { email, role };
  } catch (e) {
    Logger.log("ERROR getUserInfo:" + e.toString());
    throw new Error(e.message || e.toString());
  }
}
```

## 3. api.js — Agregar `App.api.getUserInfo()`

**Archivo:** `/home/cesar/mis_proyectos/diegoerp/api.js`

**Insertar en `App.api`** (después de `getAuditHistory`, antes de cerrar el objeto):

```javascript

  getUserInfo: function () {
    return callServer('getUserInfo');
  },
```

## 4. index_v3_SaaS.html — Mostrar email y rol en sidebar

### 4a. HTML — Agregar `#session-info` en el sidebar

**Archivo:** `/home/cesar/mis_proyectos/diegoerp/index_v3_SaaS.html`

**Reemplazar** las líneas 382–385:

```html
  <div class="sidebar-footer">
    <div id="session-info" style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border);">
      <div id="user-email" style="font-size:10px;color:var(--muted);"></div>
      <div id="user-role" style="font-size:9px;color:var(--muted-2);margin-top:2px;"></div>
    </div>
    Gemini 2.5 Flash · IA activa<br>
    © 2026 César A. Abadía
  </div>
```

### 4b. JavaScript — Agregar `cargarUserInfo()`

**Archivo:** `/home/cesar/mis_proyectos/diegoerp/index_v3_SaaS.html`

**Agregar esta función** antes del `DOMContentLoaded` (ej: después de `guardarTercero`):

```javascript
function cargarUserInfo() {
  App.api.getUserInfo()
    .then(function (info) {
      document.getElementById('user-email').textContent = info.email || '';
      document.getElementById('user-role').textContent = info.role
        ? 'Rol: ' + info.role
        : 'Rol: Sin asignar';
    })
    .catch(function () {
      document.getElementById('user-email').textContent = 'Acceso denegado';
      document.getElementById('user-role').textContent = 'Verifica tus permisos';
    });
}
```

**Modificar** el `DOMContentLoaded` existente (línea 858) para que llame `cargarUserInfo()` al inicio:

```javascript
document.addEventListener('DOMContentLoaded', function () {
  cargarUserInfo();
  cargarDashboard();
  cargarCartera();
  cargarTerceros();
  // ... resto igual
});
```

## Resumen de cambios

| Archivo | Cambio |
|---|---|
| `.opencode/opencode.json` | Crear con permisos `edit: allow` |
| `API.gs` | +1 función `getUserInfo()` |
| `api.js` | +1 método `getUserInfo` en `App.api` |
| `index_v3_SaaS.html` | HTML: `#session-info` en sidebar-footer |
| `index_v3_SaaS.html` | JS: función `cargarUserInfo()` + llamado en `DOMContentLoaded` |

Una vez creado el `opencode.json` y reiniciado opencode, puedo aplicar los 3 cambios de código automáticamente si me los pides.

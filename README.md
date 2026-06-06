# MicroERP · Cartera Pro

Sistema de gestión de cartera (Cuentas por Cobrar / Cuentas por Pagar) construido sobre **Google Apps Script** con integración de **Gemini 2.5 Flash** para análisis financiero inteligente.

Incluye control de inventario, auditoría transaccional, caché con verificación de integridad, bloqueo de concurrencia y control de acceso basado en roles.

---

## Requisitos previos

- Cuenta de Google (Google Workspace o Gmail).
- Acceso a [Google Sheets](https://sheets.google.com).
- Editor de [Google Apps Script](https://script.google.com).
- (Opcional) API Key de Gemini — obtener en [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

---

## Estructura del proyecto

| Archivo               | Capa                          |
| --------------------- | ----------------------------- |
| `Config.gs`           | Configuración y utilidades    |
| `Main.gs`             | Entry point (`doGet`)         |
| `CacheService.gs`     | Caché en memoria con TTL      |
| `DAO.gs`              | Acceso a datos (Sheets)       |
| `AuthService.gs`      | Autenticación y autorización  |
| `Domain.gs`           | Lógica de negocio transaccional |
| `Servicios.gs`        | Servicios de alto nivel       |
| `AuditLog.gs`         | Registro de auditoría         |
| `IAService.gs`        | Integración con Gemini        |
| `API.gs`              | API pública                   |
| `LockManager.gs`      | Locks de concurrencia         |
| `inventario.gs`       | Módulo de inventario          |
| `index_v3_SaaS.html`  | Interfaz web (frontend)       |

---

## Pasos para desplegar

### 1. Crear el proyecto de Apps Script

1. Ir a [script.google.com](https://script.google.com).
2. Crear un **nuevo proyecto**.
3. Copiar **todos los archivos `.gs`** en el editor.
4. Copiar `index_v3_SaaS.html` → crear archivo HTML con ese nombre exacto.

### 2. Configurar las hojas de cálculo

Crear un archivo de Google Sheets y nombrar las pestañas exactamente como se indica:

#### **Terceros**

| ID | Nombre | Teléfono | Tipo | Límite_Crédito | Activo |
| -- | ------ | -------- | ---- | -------------- | ------ |

- `ID`: identificador único (ej. CL-001).
- `Tipo`: `CLIENTE` o `PROVEEDOR`.
- `Límite_Crédito`: en **centavos** (ej. 5000000 = $50.000).
- `Activo`: `ACTIVO` o `INACTIVO`.

#### **Cartera**

| ID | Fecha | ID_Tercero | Origen_ID | Total | Saldo | Tipo | Estado | Fecha_Vencimiento | Vencida_Timestamp |
| -- | ----- | ---------- | --------- | ----- | ----- | ---- | ------ | ----------------- | ----------------- |

- `Total` y `Saldo`: en **centavos**.
- `Tipo`: `CxC` (Cuentas por Cobrar) o `CxP` (Cuentas por Pagar).
- `Estado`: `ABIERTA`, `PARCIAL`, `CANCELADA`, `VENCIDA`.

#### **Movimientos_Cartera**

| ID | Fecha | ID_Cartera | ID_Tercero | Valor | Tipo_Mov | Referencia |
| -- | ----- | ---------- | ---------- | ----- | -------- | ---------- |

- `Tipo_Mov`: `ABONO`, `CANCELACION`, etc.

#### **AUDIT_LOG**

| ID | Timestamp | Operacion | Tabla | ID_Registro | Usuario | Datos_Previos | Datos_Nuevos | Estado |
| -- | --------- | --------- | ----- | ----------- | ------- | ------------- | ------------ | ------ |

#### **Productos** (opcional, para inventario)

| ID | Nombre | Stock | Precio |
| -- | ------ | ----- | ------ |

### 3. Configurar autorización y permisos

Ir al editor de Apps Script → **Ver → Ver registros de ejecución** o usar la consola.

Ejecutar en el editor:

```javascript
const users = {
  "admin@empresa.com": "ADMIN",
  "operador@empresa.com": "OPERATOR",
  "consultor@empresa.com": "VIEWER"
};
PropertiesService.getScriptProperties().setProperty("AUTHORIZED_USERS", JSON.stringify(users));
```

**Roles disponibles:**

| Rol       | Nivel | Permisos                                            |
| --------- | ----- | --------------------------------------------------- |
| `VIEWER`  | 1     | Consultar terceros, cartera, dashboard, auditoría e IA |
| `OPERATOR`| 2     | Todo VIEWER + registrar abonos/ventas, editar terceros, inventario |
| `ADMIN`   | 3     | Todo OPERATOR + configurar IA, triggers, caché, sistema |

### 4. Configurar API Key de Gemini (opcional)

Ejecutar en el editor:

```javascript
setupGeminiKey("tu-api-key-aqui");
```

O alternativamente desde `AuthService`:

```javascript
AuthService.setApiKey("GEMINI_API_KEY", "tu-api-key");
```

Obtener una API Key gratuita en: https://aistudio.google.com/apikey

### 5. Configurar triggers diarios

Ejecutar **una sola vez** en el editor:

```javascript
instalarTriggerVencimientos();   // Diario a las 2:00 AM — actualiza estados VENCIDA
crearTriggerInventario();        // Diario a las 8:00 AM — revisa stock de productos
```

Ambos son idempotentes: no crearán duplicados si ya existen.

### 6. Publicar como Web App

1. Ir a **Desplegar → Nueva implementación**.
2. Tipo: **Web App**.
3. **Ejecutar como**: seleccionar tu cuenta ("Yo").
4. **Acceso**: `Cualquier persona` (o restringido según necesidad). El control de acceso real se maneja via `AUTHORIZED_USERS`.
5. Desplegar y copiar la URL generada.

---

## Ejemplo de configuración completa

```javascript
// 1. Usuarios y roles
PropertiesService.getScriptProperties().setProperty("AUTHORIZED_USERS", JSON.stringify({
  "admin@micorp.co": "ADMIN",
  "ana@micorp.co": "OPERATOR",
  "carlos@micorp.co": "VIEWER"
}));

// 2. API Key de Gemini
setupGeminiKey("AIzaSy...");

// 3. Triggers diarios
instalarTriggerVencimientos();
crearTriggerInventario();
```

---

## Solución de problemas

### Error de permisos

```
Error: Acceso denegado. El usuario '...' no tiene ningún rol asignado.
```

**Causa:** el usuario no está en `AUTHORIZED_USERS` o el JSON está mal formado.

**Solución:** verificar el JSON en `PropertiesService`:

```javascript
const raw = PropertiesService.getScriptProperties().getProperty("AUTHORIZED_USERS");
console.log(JSON.parse(raw)); // debe ser un objeto { "email": "ROL" }
```

### API Key no configurada

```
Error: Configuración de seguridad incompleta: API Key 'GEMINI_API_KEY' no configurada.
```

**Causa:** no se ejecutó `setupGeminiKey()`.

**Solución:**

```javascript
AuthService.hasApiKey("GEMINI_API_KEY"); // debe retornar true
```

### Límite de cuota de Gemini

```
Error: Cuota de API excedida. Espera unos minutos.
```

**Causa:** el modelo Gemini 2.5 Flash tiene límites de solicitudes por minuto.

**Soluciones:**
- Esperar 60 segundos y reintentar.
- El servicio reintenta automáticamente hasta 3 veces con backoff exponencial.
- Reducir el volumen de datos analizados (el sistema ya aplica muestreo estratificado).

### Inconsistencia de caché

```
Error: Integridad de caché de terceros comprometida.
```

**Causa:** los datos en memoria no coinciden con los de la hoja de cálculo.

**Solución:** el sistema aplica auto-recuperación (`recoverFromStale()`). Si persiste:

```javascript
CACHE.invalidate();   // Limpia toda la caché
CACHE.refresh(true);  // Forza recarga completa
```

Si el problema continúa, revisar que los nombres de las hojas coincidan exactamente y que los encabezados de columna estén en la primera fila.

### Trigger no se ejecuta

**Causa:** el trigger fue eliminado o no se instaló correctamente.

**Solución:** verificar triggers activos:

```javascript
ScriptApp.getProjectTriggers().forEach(t => console.log(t.getHandlerFunction()));
```

Reinstalar si es necesario.

---

## Arquitectura

```
index_v3_SaaS.html (frontend)
       ↕ google.script.run
   ┌─────────────────────┐
   │   API.gs (L6)       │
   ├─────────────────────┤
   │ AuthService.gs (L5) │  ← permisos sobre cada acción
   ├─────────────────────┤
   │ Domain.gs (L5)      │  ← lógica transaccional con rollback
   ├─────────────────────┤
   │ Servicios.gs (L3)   │  ← orquestación de alto nivel
   ├─────────────────────┤
   │ DAO.gs (L4)         │  ← acceso optimizado a Sheets
   ├─────────────────────┤
   │ CacheService.gs (L3)│  ← caché en memoria + checksum
   ├─────────────────────┤
   │ Config.gs (L1)      │  ← constantes y utilidades
   └─────────────────────┘
```

## Licencia

Uso interno. Desarrollado para gestión de cartera comercial.

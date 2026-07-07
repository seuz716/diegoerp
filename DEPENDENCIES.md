# Dependencies Loading Order

## ⚠️ CRITICAL: Load Order Documentation

Google Apps Script loads `.gs` files in the order they appear in the project file list.
This document defines the **required loading order** to prevent circular dependency issues
and ensure all dependencies are available when needed.

---

## Loading Layers

### Layer 1 (Base - Must Load First)
| File | Purpose | Exposed Globals |
|------|---------|-----------------|
| `Config.gs` | Base configuration, utilities, schema validation | `getSheet`, `_parseMoneda`, `_safeDate`, `CARTERA_CONFIG`, `CONFIG`, `SESSION_SERVICE` |

### Layer 2 (Direct Dependencies on Config)
| File | Purpose | Dependencies |
|------|---------|--------------|
| `CacheService.gs` | Memory indices, circuit breaker, integrity checks | `getSheet`, `_parseMoneda`, `CARTERA_CONFIG` |
| `AuthService.gs` | Authentication, permissions, API key management | `SESSION_SERVICE` |
| `LockManager.gs` | Distributed locking, race condition prevention | `CONFIG`, `CARTERA_CONFIG` |

### Layer 3 (Depends on Layer 2)
| File | Purpose | Dependencies |
|------|---------|--------------|
| `AuditLog.gs` | Audit trail, correlation IDs | `LOCK_MANAGER`, `SESSION_SERVICE` |
| `DAO.gs` | Data access objects, batch operations | `CACHE`, `DAO_COMPRAS` |
| `DAOCompras.gs` | Purchases data access | `Config` utilities |

### Layer 4 (Business Logic)
| File | Purpose | Dependencies |
|------|---------|--------------|
| `Domain.gs` | Business rules, transactions | `CACHE`, `DAO`, `AuthService`, `TransactionManager` |
| `Accounting.gs` | Ledgers, financial records | `Config`, `Cache` |
| `IAService.gs` | AI/LLM integration | `AuthService`, `CACHE` |

### Layer 5 (Entry Points & API)
| File | Purpose | Dependencies |
|------|---------|--------------|
| `Servicios.gs` | Service orchestrator | All modules |
| `Main.gs` | Main entry point | `Domain`, `CacheService` |
| `API.gs` | Public API endpoints | All modules |

---

## Dependency Graph

```
Config.gs
    ├── CacheService.gs ─────┐
    │       ├── DAO.gs ─────┤
    │       └── IAService.gs │
    │                       │
    ├── AuthService.gs ──┐   │
    │                    │   │
    ├── LockManager.gs ─┼───┼──> Domain.gs
    │                    │   │
    └── AuditLog.gs ────┼───┘

TransactionManager (in Config.gs)
    └── integrates with all layers

API.gs (exposes all functionality)
```

---

## Guards Implemented

### CacheService.gs
```javascript
(function _verifyCacheServiceDependencies() {
  if (typeof getSheet === 'undefined') {
    throw new Error("LOAD ERROR: CacheService.gs requires Config.gs first");
  }
  // ... more guards
})();
```

### What Happens on Wrong Order?
- **CacheService → Config**: Throws `LOAD ERROR` with clear message
- **AuthService → Config**: `SESSION_SERVICE` will be undefined
- **LockManager → Config**: `CARTERA_CONFIG` will be undefined

---

## Testing Load Order

Run `testLoadOrder()` to verify all modules loaded correctly:

```javascript
function testLoadOrder() {
  const checks = {
    Config: typeof getSheet === 'function',
    CacheService: typeof CACHE !== 'undefined',
    AuthService: typeof AuthService !== 'undefined',
    LockManager: typeof LOCK_MANAGER !== 'undefined',
    AuditLog: typeof LOG_ENGINE !== 'undefined',
  };
  
  const allPassed = Object.values(checks).every(Boolean);
  console.log('Load order test:', allPassed ? 'PASSED' : 'FAILED', checks);
  return { passed: allPassed, checks };
}
```

---

## Reference: AGENTS.md Contract

### Config.gs (SINGLETON) exposes:
- `SESSION_SERVICE.getCurrentUser()` → `{getEmail: fn}` or `{getEmail: () => null}`
- `SESSION_SERVICE.getScriptTimeZone()` → string timezone
- `SESSION_SERVICE._resetMock()` / `_setMockUser(email)` - testing

### AuthService.gs exposes:
- `AuthService.checkPermission(accion)` - lanza Error si no autorizado
- `AuthService.getUserRole(email)` - retorna null o rol válido
- `TRIGGER_SAFE_ACTIONS[accion]` - boolean

### LockManager.gs exposes:
- `LOCK_MANAGER.acquireResourceLock(resourceId)` → `{releaseLock: fn}`
- `LOCK_MANAGER.cleanupExpiredLocks()` - periódico

### AuditLog.gs exposes:
- `LOG_ENGINE.logEvent(operacion, tabla, idRegistro, previos, nuevos, estado, {correlationId})`

---

## Schema Changes (v1.3)

### Campo tipoTercero en TERCEROS
Se agrega el campo `tipoTercero` (alias de `tipo`) para clasificar terceros según su actividad:
- **CLIENTE**: Tercedores con cartera CxC (ventas) o sin historial (asignado por defecto)
- **PROVEEDOR**: Terceros con compras o cartera CxP (pagos a proveedores)
- **AMBOS**: Terceros que son cliente y proveedor simultáneamente

### Tabla PRODUCTO_PROVEEDOR (nueva)
Tabla relacional que vincula productos con sus proveedores preferidos:
| Columna | Header sheet | Tipo | Descripción |
|---------|-------------|------|-------------|
| `idProducto` | `ID_Producto` | string | FK → Productos.id |
| `idProveedor` | `ID_Proveedor` | string | FK → Terceros.id |
| `precioUltimaCompra` | `Precio_Ultima_Compra` | number (centavos) | Precio de última compra |
| `esPreferido` | `Es_Preferido` | boolean | TRUE si es proveedor preferido |
| `fechaUltimaCompra` | `Fecha_Ultima_Compra` | Date | Fecha de última compra |

### Script de migración: migrarTercerosTipoYProductoProveedor()
Características:
- **Idempotente**: Usa flag `MIGRACION_TERCEROS_V1_3_DONE` en PropertiesService
- **Reversible**: Guarda snapshot en hoja `SNAPSHOT_TERCEROS_V1` antes de escribir; función `revertirMigracionTerceros(snapshotKey)` para rollback
- **Clasificación automática**: Infiere tipo de tercero basado en:
  - Con compras → PROVEEDOR
  - Con cartera CxC → CLIENTE
  - Con cartera CxP o ambas → AMBOS
  - Sin actividad → CLIENTE (reportado en log para revisión manual)
- **Auditoría**: Cada clasificación genera evento vía `LOG_ENGINE.logEvent()` con correlationId

---

## Schema: Tablas y Campos (v2.6)

### TERCEROS — campo tipoTercero
| Campo | Columna sheet | Valores | Descripción |
|-------|---------------|---------|-------------|
| `tipo` / `tipoTercero` | `Tipo` (col 3) | `CLIENTE`, `PROVEEDOR`, `AMBOS` | Clasificación del tercero. Misma columna física, dos alias. |

- Constante: `TIPO_TERCERO.CLIENTE`, `TIPO_TERCERO.PROVEEDOR`, `TIPO_TERCERO.AMBOS`, `TIPO_TERCERO.VALIDOS`
- Validación: `SCHEMA_VALIDATOR.validateTipoTercero(value)` en `AuthService.gs`
- Migración: `migrarClasificacionTerceros()` backfillea registros existentes infiriendo por historial de compras/cartera

### PRODUCTO_PROVEEDOR — nueva tabla relacional
| Columna | Header sheet | Tipo | Descripción |
|---------|-------------|------|-------------|
| `idProducto` | `ID_Producto` | string | FK → Productos.id |
| `idProveedor` | `ID_Proveedor` | string | FK → Terceros.id (debe ser PROVEEDOR o AMBOS) |
| `precioUltimaCompra` | `Precio_Ultima_Compra` | number (centavos) | Precio de la última compra |
| `esPreferido` | `Es_Preferido` | boolean | TRUE si es proveedor preferido |
| `fechaUltimaCompra` | `Fecha_Ultima_Compra` | Date | Fecha de la última compra |

- Constante: `PRODUCTO_PROVEEDOR_CONFIG.SHEET`, `PRODUCTO_PROVEEDOR_CONFIG.COLUMNS`
- La migración `migrarClasificacionTerceros()` crea la hoja si no existe
- No modifica la estructura de PRODUCTOS ni COMPRAS

---

*Generated: 2026-06-28*
*Part of: Coordinación de IAs - Contrato de archivos*
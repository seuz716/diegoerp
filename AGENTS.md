# Coordinación de IAs - Contrato de archivos

## IA-SECURITY (actual) - AuthService.gs, LockManager.gs, AuditLog.gs
- ✅ AuthService.gs: TRIGGER_SAFE_ACTIONS, CRYPTO_SERVICE, SchemaValidator, checkPermission corregido, _kdf optimizado
- ✅ LockManager.gs: _buildResourceIndex(), removeOrphanLocks(), race condition corregida en orphan cleanup
- ✅ AuditLog.gs: correlationId propagation
- ✅ Config.gs: SESSION_SERVICE singleton (eliminadas 5 definiciones duplicadas en Domain.gs, API.gs, Main.gs, Servicios.gs, AuthService.gs)

## IA-BUSINESS (siguiente) - Domain.gs, DAO.gs, CacheService.gs
- ✅ DOMAIN.registrarAbonoAtomic → validar saldo crediticio
- ✅ DAO.updateCarteraBatch → optimistic locking atómico
- ✅ CACHE → circuit breaker HALF_OPEN
- ✅ Kardex: Historial movimientos por producto (getKardexProducto) y global (getKardex)

## CLI 1 - SEGURIDAD (completado)
- ✅ SESSION_SERVICE consolidado como singleton en Config.gs
- ✅ checkPermission: eliminada comparación redundante email !== this._getCurrentUser()
- ✅ _kdf: optimizado con comentario de key stretching
- ✅ AuditLog: lock global unificado (eliminada race condition en purge)
- ✅ correlationId propagation en todos los módulos

## CLI 2 - DOMINIO NEGOCIO (completado)
- ✅ registrarAbonoAtomic: validación cupo crediticio (CxC)
- ✅ Idempotencia con correlationId
- ✅ Optimistic locking con reintentos (DAO.updateCarteraBatch)
- ✅ Creación inline de productos en compras (Domain.gs)
- ✅ DAO_PRODUCTOS.crear() con ID opcional

## CLI 3 - INPUT VALIDATION (completado)
- ✅ INPUT_VALIDATOR.validateTipo: valida CxC, CxP, CLIENTE, PROVEEDOR, AMBOS
- ✅ INPUT_VALIDATOR.validatePageSize: min 1, max 5000 (protección DoS)
- ✅ INPUT_VALIDATOR.validatePageToken: asegura >= 0
- ✅ INPUT_VALIDATOR.validateEstado: valida ABIERTA, PARCIAL, CANCELADA, VENCIDA
- ✅ getCartera, getTerceros, getCompras, getProductos, actualizarProducto: validación agregada
- ✅ Tests: 5 nuevos tests para input validation (total 30 tests)

## Contrato de interfaces

### Config.gs (SINGLETON) expone:
- `SESSION_SERVICE.getCurrentUser()` → `{getEmail: fn}` o `{getEmail: () => null}`
- `SESSION_SERVICE.getScriptTimeZone()` → string timezone
- `SESSION_SERVICE._resetMock()` / `_setMockUser(email)` - testing

### AuthService.gs expone:
- `AuthService.checkPermission(accion)` - lanza Error si no autorizado
- `AuthService.getUserRole(email)` - retorna null o rol válido
- `TRIGGER_SAFE_ACTIONS[accion]` - boolean

### LockManager.gs expone:
- `LOCK_MANAGER.acquireResourceLock(resourceId)` → `{releaseLock: fn}`
- `LOCK_MANAGER.cleanupExpiredLocks()` - periódico

### AuditLog.gs expone:
- `LOG_ENGINE.logEvent(operacion, tabla, idRegistro, previos, nuevos, estado, {correlationId})`

## Protocolo de extensión
Solo agregar funciones EXPORTADAS (nombres sin guión bajo inicial) en los archivos asignados. Usar `SESSION_SERVICE` desde Config.gs (no redefinir localmente).

## TABLA DE PROGRESO

   Modelo                         │ Fase                           │ Tarea                         │ Estado
  ────────────────────────────────┼────────────────────────────────┼───────────────────────────────┼───────────────────────────────
   A                              │ Inf.                           │ Criptografía                  │ ✅
   A                              │ Inf.                           │ JSON Schemas                  │ ✅
   A                              │ Inf.                           │ Lock Manager                  │ ✅
   A                              │ Inf.                           │ Circuit Breaker               │ ✅
   B                              │ Validación                     │ Entradas                      │ ✅
   B                              │ Validación                     │ Negocio                       │ ✅
   B                              │ Rendimiento                    │ Props cache                   │ ✅
   B                              │ Rendimiento                    │ Batch writes                  │ ✅
   B                              │ Rendimiento                    │ JSON minimize                 │ ✅
   B                              │ Observabilidad                 │ Rate metrics                  │ ✅
   CLI 1                          │ Seguridad                      │ SESSION_SERVICE singleton     │ ✅
   CLI 1                          │ Seguridad                      │ checkPermission fix           │ ✅
   CLI 1                          │ Seguridad                      │ _kdf optimization             │ ✅
   CLI 1                          │ Seguridad                      │ AuditLog race condition       │ ✅
   CLI 1                          │ Seguridad                      │ correlationId propagation     │ ✅
   CLI 2                          │ Negocio                        │ Creación inline productos     │ ✅
   CLI 2                          │ Negocio                        │ DAO_PRODUCTOS.id opcional     │ ✅
   CLI 2                          │ Rendimiento                    │ Pre-carga productoMap         │ ✅

   --------

   Próximas tareas
   ────────────────────────────────┼────────────────────────────────┼───────────────────────────────┼───────────────────────────────
   1                              │ Fix circuit breaker half-open    │ (1h)                          │ ✅
   2                              │ Complete getHealth()             │ (0.5h)                        │ ✅
   3                              │ Optimize cache hit tracking      │ (0.5h)                        │ ✅
   4                              │ Fix Cache stale N+1              │ (1h)                          │ ✅
   5                              │ Consolidate DAO batch ops        │ (2h)                          │ ✅
   6                              │ Add optimistic locking           │ (1.5h)                        │ ✅
   7                              │ Fix Config references            │ (0.25h)                       │ ✅
   8                              │ Document extension points        │ (0.5h)                        │ ✅
   9                              │ Fix SESSION_SERVICE duplicado    │ (3h)                          │ ✅
   10                             │ Fix checkPermission bug          │ (1h)                          │ ✅
   11                             │ Optimizar _kdf criptográfico     │ (1.5h)                        │ ✅
   12                             │ Fix Auth permission checks       │ (1h)                          │ ✅
   13                             │ Cleanup orphan locks race cond   │ (1h)                          │ ✅

   --------

   Commits totales: 25 en main (incluye commit de correcciones circuit breaker)

   --------

   Correcciones arquitectónicas CacheService.gs completadas:
   - ✅ Eliminada instanciación fallida `const CACHE = new CacheService()`
   - ✅ Consolidado: _transitionToHalfOpen integrado en _autoRecoverCircuitBreaker
   - ✅ Límite 999999 en el contador de métricas circuitOpens/circuitCloses
   - ✅ getHealth() completado con failCount, nextRetryMs, checksumValidationStatus

   --------

   Correcciones Módulo SEGURIDAD completadas:
   - ✅ SESSION_SERVICE consolidado como singleton en Config.gs
   - ✅ checkPermission: eliminada comparación redundante email !== this._getCurrentUser()
   - ✅ _kdf: iteraciones ahora contribuyen al key stretching vía HMAC chain
   - ✅ _deriveKey: corregida recursión infinita (llamaba a _deriveKey en vez de _deriveKeyWithIterations)
   - ✅ removeOrphanLocks: lock global unificado para detect+delete (elimina race condition)

   --------

Test Suite (runAllRegressionTests): 30 tests
    - AuthService: 3 tests (auth, whitelist, unknown action)
    - LockManager: 2 tests (cleanup, index)
    - CacheService: 6 tests (circuit, health, consistency, reset)
    - AuditLog: 2 tests (correlationId, sanitization)
    - TransactionManager: 3 tests (struct, correlationId, snapshot)
    - Accounting: 8 tests (methods, integration, singleton, resumen)
    - SchemaValidator: 2 tests (validation)
    - Integrity: 4 tests (purge race, commit/rollback, opt-locking, validation)
    - Business Validation: 3 tests (credit limit, idempotency)
    - API Validation: 5 tests (validateTipo, validatePageSize, validateEstado, validatePageToken, getProductos)

### 🔒 Seguridad - Logging Sanitizado
- ✅ AuthService logging: removed keyName/secretName from console.log output
- ✅ API._safeError: removed stack trace from console output
- ✅ AuditLog error logs: replaced e.toString() with generic messages

### 🔒 Seguridad - Circuit Breaker Hardening
- ✅ CacheService: Validate timestamps (max 24h window) to prevent corruption
- ✅ Main.gs: Removed keyLength from checkIAKey output

## CLI 4 - BACKEND REFACTOR (completado)
- ✅ CacheService: `_refreshTerceros()` missing `tercerosCircuitState = 'open'` — corregido
- ✅ CacheService: `_handleIntegrityFailure()` missing `_setCircuitState()` — corregido
- ✅ CacheService: `CIRCUIT_AUTO_CLOSE_MS` cambiado de 300000 a 30000 (30s exactos)
- ✅ CacheService: HALF_OPEN stuck fix — `isTercerosValid()`/`isCarteraValid()` fuerza refresh en half_open
- ✅ CacheService: Flujo CLOSED→OPEN→HALF_OPEN→CLOSED verificado y funcional
- ✅ Config.gs: `_getTimeZone()` usa `SESSION_SERVICE.getScriptTimeZone()` en vez de `Session.getScriptTimeZone()`
- ✅ API.gs: `generateCorrelationId()` y `_safeError()` usan `SESSION_SERVICE.getScriptTimeZone()`
- ✅ SESSION_SERVICE: 0 bypasses externos, solo llamado interno en definición
- ✅ IAService: Rate limiter cambiado a token bucket (100 req/min)
- ✅ IAService: Error message actualizado a "Límite de solicitudes excedido, reintente en 60 segundos."
- ✅ IAService: Validación de entrada — >500 registros rechaza con RATE_LIMITED
- ✅ DAO.updateCarteraBatch(): Optimistic locking verificado (3 retries, version increment, rollback no necesario)
- ✅ AuditLog.logEvent(): Lock adquirido ANTES de getLastRow() — purge atómico correcto
- ✅ Frontend wrappers getCacheHealth/getCacheMetrics/verificarConfiguracionIA presentes en app.html
- ✅ Archivos setup redundantes (INSTALL_SCRIPT.gs, SETUP_ONE_CLICK.gs, init_spreadsheet.gs) eliminados

### ❌ No aplica al stack GAS
- SQL optimizer/connection pool — este proyecto NO usa SQL, usa SpreadsheetApp
- Logging async + 50MB rotation — GAS no soporta escritura asíncrona ni tamaño de archivo (worksheets)
- /procesarIA endpoint — los endpoints GAS son funciones globales, no rutas HTTP
## MATRIZ DE CORRELACIÓN - PRODUCTOS (Sección 7)

| Función Frontend | Backend Call | Función Backend | Estado | Observaciones |
|-----------------|--------------|-----------------|--------|---------------|
| cargarProductos() | App.api.getProductos() | getProductos() | ✅ | CRUD completo con validación |
| guardarProducto() | App.api.actualizarProducto() | actualizarProducto() | ✅ | Con optimistic locking |
| toggleActivo() | App.api.toggleActivoProducto() | DAO_PRODUCTOS.toggleActivo() | ✅ | Cambia estado ACTIVO/INACTIVO |
| (No UI directa) | getKardexProducto(id, limit) | DOMAIN.getKardexProducto(id, limit) | ✅ CORRECTO | Historial movimientos inventario por producto específico |
| (No UI directa) | getKardex(limit) | DOMAIN.getKardex(limit) | ✅ CORRECTO | Kardex global: movimientos todos productos últimos 30 día |

## MATRIZ DE CORRELACIÓN - DASHBOARD (Sección 8)

| Función Frontend | Backend Call | Función Backend | Estado | Observaciones |
|-----------------|--------------|-----------------|--------|---------------|
| (No UI directa) | App.api.getVentasDelDia() | getVentasDelDia() | ✅ CORRECTO | Reporte de ventas del día actual. Útil para corte de caja diario. Retorna total y lista de ventas. |

## ?? IMPLEMENTACI�N VERIFICADA - SmokeTests.gs

| Funci�n | Archivo | Estado |
|---------|---------|--------|
| SmokeTests.runAll() | SmokeTests.gs | ? Creado |
| SmokeTests.testHealthCheck() | SmokeTests.gs | ? Usa getHealthStatus (Main.gs) |
| SmokeTests.testSheetsExist() | SmokeTests.gs | ? Usa CARTERA_CONFIG, CONFIG, COMPRAS_CONFIG |
| SmokeTests.testCriticalFunctions() | SmokeTests.gs | ? Usa getTerceros, getProductos, CACHE.getHealth, DAO_COMPRAS.getMovimientosKardex |
| SmokeTests.testConfiguration() | SmokeTests.gs | ? Usa PropertiesService |
| SmokeTests.testTriggersExist() | SmokeTests.gs | ? Usa ScriptApp.getProjectTriggers() |
| runSmokeTests() | SmokeTests.gs | ? Funci�n principal exportada |
| sendSmokeAlert() | SmokeTests.gs | ? Usa SESSION_SERVICE.getCurrentUser, MailApp |

Todas las dependencias existen en el proyecto:
- CARTERA_CONFIG, CONFIG, COMPRAS_CONFIG en Config.gs
- CACHE en CacheService.gs  
- DAO_COMPRAS en DAOCompras.gs
- getTerceros, getProductos en API.gs
- getHealthStatus en Main.gs
- SESSION_SERVICE en Config.gs

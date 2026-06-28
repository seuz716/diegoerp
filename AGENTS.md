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

## CLI 2 - DOMINIO NEGOCIO (completado)
- ✅ registrarAbonoAtomic: validación cupo crediticio (CxC)
- ✅ Idempotencia con correlationId
- ✅ Optimistic locking con reintentos (DAO.updateCarteraBatch)

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

   Commits totales: 22 en main

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

Test Suite (runAllRegressionTests): 29 tests
    - AuthService: 3 tests (auth, whitelist, unknown action)
    - LockManager: 2 tests (cleanup, index)
    - CacheService: 6 tests (circuit, health, consistency, reset)
    - AuditLog: 2 tests (correlationId, sanitization)
    - TransactionManager: 3 tests (struct, correlationId, snapshot)
    - Accounting: 8 tests (methods, integration, singleton, resumen)
    - SchemaValidator: 2 tests (validation)
    - Integrity: 4 tests (purge race, commit/rollback, opt-locking, validation)
    - Business Validation: 3 tests (credit limit, idempotency)
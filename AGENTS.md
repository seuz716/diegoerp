# Coordinación de IAs - Contrato de archivos

## IA-SECURITY (actual) - AuthService.gs, LockManager.gs, AuditLog.gs
- ✅ AuthService.gs: TRIGGER_SAFE_ACTIONS, CRYPTO_SERVICE, SchemaValidator
- ✅ LockManager.gs: _buildResourceIndex(), removeOrphanLocks()
- ✅ AuditLog.gs: correlationId propagation

## IA-BUSINESS (siguiente) - Domain.gs, DAO.gs, CacheService.gs
- DOMAIN.registrarAbonoAtomic → validar saldo crediticio
- DAO.updateCarteraBatch → optimistic locking atómico
- CACHE → circuit breaker HALF_OPEN

## Contrato de interfaces

### AuthService.gs expone:
- `AuthService.checkPermission(accion)` - lanza Error si no autorizado
- `AuthService.getUserRole(email)` - retorna null o rol válido
- `TRIGGER_SAFE_ACTIONS[accion]` - boolean

### LockManager.gs expone:
- `LOCK_MANAGER.acquireResourceLock(resourceId)` → {releaseLock: fn}
- `LOCK_MANAGER.cleanupExpiredLocks()` - periódico

### AuditLog.gs expone:
- `LOG_ENGINE.logEvent(operacion, tabla, idRegistro, previos, nuevos, estado, {correlationId})`

## Protocolo de extensión
Solo agregar funciones EXPORTADAS (nombres sin guión bajo inicial) en los archivos asignados.

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

  Commits totales: 17 en main

  --------

  Correcciones arquitectónicas CacheService.gs completadas:
  - ✅ Eliminada instanciación fallida `const CACHE = new CacheService()`
  - ✅ Consolidado: _transitionToHalfOpen integrado en _autoRecoverCircuitBreaker
  - ✅ Límite 999999 en el contador de métricas circuitOpens/circuitCloses
  - ✅ getHealth() completado con failCount, nextRetryMs, checksumValidationStatus
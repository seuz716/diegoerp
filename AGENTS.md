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
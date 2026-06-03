/**
 * MANEJO DE LOCKS Y CONCURRENCIA
 * Resuelve:
 * - #1: Condición de carrera (Lock Global vs Lock de Recurso)
 * - #6: Backoff exponencial con jitter seguro
 */

const LOCK_MANAGER = {
  GLOBAL_TIMEOUT: 30000,
  MAX_RETRIES: 4,
  BASE_BACKOFF: 500,
  RESOURCE_LOCK_WAIT: 1500,
  RESOURCE_LOCK_TIMEOUT: 10000,
  RESOURCE_TTL_MS: 45000,
  LOCK_PREFIX: "LOCK_",

  /**
   * Intenta obtener un lock específico de recurso mediante PropertiesService,
   * coordinado con un lock global para asegurar atomicidad.
   */
  acquireResourceLock(resourceId) {
    const properties = PropertiesService.getScriptProperties();
    const lockKey = this.LOCK_PREFIX + resourceId;
    let attempt = 0;
    const startTime = Date.now();

    while (attempt < this.MAX_RETRIES) {
      const globalLock = LockService.getScriptLock();
      if (globalLock.tryLock(this.RESOURCE_LOCK_WAIT)) {
        try {
          const now = Date.now();
          const raw = properties.getProperty(lockKey);
          let isLocked = false;

          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.expiresAt && parsed.expiresAt > now) {
                isLocked = true;
              }
            } catch (e) {
              isLocked = false;
            }
          }

          if (!isLocked) {
            properties.setProperty(lockKey, JSON.stringify({ expiresAt: now + this.RESOURCE_TTL_MS }));
            return {
              releaseLock: () => this._releaseResourceLock(lockKey),
            };
          }
        } finally {
          globalLock.releaseLock();
        }
      }

      attempt++;
      if (attempt < this.MAX_RETRIES && Date.now() - startTime < this.RESOURCE_LOCK_TIMEOUT) {
        Utilities.sleep(this._backoffMs(attempt));
      }
    }

    throw new Error('El sistema está ocupado. Por favor reintenta en 30s.');
  },

  _releaseResourceLock(lockKey) {
    const globalLock = LockService.getScriptLock();
    if (globalLock.tryLock(5000)) {
      try {
        PropertiesService.getScriptProperties().deleteProperty(lockKey);
      } finally {
        globalLock.releaseLock();
      }
    }
  },

  /** Fallback genérico para acciones masivas (Ej: cache refreshes generales) */
  acquireGlobalLock(timeout = this.GLOBAL_TIMEOUT) {
    const lock = LockService.getScriptLock();
    let attempt = 0;

    while (attempt < this.MAX_RETRIES) {
      if (lock.tryLock(timeout)) return lock;
      attempt++;
      if (attempt < this.MAX_RETRIES) {
        Utilities.sleep(this._backoffMs(attempt));
      }
    }

    throw new Error('Servidor saturado. Intenta repitiendo un poco más tarde.');
  },

  _backoffMs(attempt) {
    const baseWait = this.BASE_BACKOFF * Math.pow(2, attempt - 1);
    const jitterRatio = 0.3 + Math.random() * 0.2;
    const jitter = baseWait * jitterRatio * (Math.random() * 2 - 1);
    return Math.max(500, baseWait + jitter);
  },
};

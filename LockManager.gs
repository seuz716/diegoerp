/**
 * MANEJO DE LOCKS Y CONCURRENCIA
 * Resuelve:
 * - #1: Condición de carrera (Lock Global monopolizado vs Lock de Recurso)
 * - #6: Backoff exponencial con jitter insuficiente
 */

const LOCK_MANAGER = {
  GLOBAL_TIMEOUT: 30000, 
  MAX_RETRIES: 5,
  BASE_BACKOFF: 600,

  /**
   * Intenta obtener un lock específico de recurso simulado mediante Cache,
   * garantizando su seteo a través de un lock global intermedio.
   * Resuelve el 🔴 CUELLO DE BOTELLA en 50 usuarios recurrentes.
   */
  acquireResourceLock(resourceId) {
    const cache = CacheService.getScriptCache();
    const lockKey = "LOCK_" + resourceId;
    let attempt = 0;
    
    while (attempt < this.MAX_RETRIES) {
      // Tomamos lock global SOLO por un máximo de 3s para leer/escribir concurrencia en Cache
      const globalLock = LockService.getScriptLock();
      if (globalLock.tryLock(3000)) {
        try {
          const isLocked = cache.get(lockKey);
          if (!isLocked) {
             // El recurso está libre, lo tomamos por un máximo de 45seg (previene locks huérfanos)
             cache.put(lockKey, "LOCKED", 45); 
             // Devolvemos una API estándar de "releaseLock"
             return {
               releaseLock: () => {
                 cache.remove(lockKey);
               }
             };
          }
        } finally {
          // Liberamos el Script Lock casi inmediato
          globalLock.releaseLock();
        }
      }
      
      // Si estaba bloqueado o el microLockGlobal falló, realizamos Exp Backoff
      attempt++;
      if (attempt < this.MAX_RETRIES) {
        // JITTER MASIVO: 30% a 50% de la base dictada por la auditoría recomendada
        const baseWait = this.BASE_BACKOFF * Math.pow(2, attempt - 1);
        const jitterRatio = 0.3 + Math.random() * 0.2; 
        const jitter = baseWait * jitterRatio * (Math.random() - 0.5) * 2;
        const waitTime = baseWait + jitter;
        
        Utilities.sleep(Math.max(500, waitTime));
      }
    }
    
    throw new Error('El sistema está ocupado verificando los saldos de este usuario. Por favor intenta de nuevo.');
  },

  /** Fallback genérico para acciones masivas (Ej: cache refreshes generales) */
  acquireGlobalLock(timeout = this.GLOBAL_TIMEOUT) {
    const lock = LockService.getScriptLock();
    let attempt = 0;
    while (attempt < this.MAX_RETRIES) {
      if (lock.tryLock(timeout)) return lock; 
      attempt++;
      if (attempt < this.MAX_RETRIES) {
        const baseWait = this.BASE_BACKOFF * Math.pow(2, attempt - 1);
        const jitterRatio = 0.3 + Math.random() * 0.2; 
        const waitTime = baseWait + (baseWait * jitterRatio * (Math.random() - 0.5) * 2);
        Utilities.sleep(Math.max(500, waitTime));
      }
    }
    throw new Error('Servidor saturado. Intenta repitiendo un poco más tarde.');
  }
};

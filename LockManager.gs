/**
 * MANEJO DE LOCKS Y CONCURRENCIA
 * Resuelve Problema #4: Timeout genérico sin reintento
 */

const LOCK_MANAGER = {
  DEFAULT_TIMEOUT: 30000, // 30 segundos
  MAX_RETRIES: 3,
  BASE_BACKOFF: 500,

  /**
   * Intenta obtener un lock exclusivo de script con retries exponenciales.
   * Lanza un Error si falla.
   */
  acquireLock(timeoutMS = this.DEFAULT_TIMEOUT) {
    const lock = LockService.getScriptLock();
    let attempt = 0;
    
    while (attempt < this.MAX_RETRIES) {
      if (lock.tryLock(timeoutMS)) {
        return lock; // Lock adquirido exitosamente
      }
      
      attempt++;
      if (attempt < this.MAX_RETRIES) {
        // Backoff exponencial con un pequeño jitter
        const waitTime = this.BASE_BACKOFF * Math.pow(2, attempt - 1) + Math.random() * 200;
        Utilities.sleep(waitTime);
      }
    }
    
    // Falla final
    throw new Error('Servidor ocupado. La transacción no se pudo completar porque otros usuarios están realizando cambios. Intente nuevamente.');
  }
};

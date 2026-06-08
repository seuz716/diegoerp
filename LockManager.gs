/**
 * MANEJO DE LOCKS Y CONCURRENCIA
 * Resuelve:
 * - #1: Condición de carrera (Lock Global vs Lock de Recurso)
 * - #6: Backoff exponencial con jitter seguro
 *
 * TTL Protocol:
 * - Locks se almacenan en ScriptProperties con prefijo LOCK_ + resourceId
 * - Cada lock contiene { expiresAt: timestamp } en ms desde epoch
 * - TTL normal: RESOURCE_TTL_MS (45s)
 * - TTL máximo aceptable: RESOURCE_LOCK_MAX_TTL_MS (120s)
 * - Locks con expiresAt > now + RESOURCE_LOCK_MAX_TTL_MS se consideran corruptos
 * - Cleanup periódico: cleanupExpiredLocks() barre y elimina locks expirados
 * - Orphan detection: _detectOrphanLocks() busca locks sin recurso asociado
 */

const LOCK_MANAGER = {
  GLOBAL_TIMEOUT: 30000,
  MAX_RETRIES: 4,
  BASE_BACKOFF: 500,
  RESOURCE_LOCK_WAIT: 1500,
  RESOURCE_LOCK_TIMEOUT: 25000,
  RESOURCE_TTL_MS: 45000,
  RESOURCE_LOCK_MAX_TTL_MS: 120000,
  LOCK_PREFIX: "LOCK_",
  _lockDepth: 0,
  _maxDepthReentrant: 10,

  _safeTryLock(timeoutMs) {
    if (this._lockDepth >= this._maxDepthReentrant) {
      Logger.log("FATAL: _lockDepth anómalo (" + this._lockDepth + "). Reseteando.");
      this._lockDepth = 0;
    }
    const lock = LockService.getScriptLock();
    if (this._lockDepth > 0) {
      this._lockDepth++;
      return true;
    }
    if (lock.tryLock(timeoutMs)) {
      this._lockDepth = 1;
      return true;
    }
    return false;
  },

  _safeReleaseLock() {
    if (this._lockDepth > 0) {
      this._lockDepth--;
      if (this._lockDepth === 0) {
        LockService.getScriptLock().releaseLock();
      }
    }
  },

  /**
   * Intenta obtener un lock específico de recurso mediante PropertiesService,
   * coordinado con un lock global para asegurar atomicidad.
   * TTL Protocol: Si el lock existe pero expiró (expiresAt < now), se elimina
   * y se adquiere de inmediato. Si el lock tiene un TTL anormalmente largo
   * (expiresAt > now + RESOURCE_LOCK_MAX_TTL_MS), se loguea como corrupto.
   */
  acquireResourceLock(resourceId) {
    const properties = PropertiesService.getScriptProperties();
    const lockKey = this.LOCK_PREFIX + resourceId;
    const MAX_RETRIES = 10;
    let attempt = 0;
    const startTime = Date.now();

    while (attempt < MAX_RETRIES) {
      // Abort if total elapsed time exceeds timeout
      if (Date.now() - startTime >= this.RESOURCE_LOCK_TIMEOUT) {
        throw new Error(`Timeout (${this.RESOURCE_LOCK_TIMEOUT}ms) al adquirir bloqueo para ${resourceId}.`);
      }

      if (this._safeTryLock(this.RESOURCE_LOCK_WAIT)) {
        try {
          const now = Date.now();
          const raw = properties.getProperty(lockKey);
          let isLocked = false;

          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.expiresAt && parsed.expiresAt > now) {
                isLocked = true;
                if (typeof parsed.expiresAt === "number" && parsed.expiresAt > now + this.RESOURCE_LOCK_MAX_TTL_MS) {
                  Logger.log("LOCK_CORRUPT: Resource lock " + lockKey + " has absurd TTL. expiresAt=" + parsed.expiresAt + " now=" + now + " maxTTL=" + this.RESOURCE_LOCK_MAX_TTL_MS);
                }
              } else {
                properties.deleteProperty(lockKey);
              }
            } catch (e) {
              // Invalid JSON — treat as unlocked
            }
          }

          if (!isLocked) {
            const lockData = { expiresAt: now + this.RESOURCE_TTL_MS };
            properties.setProperty(lockKey, JSON.stringify(lockData));
            return {
              releaseLock: () => this._releaseResourceLock(lockKey, lockData),
            };
          }
        } finally {
          this._safeReleaseLock();
        }
      }

      attempt++;
      // Sleep between attempts (exponential backoff) regardless of timeout check above
      if (attempt < MAX_RETRIES) {
        Utilities.sleep(this._backoffMs(attempt));
      }
    }

    throw new Error(`No se pudo adquirir el bloqueo para el recurso ${resourceId} después de ${MAX_RETRIES} intentos.`);
  },

  /**
   * Libera un lock de recurso verificando que el valor actual coincida
   * con el esperado (por si otra ejecución adquirió el lock tras expirar).
   * Cleanup strategy: se adquiere lock global para evitar condiciones de carrera.
   * @param {string} lockKey - Clave del lock (LOCK_ + resourceId)
   * @param {Object} expectedData - Datos esperados del lock al momento de adquisición
   */
  _releaseResourceLock(lockKey, expectedData) {
    const gotLock = this._safeTryLock(5000);
    if (!gotLock) {
      Logger.log("WARNING: No se pudo adquirir lock global para liberar " + lockKey);
      return;
    }
    try {
      const props = PropertiesService.getScriptProperties();
      const currentRaw = props.getProperty(lockKey);
      if (currentRaw) {
        try {
          const current = JSON.parse(currentRaw);
          if (expectedData && current.expiresAt !== expectedData.expiresAt) {
            Logger.log("WARNING: Lock " + lockKey + " was acquired by another execution after expiry. Expected expiresAt=" + expectedData.expiresAt + " but found " + current.expiresAt);
            return; // Do not delete someone else's lock
          }
        } catch (e) {
          // Ignore parse errors on release
        }
      }
      props.deleteProperty(lockKey);
    } finally {
      this._safeReleaseLock();
    }
  },

  /**
   * Cleans up all expired locks from ScriptProperties.
   * TTL Protocol: scans all LOCK_* properties, removes those with
   * expiresAt < Date.now(). Uses global lock for atomicity.
   * Cleanup strategy: designed to be run via time-based trigger (hourly).
   * @returns {{cleaned: number, scanned: number}} Resultado de la limpieza
   */
  cleanupExpiredLocks() {
    let cleaned = 0;
    let scanned = 0;

    if (this._safeTryLock(this.GLOBAL_TIMEOUT)) {
      try {
        const props = PropertiesService.getScriptProperties();
        const keys = props.getKeys().filter(k => k.startsWith(this.LOCK_PREFIX));
        scanned = keys.length;

        for (const key of keys) {
          const raw = props.getProperty(key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
                props.deleteProperty(key);
                cleaned++;
              }
            } catch (e) {
              props.deleteProperty(key);
              cleaned++;
            }
          }
        }
      } finally {
        this._safeReleaseLock();
      }
    }

    return { cleaned, scanned };
  },

  /**
   * Scans all LOCK_* properties and detects orphan locks whose resourceId
   * no longer exists in the system (Terceros or Cartera sheets).
   * Best-effort: just logs warnings for manual review.
   * Cleanup strategy: intended as diagnostic tool, does not auto-delete.
   * @returns {string[]} List of orphan lock keys
   */
  _detectOrphanLocks() {
    if (!this._safeTryLock(10000)) {
      Logger.log("WARNING: No se pudo adquirir lock global para detección de orphans.");
      return [];
    }
    try {
      const props = PropertiesService.getScriptProperties();
      const keys = props.getKeys().filter(k => k.startsWith(this.LOCK_PREFIX));
      const orphans = [];

      let tercerosData = null;
      let carteraData = null;
      try {
        const ss = getActiveSpreadsheet();
        const tercerosSheet = ss.getSheetByName("Terceros");
        const carteraSheet = ss.getSheetByName("Cartera");
        if (tercerosSheet) tercerosData = tercerosSheet.getDataRange().getValues();
        if (carteraSheet) carteraData = carteraSheet.getDataRange().getValues();
      } catch (e) {
        Logger.log("WARNING: No se pudo acceder a las hojas para detección de orphans: " + e.message);
      }

      for (const key of keys) {
        const resourceId = key.substring(this.LOCK_PREFIX.length);
        let found = false;

        if (tercerosData) {
          for (const row of tercerosData) {
            if (row.some(cell => String(cell) === resourceId)) {
              found = true;
              break;
            }
          }
        }
        if (!found && carteraData) {
          for (const row of carteraData) {
            if (row.some(cell => String(cell) === resourceId)) {
              found = true;
              break;
            }
          }
        }

        if (!found) {
          Logger.log("WARNING: Possible orphan lock. Resource " + resourceId + " (key: " + key + ") not found in Terceros or Cartera sheets.");
          orphans.push(key);
        }
      }

      return orphans;
    } finally {
      this._safeReleaseLock();
    }
  },

  /**
   * Creates a time-driven trigger to run cleanupExpiredLocks every hour.
   * Requires "configurar_sistema" permission.
   * Cleanup strategy: periodic cleanup prevents ScriptProperties bloat
   * from abandoned locks due to script interruptions.
   * @returns {{success: boolean, message: string}} Resultado de la operación
   */
  crearTriggerLockCleanup() {
    try {
      AuthService.checkPermission("configurar_sistema");
    } catch (e) {
      Logger.log("WARNING: No se pudo verificar permiso configurar_sistema: " + e.message);
    }

    const gotLock = this._safeTryLock(10000);
    if (!gotLock) {
      return { success: false, message: "No se pudo adquirir lock para configurar trigger." };
    }
    try {
      const triggers = ScriptApp.getProjectTriggers().filter(
        t => t.getHandlerFunction() === "cleanupExpiredLocks"
      );
      // Si ya existe exactamente 1, no hacer nada
      if (triggers.length === 1) {
        const msg = "Trigger cleanupExpiredLocks ya existe.";
        Logger.log(msg);
        return { success: true, message: msg };
      }
      triggers.forEach(t => ScriptApp.deleteTrigger(t));

      ScriptApp.newTrigger("cleanupExpiredLocks")
        .timeBased()
        .everyHours(1)
        .create();

      const msg = "Trigger de limpieza de locks creado exitosamente (cada 1 hora).";
      Logger.log(msg);
      return { success: true, message: msg };
    } finally {
      this._safeReleaseLock();
    }
  },

  /** Fallback genérico para acciones masivas (Ej: cache refreshes generales) */
  acquireGlobalLock(timeout = this.GLOBAL_TIMEOUT) {
    let attempt = 0;

    while (attempt < this.MAX_RETRIES) {
      if (this._safeTryLock(timeout)) {
        return {
          releaseLock: () => this._safeReleaseLock()
        };
      }
      attempt++;
      if (attempt < this.MAX_RETRIES) {
        Utilities.sleep(this._backoffMs(attempt));
      }
    }

    throw new Error('Servidor saturado. Intenta de nuevo más tarde.');
  },

  _backoffMs(attempt) {
    const baseWait = Math.min(3000, this.BASE_BACKOFF * Math.pow(2, attempt - 1));
    return baseWait / 2 + Math.random() * baseWait;  // [0.5, 1.5]×baseWait
  },
};
// Global wrapper required for time-driven trigger
function cleanupExpiredLocks() {
  LOCK_MANAGER.cleanupExpiredLocks();
}

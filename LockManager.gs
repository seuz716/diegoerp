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
  PROPAGATION_DELAY_MS: LOCK_CONFIG.PROPAGATION_DELAY_MS,
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
          Utilities.sleep(this.PROPAGATION_DELAY_MS);
          const now = Date.now();
          const raw = properties.getProperty(lockKey);
          let isLocked = false;

          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.expiresAt && parsed.expiresAt > now) {
                if (typeof parsed.expiresAt === "number" && parsed.expiresAt > now + this.RESOURCE_LOCK_MAX_TTL_MS) {
                  Logger.log("LOCK_CORRUPT: Resource lock " + lockKey + " has absurd TTL. expiresAt=" + parsed.expiresAt + " now=" + now + " maxTTL=" + this.RESOURCE_LOCK_MAX_TTL_MS + ". Treating as expired.");
                  properties.deleteProperty(lockKey);
                } else {
                  isLocked = true;
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
      Utilities.sleep(this.PROPAGATION_DELAY_MS);
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
        Utilities.sleep(this.PROPAGATION_DELAY_MS);
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

        // === INICIO FIX C-05 ===
        // Also remove orphan locks during cleanup
        try {
          const orphanResult = this.removeOrphanLocks();
          cleaned += orphanResult.removed;
        } catch (e) {
          Logger.log("[FIX-C-05] Error during orphan removal in cleanup: " + e.toString());
        }
        // === FIN FIX C-05 ===
      } finally {
        this._safeReleaseLock();
      }
    }

    return { cleaned, scanned };
  },

  /**
   * Builds index of ALL resource IDs in the system (O(n) instead of O(n*m))
   * Uses ID columns specifically for faster lookup
   */
  _buildResourceIndex() {
    const index = new Set();
    try {
      const ss = getActiveSpreadsheet();
      const COL_TER = CARTERA_CONFIG.COLUMNS.TERCEROS;
      const COL_CAR = CARTERA_CONFIG.COLUMNS.CARTERA;
      
      // Only read ID columns (much faster than entire sheets)
      const tercerosSheet = ss.getSheetByName(CARTERA_CONFIG.SHEETS.TERCEROS);
      if (tercerosSheet) {
        const lastRow = tercerosSheet.getLastRow();
        if (lastRow > 1) {
          const ids = tercerosSheet.getRange(2, COL_TER.id, lastRow - 1, 1).getValues();
          ids.forEach(row => {
            const id = String(row[0] || "").trim();
            if (id) index.add(id);
          });
        }
      }
      
      const carteraSheet = ss.getSheetByName(CARTERA_CONFIG.SHEETS.CARTERA);
      if (carteraSheet) {
        const lastRow = carteraSheet.getLastRow();
        if (lastRow > 1) {
          const ids = carteraSheet.getRange(2, COL_CAR.id_tercero, lastRow - 1, 1).getValues();
          ids.forEach(row => {
            const id = String(row[0] || "").trim();
            if (id) index.add(id);
          });
        }
      }
    } catch (e) {
      Logger.log("WARNING: No se pudo construir índice de recursos: " + e.message);
    }
    return index;
  },

  /**
   * Scans all LOCK_* properties and detects orphan locks whose resourceId
   * no longer exists in the system (Terceros or Cartera sheets).
   * NOTE: Caller MUST hold global lock. Does NOT acquire lock internally.
   * @returns {string[]} List of orphan lock keys
   */
  _detectOrphanLocks() {
    const props = PropertiesService.getScriptProperties();
    const keys = props.getKeys().filter(k => k.startsWith(this.LOCK_PREFIX));
    if (keys.length === 0) return [];
    const orphans = [];
    const resourceIndex = this._buildResourceIndex();

    for (const key of keys) {
      const resourceId = key.substring(this.LOCK_PREFIX.length);
      if (!resourceIndex.has(resourceId)) {
        Logger.log("[FIX-C-05] Orphan lock detected: Resource " + resourceId + " (key: " + key + ")");
        orphans.push(key);
      }
    }

    return orphans;
  },

  /**
   * Removes physically orphan locks from ScriptProperties.
   * Acquires global lock for the entire detect+delete operation to
   * prevent race conditions.
   * @returns {{removed: number, orphans: string[]}} Resultado de la operación
   */
  removeOrphanLocks() {
    if (!this._safeTryLock(10000)) {
      Logger.log("WARNING: No se pudo adquirir lock global para remover orphans.");
      return { removed: 0, orphans: [] };
    }
    try {
      Utilities.sleep(this.PROPAGATION_DELAY_MS);
      const orphans = this._detectOrphanLocks();
      if (orphans.length === 0) {
        Logger.log("[FIX-C-05] No orphan locks found");
        return { removed: 0, orphans: [] };
      }

      let removed = 0;
      const props = PropertiesService.getScriptProperties();
      for (const key of orphans) {
        try {
          props.deleteProperty(key);
          Logger.log("[FIX-C-05] Deleted orphan lock: " + key);
          removed++;
        } catch (e) {
          Logger.log("[FIX-C-05] Error deleting orphan lock " + key + ": " + e.toString());
        }
      }

      Logger.log("[FIX-C-05] Removed " + removed + " orphan locks out of " + orphans.length + " detected");
      return { removed, orphans };
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
    AuthService.checkPermission("configurar_sistema");

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
    // === INICIO FIX M-04 ===
    if (this._lockDepth > 0) {
      Logger.log("[FIX-M-04] Reentrant acquireGlobalLock detected (depth=%s), returning dummy lock", this._lockDepth);
      return {
        releaseLock: () => {
          Logger.log("[FIX-M-04] Dummy lock released (no-op), depth remains %s", this._lockDepth);
        }
      };
    }
    // === FIN FIX M-04 ===

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
  try {
    LOCK_MANAGER.cleanupExpiredLocks();
  } catch (e) {
    Logger.log("FATAL cleanupExpiredLocks trigger: " + e.toString());
  }
}

// === INICIO FIX C-05 ===
/**
 * Global wrapper for time-driven trigger to remove orphan locks daily.
 */
function removeOrphanLocksTrigger() {
  try {
    const result = LOCK_MANAGER.removeOrphanLocks();
    Logger.log("[FIX-C-05] removeOrphanLocksTrigger completed: " + JSON.stringify(result));
  } catch (e) {
    Logger.log("FATAL removeOrphanLocksTrigger trigger: " + e.toString());
  }
}

/**
 * Creates a time-driven trigger to run removeOrphanLocks daily at 3:00 AM.
 * Requires "configurar_sistema" permission.
 * @returns {{success: boolean, message: string}}
 */
function crearTriggerOrphanCleanup() {
  AuthService.checkPermission("configurar_sistema");

  const gotLock = LOCK_MANAGER._safeTryLock(10000);
  if (!gotLock) {
    return { success: false, message: "No se pudo adquirir lock para configurar trigger." };
  }
  try {
    const triggers = ScriptApp.getProjectTriggers().filter(
      t => t.getHandlerFunction() === "removeOrphanLocksTrigger"
    );
    if (triggers.length === 1) {
      const msg = "Trigger removeOrphanLocksTrigger ya existe.";
      Logger.log(msg);
      return { success: true, message: msg };
    }
    triggers.forEach(t => ScriptApp.deleteTrigger(t));

    ScriptApp.newTrigger("removeOrphanLocksTrigger")
      .timeBased()
      .everyDays(1)
      .atHour(3)
      .create();

    const msg = "Trigger de limpieza de locks huérfanos creado (diario, 3:00 AM).";
    Logger.log(msg);
    return { success: true, message: msg };
  } finally {
    LOCK_MANAGER._safeReleaseLock();
  }
}
// === FIN FIX C-05 ===

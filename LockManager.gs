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
  SUSPICIOUS_KEY: "LOCK_SUSPICIOUS",
  GLOBAL_TIMEOUT: 60000,
  MAX_RETRIES: 4,
  BASE_BACKOFF: 500,
  RESOURCE_LOCK_WAIT: 1500,
  RESOURCE_LOCK_TIMEOUT: 60000,
  RESOURCE_TTL_MS: 45000,
  RESOURCE_LOCK_MAX_TTL_MS: 120000,
  LOCK_PREFIX: "LOCK_",
  LOG_PREFIX: "LOCK_LOG_",
  _lockDepth: 0,
  _maxDepthReentrant: 10,
  _metrics: { acquired: 0, failed: 0, timeouts: 0, orphansDetected: 0, orphansRemoved: 0, cleanups: 0 },
  _suspiciousLocks: null,

  _loadSuspiciousLocks() {
    if (this._suspiciousLocks !== null) return this._suspiciousLocks;
    try {
      var raw = PropertiesService.getScriptProperties().getProperty(this.SUSPICIOUS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this._suspiciousLocks = parsed;
          return this._suspiciousLocks;
        }
      }
    } catch (e) {
      Logger.log("[LOCK_SUSPICIOUS] Error cargando locks sospechosos: " + e.message);
    }
    this._suspiciousLocks = [];
    return this._suspiciousLocks;
  },

  _saveSuspiciousLocks() {
    try {
      if (this._suspiciousLocks && this._suspiciousLocks.length > 0) {
        PropertiesService.getScriptProperties().setProperty(this.SUSPICIOUS_KEY, JSON.stringify(this._suspiciousLocks));
      } else {
        PropertiesService.getScriptProperties().deleteProperty(this.SUSPICIOUS_KEY);
      }
    } catch (e) {
      Logger.log("[LOCK_SUSPICIOUS] Error guardando locks sospechosos: " + e.message);
    }
  },

  _getPropagationDelay() {
    if (LOCK_CONFIG && LOCK_CONFIG.PROPAGATION_DELAY_MS) return LOCK_CONFIG.PROPAGATION_DELAY_MS;
    var override = this._getConfigTimeout('PROPAGATION_DELAY_MS', 0);
    if (override > 0) return override;
    return 50;
  },

  _getConfigTimeout(key, fallback) {
    try {
      var val = PropertiesService.getScriptProperties().getProperty("LOCK_OVERRIDE_" + key);
      if (val) {
        var n = parseInt(val, 10);
        if (!isNaN(n) && n > 0 && n < 600000) return n; // max 10 min
      }
    } catch (e) {
      Logger.log("[LOCK_OVERRIDE] Error leyendo LOCK_OVERRIDE_" + key + ": " + e.message);
    }
    return fallback;
  },

  _generateToken() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
  },

  _logLockEvent(action, resourceId, token, detail) {
    const entry = { action: action, resourceId: resourceId, token: token || '', timestamp: Date.now(), detail: detail || '' };
    var logKey = this.LOG_PREFIX + resourceId + '_' + Date.now().toString(36);
    try {
      PropertiesService.getScriptProperties().setProperty(logKey, JSON.stringify(entry));
      // Limitar a 500 entradas de log
      var props = PropertiesService.getScriptProperties();
      var allLogKeys = props.getKeys().filter(function(k) { return k.indexOf('LOCK_LOG_') === 0; });
      if (allLogKeys.length > 500) {
        allLogKeys.sort();
        var toDelete = allLogKeys.length - 500;
        for (var i = 0; i < toDelete; i++) {
          props.deleteProperty(allLogKeys[i]);
        }
      }
    } catch (e) {
      Logger.log("[LOCK_METRICS] No se pudo registrar evento de lock: " + e.message);
    }
  },

  _safeTryLock(timeoutMs) {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(timeoutMs)) {
      if (this._lockDepth <= 0) this._lockDepth = 1;
      else this._lockDepth++;
      return true;
    }
    return false;
  },

  _safeReleaseLock() {
    if (this._lockDepth > 0) {
      this._lockDepth = 0;
      try {
        LockService.getScriptLock().releaseLock();
      } catch (e) {
        Logger.log("[LOCK_RELEASE_ERROR] Error liberando lock global (depth=" + this._lockDepth + "): " + e.message);
      }
    }
  },

  /**
   * Adquiere lock de recurso via PropertiesService con token único (CAS).
   * Cada lock incluye { expiresAt, token } donde token es único por adquisición.
   * Al liberar se verifica que el token coincida exactamente (AUL-1.2).
   * @param {string} resourceId - ID del recurso.
   * @returns {{releaseLock: Function}} Handle con releaseLock.
   * @throws {Error} Si no se puede adquirir tras reintentos o timeout.
   */
  acquireResourceLock(resourceId) {
    const properties = PropertiesService.getScriptProperties();
    const lockKey = this.LOCK_PREFIX + resourceId;
    const MAX_RETRIES = this._getConfigTimeout('MAX_RETRIES', 10);
    let attempt = 0;
    const startTime = Date.now();
    const timeoutMs = this._getConfigTimeout('RESOURCE_LOCK_TIMEOUT', this.RESOURCE_LOCK_TIMEOUT);
    var lockData = null;

    while (attempt < MAX_RETRIES) {
      if (Date.now() - startTime >= timeoutMs) {
        this._metrics.timeouts++;
        throw new Error("Timeout (" + timeoutMs + "ms) al adquirir bloqueo para " + resourceId + ".");
      }

      if (this._safeTryLock(this.RESOURCE_LOCK_WAIT)) {
        try {
          Utilities.sleep(this._getPropagationDelay());
          const now = Date.now();
          const raw = properties.getProperty(lockKey);
          let isLocked = false;

          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.expiresAt && parsed.expiresAt > now) {
                if (typeof parsed.expiresAt === "number" && parsed.expiresAt > now + this.RESOURCE_LOCK_MAX_TTL_MS) {
                  Logger.log("[LOCK_CORRUPT] Lock " + lockKey + " TTL absurdo expiresAt=" + parsed.expiresAt + ", tratando como expirado.");
                  properties.deleteProperty(lockKey);
                } else {
                  isLocked = true;
                }
              } else {
                properties.deleteProperty(lockKey);
              }
            } catch (e) {
              Logger.log("[LOCK_PARSE_ERROR] JSON inválido en " + lockKey + ": " + e.message + " raw='" + (raw || '').substring(0, 100) + "'");
              properties.deleteProperty(lockKey);
            }
          }

          if (!isLocked) {
            lockData = { expiresAt: now + this.RESOURCE_TTL_MS, token: this._generateToken() };
            properties.setProperty(lockKey, JSON.stringify(lockData));
            // Registrar como sospechoso ANTES de operaciones post-escritura
            this._loadSuspiciousLocks();
            var suspiciousEntry = { resourceId: resourceId, lockKey: lockKey, token: lockData.token, writtenAt: Date.now(), pending: true };
            this._suspiciousLocks.push(suspiciousEntry);
            this._saveSuspiciousLocks();
            var capturedLockData;
            try {
              this._metrics.acquired++;
              this._logLockEvent('acquire', resourceId, lockData.token, 'OK');
              capturedLockData = lockData;
            } catch (e) {
              // Emergency circuit (AUL-1.3): limpiar lock huérfano parcial
              Logger.log("[LOCK_EMERGENCY] Error post-escritura en " + lockKey + ", limpiando: " + e.message);
              properties.deleteProperty(lockKey);
              this._suspiciousLocks = this._suspiciousLocks.filter(function(s) { return s.lockKey !== lockKey; });
              this._saveSuspiciousLocks();
              throw e;
            }
            var relKey = lockKey;
            return {
              releaseLock: function() {
                LOCK_MANAGER._releaseResourceLock(relKey, capturedLockData);
                LOCK_MANAGER._loadSuspiciousLocks();
                LOCK_MANAGER._suspiciousLocks = LOCK_MANAGER._suspiciousLocks.filter(function(s) { return s.lockKey !== relKey; });
                LOCK_MANAGER._saveSuspiciousLocks();
              },
            };
          }
        } finally {
          this._safeReleaseLock();
        }
      }

      attempt++;
      if (attempt < MAX_RETRIES) {
        Utilities.sleep(this._backoffMs(attempt));
      }
    }

    this._metrics.failed++;
    this._logLockEvent('fail', resourceId, '', 'max_retries');
    throw new Error("No se pudo adquirir el bloqueo para el recurso " + resourceId + " después de " + MAX_RETRIES + " intentos.");
  },

  /**
   * Libera lock de recurso con CAS (Compare-And-Swap) vía token único.
   * Verifica que el token actual coincida con el de adquisición para
   * evitar liberar el lock de otra ejecución (AUL-1.2).
   * @param {string} lockKey - Clave del lock (LOCK_ + resourceId)
   * @param {Object} expectedData - Datos esperados { expiresAt, token }
   */
  _releaseResourceLock(lockKey, expectedData) {
    const gotLock = this._safeTryLock(5000);
    if (!gotLock) {
      Logger.log("[LOCK_RELEASE_WARN] No se pudo adquirir lock global para liberar " + lockKey);
      return;
    }
    try {
      Utilities.sleep(this._getPropagationDelay());
      const props = PropertiesService.getScriptProperties();
      const currentRaw = props.getProperty(lockKey);
      if (currentRaw) {
        try {
          const current = JSON.parse(currentRaw);
          if (expectedData) {
            if (current.token !== expectedData.token) {
              Logger.log("[LOCK_CAS_MISMATCH] Lock " + lockKey + " adquirido por otra ejecución. Token esperado=" + expectedData.token + " actual=" + current.token);
              return;
            }
            if (current.expiresAt !== expectedData.expiresAt) {
              Logger.log("[LOCK_CAS_EXPIRY] Lock " + lockKey + " expiresAt cambiado. Esperado=" + expectedData.expiresAt + " actual=" + current.expiresAt);
              return;
            }
          }
        } catch (e) {
          Logger.log("[LOCK_PARSE_ERROR] JSON inválido al liberar " + lockKey + ": " + e.message);
        }
      }
      props.deleteProperty(lockKey);
      this._logLockEvent('release', lockKey.replace(this.LOCK_PREFIX, ''), expectedData ? expectedData.token : '', 'OK');
    } finally {
      this._safeReleaseLock();
    }
  },

  /**
   * Limpia locks expirados de ScriptProperties.
   * Barre todas las propiedades LOCK_* y elimina aquellas con
   * expiresAt < Date.now(). También limpia orphans.
   * @returns {{cleaned: number, scanned: number}}
   */
  cleanupExpiredLocks() {
    let cleaned = 0;
    let scanned = 0;

    if (this._safeTryLock(this.GLOBAL_TIMEOUT)) {
      try {
        Utilities.sleep(this._getPropagationDelay());
        const props = PropertiesService.getScriptProperties();
        const keys = props.getKeys().filter(k => k.startsWith(this.LOCK_PREFIX));
        scanned = keys.length;

        // Prioridad 1: procesar locks sospechosos (AUL-1.3)
        this._loadSuspiciousLocks();
        var now = Date.now();
        var suspiciousToRemove = [];
        for (var si = 0; si < this._suspiciousLocks.length; si++) {
          var sEntry = this._suspiciousLocks[si];
          if (sEntry.pending && (now - sEntry.writtenAt > 60000)) {
            suspiciousToRemove.push(sEntry.lockKey);
            props.deleteProperty(sEntry.lockKey);
            cleaned++;
            Logger.log("[LOCK_EMERGENCY] Lock sospechoso confirmado huérfano: " + sEntry.lockKey + " (escrito=" + sEntry.writtenAt + ")");
          }
        }
        this._suspiciousLocks = this._suspiciousLocks.filter(function(s) {
          return suspiciousToRemove.indexOf(s.lockKey) < 0;
        });
        this._saveSuspiciousLocks();

        // Prioridad 2: limpieza normal por TTL
        for (const key of keys) {
          if (suspiciousToRemove.indexOf(key) >= 0) continue; // ya limpiado
          const raw = props.getProperty(key);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
                props.deleteProperty(key);
                cleaned++;
              }
            } catch (e) {
              Logger.log("[LOCK_CLEANUP] JSON inválido en " + key + ", eliminando: " + e.message);
              props.deleteProperty(key);
              cleaned++;
            }
          }
        }

        try {
          const orphanResult = this.removeOrphanLocks();
          cleaned += orphanResult.removed;
          this._metrics.orphansDetected += orphanResult.orphans ? orphanResult.orphans.length : 0;
          this._metrics.orphansRemoved += orphanResult.removed;
          this._metrics.cleanups++;
        } catch (e) {
          Logger.log("[LOCK_CLEANUP] Error en cleanup de orphans: " + e.toString());
        }
      } finally {
        this._safeReleaseLock();
      }
    }

    return { cleaned, scanned };
  },

  _indexCache: { data: null, expiresAt: 0 },

  _invalidateIndexCache() {
    this._indexCache.data = null;
    this._indexCache.expiresAt = 0;
  },

  /**
   * Construye índice de todos los IDs de recursos en el sistema.
   * Cachea el resultado por 5 minutos (AUL-2.1).
   */
  _buildResourceIndex() {
    const ahora = Date.now();
    if (this._indexCache.data && this._indexCache.expiresAt > ahora) {
      return this._indexCache.data;
    }
    const index = new Set();
    try {
      if (typeof CARTERA_CONFIG === 'undefined' || typeof CONFIG === 'undefined' || typeof COMPRAS_CONFIG === 'undefined') {
        Logger.log("[LCK-005] Dependencias no cargadas, índice vacío");
        return index;
      }
      const ss = getActiveSpreadsheet();
      if (!ss) { Logger.log("[LCK-005] Sin spreadsheet activo"); return index; }
      const COL_TER = CARTERA_CONFIG.COLUMNS.TERCEROS;
      const COL_PROD = CONFIG.COLUMNS.PRODUCTOS;
      const COL_COM = COMPRAS_CONFIG.COLUMNS.COMPRAS;

      function _collectIds(sheet, colIndex) {
        if (!sheet) return;
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          const ids = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
          for (var idx = 0; idx < ids.length; idx++) {
            var id = String(ids[idx][0] || "").trim();
            if (id) index.add(id);
          }
        }
      }

      _collectIds(ss.getSheetByName(CARTERA_CONFIG.SHEETS.TERCEROS), COL_TER.id);
      _collectIds(ss.getSheetByName(CARTERA_CONFIG.SHEETS.CARTERA), COL_TER.id_tercero);
      _collectIds(ss.getSheetByName(CONFIG.SHEETS.PRODUCTOS), COL_PROD.id);
      _collectIds(ss.getSheetByName(COMPRAS_CONFIG.SHEETS.COMPRAS), COL_COM.id);
    } catch (e) {
      Logger.log("[LCK-005] Error construyendo índice: " + e.message);
      if (e.message && (e.message.indexOf("getRange") >= 0 || e.message.indexOf("getSheetByName") >= 0)) {
        throw e;
      }
    }
    this._indexCache.data = index;
    this._indexCache.expiresAt = Date.now() + 300000; // 5 min
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
        Logger.log("[LOCK_ORPHAN] Orphan detectado: Resource " + resourceId + " (key: " + key + ")");
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
      Utilities.sleep(this._getPropagationDelay());
      const orphans = this._detectOrphanLocks();
      if (orphans.length === 0) {
        Logger.log("[LOCK_ORPHAN] No se encontraron orphans");
        return { removed: 0, orphans: [] };
      }

      let removed = 0;
      const props = PropertiesService.getScriptProperties();
      for (const key of orphans) {
        try {
          props.deleteProperty(key);
          Logger.log("[LOCK_ORPHAN] Eliminado orphan: " + key);
          removed++;
        } catch (e) {
          Logger.log("[LOCK_ORPHAN] Error eliminando orphan " + key + ": " + e.toString());
        }
      }

      this._metrics.orphansDetected += orphans.length;
      this._metrics.orphansRemoved += removed;
      Logger.log("[LOCK_ORPHAN] Removidos " + removed + "/" + orphans.length + " orphans");
      return { removed, orphans };
    } finally {
      this._safeReleaseLock();
    }
  },

  /**
   * Crea trigger time-based para cleanupExpiredLocks cada hora.
   * Desacoplado de AuthService (AUL-2.3): el permiso se verifica opcionalmente.
   * @returns {{success: boolean, message: string}}
   */
  crearTriggerLockCleanup() {
    if (typeof AuthService !== 'undefined' && AuthService && AuthService.checkPermission) {
      try { AuthService.checkPermission("configurar_sistema"); } catch (e) {
        Logger.log("[LOCK_TRIGGER] Sin permiso configurar_sistema: " + e.message);
        return { success: false, message: "Permiso denegado: " + e.message };
      }
    }

    const gotLock = this._safeTryLock(10000);
    if (!gotLock) {
      return { success: false, message: "No se pudo adquirir lock para configurar trigger." };
    }
    try {
      const triggers = ScriptApp.getProjectTriggers().filter(
        t => t.getHandlerFunction() === "cleanupExpiredLocks"
      );
      if (triggers.length > 1) {
        Logger.log("[LOCK_TRIGGER] Encontrados " + triggers.length + " triggers duplicados, limpiando");
      }
      if (triggers.length === 1) {
        Logger.log("[LOCK_TRIGGER] Trigger cleanupExpiredLocks ya existe.");
        return { success: true, message: "Trigger cleanupExpiredLocks ya existe." };
      }
      triggers.forEach(t => ScriptApp.deleteTrigger(t));

      ScriptApp.newTrigger("cleanupExpiredLocks")
        .timeBased()
        .everyHours(1)
        .create();

      Logger.log("[LOCK_TRIGGER] Trigger cleanupExpiredLocks creado (cada 1 hora)");
      return { success: true, message: "Trigger de limpieza de locks creado exitosamente (cada 1 hora)." };
    } finally {
      this._safeReleaseLock();
    }
  },

  /**
   * Acquires a global script lock with retry and exponential backoff.
   * Supports reentrant calls - if lock already acquired by same execution,
   * returns a dummy lock that won't actually release the underlying lock.
   * @param {number} [timeout=this.GLOBAL_TIMEOUT] - Timeout in ms for lock attempt.
   * @returns {{releaseLock: Function}} Lock handle with releaseLock method.
   * @throws {Error} If lock cannot be acquired after MAX_RETRIES.
   */
  acquireGlobalLock(timeout) {
    if (timeout === undefined || timeout === null) timeout = this.GLOBAL_TIMEOUT;
    if (this._lockDepth > 0) {
      Logger.log("[LOCK_REENTRANT] acquireGlobalLock reentrante (depth=" + this._lockDepth + "), retornando dummy lock");
      return {
        releaseLock: function() {
          if (LOCK_MANAGER._lockDepth > 0) {
            LOCK_MANAGER._lockDepth--;
            Logger.log("[LOCK_REENTRANT] Dummy lock release, depth ahora=" + LOCK_MANAGER._lockDepth);
          }
        }
      };
    }

    let attempt = 0;

    while (attempt < this.MAX_RETRIES) {
      if (this._safeTryLock(timeout)) {
        return {
          releaseLock: function() { LOCK_MANAGER._safeReleaseLock(); }
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
    return baseWait / 2 + Math.random() * baseWait;
  },

  /**
   * Retorna métricas operativas del gestor de locks (AUL-2.4).
   * @returns {{acquired: number, failed: number, timeouts: number, orphansDetected: number, orphansRemoved: number, cleanups: number}}
   */
  getLockMetrics() {
    var m = this._metrics;
    this._loadSuspiciousLocks();
    return {
      acquired: m.acquired,
      failed: m.failed,
      timeouts: m.timeouts,
      orphansDetected: m.orphansDetected,
      orphansRemoved: m.orphansRemoved,
      cleanups: m.cleanups,
      lockDepth: this._lockDepth,
      indexCached: !!this._indexCache.data,
      suspiciousLocks: this._suspiciousLocks ? this._suspiciousLocks.length : 0
    };
  },

  /**
   * Retorna entradas del log de locks.
   * @param {number} [limit=20] - Máximo de entradas a retornar.
   * @returns {Array<{action: string, resourceId: string, token: string, timestamp: number, detail: string}>}
   */
  getLockLog(limit) {
    if (limit === undefined || limit === null) limit = 20;
    try {
      var props = PropertiesService.getScriptProperties();
      var keys = props.getKeys().filter(function(k) { return k.indexOf('LOCK_LOG_') === 0; });
      keys.sort();
      if (keys.length > limit) keys = keys.slice(keys.length - limit);
      var entries = [];
      for (var i = 0; i < keys.length; i++) {
        try {
          var raw = props.getProperty(keys[i]);
          if (raw) entries.push(JSON.parse(raw));
        } catch (e) {
          Logger.log("[LOCK_LOG_CORRUPT] Entrada de log inválida key=" + keys[i] + ": " + e.message);
        }
      }
      return entries;
    } catch (e) {
      Logger.log("[LOCK_METRICS] Error obteniendo log: " + e.message);
      return [];
    }
  },

  /**
   * Limpia el log y sospechosos.
   */
  _resetMetrics() {
    this._metrics = { acquired: 0, failed: 0, timeouts: 0, orphansDetected: 0, orphansRemoved: 0, cleanups: 0 };
    this._suspiciousLocks = [];
    try {
      var props = PropertiesService.getScriptProperties();
      props.deleteProperty(this.SUSPICIOUS_KEY);
      var keys = props.getKeys().filter(function(k) { return k.indexOf('LOCK_LOG_') === 0; });
      for (var i = 0; i < keys.length; i++) props.deleteProperty(keys[i]);
    } catch (e) {
      Logger.log("[LOCK_METRICS] Error limpiando log de locks: " + e.message);
    }
  },
};
/**
 * Global wrapper for time-driven trigger to clean up expired locks.
 * Delegates to LOCK_MANAGER.cleanupExpiredLocks().
 */
function cleanupExpiredLocks() {
  try {
    LOCK_MANAGER.cleanupExpiredLocks();
  } catch (e) {
    Logger.log("FATAL cleanupExpiredLocks trigger: " + e.toString());
  }
}

/**
 * Wrapper global para trigger time-based de limpieza de orphans.
 */
function removeOrphanLocksTrigger() {
  try {
    const result = LOCK_MANAGER.removeOrphanLocks();
    Logger.log("[LOCK_TRIGGER] removeOrphanLocksTrigger completado: " + JSON.stringify(result));
  } catch (e) {
    Logger.log("[LOCK_TRIGGER] FATAL removeOrphanLocksTrigger: " + e.toString());
  }
}

/**
 * Creates a time-driven trigger to run removeOrphanLocks daily at 3:00 AM.
 * Requires "configurar_sistema" permission.
 * @returns {{success: boolean, message: string}}
 */
function crearTriggerOrphanCleanup() {
  if (typeof AuthService !== 'undefined' && AuthService && AuthService.checkPermission) {
    try { AuthService.checkPermission("configurar_sistema"); } catch (e) {
      Logger.log("[LOCK_TRIGGER] Sin permiso configurar_sistema: " + e.message);
      return { success: false, message: "Permiso denegado: " + e.message };
    }
  }

  const gotLock = LOCK_MANAGER._safeTryLock(10000);
  if (!gotLock) {
    return { success: false, message: "No se pudo adquirir lock para configurar trigger." };
  }
  try {
    const triggers = ScriptApp.getProjectTriggers().filter(
      t => t.getHandlerFunction() === "removeOrphanLocksTrigger"
    );
    if (triggers.length > 1) {
      Logger.log("[LOCK_TRIGGER] Encontrados " + triggers.length + " triggers duplicados, limpiando");
    }
    if (triggers.length === 1) {
      Logger.log("[LOCK_TRIGGER] Trigger removeOrphanLocksTrigger ya existe.");
      return { success: true, message: "Trigger removeOrphanLocksTrigger ya existe." };
    }
    triggers.forEach(t => ScriptApp.deleteTrigger(t));

    ScriptApp.newTrigger("removeOrphanLocksTrigger")
      .timeBased()
      .everyDays(1)
      .atHour(3)
      .create();

    Logger.log("[LOCK_TRIGGER] Trigger removeOrphanLocksTrigger creado (diario, 3:00 AM)");
    return { success: true, message: "Trigger de limpieza de locks huérfanos creado (diario, 3:00 AM)." };
  } finally {
    LOCK_MANAGER._safeReleaseLock();
  }
}

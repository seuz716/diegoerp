/**
 * IdempotencyService - Persistente idempotency usando CacheService
 * 
 * Almacena correlationId procesados en caché con TTL para evitar
 * duplicación de operaciones entre reinicios del script.
 */
const IDEMPOTENCY_PREFIX = "IDEM_";
const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

const IdempotencyService = {
  /**
   * Checks if a correlationId has been processed for a given entity.
   * @param {string} correlationId - Unique operation identifier
   * @param {string} entityId - Entity identifier (e.g., client ID)
   * @returns {boolean} true if already processed
   */
  isProcessed(correlationId, entityId) {
    if (!correlationId) return false;
    const key = IDEMPOTENCY_PREFIX + correlationId + "::" + entityId;
    const cache = CacheService.getScriptCache();
    return cache.get(key) === "1";
  },

  /**
   * Marks a correlationId as processed.
   * @param {string} correlationId - Unique operation identifier
   * @param {string} entityId - Entity identifier
   */
  markProcessed(correlationId, entityId) {
    if (!correlationId) return;
    const key = IDEMPOTENCY_PREFIX + correlationId + "::" + entityId;
    const cache = CacheService.getScriptCache();
    cache.put(key, "1", IDEMPOTENCY_TTL_SECONDS);
  },

  /**
   * Clears a processed marker (for testing or manual override).
   * @param {string} correlationId - Unique operation identifier
   * @param {string} entityId - Entity identifier
   */
  clearProcessed(correlationId, entityId) {
    if (!correlationId) return;
    const key = IDEMPOTENCY_PREFIX + correlationId + "::" + entityId;
    const cache = CacheService.getScriptCache();
    cache.remove(key);
  }
};

/**
 * Backwards-compatible wrapper replacing _isIdempotent global variable
 * @param {string} correlationId - Unique operation identifier
 * @param {string} idTercero - Third party ID
 * @returns {boolean} true if already processed
 */
function _isIdempotent(correlationId, idTercero) {
  return IdempotencyService.isProcessed(correlationId, idTercero);
}
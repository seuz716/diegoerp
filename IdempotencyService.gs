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
    // Capa 1 (rápida, volátil): CacheService
    const cache = CacheService.getScriptCache();
    if (cache.get(key) === "1") return true;
    // Capa 2 (durable): PropertiesService sobrevive a clears de caché
    const props = PropertiesService.getScriptProperties();
    const ts = props.getProperty(key);
    if (ts) {
      // Auto-limpieza: respeta la ventana de 24h también en el store durable
      const ageMs = Date.now() - Number(ts);
      if (ageMs <= IDEMPOTENCY_TTL_SECONDS * 1000) {
        try { cache.put(key, "1", IDEMPOTENCY_TTL_SECONDS); } catch (e) { /* best-effort */ }
        return true;
      }
      props.deleteProperty(key); // expirado -> descartar
    }
    return false;
  },

  /**
   * Marks a correlationId as processed (dos capas: caché + PropertiesService).
   * @param {string} correlationId - Unique operation identifier
   * @param {string} entityId - Entity identifier
   */
  markProcessed(correlationId, entityId) {
    if (!correlationId) return;
    const key = IDEMPOTENCY_PREFIX + correlationId + "::" + entityId;
    // Capa 1: caché volátil (rápido para lecturas repetidas)
    CacheService.getScriptCache().put(key, "1", IDEMPOTENCY_TTL_SECONDS);
    // Capa 2: backup durable (sobrevive a clears de caché)
    try {
      PropertiesService.getScriptProperties().setProperty(key, String(Date.now()));
    } catch (e) { /* cuota/limite - la caché aún cubre el caso común */ }
  },

  /**
   * Clears a processed marker (for testing or manual override).
   * @param {string} correlationId - Unique operation identifier
   * @param {string} entityId - Entity identifier
   */
  clearProcessed(correlationId, entityId) {
    if (!correlationId) return;
    const key = IDEMPOTENCY_PREFIX + correlationId + "::" + entityId;
    CacheService.getScriptCache().remove(key);
    PropertiesService.getScriptProperties().deleteProperty(key);
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
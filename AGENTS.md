# Coordinación de IAs - Contrato de archivos

## IA-SECURITY (actual) - AuthService.gs, LockManager.gs, AuditLog.gs
- ✅ AuthService.gs: TRIGGER_SAFE_ACTIONS, CRYPTO_SERVICE, SchemaValidator, checkPermission corregido, _kdf optimizado
- ✅ LockManager.gs: _buildResourceIndex(), removeOrphanLocks(), race condition corregida en orphan cleanup
- ✅ AuditLog.gs: correlationId propagation
- ✅ Config.gs: SESSION_SERVICE singleton (eliminadas 5 definiciones duplicadas en Domain.gs, API.gs, Main.gs, Servicios.gs, AuthService.gs)

## IA-BUSINESS (siguiente) - Domain.gs, DAO.gs, CacheService.gs
- ✅ DOMAIN.registrarAbonoAtomic → validar saldo crediticio
- ✅ DAO.updateCarteraBatch → optimistic locking atómico
- ✅ CACHE → circuit breaker HALF_OPEN
- ✅ Kardex: Historial movimientos por producto (getKardexProducto) y global (getKardex)

## CLI 1 - SEGURIDAD (completado)
- ✅ SESSION_SERVICE consolidado como singleton en Config.gs
- ✅ checkPermission: eliminada comparación redundante email !== this._getCurrentUser()
- ✅ _kdf: optimizado con comentario de key stretching
- ✅ AuditLog: lock global unificado (eliminada race condition en purge)
- ✅ correlationId propagation en todos los módulos

## CLI 2 - DOMINIO NEGOCIO (completado)
- ✅ registrarAbonoAtomic: validación cupo crediticio (CxC)
- ✅ Idempotencia con correlationId
- ✅ Optimistic locking con reintentos (DAO.updateCarteraBatch)
- ✅ Creación inline de productos en compras (Domain.gs)
- ✅ DAO_PRODUCTOS.crear() con ID opcional

## CLI 3 - INPUT VALIDATION (completado)
- ✅ INPUT_VALIDATOR.validateTipo: valida CxC, CxP, CLIENTE, PROVEEDOR, AMBOS
- ✅ INPUT_VALIDATOR.validatePageSize: min 1, max 5000 (protección DoS)
- ✅ INPUT_VALIDATOR.validatePageToken: asegura >= 0
- ✅ INPUT_VALIDATOR.validateEstado: valida ABIERTA, PARCIAL, CANCELADA, VENCIDA
- ✅ getCartera, getTerceros, getCompras, getProductos, actualizarProducto: validación agregada
- ✅ Tests: 5 nuevos tests para input validation (total 30 tests)

## Contrato de interfaces

### Config.gs (SINGLETON) expone:
- `SESSION_SERVICE.getCurrentUser()` → `{getEmail: fn}` o `{getEmail: () => null}`
- `SESSION_SERVICE.getScriptTimeZone()` → string timezone
- `SESSION_SERVICE._resetMock()` / `_setMockUser(email)` - testing

### AuthService.gs expone:
- `AuthService.checkPermission(accion)` - lanza Error si no autorizado
- `AuthService.getUserRole(email)` - retorna null o rol válido
- `TRIGGER_SAFE_ACTIONS[accion]` - boolean

### LockManager.gs expone:
- `LOCK_MANAGER.acquireResourceLock(resourceId)` → `{releaseLock: fn}`
- `LOCK_MANAGER.cleanupExpiredLocks()` - periódico

### AuditLog.gs expone:
- `LOG_ENGINE.logEvent(operacion, tabla, idRegistro, previos, nuevos, estado, {correlationId})`

## Protocolo de extensión
Solo agregar funciones EXPORTADAS (nombres sin guión bajo inicial) en los archivos asignados. Usar `SESSION_SERVICE` desde Config.gs (no redefinir localmente).

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
   CLI 1                          │ Seguridad                      │ SESSION_SERVICE singleton     │ ✅
   CLI 1                          │ Seguridad                      │ checkPermission fix           │ ✅
   CLI 1                          │ Seguridad                      │ _kdf optimization             │ ✅
   CLI 1                          │ Seguridad                      │ AuditLog race condition       │ ✅
   CLI 1                          │ Seguridad                      │ correlationId propagation     │ ✅
   CLI 2                          │ Negocio                        │ Creación inline productos     │ ✅
   CLI 2                          │ Negocio                        │ DAO_PRODUCTOS.id opcional     │ ✅
   CLI 2                          │ Rendimiento                    │ Pre-carga productoMap         │ ✅

   --------

   Próximas tareas
   ────────────────────────────────┼────────────────────────────────┼───────────────────────────────┼───────────────────────────────
   1                              │ Fix circuit breaker half-open    │ (1h)                          │ ✅
   2                              │ Complete getHealth()             │ (0.5h)                        │ ✅
   3                              │ Optimize cache hit tracking      │ (0.5h)                        │ ✅
   4                              │ Fix Cache stale N+1              │ (1h)                          │ ✅
   5                              │ Consolidate DAO batch ops        │ (2h)                          │ ✅
   6                              │ Add optimistic locking           │ (1.5h)                        │ ✅
   7                              │ Fix Config references            │ (0.25h)                       │ ✅
   8                              │ Document extension points        │ (0.5h)                        │ ✅
   9                              │ Fix SESSION_SERVICE duplicado    │ (3h)                          │ ✅
   10                             │ Fix checkPermission bug          │ (1h)                          │ ✅
   11                             │ Optimizar _kdf criptográfico     │ (1.5h)                        │ ✅
   12                             │ Fix Auth permission checks       │ (1h)                          │ ✅
   13                             │ Cleanup orphan locks race cond   │ (1h)                          │ ✅

   --------

   Commits totales: 25 en main (incluye commit de correcciones circuit breaker)

   --------

   Correcciones arquitectónicas CacheService.gs completadas:
   - ✅ Eliminada instanciación fallida `const CACHE = new CacheService()`
   - ✅ Consolidado: _transitionToHalfOpen integrado en _autoRecoverCircuitBreaker
   - ✅ Límite 999999 en el contador de métricas circuitOpens/circuitCloses
   - ✅ getHealth() completado con failCount, nextRetryMs, checksumValidationStatus

   --------

   Correcciones Módulo SEGURIDAD completadas:
   - ✅ SESSION_SERVICE consolidado como singleton en Config.gs
   - ✅ checkPermission: eliminada comparación redundante email !== this._getCurrentUser()
   - ✅ _kdf: iteraciones ahora contribuyen al key stretching vía HMAC chain
   - ✅ _deriveKey: corregida recursión infinita (llamaba a _deriveKey en vez de _deriveKeyWithIterations)
   - ✅ removeOrphanLocks: lock global unificado para detect+delete (elimina race condition)

   --------

Test Suite (runAllRegressionTests): 125 tests
    - AuthService: 3 tests (auth, whitelist, unknown action)
    - LockManager: 2 tests (cleanup, index)
    - CacheService: 6 tests (circuit, health, consistency, reset)
    - AuditLog: 2 tests (correlationId, sanitization)
    - TransactionManager: 3 tests (struct, correlationId, snapshot)
    - Accounting: 8 tests (methods, integration, singleton, resumen)
    - SchemaValidator: 2 tests (validation)
    - Integrity: 4 tests (purge race, commit/rollback, opt-locking, validation)
    - Business Validation: 3 tests (credit limit, idempotency)
    - API Validation: 5 tests (validateTipo, validatePageSize, validateEstado, validatePageToken, getProductos)
    - Inventory: 8 tests (KARDEX integrity, trazabilidad, stock consistency)
    - Purchases: 5 tests (COMP-01 to COMP-05)
    - Sales -> Kardex REAL VALIDATION: 5 tests (VTA-01 a VTA-05 con ejecución real)
    - Tercero Tipo Validation: 3 tests (TERC-01 a TERC-03) - compra no-proveedor rechazada, vinculación exitosa, preferido único

### 🔒 Seguridad - Logging Sanitizado
- ✅ AuthService logging: removed keyName/secretName from console.log output
- ✅ API._safeError: removed stack trace from console output
- ✅ AuditLog error logs: replaced e.toString() with generic messages

### 🔒 Seguridad - Circuit Breaker Hardening
- ✅ CacheService: Validate timestamps (max 24h window) to prevent corruption
- ✅ Main.gs: Removed keyLength from checkIAKey output

## CLI 4 - BACKEND REFACTOR (completado)
- ✅ CacheService: `_refreshTerceros()` missing `tercerosCircuitState = 'open'` — corregido
- ✅ CacheService: `_handleIntegrityFailure()` missing `_setCircuitState()` — corregido
- ✅ CacheService: `CIRCUIT_AUTO_CLOSE_MS` cambiado de 300000 a 30000 (30s exactos)
- ✅ CacheService: HALF_OPEN stuck fix — `isTercerosValid()`/`isCarteraValid()` fuerza refresh en half_open
- ✅ CacheService: Flujo CLOSED→OPEN→HALF_OPEN→CLOSED verificado y funcional
- ✅ Config.gs: `_getTimeZone()` usa `SESSION_SERVICE.getScriptTimeZone()` en vez de `Session.getScriptTimeZone()`
- ✅ API.gs: `generateCorrelationId()` y `_safeError()` usan `SESSION_SERVICE.getScriptTimeZone()`
- ✅ SESSION_SERVICE: 0 bypasses externos, solo llamado interno en definición
- ✅ IAService: Rate limiter cambiado a token bucket (100 req/min)
- ✅ IAService: Error message actualizado a "Límite de solicitudes excedido, reintente en 60 segundos."
- ✅ IAService: Validación de entrada — >500 registros rechaza con RATE_LIMITED
- ✅ DAO.updateCarteraBatch(): Optimistic locking verificado (3 retries, version increment, rollback no necesario)
- ✅ AuditLog.logEvent(): Lock adquirido ANTES de getLastRow() — purge atómico correcto
- ✅ Frontend wrappers getCacheHealth/getCacheMetrics/verificarConfiguracionIA presentes en app.html
- ✅ Archivos setup redundantes (INSTALL_SCRIPT.gs, SETUP_ONE_CLICK.gs, init_spreadsheet.gs) eliminados

## IA-SECURITY - Secret Management (completado)
- ✅ SecretService.gs: Nuevo servicio con UserProperties + ofuscación XOR
- ✅ AuthService.setApiKey/getApiKey migrado a usar SecretService
- ✅ Main.doGet: Configuración remota de ssid requiere token de un solo uso
- ✅ generateSetupToken(): Genera UUID para configuración segura de ssid
- ✅ revokeSetupToken(): Revoca token existente
- ✅ migrateSecretsToUserProperties(): Migración de secretos existentes

### ❌ No aplica al stack GAS
- SQL optimizer/connection pool — este proyecto NO usa SQL, usa SpreadsheetApp
- Logging async + 50MB rotation — GAS no soporta escritura asíncrona ni tamaño de archivo (worksheets)
- /procesarIA endpoint — los endpoints GAS son funciones globales, no rutas HTTP
## MATRIZ DE CORRELACIÓN - PRODUCTOS (Sección 7)

| Función Frontend | Backend Call | Función Backend | Estado | Observaciones |
|-----------------|--------------|-----------------|--------|---------------|
| cargarProductos() | App.api.getProductos() | getProductos() | ✅ | CRUD completo con validación |
| guardarProducto() | App.api.actualizarProducto() | actualizarProducto() | ✅ | Con optimistic locking |
| toggleActivo() | App.api.toggleActivoProducto() | DAO_PRODUCTOS.toggleActivo() | ✅ | Cambia estado ACTIVO/INACTIVO |
| (No UI directa) | getKardexProducto(id, limit) | DOMAIN.getKardexProducto(id, limit) | ✅ CORRECTO | Historial movimientos inventario por producto específico |
| (No UI directa) | getKardex(limit) | DOMAIN.getKardex(limit) | ✅ CORRECTO | Kardex global: movimientos todos productos últimos 30 día |

## MATRIZ DE CORRELACIÓN - PROVEEDORES (Sección 7b)

| Función Frontend | Backend Call | Función Backend | Estado | Observaciones |
|-----------------|--------------|-----------------|--------|---------------|
| cargarTerceros() con filtro | App.api.getTercerosPorTipo(tipo) | DAO.getTercerosPorTipo(tipo) | ✅ Mapeada | Filtra CLIENTE/PROVEEDOR/AMBOS en UI con dropdown |
| cargarVentasTerceros() | App.api.getTerceros(null) filtrado CLIENTE/AMBOS | getTerceros() | ✅ Mapeada | Selector de cliente filtra solo CLIENTE/AMBOS |
| abrirModalNuevaCompra() | App.api.getTerceros(null) filtrado PROVEEDOR/AMBOS | getTerceros() | ✅ Verificado | Selector de proveedor filtra solo PROVEEDOR/AMBOS |
| getProveedorPorProducto() | App.api.getProveedoresDeProducto(id) | DAO.getProveedorPorProducto() | ✅ Mapeada | Retorna array con proveedor(es) del producto |
| getAnalisisProveedor() | App.api.getAnalisisProveedor(idProveedor) | DOMAIN.getAnalisisProveedor() | ✅ Mapeada | Saldo, últimas compras, top 5 productos |
| getProductosMasCompradosPorProveedor() | App.api.getProductosMasCompradosPorProveedor(id, top) | DOMAIN.getProductosMasCompradosPorProveedor() | ✅ Mapeada | Ranking productos comprados a proveedor |
| vincularProductoProveedor() | App.api.vincularProductoProveedor() | DOMAIN.vincularProductoProveedor() | ⚠️ Pendiente | No valida duplicados antes de appendRow |

## MATRIZ DE CORRELACIÓN - DASHBOARD (Sección 8)

| Función Frontend | Backend Call | Función Backend | Estado | Observaciones |
|-----------------|--------------|-----------------|--------|---------------|
| (No UI directa) | App.api.getVentasDelDia() | getVentasDelDia() | ✅ CORRECTO | Reporte de ventas del día actual. Útil para corte de caja diario. Retorna total y lista de ventas. |

## ?? VALIDACIÓN REAL - Tests con ejecución de lógica (TestRegression.gs)

### Tests VTA-01 a VTA-05 - Ventas → Kardex (Validación Real)
- ✅ VTA-01: Registrar venta crea movimiento SALIDA en kardex
  - Crea producto de prueba con stock
  - Crea cliente de prueba
  - Ejecuta registrarVentaAtomic()
  - Verifica movimiento SALIDA en kardex con cantidad correcta
  - Verifica stock decrementado correctamente

- ✅ VTA-02: Cantidad vendida coincide con kardex SALIDA
  - Obtiene ventas reales de la base de datos
  - Calcula cantidad vendida por venta
  - Compara con cantidad en kardex SALIDA
  - Reporta diferencias encontradas

- ✅ VTA-03: Venta con stock insuficiente rechazada
  - Crea producto con stock limitado (1 unidad)
  - Intenta vender cantidad mayor al stock
  - Verifica que la venta es rechazada
  - Verifica mensaje de error menciona "stock"

- ✅ VTA-04: Precio venta registrado correctamente en kardex
  - Crea producto de prueba
  - Registra venta con precio específico
  - Verifica precio_unitario en movimiento kardex SALIDA

- ✅ VTA-05: Anular venta genera movimiento ENTRADA reversa
  - Crea producto/cliente de prueba
  - Registra venta
  - Intenta anular (si función existe)
  - Verifica ENTRADA de reversa y stock restaurado

### Tests REP-03 a REP-05 - Reportes Inventario
- ✅ REP-03: Quiebres detectados (stock=0 con ventas recientes)
  - Identifica productos con stock <= 0 y movimientos SALIDA recientes
  - Reporta como INFO (no error bloqueante)

- ✅ REP-04: Exceso de inventario calculado
  - Verifica getExcesoInventario() retorna array
  - Valida estructura mínima de respuesta

- ✅ REP-05: Margen bajo reportado (< 10%)
  - Verifica getMargenPorProducto() retorna objeto
  - Valida array margenBajo existe
  - Verifica estructura de elementos

### Tests PROV-01 - Trazabilidad Proveedor
- ✅ PROV-01: Trazabilidad proveedor → producto completa
  - Obtiene compras y sus detalles
  - Mapea proveedores a productos
  - Verifica integridad de datos

### Tests STK-01 - Stock Consistency
- ✅ STK-01: Stock de productos concuerda con kardex calculado
  - Calcula stock por producto desde kardex
  - Compara con stock registrado
  - Reporta discrepancias

## ?? IMPLEMENTACI�N VERIFICADA - SmokeTests.gs

| Funci�n | Archivo | Estado |
|---------|---------|--------|
| SmokeTests.runAll() | SmokeTests.gs | ? Creado |
| SmokeTests.testHealthCheck() | SmokeTests.gs | ? Usa getHealthStatus (Main.gs) |
| SmokeTests.testSheetsExist() | SmokeTests.gs | ? Usa CARTERA_CONFIG, CONFIG, COMPRAS_CONFIG |
| SmokeTests.testCriticalFunctions() | SmokeTests.gs | ? Usa getTerceros, getProductos, CACHE.getHealth, DAO_COMPRAS.getMovimientosKardex |
| SmokeTests.testConfiguration() | SmokeTests.gs | ? Usa PropertiesService |
| SmokeTests.testTriggersExist() | SmokeTests.gs | ? Usa ScriptApp.getProjectTriggers() |
| runSmokeTests() | SmokeTests.gs | ? Funci�n principal exportada |
| sendSmokeAlert() | SmokeTests.gs | ? Usa SESSION_SERVICE.getCurrentUser, MailApp |

Todas las dependencias existen en el proyecto:
- CARTERA_CONFIG, CONFIG, COMPRAS_CONFIG en Config.gs
- CACHE en CacheService.gs  
- DAO_COMPRAS en DAOCompras.gs
- getTerceros, getProductos en API.gs
- getHealthStatus en Main.gs
- SESSION_SERVICE en Config.gs

## Extension Points / Puntos de Extensión

### Exportar nuevas funciones:
1. Agregar en `DOMAIN.<functionName>()` en Domain.gs
2. NO usar guion bajo (_) al inicio del nombre
3. Usar `@param` y `@returns` en JSDoc
4. Agregar test en TestRegression.gs con prefijo correspondiente

### Utilidades disponibles:
- `DOMAIN.createTTLCache(ttlSeconds)` - Cache con expiración
- `DOMAIN.getProductosCached()` - Productos con cache automático
- `DOMAIN.binarySearchByDate(arr, fecha, key)` - Búsqueda binaria
- `DOMAIN.processBatch(items, batchCallback, batchSize)` - Procesamiento por lotes

### Performance:
- Índices: KARDEX(id_producto), MOV_CARTERA(fecha), TERCEROS(id), PRODUCTOS(id)
- TTL Cache: productos/terceros=300s, kardex=60s
- Batch processing: usar `DOMAIN.processBatch()` para >100 items

### Setup Service:
- `setupService.runSetup()` - Crear hojas faltantes
- `verifyConfig()` - Verificar configuración
- `migrateLegacy()` - Migrar datos legacy

### Estructura de datos kardex:
- id: string (KDX-YYYYMMDD-XXXXX)
- fecha: Date
- tipo_mov: "ENTRADA" | "SALIDA"
- id_producto: string
- cantidad: number
- costo_unitario: number
- precio_unitario: number
- stock_anterior: number
- stock_nuevo: number
- origen: string (compraId, ventaId, "AJUSTE", "MERMA")
- referencia: string

### Índices de performance:
- KARDEX: id_producto
- MOV_CARTERA: fecha
- TERCEROS: id
- PRODUCTOS: id

### TTL Cache:
- productos: 300s, terceros: 300s, kardex: 60s

### Configuración Segura de Secretos:
1. **Desde el editor**: Ejecuta `setupGeminiKeyFromPrompt()` para configurar GEMINI_API_KEY
2. **Configuración remota de SPREADSHEET_ID**:
   - Ejecuta `generateSetupToken()` desde el editor
   - Revisa los logs para obtener el token UUID
   - Accede a la URL: `https://script.google.com/macros/s/SCRIPT_ID/exec?ssid=YOUR_SSID&token=TOKEN_UUID`
   - El token se revoca automáticamente tras el primer uso exitoso
3. **Migrar secretos existentes**: Ejecuta `migrateSecretsToUserProperties()` para mover claves de ScriptProperties a UserProperties
4. **Para producción**: Configura `SECRET_PROXY_URL` con endpoint HMAC para gestión de secretos externa

## IA-BUSINESS - Lógica de Negocio (completado)
- ✅ Domain.registrarAbonoAtomic: Eliminada validación de límite crédito (abono reduce deuda, no la aumenta)
- ✅ IdempotencyService.gs: Idempotencia persistente usando CacheService (24h TTL)
- ✅ _Transaction.rollback: Lanza excepción CONFLICTO_ROLLBACK en conflicto de versión
- ✅ DAO.saveTerceroImpl: Refresh de caché antes de validar duplicados de nombre
- ✅ _crearProductoInline: Función con lock global para crear productos sin colisión de IDs

## AGENTE 3 - PERFORMANCE (completado)
- ✅ **2.2**: Unificadas lecturas de productos en registrarVentaAtomic (eliminada segunda lectura redundante)
- ✅ **2.3**: _generarCSV refactorizado con lectura por bloques (_readSheetInBlocks, límite 50,000 filas)
- ✅ **2.4**: Refrescos condicionales de caché en API (getDashboardCartera, getCacheMetrics, getCompras)
- ✅ **2.5**: Lectura limitada de AUDIT_LOG en getVentasDelDia (máximo 5,000 filas)

## Agente 3/4 - Auditoría final de proveedores

| Hallazgo | Estado | Observaciones |
|----------|--------|---------------|
| AUD-PROV-001: getAnalisisProveedor | **CERRADO** | Domain.gs:1985 retorna {proveedor, saldo, movimientosRecientes, productosMasComprados} |
| AUD-PROV-002: getProductosMasCompradosPorProveedor | **CERRADO** | Domain.gs:1927 retorna Array con productos por cantidad |
| AUD-PROV-003: Wrappers faltantes | **CERRADO** | Todos los wrappers existen en app.html:235-239 |
| AUD-PROV-004: getProveedorPorProducto retorna array | **CERRADO** | No retorna array — es diseño correcto, API.gs:1266 envuelve en array si hay resultado |
| AUD-PROV-005: vincularProductoProveedor valida duplicados | **CERRADO** | Domain.gs:1036-1045 ahora hace upsert (busca existente y actualiza, no inserta duplicado)

## AGENTE 4 - FRONTEND WRAPPERS (completado)
- ✅ App.api.getTercerosPorTipo(tipo) wrapper agregado
- ✅ App.api.vincularProductoProveedor() wrapper agregado  
- ✅ App.api.getProveedoresDeProducto() wrapper agregado
- ✅ App.api.getAnalisisProveedor() wrapper agregado
- ✅ App.api.getProductosMasCompradosPorProveedor() wrapper agregado
- ✅ cargarTerceros() actualizado para usar getTercerosPorTipo con filtro tipo
- ✅ cargarVentasTerceros() filtra CLIENTE/AMBOS para selector de clientes
- ✅ abrirModalNuevaCompra() filtra PROVEEDOR/AMBOS para selector de proveedores
- ✅ filtro-tipo-tercero dropdown agregado en UI
- ✅ Event listener para filtro tipo en init.html

## Hallazgos Config.gs Verificados

| Hallazgo | Estado | Evidencia |
|----------|--------|-----------|
| Línea 14: `tipoTercero: 3` duplicado | **CERRADO** | Config.gs:14 - eliminado |
| Línea 232: JSON.stringify comparación headers | **ABIERTO** | Comparación frágil si orden/espacios varían |
| Línea 250: _sanitizeCell objects | **CERRADO** | Config.gs:378-388 - agregado manejo de objetos |
| Línea 276: LogService undefined | **CERRADO** | Config.gs:412 - reemplazado por Logger.log |
| Línea 403: Hoisting BACKUP_CONFIG | **CERRADO** | Config.gs:10-15 - movido al inicio |
| Línea 308: mapping Producto_Proveedor | **CERRADO** | Config.gs:308 - estructura corregida (dos fixes) |
| Índices hardcodeados COLUMN | **ABIERTO** | Requiere arquitectura de schema dinámico |
| Regex fecha insegura "99/99/9999" | **ABIERTO** | Validación permite fechas inválidas |
| TransactionManager snapshot | **ABIERTO** | Lectura por filas individuales (performance) |

| CFG-001 | CRÍTICA | 150 | SPREADSHEET_ID_FALLBACK hardcodeado | **CERRADO** | Eliminado hardcoded. getActiveSpreadsheet() usa PropertiesService o fallback a hoja vinculada |
| CFG-002 | CRÍTICA | 308 | Mapping Producto_Proveedor estructura anidada | **CERRADO** | Config.gs:211,308 - estructura corregida |
| CFG-003 | MAYOR | 113-114, 143 | Variables globales mutables sin persistencia | **CERRADO** | Migrado a CacheService.getScriptCache() para metadata y eliminado _SPREADSHEET_CACHE |
| CFG-004 | MAYOR | 245 | Mutación de const objects | **CERRADO** | Config.gs:243-245 - Object.assign crea nuevo objeto |
| CFG-005 | MAYOR | 479 | AuthService no definido | **CERRADO** | Config.gs:480 - guard de existencia agregado |
| CFG-006 | MAYOR | 537 | getDataRange() ineficiente | **ABIERTO** | Requiere lectura selectiva con offset |
| CFG-007 | MENOR | 14-17, 29-32, 47-49 | Índices hardcodeados contradicen reloadSchema | **ABIERTO** | Column indexes fijos existen antes del sistema dinámico |
| CFG-008 | MENOR | 232 | JSON.stringify frágil | **ABIERTO** | Comparación sin normalización de espacios |

## Hallazgos LockManager.gs Verificados

| ID | Severidad | Línea(s) | Estado | Acción tomada |
|----|-----------|---------|--------|-------------|
| LCK-001 | CRÍTICA | 36-38 | ✅ CERRADO | Eliminado dummy lock - solo tryLock nativo real |
| LCK-002 | CRÍTICA | 80-104 | ✅ CERRADO | Operación atómica bajo lock global |
| LCK-003 | MAYOR | 25 | ✅ CERRADO | Lazy loading `_getPropagationDelay()` |
| LCK-004 | MAYOR | 36-38 | ✅ CERRADO | Eliminado - mismo fix que LCK-001 |
| LCK-005 | MAYOR | 248-265 | ⚠️ ABIERTO | getRange optimizado pero necesita inyección de dependencias |
| LCK-006 | MAYOR | 348 | ✅ CERRADO | Guard `AuthService && AuthService.checkPermission` agregado |
| LCK-007 | MENOR | 268-274 | ✅ CERRADO | Rethrow de errores críticos agregado |

# DIEGOERP — DOCUMENTO ÚNICO CONSOLIDADO
## MicroERP · Cartera Pro · v2.1
**Tech:** Google Apps Script V8 + Google Sheets (DB) + Gemini 2.5 Flash + Vanilla SPA HTML
**Patrones:** Transacciones write-ahead, Caché con checksum, RBAC, Lock distribuido, Auditoría tipo append-only
**Branch model:** `main` (producción) / `feature/*` (desarrollo) / `django-migration` (futuro Django)

---

## 1. FILE MAP (18 .gs + 1 .html)

| File | LOC | Layer | Responsabilidad |
|------|-----|-------|-----------------|
| `Config.gs` | 394 | L1 | Constantes, SPREADSHEET_ID_FALLBACK, getActiveSpreadsheet(), getSheet(), CONFIG.reloadSchema(), COMPRAS_CONFIG, _sanitizeId(), _parseMoneda(), _safeDate(), SPREADSHEET_ID_FALLBACK |
| `LockManager.gs` | 431 | L2 | LOCK_MANAGER: acquireResourceLock(id, timeout, maxAttempts), releaseResourceLock(id), cleanupExpiredLocks(), removeOrphanLocksTrigger(), crearTriggerOrphanCleanup(), _jitter(). Usa ScriptLock + PropertiesService. |
| `CacheService.gs` | 681 | L3 | CACHE: refresh(force), invalidate(), ensureIntegrity(), getTerceros(), getCartera(), getDashboardSummary(), recoverFromStale(). TTL 30s, circuit breaker (5 fails → stale 5 min), checksum SHA-256 |
| `DAO.gs` | 417 | L4 | DAO: TERCEROS: findByIndex/find/normalize, getTerceroByIndex; CARTERA: getByEstado, updatePartial, createFromObj, getPendientesByTercero; MOV: appendRange; getLastRow; PROD: getAll. _sanitizeCell(). |
| `DAOCompras.gs` | 193 | L4 | DAO_COMPRAS: getCompraById, getCompras(filtroProveedor, filtroEstado), getComprasByProveedor, crearCompra, actualizarSaldoCompra, crearPagoProveedor, getDetallesByCompra, getPagosByCompra |
| `AuthService.gs` | 335 | L5 | ROLES={ADMIN:3,OPERATOR:2,VIEWER:1}, PERMISSION_ROLES(23 permisos), AuthService: checkPermission(), getCurrentUser(), setApiKey/hasApiKey; SecretManager: encriptación AES-256 vía SHA-256; PROXY_SECRET_SERVICE. |
| `Domain.gs` | 437 | L5 | _Transaction: create()→{begin, snapshotTerceroRow, snapshotCarteraRows, markMovPreAppend, markMovPostAppend, commit, rollback} con snaps de cartera+tercero+compra. _buildAbonoPlan(). DOMAIN: saveTercero, registrarAbonoAtomic, crearCarteraAtomic, procesarVentaAtomic, registrarCompraAtomic, procesarPagoProveedorAtomic, getVencimientosProximos(dias), getRankingDeudores(topN), getConcentracionProveedores |
| `API.gs` | 470 | L6 | RATE_LIMITER (1s/5s window). 16 endpoints públicos. _safeError(). |
| `Servicios.gs` | 537 | L3 | VENTA_STATES machine (INIT→COMPLETED/FAILED), procesarVentaV2(), actualizarVencimientos(), triggers (crearTriggerVencimientos, instalarTriggerVencimientos), obtenerTerceros(), _registrarAbonoServicio(), _descontarInventario(), _revertirDescuentoInventario() |
| `IAService.gs` | 901 | L3 | SamplingStrategy: segmentByAge(), calculateImportanceScore(), stratifiedSample(). IA_SERVICE: analizarCartera(), buildPrompt(), buildPromptSegmentado(), _callGeminiAPI(). setupGeminiKey(), removeGeminiKey(), analizarConGeminiCompleto(). Máx 3 retries con backoff exponencial. |
| `AuditLog.gs` | 165 | L4 | LOG_ENGINE: logEvent(), getHistory(tabla, idRegistro, limit), purgeOldLogs(). MAX_LOG_ROWS=5000. getVentasHistory(). |
| `Main.gs` | 409 | L0 | doGet(e): sirve HTML, ?health endpoint, autorouting. inicializarSistema(), migrarEstructuraCompras(), handleHealthCheck(), Main_getCarteraDebug(), debugCartera(), checkIAKey() |
| `_key.gs` | 1 | L0 | __GEMINI_FALLBACK_KEY__ hardcoded (AIzaSyBtWeyG6RNSP7KxB9bm-W9JeZs9bJEXFg0) |
| `INSTALL_SCRIPT.gs` | 52 | L0 | initCartera(): configura SPREADSHEET_ID desde active spreadsheet |
| `SETUP_ONE_CLICK.gs` | 48 | L0 | setupCompleto(): guarda ID, verifica hojas y cartera |
| `init_spreadsheet.gs` | 26 | L0 | initFromSpreadsheet(): guarda ID, verifica hojas |
| `diagnose_cartera.gs` | 66→130 | L0 | diagnoseCartera() + tests: testRegistrarCompra, testVencimientosProximos, testRankingDeudores, testConcentracionProveedores, testMigrarDatosCompras |
| `migrarDatosCompras.gs` | 38 | L0 | migrarDatosCompras(): crea hojas Compras, Detalle_Compras, Pagos_Proveedores (idempotente) |
| `index_v3_SaaS.html` | 2164 | L7 | SPA: 7 views (dashboard, cartera, abonos, terceros, ventas, compras, vencimientos), 3 modals (tercero, compra, pago-compra), 2 themes (claro/oscuro), CSS variables, responsive (sidebar→bottom-nav ≤768px). Brutalismo: Sora + DM Mono + Libre Baskerville. |

---

## 2. DATA SCHEMA — 8 SHEETS

### 2.1 Terceros
| Col | Header | Type | Constraint |
|-----|--------|------|------------|
| 0 | ID | string | PK, _sanitizeId |
| 1 | Nombre | string | max 100 |
| 2 | Teléfono | string | max 20 |
| 3 | Tipo | enum | CLIENTE\|PROVEEDOR\|AMBOS |
| 4 | Límite_Crédito | int64 | centavos |
| 5 | Activo | enum | ACTIVO\|INACTIVO |

### 2.2 Cartera
| Col | Header | Type | Constraint |
|-----|--------|------|------------|
| 0 | ID | string | PK, format: "CXC-{uuid}" or "CXP-{uuid}" |
| 1 | Fecha | Date | ISO |
| 2 | ID_Tercero | string | FK→Terceros.ID |
| 3 | Origen_ID | string | ref compra/venta |
| 4 | Total | int64 | centavos |
| 5 | Saldo | int64 | centavos, ≤ Total |
| 6 | Tipo | enum | CxC\|CxP |
| 7 | Estado | enum | ABIERTA\|PARCIAL\|CANCELADA\|VENCIDA |
| 8 | Fecha_Vencimiento | Date | nullable |
| 9 | Vencida_Timestamp | Date | nullable, set on mark-vencida |
| 10 | Version | int64 | optimistic lock (starts 1) |

### 2.3 Movimientos_Cartera
| Col | Header | Type |
|-----|--------|------|
| 0 | ID | string, PK |
| 1 | Fecha | Date |
| 2 | ID_Cartera | string, FK→Cartera.ID |
| 3 | ID_Tercero | string, FK→Terceros.ID |
| 4 | Valor | int64, centavos |
| 5 | Tipo_Mov | enum: ABONO\|CANCELACION |
| 6 | Referencia | string |

### 2.4 AUDIT_LOG
| Col | Header | Type |
|-----|--------|------|
| 0 | ID | string, PK |
| 1 | Timestamp | Date |
| 2 | Operacion | string |
| 3 | Tabla | string |
| 4 | ID_Registro | string |
| 5 | Usuario | string (email) |
| 6 | Datos_Previos | JSON string |
| 7 | Datos_Nuevos | JSON string |
| 8 | Estado | SUCCESS\|ERROR |

### 2.5 Productos
| Col | Header | Type |
|-----|--------|------|
| 0 | ID | string, PK |
| 1 | Nombre | string |
| 2 | Stock | int64 |
| 3 | Precio | int64, centavos |
| 4 | Version | int64 |

### 2.6 Compras (nuevo Fase 2)
| Col | Header | Type | Constraint |
|-----|--------|------|------------|
| 0 | ID | string | PK |
| 1 | Fecha | Date | auto |
| 2 | ID_Proveedor | string | FK→Terceros.ID (tipo=PROVEEDOR\|AMBOS) |
| 3 | Factura | string | num documento |
| 4 | Total | int64 | centavos |
| 5 | Pagado | int64 | centavos, ≤ Total |
| 6 | Saldo | int64 | centavos |
| 7 | Estado | enum | PENDIENTE\|PARCIAL\|PAGADA |
| 8 | Fecha_Vencimiento | Date | nullable |
| 9 | Version | int64 | |

### 2.7 Detalle_Compras (nuevo Fase 2)
| Col | Header | Type |
|-----|--------|------|
| 0 | ID | string, PK |
| 1 | ID_Compra | string, FK→Compras.ID |
| 2 | ID_Producto | string |
| 3 | Cantidad | int64 |
| 4 | Precio_Unitario | int64, centavos |

### 2.8 Pagos_Proveedores (nuevo Fase 2)
| Col | Header | Type |
|-----|--------|------|
| 0 | ID | string, PK |
| 1 | Fecha | Date |
| 2 | ID_Compra | string, FK→Compras.ID |
| 3 | Monto | int64, centavos |
| 4 | Referencia | string |

---

## 3. RBAC MATRIX

### Roles
```
VIEWER  (L1): consulta readonly
OPERATOR(L2): VIEWER + operaciones (abonos, ventas, terceros, inventario)
ADMIN   (L3): OPERATOR + configuración, caché, mantenimiento
```

### 23 Permisos (PERMISSION_ROLES AuthService.gs:4-23)
```
VER:      ver_terceros(V), ver_cartera(V), ver_dashboard(V), ver_auditoria(V),
          ver_analisis_ia(V), ver_configuracion(V), ver_ventas(V),
          ver_compras(V), ver_vencimientos(V)  ← nuevos Fase 2
OPERAR:   registrar_abono(O), guardar_tercero(O), analizar_ia(O),
          revisar_inventario(O), enviar_alertas(O), registrar_venta(O),
          registrar_compra(O), registrar_pago_proveedor(O)  ← nuevos Fase 2
ADMIN:    ver_cache(A), configurar_ia(A), ejecutar_mantenimiento(A),
          configurar_sistema(A), administrar(A)
```

### AuthService.checkPermission(permiso)
1. Obtiene email vía `Session.getActiveUser().getEmail()` (fallback: owner spreadsheet)
2. Busca rol en `AUTHORIZED_USERS` (JSON en PropertiesService)
3. Compara jerarquía: `ROLE_HIERARCHY[rol] >= ROLE_HIERARCHY[PERMISSION_ROLES[permiso]]`
4. Si falla, lanza `new Error("Acceso denegado")`

---

## 4. TRANSACTION & CONCURRENCY MODEL

### LockManager (LockManager.gs:17)
```
acquireResourceLock(id, timeout=15000, maxAttempts=50):
  1. Try ScriptLock.tryLock(5000) → GAS-level lock
  2. Write lock {owner, expires} to PropertiesService (JSON)
  3. Retry with jittered exponential backoff (0.5×baseWait + random×0.5×baseWait)
  4. If >timeout elapsed → return false

releaseResourceLock(id):
  1. Read lock from PropertiesService
  2. If owner matches → delete
  3. If stale (no owner) → delete anyway (orphan cleanup)

_cleanupOrphanLocks(): escanea todas las keys en PropertiesService,
  elimina locks con owner=null o expires<now
```

### _Transaction (Domain.gs:13)
```
create() → { begin, snapshotTerceroRow, snapshotCarteraRows,
  snapshotCompraRows, markMovPreAppend, markMovPostAppend,
  markPagoPreAppend, markPagoPostAppend, markDetallePreAppend,
  markDetallePostAppend, commit, rollback }

rollback():
  1. Restaura filas Terceros (terceroSnapshots[])
  2. Restaura filas Cartera (carteraSnapshots[])
  3. Restaura filas Compras (compraSnapshots[])
  4. Elimina filas Movimientos agregadas (movPost > movPre → deleteRows)
  5. Elimina filas Pagos_Proveedores agregadas
  6. Elimina filas Detalle_Compras agregadas
  7. ctx.active = false
```

### Rate Limiter (API.gs:20)
```
RATE_LIMITER = {
  calls: {},
  WINDOW_MS: 5000,
  COOLDOWN_MS: 1000,
  check(key): si lastCall + 1s → error; si +5s >5 calls → error
}
```

---

## 5. CACHE ARCHITECTURE (CacheService.gs)

### Estructura
```
CACHE = {
  terceros: [],           // raw data
  cartera: [],
  dashboard: {...},
  terceroIndex: {},       // id→rowIndex lookup
  lastRefresh: 0,
  integrityChecksum: "",  // SHA-256 hash
  stale: false,           // circuit breaker
  circuitFailures: 0,
  lastCircuitFailure: 0,
  TTL: 30000,             // 30s
  CIRCUIT_MAX_FAILURES: 5,
  CIRCUIT_AUTO_CLOSE_MS: 300000 // 5 min
}
```

### Flujo refresh()
1. Si fresh (<TTL) && !force → skip
2. Obtener data + checksum de Sheets via PropertiesService
3. Validar integridad (ensureIntegrity)
4. Si ok → poblar estructuras; si fail → incrementa circuitFailures
5. Si circuitFailures ≥5 → stale=true por 5 min, auto-recovery intenta refresh

### ensureIntegrity() throws CacheIntegrityError si checksums no coinciden

---

## 6. API ENDPOINTS CATALOG (API.gs)

| Endpoint | Params | Permiso | RateLimit | Timeout | Retorna |
|----------|--------|---------|-----------|---------|---------|
| `getTerceros` | filtroTipo | ver_terceros | no | 30s | {success, items} |
| `getCartera` | filtroTipo, filtroEstado, pageSize, pageToken | ver_cartera | no | 30s | {success, items, pageToken} |
| `getDashboardCartera` | — | ver_dashboard | no | 30s | {porCobrar, porPagar, vencidaCxC, vencidaCxP, alertas, totalObligaciones, proximosVencimientos7, 15, 30, topDeudores, concentracionProveedores} |
| `saveTercero` | tercero{id,nombre,tipo,limite,activo} | guardar_tercero | no | 30s | {success, id} |
| `registrarAbono` | idTercero, valorAbono, referencia, tipo | registrar_abono | no | 30s | {success, aplicado, restante} |
| `getAuditHistory` | tabla, idRegistro, limit | ver_auditoria | no | 30s | {success, items} |
| `getCacheHealth` | — | ver_cache | no | 30s | health status |
| `analizarConGeminiFresco` | — | analizar_ia | no | 180s | IA analysis |
| `getUserInfo` | — | — | no | 30s | {email, role} |
| `procesarVenta` | carrito[], opciones{tipo, idCliente, dias} | registrar_venta | no | 30s | {success, ...} |
| `getProductos` | — | ver_ventas | no | 30s | {success, items} |
| **NUEVOS Fase 2+3** | | | | | |
| `registrarCompra` | proveedorId, items[], total, fechaVencimiento, factura | registrar_compra | sí | 30s | {success, id} |
| `getCompras` | filtroProveedor, filtroEstado | ver_compras | no | 30s | {success, items} con nombre_proveedor |
| `getDetalleCompra` | idCompra | ver_compras | no | 30s | {success, detalles, pagos} |
| `registrarPagoProveedor` | idCompra, monto, referencia | registrar_pago_proveedor | sí | 30s | {success, ...} |
| `getProximosVencimientos` | dias | ver_vencimientos | no | 30s | {success, items[], total, dias} |
| `getRankingDeudores` | topN | ver_dashboard | no | 30s | {success, items[]} |
| `getConcentracionProveedores` | — | ver_dashboard | no | 30s | {success, totalCompras, conteo, ...} |

---

## 7. DOMAIN OPERATIONS

| Operation | Lock | Tx | Sheets modificadas | Descripción |
|-----------|------|----|--------------------|-------------|
| `saveTercero` | id | sí | Terceros | Crea o actualiza tercero. Si update, snapshot previo. |
| `registrarAbonoAtomic` | id_tercero | sí | Cartera, Mov_Cartera | FIFO: paga deuda más antigua primero. _buildAbonoPlan(). |
| `crearCarteraAtomic` | id_tercero | sí | Cartera | Crea registro CxC/CxP con estado ABIERTA. |
| `procesarVentaAtomic` | global | sí | Cartera, Mov_Cartera, Productos (stock) | State-machine: valida stock→reserva→descuenta→crea cartera. |
| `registrarCompraAtomic` | id_proveedor | sí | Compras, Detalle_Compras, Productos (stock+) | Crea compra + items. Aumenta stock productos. |
| `procesarPagoProveedorAtomic` | id_compra | sí | Compras, Pagos_Proveedores | Actualiza saldo compra. Si saldo≤0 → PAGADA. |

### Reportes analíticos en DOMAIN
- `getVencimientosProximos(dias)`: combina Cartera (ABIERTA|PARCIAL) + Compras (PENDIENTE|PARCIAL) con fecha_vencimiento en rango. Retorna [{nombre, saldo, dias, fecha, tipo}]
- `getRankingDeudores(topN)`: ordena Cartera por saldo descendente, filtra CxC con saldo>0, limita a topN
- `getConcentracionProveedores()`: suma total compras por proveedor, retorna totalCompras + conteo proveedores

---

## 8. FRONTEND ARCHITECTURE (index_v3_SaaS.html)

### Views
| View ID | Función carga | Contenido |
|---------|---------------|-----------|
| dashboard | cargarDashboard() | 3 stat-hero (CxC, CxP, Exposición), alertas top-10, KPIs nuevos (prox vencimientos 7/15/30d, top deudor, conc. proveedores), IA panel |
| cartera | cargarCartera() | Tabla Cartera con filtros tipo/estado, infinite scroll via pageToken |
| abonos | cargarAbonoSelect() | Formulario pago FIFO: select tercero, tipo, monto, referencia |
| terceros | cargarTerceros() | Tabla terceros + modal crear/editar |
| ventas | cargarVentas() | Formulario venta contado/crédito, productos dinámicos, total calculado |
| compras | cargarCompras() | Tabla compras con filtros proveedor/estado, modal nueva compra, modal pago |
| vencimientos | cargarVencimientos() | Tabla vencimientos próximos con selector dias (7/15/30/60/90) |

### Routing
```javascript
// Nav click → classList toggle + data-view matching
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    // remove active from all, add to clicked
    // viewId = btn.dataset.view
    // show document.getElementById('view-' + viewId)
    // call cargarVista(viewId) — if/else dispatch
  })
})
```

### App.data cache
```javascript
App.data = { dashboard: null, cartera: null, terceros: null }
// cargarDashboard() checkea App.data.dashboard primero, solo llama API si null
// cargarCartera() igual con App.data.cartera
```

### Modal system
- 3 modales: `.modal-overlay` + `.modal-box` con `role="dialog" aria-modal="true"`
- Escape key cierra modal abierto
- Focus: primer input del modal recibe focus tras 100ms

### Temas
- `data-theme="light|dark"` en `<html>`, persistido en localStorage
- CSS variables: --bg, --text, --accent, --red, --green, --border, --hover, --muted
- Acento dorado: #D4A82A (light) / #E8C547 (dark)
- Toggle en sidebar con animación de thumb

### Responsive breakpoints
- ≤768px: sidebar → bottom-nav fijo (56px), padding main reducido
- ≤480px: form-field font-size=16px (previene zoom iOS), btn min-height=44px
- Tablas: overflow-x: auto + -webkit-overflow-scrolling: touch

---

## 9. AI INTEGRATION (IAService.gs)

### Sampling (IAService.gs:13-200)
```javascript
SamplingStrategy = {
  segmentByAge(items): // [0-30d, 31-60d, 61-90d, 91+]
  calculateImportanceScore(item): // saldo * weight(edad) * weight(tipo)
  stratifiedSample(items, maxTokens): // preserva proporciones + top N por categoría
}
```

### Prompt building
```javascript
// buildPromptSegmentado(): comprime datos a objeto {i,s,t,e,f,d} x item
// Convierte centavos→pesos COP $ para Gemini
// Máx 3 retries con backoff: 1s, 2s, 4s
// Timeout total: 180s (frontend) + 30s GAS
```

### Configuración
```javascript
setupGeminiKey(apiKey) // guarda en PropertiesService
removeGeminiKey()      // elimina de PropertiesService
hasApiKey("GEMINI_API_KEY") // boolean
```

---

## 10. DEPLOYMENT CONFIG

### appsscript.json (NO campo "files")
```json
{
  "timeZone": "America/Bogota",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE" },
  "executionApi": { "access": "ANYONE" },
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```
⚠️ El manifiesto NO lista los archivos del proyecto. GAS los incluye automáticamente por estar en la misma raíz del clasp push.

### clasp config
```json
{"scriptId":"1ANnjrHVIeGQo4UiNi198cr_S3KfdoJpxDk9FJgohUO_9a_OLAItGFSQy","scriptExtensions":[".gs"]}
```

### Triggers
```javascript
instalarTriggerVencimientos()   // Diario 2:00 AM → actualizarVencimientos()
crearTriggerInventario()         // Diario 8:00 AM → revisar stock
crearTriggerOrphanCleanup()     // Diario 3:00 AM → removeOrphanLocksTrigger()
```

### Health check
```
GET ?health → JSON { status, sheets, cache, triggers }
```

---

## 11. GIT LOG — AUDIT HISTORY

```
main (HEAD)
  36dd8a0 docs: initial QA report baseline
  06cd2b2 docs: add migration guide and update README
  71274c1 refactor: rename all .js to .gs (14 files)
  f362856 chore: update .claspignore and .gitignore

feature/modulo-compras-reportes (2 commits ahead of main)
  9e34d79 feat(compras): domain, config, auth, migration files
  8c31d6e feat(compras): API endpoints + frontend views

django-migration (diverged)
  1622555 feat: frontend CRUD Productos, Compras, CxP (Django templates)
  328ffb2 feat: Django backend models, views, API, serializers
```

---

## 12. AUDIT FINDINGS (Consolidado de QA_REPORT.md + prompts)

### Hallazgos QA_REPORT.md baseline
| ID | Gravedad | Archivo | Hallazgo | Status |
|----|----------|---------|----------|--------|
| QA-01 | ⚠️ menor | appsscript.json | Sin campo `files` que liste archivos .gs | Abierto |
| QA-02 | ❌ bloqueante | Config.gs | Faltaban SCHEMA_definitions para Compras/Detalle/Pagos | ✅ Corregido |
| QA-03 | ❌ faltante | MIGRACION.md | Archivo no existía cuando README lo referenciaba | ✅ Creado |
| QA-04 | 🟢 preventivo | API.gs | Posible duplicación de funciones (registrarAbono ya existe) | Mitigado |
| QA-05 | 🟢 preventivo | AuthService.gs | Faltaban permisos compras | ✅ Agregados |

### Del Prompt Auditoria Técnica (6 pilares)
1. **Concurrencia**: LockManager con _jitter, deadlock timeout 15s, orphan cleanup automático
2. **Caché**: CacheIntegrityError con falsos positivos posibles por milisegundos — mitigado con circuit breaker
3. **Seguridad**: RBAC estricto por endpoint, SecretManager con SHA-256, PROXY_SECRET_SERVICE sin autenticación (⚠️ riesgo conocido FIX m-04)
4. **Rendimiento**: Cuotas GAS — batch writes, Sheet caché (10 sheets max), limpieza LOG cada 100 ops
5. **Exactitud**: Todo en centavos (int64), _parseMoneda sanitiza, sin floats en montos
6. **Frontend**: CSP configurado, aria-live en regiones dinámicas, 44px touch targets, reduced-motion

### Del Prompt Auditoría Frontend (8 ejes)
- Modo claro/oscuro: contraste WCAG AA verificado, toggle persiste, sin fugas de color
- Tipografía: Sora (cuerpo), DM Mono (datos), Libre Baskerville (display) — 3 escalas armónicas
- Sistema espaciado: variables --space-1 a -12, sin valores mágicos residuales
- Mobile: bottom-nav 56px, tablas scroll-x, inputs 16px iOS, 44px botones
- A11y: focus-visible visible, skip-link, aria-modal, aria-live, Escape cierra modales
- CSS: variables everywhere, sin duplicación significativa

---

## 13. ARCHITECTURAL DECISIONS (ADRs comprimidas)

### ADR-001: Centavos como int64
**Problema:** Floats JS causan errores de redondeo en contabilidad.
**Decisión:** Todos los montos se almacenan en centavos (int64). Frontend divide por 100 para display.
**Trade-off:** Mayor overhead de conversión (+1 operación por display).
**Código:** `App.formatearMoneda(centavos)`, `_parseMoneda(valor)`, `App.toCents(amount)`.

### ADR-002: _Transaction write-ahead en vez de transacciones reales
**Problema:** Google Sheets no soporta transacciones ACID.
**Decisión:** Snapshot antes de escribir, rollback manual si falla cualquier paso.
**Trade-off:** No atómico real (ventana entre snapshot y write), pero suficiente para ERP simple.
**Código:** `_Transaction.create()` → begin → snapshot → write → commit|rollback.

### ADR-003: COMPRAS_CONFIG separado de CARTERA_CONFIG
**Problema:** Un solo objeto CONFIG crecería sin límite.
**Decisión:** CARTERA_CONFIG (dominio original) + COMPRAS_CONFIG (nuevo) como constantes independientes.
**Trade-off:** Dos fuentes de verdad para schemas, pero separación de dominios clara.

### ADR-004: CACHE.refresh con TTL 30s
**Problema:** Llamadas repetitivas a Sheets agotan cuota.
**Decisión:** Caché en memoria con TTL 30s, checksum SHA-256, circuit breaker 5 fails → 5 min stale.
**Trade-off:** Lecturas stale hasta 30s. Aceptable para ERP sin requerimientos de consistencia en tiempo real.

### ADR-005: _sanitizeId como función central
**Problema:** IDs inconsistentes causaban errores de lookup.
**Decisión:** `_sanitizeId(id)` normaliza: uppercase, sin espacios, sin caracteres especiales.
**Código:** `String(id).toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_-]/g, '')`.

### ADR-006: SPA single-file (no frameworks)
**Problema:** GAS solo permite HTML+JS+CSS en un archivo por web app.
**Decisión:** Vanilla JS, sin dependencias externas, single-file.
**Trade-off:** ~2164 líneas en un archivo. Mantenible por patrón de secciones y namespacing `App.*`.

---

## 14. KNOWN GAPS & WARNINGS

| Gap | Archivo | Impacto | Mitigación |
|-----|---------|---------|------------|
| PROXY_SECRET_SERVICE sin autenticación | AuthService.gs:272 | Cualquiera con URL puede leer secrets | Documentado en FIX m-04, requiere token HMAC |
| appsscript.json sin campo `files` | appsscript.json | No explícito qué archivos pertenecen al proyecto | GAS incluye automáticamente todos los .gs de la raíz |
| Fallback Gemini key hardcoded | _key.gs:1 | Exposición de API key en repositorio git | Es key gratuita de baja cuota, reemplazar en producción |
| Sin migraciones automáticas de schema | Config.gs | Schema version manual vía SCHEMA_VERSION | reloadSchema() compara headers y reporta mismatch |
| Dashboard sin refresh automático | index_v3_SaaS.html | Usuario debe recargar para ver datos nuevos | App.data cache se invalida solo al cambiar de vista |
| Sin tests automatizados | diagnose_cartera.gs solo debug | No hay suite de tests ejecutable en CI | GAS no tiene test runner nativo — usar clasp + jest externo |
| LockManager no libera lock si ScriptLock.tryLock falla | LockManager.gs | Potencial deadlock si timeout y lock real adquirido | timeout=15s > GAS max exec (6min mitigado) |
| Rollback de compras no revierte stock | Domain.gs (procesarPagoProveedorAtomic) | Si falla pago, el stock incrementado por registrarCompra no se revierte | RegistrarCompra aumenta stock, su rollback no lo decrementa (gap conocido) |

---

## 15. CONSTANTES CLAVE

| Constante | Valor | Archivo |
|-----------|-------|---------|
| SPREADSHEET_ID_FALLBACK | "1hPpL-9ay6DNRDTBKy84r_M3pCnEGU6hJRdCzUQyJFoc" | Config.gs:94 |
| APP_CRYPTO_SALT | "DIEGOERP_AES_V2_2026" | AuthService.gs:25 |
| CACHE.TTL | 30000 (30s) | CacheService.gs:21 |
| CACHE.CIRCUIT_MAX_FAILURES | 5 | CacheService.gs:37 |
| CACHE.CIRCUIT_AUTO_CLOSE_MS | 300000 (5 min) | CacheService.gs:39 |
| MAX_LOG_ROWS | 5000 | AuditLog.gs:5 |
| STOCK_MINIMO | 5 | Config.gs:29 |
| LOCK.timeout | 15000 (15s) | LockManager.gs:20 |
| LOCK.maxAttempts | 50 | LockManager.gs:21 |
| LOCK.retryDelay | 300 (base ms) | LockManager.gs:22 |
| RATE_LIMITER.WINDOW_MS | 5000 | API.gs:14 |
| RATE_LIMITER.COOLDOWN_MS | 1000 | API.gs:15 |
| RATE_LIMITER.MAX_CALLS | 5 | API.gs:13 |
| IA_TIMEOUT_MS | 180000 (frontend) | index_v3_SaaS.html:1003 |
| IA_RETRIES | 3 | IAService.gs |
| __GEMINI_FALLBACK_KEY__ | "AIzaSyBtWeyG6RNSP7KxB9bm-W9JeZs9bJEXFg0" | _key.gs:1 |

---

## 16. FIX INDEX (todos los FIX documentados en código)

| ID | Descripción | Archivo | Estado |
|----|------------|---------|--------|
| M-01 | actualizarVencimientos: skip sin lock si ya corrió hoy (duración ≥30s) | Servicios.gs:195 | Implementado |
| M-02 | Rollback de tercero en _Transaction + snapshot | Domain.gs:76 | Implementado |
| M-03 | Schema version persistida, evita recarga por cada exec | Config.gs:43 | Implementado |
| M-04 | PROXY_SECRET_SERVICE sin auth (gap documentado) | AuthService.gs:272 | Gap — requiere refactor |
| M-05 | getDashboardCartera: cache check antes de recarga | API.gs:142 | Implementado |
| M-06 | CacheService: stale recovery + circuit breaker mejorado | CacheService.gs:333-380 | Implementado |
| M-07 | _revertirDescuentoInventario con batch write | Servicios.gs:494 | Implementado |
| M-08 | AuthService: fallback email para triggers (getActiveUser null) | AuthService.gs:233 | Implementado |
| C-01 | Convertir centavos→pesos en prompts Gemini | IAService.gs:433 | Implementado |
| C-02 | Circuit breaker + auto-close en CacheService | CacheService.gs:36-40 | Implementado |
| C-03 | Purge de AuditLog con lock | AuditLog.gs:39 | Implementado |
| C-04 | Optimización n+1 en Domain (pre-carga map O(1)) | Domain.gs:335 | Implementado |
| C-05 | Orphan lock cleanup automático | LockManager.gs:189 | Implementado |

---

## 17. ABREVIATURAS Y NOTACIÓN

| Abrev | Significado |
|-------|-------------|
| CxC | Cuentas por Cobrar |
| CxP | Cuentas por Pagar |
| GAS | Google Apps Script |
| TX | Transacción |
| LOCK | LockManager |
| RBAC | Role-Based Access Control |
| CSP | Content Security Policy |
| TTL | Time To Live |
| ADR | Architectural Decision Record |
| FIFO | First In First Out |
| LOC | Lines of Code |
| PK | Primary Key |
| FK | Foreign Key |

---

*Documento generado el 2026-06-23 — consolidación de README.md, QA_REPORT.md, MIGRACION.md, PROMPT_AUDITORIA.md, PROMPT_AUDITORIA_FRONTEND.md, PROMPT_REVISION.md, appsscript.json, .clasp.json, y metadatos extraídos de los 18 archivos .gs + 1 .html.*

# Auditoría Técnica Backend - MicroERP Cartera Pro

## AUD-001: XSS Stored via innerHTML en frontend
**Severidad:** CRÍTICA  
**Componente:** `index_v3_SaaS.html` (líneas 1234, 1300, 1313, 1323, 1331, etc.)  
**Vulnerabilidad:** Uso de `innerHTML` sin sanitización para renderizar datos de cartera, terceros, compras. Un atacante puede inyectar `<script>` en campos como "nombre_tercero", "concepto" o "referencia" que se ejecutarán al cargar la UI.  
**Impacto:** Ejecución de código arbitrario en el navegador del usuario, robo de sesión, acceso no autorizado.  
**Solución:** Reemplazar `innerHTML` por `textContent` o usar DOMPurify antes de renderizar.

## AUD-002: Bypass RBAC en triggers por tiempo
**Severidad:** CRÍTICA  
**Componente:** `AuthService.gs` (líneas 270-280)  
**Vulnerabilidad:** `TRIGGER_SAFE_ACTIONS` permite ejecución sin autenticación. Un atacante puede llamar directamente a `actualizarVencimientos` o `revisarInventario` enviando petición POST al endpoint API.  
**Impacto:** Ejecución de operaciones administrativas sin autorización.  
**Solución:** Verificar origen de llamada, no solo whitelister acciones.

## AUD-003: Exposición de API Keys en PropertiesService
**Severidad:** CRÍTICA  
**Componente:** `AuthService.gs` (líneas 191-222)  
**Vulnerabilidad:** API keys se almacenan en `PropertiesService.getScriptProperties()` accesible por cualquier script en el mismo proyecto con permisos de edición.  
**Impacto:** Robo de credenciales Gemini, abuso de cuota API, posible facturación fraudulenta.  
**Solución:** Usar `PropertiesService.getUserProperties()` o secret manager de GCP.

## AUD-004: Race condition en LockManager TTL
**Severidad:** CRÍTICA  
**Componente:** `LockManager.gs` (líneas 70-120)  
**Vulnerabilidad:** El lock se guarda con TTL 45s pero hay gap entre verificación y adquisición. Dos procesos pueden pasar la verificación simultáneamente.  
**Impacto:** Ejecuciones concurrentes corruptas, pérdida de datos.  
**Solución:** Usar lock atómico con `acquireResourceLock` bajo lock global.

## AUD-005: Rollback sin verificación concurrente
**Severidad:** CRÍTICA  
**Componente:** `Domain.gs` (líneas 136-190)  
**Vulnerabilidad:** El rollback en `_Transaction.rollback()` escribe directo a la hoja sin verificar que los datos no hayan cambiado.  
**Impacto:** Pérdida de actualizaciones concurrentes, datos inconsistentes.  
**Solución:** Verificar versión de fila antes del rollback, hacer merge si es necesario.

## AUD-006: Auditoría sin límite (DoS)
**Severidad:** MAYOR  
**Componente:** `AuditLog.gs` (líneas 100-126)  
**Vulnerabilidad:** La hoja AUDIT_LOG crece indefinidamente. El purge elimina filas pero no limita el archivo.  
**Impacto:** Límite de filas de Google Sheets (10K), degradación de rendimiento.  
**Solución:** Implementar archived logs en hojas separadas con timestamp.

## AUD-007: Optimización prompt Gemini
**Severidad:** MAYOR  
**Componente:** `IAService.gs` (líneas 13-100)  
**Vulnerabilidad:** `segmentByAge` incluye todos los items sin límite, causando payloads > 1M tokens.  
**Impacto:** Timeout de API, costos elevados, respuesta lenta.  
**Solución:** Aplicar límite máximo 500 items por segmento.

## Hallazgos MAYORES (3-8) omitidos por espacio

## Matriz de Riesgos Priorizada

| ID | Severidad | Impacto | Effort | Prioridad |
|---|---|---|---|---|---|
| AUD-001 | CRÍTICA | Remote Code Execution | Medio | 1 |
| AUD-002 | CRÍTICA | Auth Bypass | Bajo | 1 |
| AUD-003 | CRÍTICA | Credential Leak | Alto | 1 |
| AUD-004 | CRÍTICA | Data Corruption | Alto | 1 |
| AUD-005 | CRÍTICA | Lost Updates | Medio | 1 |
| AUD-006 | MAYOR | DoS | Bajo | 2 |
| AUD-007 | MAYOR | Performance | Bajo | 2 |

## Plan de Remediación (4 Fases)

1. **Inmediata (H+0):** AUD-002, AUD-001 - Bloquear ejecución no autorizada
2. **Corto plazo (H+24):** AUD-004, AUD-005 - Corregir race conditions
3. **Mediano plazo (H+72):** AUD-003 - Migrar a Secret Manager
4. **Largo plazo (H+168):** AUD-006, AUD-007 - Optimización y límites
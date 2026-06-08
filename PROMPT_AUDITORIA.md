# Prompt de Auditoría Técnica Profunda para DiegoERP / MicroERP

Copia y pega este prompt en una herramienta de IA avanzada (como Gemini 1.5 Pro/2.5 Pro o similar) junto con los archivos del proyecto `diegoerp` para realizar una evaluación exhaustiva del sistema.

---

```text
Eres un experto senior en ciberseguridad, arquitectura de software en la nube y optimización de bases de datos serverless (con foco en Google Apps Script y Google Sheets como motor de persistencia).

Tu misión es realizar una **Auditoría Técnica Profunda e Integral (Código, Seguridad, Concurrencia y Rendimiento)** sobre el proyecto **DiegoERP / MicroERP · Cartera Pro**.

Este proyecto es un sistema de cartera comercial y facturación ligero estructurado con **Google Apps Script (GAS) en el Backend**, **Google Sheets como Base de Datos**, una SPA monolítica en **HTML + CSS + Javascript Vainilla en el Frontend** (que se comunica mediante `google.script.run`), e integración directa con **Gemini 2.5 Flash** para analítica financiera predictiva.

El proyecto está compuesto por los siguientes archivos que deberás analizar a fondo:
1. Config.gs: Constantes globales, jerarquía de roles (ADMIN, OPERATOR, VIEWER) y mapeo de columnas/esquemas.
2. Main.gs: Punto de entrada HTTP de la aplicación (`doGet`).
3. LockManager.gs: Sistema distribuidos de Locks de recursos usando PropertiesService y ScriptLock de Google para resolver condiciones de carrera.
4. CacheService.gs: Capa de caché en memoria con control de expiración (TTL), verificación de sumas de comprobación (checksums) y auto-recuperación ante inconsistencias.
5. DAO.gs: Capa de acceso a datos (Data Access Object) para Google Sheets.
6. AuthService.gs: Autenticación, autorización de usuarios basada en emails y almacenamiento seguro de API Keys.
7. Domain.gs: Capa lógica de negocio (registro de abonos, control de límites de crédito, registro de ventas con inventario y rollback transaccional).
8. Servicios.gs: Orquestación de lógica y generación de reportes generales.
9. API.gs: Endpoints expuestos al cliente Web (frontend) y validación de seguridad de entrada.
10. AuditLog.gs: Sistema de logging histórico de modificaciones de celdas y operaciones.
11. IAService.gs: Integración con la API de Gemini, utilizando muestreo estratificado y cálculo de importancia de cartera.
12. index_v3_SaaS.html: Interfaz de usuario (frontend) SPA responsive con diseño brutalista y estándares de accesibilidad WAI-ARIA.

---

### OBJETIVOS DE LA AUDITORÍA

Analiza los archivos buscando fallas y oportunidades de optimización en los siguientes seis pilares:

#### 1. Gestión de Concurrencia y Race Conditions (Crítico)
* **Lock Contention**: Analiza si el protocolo implementado en `LockManager.gs` (`acquireResourceLock` y `releaseResourceLock`) es propenso a interbloqueos (deadlocks) o condiciones de carrera si dos usuarios ejecutan `ejecutarAbono` simultáneamente para el mismo cliente.
* **Control de Transacciones**: Revisa si ante fallos intermedios en `Domain.gs` (por ejemplo, si se escribe en la hoja "Cartera" pero falla la escritura en "Movimientos_Cartera"), los bloqueos se liberan correctamente en un bloque `finally` y si se realiza una reversión (rollback) manual adecuada.
* **Stale Reads**: Evalúa si la velocidad de refresco de la caché o el almacenamiento asíncrono puede provocar que se lea un saldo desactualizado antes de procesar una nueva transacción.

#### 2. Consistencia y Resiliencia de la Caché
* **Integridad de Datos**: Audita cómo se calcula y valida el checksum en `CacheService.gs` (`CacheIntegrityError`). ¿Hay escenarios donde diferencias menores de milisegundos en actualizaciones concurrentes generen excepciones de integridad falsas?
* **Circuit Breaker y Stale**: Evalúa el comportamiento del estado `stale` y del disyuntor ante fallos sucesivos en llamadas a Sheets. ¿El mecanismo de auto-recuperación (`recoverFromStale()`) es seguro o puede provocar bucles infinitos de refresco bajo carga moderada?

#### 3. Seguridad, RBAC y Evasión de Permisos (Ciberseguridad)
* **Validación de Roles (Bypass)**: Examina minuciosamente `API.gs` and `AuthService.gs`. ¿Existe algún endpoint expuesto que no valide de forma estricta los privilegios del usuario activo (`Session.getActiveUser().getEmail()`)? ¿Puede un usuario con rol `VIEWER` forzar la ejecución de `ejecutarAbono` o `registrarVenta` enviando un payload directo?
* **Seguridad de Datos de Configuración**: Examina cómo se resguarda la API Key de Gemini en `PropertiesService.getScriptProperties()`. ¿Es vulnerable a accesos no autorizados por parte de otros scripts ejecutándose en el mismo contenedor o cuentas compartidas?
* **Sanitización de Datos**: Identifica posibles inyecciones de código en campos de texto (ej. nombres de terceros, referencias de abonos) que puedan explotarse en el frontend (`index_v3_SaaS.html`) mediante XSS al renderizar tablas dinámicas.

#### 4. Rendimiento de Apps Script e Integración de IA
* **Límites de Cuota de Google**: Identifica llamadas repetitivas en bucles a servicios de Google (`SpreadsheetApp`, `PropertiesService`, `UrlFetchApp`) que puedan agotar las cuotas diarias de Apps Script o provocar el error de tiempo de ejecución límite de 6 minutos.
* **Eficiencia de Gemini**: Revisa el algoritmo de muestreo estratificado en `IAService.gs` (`SamplingStrategy.segmentByAge` y `calculateImportanceScore`). ¿Puede generar payloads excesivamente grandes que superen la ventana de contexto o inflen innecesariamente los costos de tokens?
* **Mecanismos de Reintento**: Audita la implementación de backoff exponencial para llamadas HTTP a la API de Gemini.

#### 5. Exactitud Numérica e Integridad del Esquema
* **Aritmética de Centavos**: Verifica si la representación de valores monetarios en centavos (`Total`, `Saldo`, `Valor`) se implementa consistentemente en todo el backend y frontend. Busca posibles operaciones matemáticas de punto flotante en JS que puedan causar discrepancias de céntimos en la base de datos (Google Sheets).
* **Validación de Tipos**: Comprueba si los datos vacíos o nulos en las columnas de Sheets rompen los castings de tipos de datos en la deserialización.

#### 6. Calidad, Responsive y Accesibilidad del Frontend
* **Seguridad del Frontend**: Revisa la política de seguridad de contenido (CSP) configurada. ¿Bloquea correctamente scripts maliciosos sin dañar la comunicación con Apps Script (`google.script.run`)?
* **Manejo de Errores y Estados de Carga**: Comprueba si el flujo de JS maneja adecuadamente los timeouts y desconexiones de GAS, mostrando notificaciones oportunas al usuario y previniendo el congelamiento de la pantalla.
* **Compatibilidad Móvil**: Evalúa el rendimiento de los layouts responsivos en resoluciones bajas y la accesibilidad táctil de los elementos.

---

### ESTRUCTURA DEL INFORME TÉCNICO REQUERIDO

Por cada hallazgo crítico, mayor, menor o de optimización encontrado, estructura tu respuesta de la siguiente manera:

1. **ID**: AUDIT-00X
2. **Severidad**: (Crítica / Mayor / Menor / Optimización)
3. **Componente Afectado**: (Ejemplo: `Domain.gs`, `LockManager.gs`)
4. **Vulnerabilidad / Defecto**: Explicación técnica del problema, causa raíz e impacto práctico.
5. **Prueba de Concepto (PoC) / Escenario de Falla**: Secuencia paso a paso que detona el error.
6. **Código Vulnerable / Ineficiente**: Fragmento de código original con indicación aproximada de líneas.
7. **Solución y Código Refactorizado**: Propuesta de remediación lista para aplicar, escrita con mejores prácticas.

Adicionalmente, concluye con una **Matriz de Riesgos resumida** en una tabla Markdown, priorizando los cambios de mayor impacto a menor impacto.
```

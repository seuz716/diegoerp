# Prompt para auditoría final de producción

Evalúa si este ERP construido en Google Apps Script (GAS) está listo para producción. Revisa **cada archivo** y emite un reporte estructurado con:

- **Puntaje general** (0-10) con desglose por categoría
- **Bloqueadores (P0):** lo que impide salir a producción
- **Críticos (P1):** bugs o vulnerabilidades que deben corregirse
- **Mejoras (P2):** optimizaciones o deuda técnica
- **Falsos positivos** si encuentras algo que parece error pero no lo es, explícalo

## Archivos a evaluar

Trabajas en `/home/cesar/mis_proyectos/diegoerp/`. Archivos clave:

### Backend (.gs)
- `API.gs` — 29 endpoints públicos (google.script.run). Incluye: cartera, abonos, ventas, terceros, compras, reportes, dashboard.
- `Domain.gs` — Lógica de negocio. Contiene `_Transaction` con optimistic locking, snapshots y rollback para ventas, abonos y compras. 5 funciones nuevas de compras: `registrarCompraAtomic`, `procesarPagoProveedorAtomic`, `getVencimientosProximos`, `getRankingDeudores`, `getConcentracionProveedores`.
- `DAOCompras.gs` — CRUD de compras, detalle de compras, pagos a proveedores.
- `DAO.gs` — DAO original de cartera/terceros.
- `AuthService.gs` — Autenticación basada en roles + HMAC para proxy. HMAC ahora lanza error si no hay secret configurado (endurecido).
- `Config.gs` — Constantes: columnas, estados, sheets.
- `CacheService.gs` — Cache con chunking (chunkSize=90000, max 100KB de ScriptCache).
- `LockManager.gs` — Lock distribuido con PROPAGATION_DELAY_MS=50.
- `migrarDatosCompras.gs` — Script idempotente para crear hojas Compras/Detalle_Compras/Pagos_Proveedores.
- `diagnose_cartera.gs` — Suite de tests unitarios (incluye 5 tests de compras).
- `validadores.gs`, `reportes_cartera.gs`, `funcCartera.gs` — Módulos de soporte.

### Frontend
- `index_v3_SaaS.html` — SPA de 2740 líneas con vistas: Dashboard, Cartera, Terceros, Abonos, Ventas, Compras, Vencimientos. Incluye localStorage, tema claro/oscuro, diseño responsive, navegación bottom-nav + sidebar.

### Otros
- `.gitignore` — ignorados recién actualizados (django_migration/).

## Checklist de evaluación

### Seguridad
1. **XSS:** ¿Hay algún `innerHTML` con datos del usuario sin sanitizar? Busca en el HTML y en cualquier .gs que genere HTML.
2. **Inyección:** Las queries a Sheets (getRange, getValues, getDataRange) usan índices numéricos, no SQL. ¿Hay algún lugar donde se construya un rango dinámicamente con input del usuario?
3. **Autenticación:** ¿Cada endpoint verifica el rol adecuado? ¿El bypass silencioso de `getCartera()` que permitía acceso read-only sin rol fue realmente eliminado?
4. **HMAC:** ¿`_callSecretEndpoint()` realmente lanza error si no hay secret? ¿Hay algún llamado a `_callSecretEndpoint` que no maneje el error?
5. **Exposición de datos:** ¿Los errores devueltos al cliente contienen stack traces o información sensible? Busca patrones como `error.stack`, `e.stack`, o `JSON.stringify(e)`.
6. **UUID:** ¿Se usa `Utilities.getUuid()` de GAS o una implementación casera insegura?

### Transacciones y consistencia
7. **Optimistic locking:** ¿Cada operación de escritura verifica `version`? ¿Qué pasa si hay un conflictWrite?
8. **Rollback:** ¿`_Transaction.rollback()` realmente restaura los snapshots en orden inverso? ¿Cubre compras también?
9. **Concurrencia:** ¿LockManager se usa antes de cada escritura? ¿Hay algún lugar que modifique sheets sin lock?
10. **Idempotencia:** ¿`migrarDatosCompras` puede ejecutarse múltiples veces sin duplicar datos?

### Manejo de errores
11. **Try/catch:** ¿Cada endpoint en API.gs tiene try/catch que devuelve `{ok:false, error: mensaje}`?
12. **Errores fatales:** ¿Hay algún catch vacío o que solo logee sin devolver error al usuario?
13. **Timeouts:** Las llamadas `google.script.run` del frontend tienen `setTimeout` de respaldo? GAS Rhino NO expone `.withTimeout()`.
14. **Validación de input:** ¿Los parámetros de cada endpoint se validan (tipo, rango, obligatorios)?

### Fronend
15. **Estado de carga:** ¿Cada vista muestra indicador de carga mientras espera respuesta de `google.script.run`?
16. **Manejo de error UI:** ¿Los errores del servidor se muestran como toast/notificación, no como alert()?
17. **Rendimiento:** ¿Hay DOM masivo sin virtualización? ¿Las listas de cartera/ventas/compras podrían tener cientos de filas?
18. **Modo offline:** ¿Hay un banner de "sin conexión" cuando el usuario pierde internet?
19. **Accesibilidad:** ¿Los modales manejan foco? ¿Hay roles ARIA? ¿El contraste de colores cumple WCAG AA?
20. **Tema oscuro:** ¿Funciona correctamente en ambos modos? ¿Persiste la preferencia en localStorage?
21. **Navegación:** ¿La vista activa en sidebar/bottom-nav refleja la ruta actual? ¿El botón back-to-top funciona?
22. **Caché de datos:** ¿Hay datos cacheados en memoria/cliente que puedan dar información desactualizada?

### Lógica de negocio
23. **Cálculo de saldos:** `saldo = total - sum(pagos)` en abonos y en compras. ¿Se recalcula correctamente tras cada pago?
24. **Vencimientos:** ¿Las fechas se comparan como objetos Date o como strings? ¿Qué pasa si la hoja tiene fechas en formato distinto?
25. **Rankings:** `getRankingDeudores` y `getConcentracionProveedores` — ¿qué pasa si no hay datos? ¿Manejan división por cero (porcentajes)?
26. **Dashboard KPIs:** ¿Los indicadores de vencimientos, top deudor y concentración se actualizan cuando cambian los datos?
27. **Estados de compra:** Config.gs usa `ESTADOS: { ABIERTA: "PENDIENTE", PARCIAL: "PARCIAL", PAGADA: "PAGADA" }`. ¿Domain.gs y frontend usan estos mismos valores? ¿Coinciden en todos los lugares?

### Deuda técnica
28. **Logger.log:** ¿Quedan `Logger.log` de depuración en DAO, Domain o API que deban limpiarse?
29. **Código muerto:** ¿Hay funciones sin usar, variables sin referencia, o comentarios enormes de código comentado?
30. **TODO/FIXME/HACK:** ¿Hay marcadores en el código que indiquen trabajo incompleto?
31. **Hardcoded:** ¿Hay valores mágicos (números, strings) que deberían ser constantes en Config.gs?
32. **Magic numbers en frontend:** ¿Hay breakpoints, colores, tamaños hardcodeados? ¿O usan variables CSS/constantes?
33. **Duplicación:** ¿Hay lógica duplicada entre DAO.gs y DAOCompras.gs que pueda unificarse?

### Límites de GAS
34. **ScriptCache 100KB:** CacheService fragmenta en chunks de 90KB. ¿Maneja correctamente datos que exceden múltiples chunks?
35. **Tiempo de ejecución:** ¿Hay endpoints que procesen cientos de filas sin paginación? ¿Podrían exceder los 6 min de GAS?
36. **Límite de celdas:** ¿Las hojas de cálculo podrían acercarse al límite de 10M de celdas? ¿Hay plan de archivado?

### Regresión
37. **¿El port del módulo Compras rompió algo existente?** Revisa que funciones previas en API.gs, Domain.gs y el frontend sigan intactas.
38. **Nombres de funciones:** ¿No hay conflictos de nombres entre funciones nuevas y existentes en el ámbito global (GAS no tiene modules)?

## Formato del reporte

```
## RESUMEN
- Score general: X.X/10
- Bloqueadores (P0): X
- Críticos (P1): X  
- Mejoras (P2): X
- Falsos positivos identificados: X

## P0 — BLOQUEADORES
[lista]

## P1 — CRÍTICOS
[lista con archivo:línea y solución propuesta]

## P2 — MEJORAS
[lista con archivo:línea]

## FALSOS POSITIVOS
[cada falso positivo con explicación de por qué no es un error]

## Veredicto final
¿Recomiendas salir a producción? Sí / No / Condicional.
Si es condicional, ¿qué mínimo debe corregirse antes?
```

Sé riguroso, específico y citando archivo:línea. Si un hallazgo aplica a múltiples archivos, menciónalos a todos.

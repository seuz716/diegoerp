# Migración del proyecto DiegoERP

## Resumen

Esta migración renombra todos los archivos `.js` a `.gs` para alinearse con los estándares de Google Apps Script, añade funciones de inicialización del sistema y prepara la estructura de datos para nuevas funcionalidades.

## Pasos para el administrador

### 1. Desplegar los archivos renombrados

```bash
clasp push
```

Esto subirá todos los archivos `.gs` al proyecto de Apps Script.

### 2. Ejecutar `inicializarSistema()`

Desde el editor de Google Apps Script:

1. Abre el proyecto en [script.google.com](https://script.google.com).
2. Selecciona la función `inicializarSistema` en el menú desplegable.
3. Haz clic en **Ejecutar**.
4. Revisa los logs en **Ver → Registros de ejecución**.

Esta función:
- Recarga y valida todos los esquemas de las hojas.
- Verifica que los encabezados de columna coincidan con las definiciones.
- Registra un reporte de estado.

### 3. Verificar la Web App

Abre la URL de la Web App desplegada y verifica que cargue correctamente.

### 4. (Opcional) Migrar estructura de Compras

Si se requieren las nuevas columnas para la Fase 2:

```javascript
migrarEstructuraCompras();
```

Esta función agrega la columna `Numero_Factura` a la hoja Cartera de forma segura e idempotente (no daña datos existentes).

### 5. Verificar health check

Agrega `?health` a la URL de la Web App para ver el estado del sistema:

```
https://script.google.com/macros/s/<SCRIPT_ID>/exec?health
```

## Archivos afectados

| Archivo original | Nuevo nombre |
|-----------------|--------------|
| API.js | API.gs |
| AuditLog.js | AuditLog.gs |
| AuthService.js | AuthService.gs |
| CacheService.js | CacheService.gs |
| Config.js | Config.gs |
| DAO.js | DAO.gs |
| Domain.js | Domain.gs |
| IAService.js | IAService.gs |
| INSTALL_SCRIPT.js | INSTALL_SCRIPT.gs |
| LockManager.js | LockManager.gs |
| Main.js | Main.gs |
| SETUP_ONE_CLICK.js | SETUP_ONE_CLICK.gs |
| Servicios.js | Servicios.gs |
| diagnose_cartera.js | diagnose_cartera.gs |
| init_spreadsheet.js | init_spreadsheet.gs |

## Funciones nuevas

- `inicializarSistema()` — Recarga esquemas y valida la estructura.
- `migrarEstructuraCompras()` — Agrega columnas nuevas a la hoja Cartera (idempotente).

## Rollback

Si es necesario revertir, los archivos `.gs` pueden renombrarse de vuelta a `.js`. El contenido no cambió.

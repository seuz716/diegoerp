# Guía de Despliegue y Rollback - MicroERP · Cartera Pro

## 📦 Despliegue a Producción

### Prerrequisitos
- [ ] CLASP instalado: `npm install -g @google/clasp`
- [ ] Acceso al proyecto GAS: `clasp login`
- [ ] SPREADSHEET_ID configurado en Properties
- [ ] GEMINI_API_KEY configurada (opcional)

### Pasos de Despliegue

```bash
# 1. Verificar estado local
clasp status

# 2. Actualizar .claspignore (asegurar que archivos dev no suban)
cat .claspignore

# 3. Subir código a la nube
clasp push

# 4. Crear nueva versión
clasp deploy new --versionDescription "v$(date +%Y%m%d)-$(git rev-parse --short HEAD)"

# 5. Obtener URL del deploy
clasp deploy list

# 6. Ejecutar smoke tests
# En el editor GAS, ejecutar: runSmokeTests()
# O visitar: https://<DEPLOYMENT_URL>?health=1

# 7. Verificar logs
# Ir a Ejecuciones en GAS Console
```

### Post-Deploy Checklist

- [ ] Health check responde OK (`?health=1`)
- [ ] Smoke tests pasan (`runSmokeTests()`)
- [ ] Hoja `SmokeTestLog` tiene nuevo registro
- [ ] Triggers están activos (revisar en GAS Console)
- [ ] Backup de configuración creado (`ConfigBackup.backupProperties()`)

---

## 🔄 Rollback Procedure

### Cuándo hacer Rollback
- Smoke tests fallan después del deploy.
- Usuarios reportan errores críticos.
- Health check responde con error.

### Pasos de Rollback

```bash
# 1. Listar despliegues disponibles
clasp deploy list

# Ejemplo de salida:
# └─ Deployments ────────────────────────────────────────
#   - 1 @1 - v20250701-abc123 (active)
#   - 2 @2 - v20250630-def456 (active)
#   - 3 @3 - v20250629-ghi789

# 2. Identificar la versión estable anterior (ej: @2)
# 3. Actualizar al deploy estable
clasp deploy update 2 --versionDescription "ROLLBACK - v20250630-def456"

# 4. Verificar que el rollback funcionó
# Visitar URL y verificar health check

# 5. Documentar el rollback
# Registrar en hoja "DeployLog": fecha, motivo, versión anterior, versión actual
```

### Rollback Automático (Opcional)

```javascript
/**
 * Función para rollback automático si los smoke tests fallan.
 * ADVERTENCIA: Usar con cuidado en producción.
 */
function autoRollbackOnFailure() {
  var result = runSmokeTests();
  if (!result.success) {
    Logger.log('⚠️ Smoke tests fallaron, ejecutando rollback...');
    // Notificar a administradores
    sendSmokeAlert(result);
    // Rollback al deploy anterior
    var deployments = ScriptApp.getDeployments();
    if (deployments.length > 1) {
      var previousDeployment = deployments[deployments.length - 2];
      // Nota: No se puede cambiar el deployment activo programáticamente
      // Se debe hacer manual con clasp
      Logger.log('Rollback manual requerido. Deploy anterior: ' + previousDeployment.getDeploymentId());
    }
  }
}
```

---

## 💾 Backup de Configuración

### Respaldar Configuración Manualmente

En el editor GAS, ejecutar:
```javascript
ConfigBackup.backupProperties();
```
Esto crea un archivo JSON en la carpeta `MicroERP_ConfigBackups`.

### Restaurar Configuración

```javascript
var fileId = 'XXX'; // ID del archivo de backup
ConfigBackup.restoreProperties(fileId);
```

### Verificar Estado del Esquema

```javascript
SchemaManager.ensureSchemaVersion();
```

---

## 📊 Monitoreo Post-Deploy

### Logs de Despliegue
Los logs se registran en:
- `SmokeTestLog` - Resultados de pruebas de humo.
- `SchemaLog` - Migraciones de esquemas.
- `DeployLog` - Registro de despliegues y rollbacks.

### Alertas
- **Correo electrónico:** Se envía alerta si smoke tests fallan (1 cada 12 horas).
- **Dashboard:** Health check disponible en `?health=1`.

---

## 🚨 Incidentes Conocidos y Soluciones

| Problema | Solución |
|----------|----------|
| `ERR_CIRCUIT_OPEN` | Esperar 30s y reintentar. Si persiste, reiniciar caché. |
| `OPTIMISTIC_LOCK_FAILURE` | Reintentar la operación manualmente. |
| `SPREADSHEET_ID no configurado` | Ejecutar `autoConfigureSpreadsheetId()` |
| `GEMINI_API_KEY falta` | Ejecutar `setupGeminiKeyFromPrompt()` |
| `Triggers no instalados` | Ejecutar `setupBackupAndExports()` y `setupPostDeployTriggers()` |

---

## 📝 Registro de Cambios (Changelog)

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2025-07-02 | v2.2 | Agregado: ConfigBackup, SchemaManager, DEPLOYMENT.md |
| 2025-07-02 | v2.1 | Agregado: Smoke tests, rollback docs |
| 2025-07-01 | v2.0 | Despliegue inicial de producción |

---

### Contactos de Emergencia
- **Administrador Principal:** cesar@abadia.dev
- **Soporte Técnico:** Ver logs en SmokeTestLog y AuditLog
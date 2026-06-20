# Django Migration for MicroERP · Cartera Pro

Migración del sistema desde Google Apps Script + Sheets hacia Django + PostgreSQL/Supabase.

## Estructura

```
django_migration/
├── diegoerp/           # Settings del proyecto
│   ├── __init__.py
│   ├── settings.py     # Configuración principal
│   ├── urls.py         # URLs raíz
│   └── wsgi.py         # WSGI para producción
├── cartera/            # App principal (equivalente a tu lógica)
│   ├── models.py       # Modelos = hojas de Sheets
│   ├── views.py        # Vistas API REST = endpoints API.gs
│   ├── serializers.py  # Serializadores = validación entrada
│   ├── urls.py         # URLs de la API
│   └── admin.py        # Admin Django
├── requirements.txt
├── manage.py
└── .env.example
```

## Instalación rápida

```bash
cd django_migration
pip install -r requirements.txt

# Configurar .env
cp .env.example .env

# Migrar base de datos
python manage.py makemigrations
python manage.py migrate

# Crear superusuario
python manage.py createsuperuser

# Ejecutar servidor
python manage.py runserver
```

## URLs API disponibles

| Endpoint | Equivalente | Descripción |
|----------|-------------|-------------|
| `/api/terceros/` | `API.getTerceros()` | Lista terceros activos |
| `/api/cartera/` | `API.getCartera()` | Lista cartera con filtros |
| `/api/tercero/save/` | `API.saveTercero()` | Crear/editar tercero |
| `/api/abono/registrar/` | `API.registrarAbono()` | Registrar abono atomic |
| `/api/dashboard/` | `API.getDashboardCartera()` | Estadísticas dashboard |
| `/api/productos/` | `API.getProductos()` | Lista productos |
| `/admin/` | - | Panel admin Django |

## Migración de datos desde Sheets

```bash
# Configurar credenciales Google en .env
export GOOGLE_CREDS_PATH=creds.json
export SPREADSHEET_ID=tu-id

python manage.py shell < cartera/management/migrate_from_sheets.py
```

## Deploy gratuito

### Opción 1: Railway.app
```bash
railway init
railway up
```

### Opción 2: PythonAnywhere
- Subir archivos vía ZIP
- Configurar virtualenv
- Web tab → WSGI configuration

### Opción 3: Vercel + Supabase
- Conectar repo de GitHub
- Configurar variables de entorno

## Ventajas sobre Apps Script

| Característica | Apps Script | Django |
|----------------|-------------|--------|
| Queries | Filtros en memoria | SQL con índices |
| Transacciones | Rollback manual | `@transaction.atomic` |
| Auth | Emails hardcodeados | Django auth + Groups |
| Testing | Impossible | pytest + factories |
| Performance | 6 min timeout | Sin límites |
| Debugging | Console logs limitados | Django Debug Toolbar |

## Próximos pasos

1. [ ] Completar modelos: agregar `Venta`, `ItemVenta`
2. [ ] Implementar lógica de inventario
3. [ ] Migrar IAService → integración Gemini en Django
4. [ ] Adaptar frontend para consumir API REST
5. [ ] Configurar Redis para cache (equivalente a CacheService.gs)
# Prompt para revisión quirúrgica del frontend

Copia y pega TODO este bloque en una nueva sesión de opencode (o cualquier asistente IA). No omitas nada.

---

Eres un senior frontend master. Debes aplicar correcciones quirúrgicas al archivo `/home/cesar/mis_proyectos/diegoerp/index_v3_SaaS.html` sin alterar el diseño visual existente (paleta de colores, tipografía, brutalismo, layout general, espaciados). Trabaja sobre una copia del archivo original y al final entrega el diff.

El archivo es una SPA monolítica de 1418 líneas con HTML+CSS+JS inline, para Google Apps Script. Diseño oscuro brutalista con acento dorado (#E8C547), tipografía DM Mono + Libre Baskerville.

## REGLAS ESTRICTAS

1. NO cambiar colores, tipografías, tamaños relativos, bordes, radios (0px), espaciados que no sean los indicados.
2. NO agregar librerías externas (ni Bootstrap, ni Tailwind, ni jQuery, ni React).
3. NO convertir a módulos ES6 ni cambiar la estructura GAS.
4. TODO debe seguir funcionando con `google.script.run`.
5. NO eliminar funcionalidad existente.
6. Cada cambio debe ser mínimo y localizado.

---

## TAREA 1: META VIEWPORT Y RESPONSIVE (crítico)

### 1.1 Agregar viewport meta tag
En la línea 4, DESPUÉS de `<meta charset="UTF-8">`, agregar:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

### 1.2 Hacer sidebar colapsable en mobile
- Agregar al CSS un `@media (max-width: 768px)` que:
  - Oculte `#sidebar` con `display: none`
  - Muestre `#bottom-nav` con `display: flex`
  - En `#main` cambie `padding: 28px 28px 24px` a `padding: 16px`
  - El `max-width: 900px` de `#main` lo dejes igual
  - El body quite `min-height: 700px` y ponga `min-height: 100dvh`

### 1.3 Poblar bottom-nav con los mismos items del sidebar
El HTML tiene `#bottom-nav` vacío (línea 390). Reemplazar con:
```html
<nav id="bottom-nav" role="navigation" aria-label="Navegación principal">
  <div class="nav-item active" data-view="dashboard">◆</div>
  <div class="nav-item" data-view="terceros">◇</div>
  <div class="nav-item" data-view="cartera">◇</div>
  <div class="nav-item" data-view="abonos">◇</div>
  <div class="nav-item" data-view="ventas">◇</div>
</nav>
```

Darle estilo dentro del mismo `@media`:
```css
#bottom-nav {
  position: fixed; bottom: 0; left: 0; right: 0;
  height: 56px; background: var(--bg-1);
  border-top: 1px solid var(--border);
  display: flex; justify-content: space-around; align-items: center;
  z-index: 2000; padding: 0 8px;
}
#bottom-nav .nav-item {
  display: flex; flex-direction: column; align-items: center;
  padding: 6px; font-size: 10px; border: none; gap: 2px;
  min-height: 44px; justify-content: center;
}
```

### 1.4 Hover/active states para bottom-nav (fuera del @media también, en la regla .nav-item existente, no cambiar nada de los .nav-item actuales, solo asegurar que los del bottom-nav hereden)

### 1.5 Tablas con scroll horizontal
A la clase `.table-section` agregar: `overflow-x: auto; -webkit-overflow-scrolling: touch;`

### 1.6 Input font-size mínimo para evitar zoom en iOS
A `.form-field` agregar en línea 331: después de `font-size:13px` no tocar, pero agregar un `@media (max-width: 480px)` que ponga `.form-field{font-size:16px}`.

### 1.7 Botones con altura táctil mínima
Agregar al `@media (max-width: 480px)`:
```css
.btn { min-height: 44px; padding: 12px 16px; }
```

### 1.8 Barra de progreso de carga inline para IA (no afecta diseño)
Agregar al HTML después de la línea 512 (dentro del IA panel):
```html
<div id="ia-progress" style="display:none;margin-top:12px;">
  <div style="height:2px;background:var(--border);overflow:hidden;">
    <div id="ia-progress-bar" style="height:100%;width:0%;background:var(--accent);transition:width .3s ease;"></div>
  </div>
  <div id="ia-progress-text" style="font-size:9px;color:var(--muted);margin-top:6px;letter-spacing:0.1em;text-transform:uppercase;">Iniciando análisis...</div>
</div>
```

## TAREA 2: UX Y USABILIDAD

### 2.1 Feedback de éxito en abonos
En `ejecutarAbono()` (línea 1068-1079), cuando la operación es exitosa, actualmente solo limpia el formulario. NO cambiar eso, pero además agregar:

Después de `document.getElementById('abono-referencia').value = '';` y antes de `document.getElementById('abono-cliente').value = '';`:

Agregar un elemento `#abono-success` en el HTML del formulario de abonos (después de `#abono-error`, alrededor de línea 599):
```html
<div id="abono-success" style="display:none;padding:12px 16px;margin-bottom:12px;border:1px solid var(--accent-border);background:var(--accent-dim);color:var(--accent);font-size:11px;letter-spacing:0.04em;"></div>
```

Y en el JS de `ejecutarAbono()`, tras limpiar el form, agregar:
```javascript
var successEl = document.getElementById('abono-success');
successEl.textContent = 'Abono registrado exitosamente.';
successEl.style.display = 'block';
setTimeout(function(){ successEl.style.display = 'none'; }, 4000);
```

### 2.2 Confirmación en acciones críticas
En `ejecutarAbono()` (línea 1048), justo después de las validaciones y antes de `btn.disabled = true;`:

Agregar:
```javascript
if (!confirm('¿Confirmar el registro de este movimiento?\nMonto: ' + App.formatearMoneda(monto * 100) + '\nTipo: ' + tipo)) { return; }
```

En `registrarVenta()` (línea 1288), justo después de las validaciones y antes de `btn.disabled = true;`:

Agregar:
```javascript
var totalStr = document.getElementById('venta-total').textContent;
if (!confirm('¿Confirmar el registro de esta venta?\nTotal: ' + totalStr + '\nTipo: ' + tipo)) { return; }
```

### 2.3 Error banner no auto-desaparezca
En `showError()` (línea 829-834), QUITAR el `setTimeout` que oculta el banner. El banner se ocultará solo cuando el usuario haga clic en otra vista o recargue.

### 2.4 Cambiar "Cliente" por "Tercero" en abonos
En línea 575, cambiar `<label class="form-label">Cliente</label>` por `<label class="form-label">Tercero</label>`.
En línea 577, cambiar `<option value="">Seleccione un cliente...</option>` por `<option value="">Seleccione un tercero...</option>`.

### 2.5 Cache App.data utilizado realmente
Modificar `cargarDashboard()` para que primero verifique `App.data.dashboard`:
```javascript
function cargarDashboard() {
  var view = document.getElementById('view-dashboard');
  view.classList.add('is-loading');
  var alertsBody = document.getElementById('alerts-body');
  mostrarLoader(alertsBody);

  var promise;
  if (App.data.dashboard) {
    promise = Promise.resolve(App.data.dashboard);
  } else {
    promise = App.api.getDashboard();
  }

  promise.then(function (data) {
    if (!App.data.dashboard) App.data.dashboard = data;
    // ... resto igual ...
```
NO cambiar la estructura de then/catch, solo añadir el cache check al inicio.

Hacer lo mismo con `cargarCartera()` (línea 971) usando `App.data.cartera`:
```javascript
function cargarCartera() {
  var view = document.getElementById('view-cartera');
  var tbody = document.querySelector('#view-cartera .data-table tbody');
  mostrarLoader(tbody);
  var filtroTipo = document.getElementById('filter-tipo').value || null;
  var filtroEstado = document.getElementById('filter-estado').value || null;

  var promise;
  if (App.data.cartera && !filtroTipo && !filtroEstado) {
    promise = Promise.resolve(App.data.cartera);
  } else {
    promise = App.api.getCartera(filtroEstado, filtroTipo);
  }
  // ... el resto del then/catch igual ...
```

## TAREA 3: ACCESIBILIDAD

### 3.1 Foco visible en todos los interactivos
Agregar al CSS (después de la línea 286, antes de `</style>`):
```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button:focus-visible, input:focus-visible, select:focus-visible, .nav-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

### 3.2 Landmarks ARIA
- En `<aside id="sidebar">` agregar `role="navigation" aria-label="Menú principal"`
- En `<main id="app">` agregar `role="main"`
- En `<nav class="sidebar-nav">` agregar `aria-label="Secciones"`
- En `<div class="modal-overlay" id="modal-tercero">` agregar `role="dialog" aria-modal="true" aria-label="Nuevo tercero"`

### 3.3 Skip-to-content link
Agregar al inicio del `<body>` (después de línea 398):
```html
<a href="#main" class="skip-link" style="position:absolute;top:-1000px;left:8px;z-index:9999;background:var(--bg-1);color:var(--accent);padding:8px 16px;border:1px solid var(--accent-border);font-size:11px;">Saltar al contenido</a>
```

Y en CSS agregar:
```css
.skip-link:focus { top: 8px; }
```

### 3.4 Focus trap en modal
En `abrirModalTercero()` (línea 1134), después de `classList.add('active')`, agregar:
```javascript
setTimeout(function(){ document.getElementById('tercero-nombre').focus(); }, 100);
```

Agregar evento keydown para cerrar con Escape. En la función `cerrarModalTercero`, está bien. Agregar en el event listener del DOMContentLoaded (después de línea 1407):
```javascript
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var modal = document.getElementById('modal-tercero');
    if (modal.classList.contains('active')) cerrarModalTercero();
  }
});
```

### 3.5 aria-live para contenido dinámico
- En `<div id="alerts-body">` agregar `aria-live="polite"`
- En `<div id="ia-results">` agregar `aria-live="polite"`
- En `<div id="abono-error">` agregar `aria-live="assertive"`
- En `<div id="venta-error">` agregar `aria-live="assertive"`

### 3.6 prefers-reduced-motion
Agregar al CSS:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  .nav-item { transition: none; }
  .view.is-loading::before { animation: none; }
}
```

### 3.7 Botón "···" con aria-label
En línea 1118, cambiar:
```html
'<td><button class="btn btn-sm" style="font-size:8px">···</button></td>'
```
por:
```html
'<td><button class="btn btn-sm" style="font-size:8px" aria-label="Opciones de ' + escapeHtml(item.nombre || '') + '">···</button></td>'
```

## TAREA 4: CALIDAD DE CÓDIGO JS

### 4.1 Unificar los dos script tags
El archivo tiene `<script>` en línea 742 y otro en línea 822. Juntar TODO el JS en un SOLO script. Mover todo el contenido del segundo script (desde `function escapeHtml` hasta el final) DENTRO del primer script, y eliminar el segundo tag.

### 4.2 Agregar 'use strict'
Al inicio del script unificado, agregar `'use strict';`

### 4.3 Pasar productosCache al namespace App
En línea 1192, cambiar:
```javascript
var productosCache = [];
```
por:
```javascript
App.productosCache = [];
```

Y reemplazar TODAS las referencias a `productosCache` por `App.productosCache` en el resto del archivo.

### 4.4 Cambiar inline onchange por event listener
En líneas 526 y 531, QUITAR `onchange="cargarCartera()"`. En su lugar, en el `DOMContentLoaded`, agregar:
```javascript
document.getElementById('filter-tipo').addEventListener('change', cargarCartera);
document.getElementById('filter-estado').addEventListener('change', cargarCartera);
```

### 4.5 Refactor showError para no auto-ocultarse
En la función `showError()` (línea 829-834), eliminar completamente la línea `setTimeout(function () { banner.classList.remove('show'); }, 6000);`.

### 4.6 IA con barra de progreso
En `analizarConGeminiFresco()` (línea 933-968), después de ocultar results, agregar:
```javascript
var progressBar = document.getElementById('ia-progress');
var progressBarInner = document.getElementById('ia-progress-bar');
var progressText = document.getElementById('ia-progress-text');
progressBar.style.display = 'block';
progressBarInner.style.width = '30%';
progressText.textContent = 'Consultando Gemini 2.5 Flash...';

// A 2 segundos
var progTimer = setTimeout(function(){ progressBarInner.style.width = '60%'; progressText.textContent = 'Procesando análisis financiero...'; }, 2000);
// A 5 segundos
var progTimer2 = setTimeout(function(){ progressBarInner.style.width = '85%'; progressText.textContent = 'Generando recomendaciones...'; }, 5000);
```

En el `.then()`:
```javascript
clearTimeout(progTimer); clearTimeout(progTimer2);
progressBarInner.style.width = '100%';
setTimeout(function(){ progressBar.style.display = 'none'; }, 500);
```

En el `.catch()`:
```javascript
clearTimeout(progTimer); clearTimeout(progTimer2);
progressBar.style.display = 'none';
```

## TAREA 5: SEGURIDAD

### 5.1 Content-Security-Policy
Agregar en el `<head>` después del viewport meta tag:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://ssl.gstatic.com; frame-src 'self' https://*.google.com;">
```

## TAREA 6: RENDIMIENTO

### 6.1 Font preload con display=swap
En la línea 5-6, cambiar:
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Libre+Baskerville:ital,wght@0,700;1,400&display=swap" rel="stylesheet">
```
Agregar `display=swap` a la URL. Ya está presente, pero asegurarse de que esté.

También agregar ANTES de esa línea:
```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

### 6.2 Cachear referencias DOM en lugar de querySelector repetido
NO es necesario refactorizar todo. Solo donde sea obvio: en `cargarCartera()`, cachear `document.getElementById('filter-tipo')` y `document.getElementById('filter-estado')` al inicio.

## ENTREGA

Al terminar, muestra el diff completo de todos los cambios realizados vs el original, organizado por sección (HTML, CSS, JS).

NO expliques cada cambio. Solo entrega el diff y confirma que cada tarea está completada.

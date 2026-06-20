#!/usr/bin/env python
"""
Adaptador API para frontend - Equivalente a callServer con google.script.run
Este archivo reemplaza las llamadas a Apps Script con fetch() a la API REST de Django
"""

# api_adapter.js - Versión Django
API_ADAPTER_DJANGO = `
// --- DJANGO API ADAPTER ---
// Reemplaza google.script.run con fetch() a Django REST API

const API_BASE = '/api/';
const API_TIMEOUT = 30000;

function callServer(funcName) {
  var args = Array.prototype.slice.call(arguments, 1);
  
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      var errorMsg = 'El servidor tardó demasiado en responder para la operación: ' + funcName;
      showError(errorMsg);
      reject(new Error(errorMsg));
    }, API_TIMEOUT);

    // Mapear nombres de funciones Apps Script a endpoints Django REST
    var endpointMap = {
      'getDashboardCartera': 'dashboard/',
      'getCartera': 'cartera/',
      'getTerceros': 'terceros/',
      'registrarAbono': 'abono/registrar/',
      'saveTercero': 'tercero/save/',
      'getProductos': 'productos/',
      'procesarVenta': 'venta/procesar/'
    };

    var endpoint = endpointMap[funcName];
    if (!endpoint) {
      reject(new Error('Endpoint no encontrado para: ' + funcName));
      return;
    }

    // Construir URL con query params
    var url = API_BASE + endpoint;
    var options = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken')
      }
    };

    // Manejar parámetros según función
    if (funcName === 'getCartera' && args.length > 0) {
      var params = new URLSearchParams();
      if (args[0]) params.append('tipo', args[0]);
      if (args[1]) params.append('estado', args[1]);
      url += '?' + params.toString();
    }

    if (funcName === 'registrarAbono' || funcName === 'saveTercero') {
      options.method = 'POST';
      options.body = JSON.stringify(args[0] || {});
    }

    fetch(url, options)
      .then(function (response) {
        clearTimeout(timer);
        return response.json();
      })
      .then(function (data) {
        resolve(data);
      })
      .catch(function (error) {
        clearTimeout(timer);
        reject(error.message || error);
      });
  });
}

function getCookie(name) {
  var cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
      var cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === (name + '=')) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}
`;

# --- Frontend adaptado ---
FRONTEND_TEMPLATE = """
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MicroERP · Django Backend</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Libre+Baskerville:ital,wght@0,700;1,400&family=Sora:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #F7F5F0; --bg-1: #EFECE5; --bg-2: #E8E4DC; --accent: #D4A82A;
  --red: #CC3333; --green: #3DA35D; --text: #1A1814; --muted: rgba(60,55,50,0.72);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Sora', sans-serif; background: var(--bg); color: var(--text); }
.container { max-width: 900px; margin: 0 auto; padding: 20px; }
.btn { padding: 8px 16px; border: 1px solid #ddd; background: var(--accent); color: white; cursor: pointer; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { padding: 12px; border-bottom: 1px solid #ddd; text-align: left; }
.error { color: var(--red); padding: 10px; background: #fee; margin: 10px 0; display: none; }
.error.show { display: block; }
</style>
</head>
<body>
<div class="container">
  <h1>MicroERP · Cartera Pro (Django)</h1>
  
  <div id="error-banner" class="error"></div>
  
  <!-- Dashboard -->
  <section id="dashboard-section">
    <h2>Dashboard</h2>
    <div id="dashboard-stats">
      <p>Cargando...</p>
    </div>
    <button class="btn" onclick="cargarDashboard()">Actualizar</button>
  </section>

  <!-- Terceros -->
  <section id="terceros-section" style="margin-top: 30px;">
    <h2>Terceros</h2>
    <table class="table" id="terceros-table">
      <thead><tr><th>ID</th><th>Nombre</th><th>Tipo</th><th>Límite</th></tr></thead>
      <tbody><tr><td colspan="4">Cargando...</td></tr></tbody>
    </table>
    <button class="btn" onclick="cargarTerceros()">Cargar Terceros</button>
  </section>

  <!-- Cartera -->
  <section id="cartera-section" style="margin-top: 30px;">
    <h2>Cartera</h2>
    <table class="table" id="cartera-table">
      <thead><tr><th>Fecha</th><th>Tercero</th><th>Saldo</th><th>Estado</th></tr></thead>
      <tbody><tr><td colspan="4">Cargando...</td></tr></tbody>
    </table>
    <button class="btn" onclick="cargarCartera()">Cargar Cartera</button>
  </section>

  <!-- Registrar Abono -->
  <section id="abono-section" style="margin-top: 30px;">
    <h2>Registrar Pago</h2>
    <div>
      <label>Tercero: <select id="abono-cliente"><option value="">Seleccione...</option></select></label><br><br>
      <label>Monto: <input type="number" id="abono-monto" min="1"></label><br><br>
      <button class="btn" onclick="registrarAbono()">Ejecutar Abono</button>
    </div>
    <div id="abono-result" style="margin-top: 10px;"></div>
  </section>
</div>

<script>
// --- COPIADO DEL FRONTEND ORIGINAL (adaptado) ---
'use strict';

// API Base URL - Django
const API_BASE = '/api/';

function showError(msg) {
  var banner = document.getElementById('error-banner');
  banner.textContent = msg;
  banner.classList.add('show');
  setTimeout(function() { banner.classList.remove('show'); }, 5000);
}

function showToast(msg, type) {
  console.log((type || 'info') + ': ' + msg);
  alert((type || 'Info') + ': ' + msg);
}

App = {
  api: {
    getDashboard: function() { return fetch(API_BASE + 'dashboard/').then(r => r.json()); },
    getCartera: function() { return fetch(API_BASE + 'cartera/').then(r => r.json()); },
    getTerceros: function() { return fetch(API_BASE + 'terceros/').then(r => r.json()); },
    registrarAbono: function(data) { 
      return fetch(API_BASE + 'abono/registrar/', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
      }).then(r => r.json());
    }
  },
  
  formatearMoneda: function(centavos) {
    if (centavos == null || isNaN(centavos)) return '$0';
    return (centavos / 100).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  }
};

function cargarDashboard() {
  App.api.getDashboard()
    .then(function(data) {
      var html = '<p>Por Cobrar: ' + App.formatearMoneda(data.porCobrar) + '</p>';
      html += '<p>Por Pagar: ' + App.formatearMoneda(data.porPagar) + '</p>';
      html += '<p>Vencido CxC: ' + App.formatearMoneda(data.vencidaCxC) + '</p>';
      document.getElementById('dashboard-stats').innerHTML = html;
    })
    .catch(function(err) { showError(err.message); });
}

function cargarTerceros() {
  App.api.getTerceros()
    .then(function(data) {
      var tbody = document.querySelector('#terceros-table tbody');
      tbody.innerHTML = '';
      (data || []).forEach(function(t) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + t.id + '</td><td>' + t.nombre + '</td><td>' + t.tipo + '</td><td>' + App.formatearMoneda(t.limite_credito) + '</td>';
        tbody.appendChild(tr);
      });
      // Populate dropdown
      var select = document.getElementById('abono-cliente');
      select.innerHTML = '<option value="">Seleccione...</option>';
      (data || []).forEach(function(t) {
        var opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.nombre;
        select.appendChild(opt);
      });
    })
    .catch(function(err) { showError(err.message); });
}

function cargarCartera() {
  App.api.getCartera()
    .then(function(res) {
      var tbody = document.querySelector('#cartera-table tbody');
      tbody.innerHTML = '';
      (res.items || []).forEach(function(c) {
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + c.fecha + '</td><td>' + c.nombre_tercero + '</td><td>' + App.formatearMoneda(c.saldo) + '</td><td>' + c.estado + '</td>';
        tbody.appendChild(tr);
      });
    })
    .catch(function(err) { showError(err.message); });
}

function registrarAbono() {
  var cliente = document.getElementById('abono-cliente').value;
  var monto = document.getElementById('abono-monto').value;
  
  if (!cliente || !monto) {
    showError('Complete todos los campos');
    return;
  }
  
  App.api.registrarAbono({
    id_tercero: cliente,
    valor: parseInt(monto),
    tipo: 'CxC'
  })
  .then(function(res) {
    document.getElementById('abono-result').innerHTML = '<p>' + JSON.stringify(res) + '</p>';
  })
  .catch(function(err) { showError(err.message); });
}

// Load on startup
document.addEventListener('DOMContentLoaded', function() {
  cargarDashboard();
  cargarTerceros();
  cargarCartera();
});
</script>
</body>
</html>
"""


if __name__ == '__main__':
    # Guardar como template Django
    import os
    template_path = os.path.join(os.path.dirname(__file__), '..', 'templates', 'index.html')
    with open(template_path, 'w') as f:
        f.write(FRONTEND_TEMPLATE)
    print(f"Template guardado en: {template_path}")
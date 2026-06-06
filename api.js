/**
 * api.js — Frontend communication layer for Google Apps Script backend.
 * Centralizes all google.script.run calls, data transformations, and UI state.
 */

var App = App || {};

// ── Promise wrapper for google.script.run ──

function callServer(funcName, ...args) {
  return new Promise(function (resolve, reject) {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(function (error) { reject(error.message || error); })
      [funcName](...args);
  });
}

// ── API functions ──

App.api = {
  getDashboard: function () {
    return callServer('getDashboardCartera');
  },

  getCartera: function (filtroEstado, filtroTipo) {
    return callServer('getCartera', filtroEstado, filtroTipo);
  },

  getTerceros: function (filtroTipo) {
    return callServer('getTerceros', filtroTipo);
  },

  registrarAbono: function (idTercero, valorAbono, referencia, tipo) {
    return callServer('registrarAbono', idTercero, valorAbono, referencia, tipo);
  },

  saveTercero: function (tercero) {
    return callServer('saveTercero', tercero);
  },

  analizarConGeminiFresco: function () {
    return callServer('analizarConGeminiFresco');
  },

  getAuditHistory: function (tabla, idRegistro, limit) {
    return callServer('getAuditHistory', tabla, idRegistro, limit);
  },
};

// ── Data transformations ──

App.formatearMoneda = function (centavos) {
  if (centavos == null || isNaN(centavos)) return '$0';
  return (centavos / 100).toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
};

App.formatearFecha = function (dateObj) {
  if (!dateObj) return '—';
  var d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (isNaN(d.getTime())) return '—';
  var meses = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
  return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
};

App.mapearEstadoCartera = function (estado) {
  var map = {
    VENCIDA: { label: 'Vencida', cls: 'badge-venc' },
    ABIERTA: { label: 'Abierta', cls: 'badge-open' },
    PARCIAL: { label: 'Parcial', cls: 'badge-open' },
    CANCELADA: { label: 'Cancelada', cls: 'badge-done' },
  };
  return map[estado] || { label: estado || '—', cls: 'badge-done' };
};

App.mapearTipoTercero = function (tipo) {
  var map = {
    CLIENTE: { label: 'Cliente', cls: 'badge-open' },
    PROVEEDOR: { label: 'Proveedor', cls: '' },
    AMBOS: { label: 'Ambos', cls: 'badge-open' },
  };
  return map[tipo] || { label: tipo || '—', cls: 'badge-done' };
};

// ── UI State Cache ──

App.data = {
  dashboard: null,
  cartera: null,
  terceros: null,

  refreshDashboard: function () {
    var self = this;
    return App.api.getDashboard().then(function (data) {
      self.dashboard = data;
      return data;
    });
  },

  refreshCartera: function (filtroEstado, filtroTipo) {
    var self = this;
    return App.api.getCartera(filtroEstado, filtroTipo).then(function (data) {
      self.cartera = data;
      return data;
    });
  },

  refreshTerceros: function (filtroTipo) {
    var self = this;
    return App.api.getTerceros(filtroTipo).then(function (data) {
      self.terceros = data;
      return data;
    });
  },
};

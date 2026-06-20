#!/usr/bin/env python
"""Admin registration - Equivalente a tu configuración en Sheets"""

from django.contrib import admin
from .models import Tercero, Cartera, Movimiento, AuditLog, Producto


@admin.register(Tercero)
class TerceroAdmin(admin.ModelAdmin):
    list_display = ['id', 'nombre', 'tipo', 'telefono', 'limite_credito_formatted', 'activo']
    list_filter = ['tipo', 'activo']
    search_fields = ['id', 'nombre']
    
    def limite_credito_formatted(self, obj):
        return f"${obj.limite_credito / 100:,.0f}"
    limite_credito_formatted.short_description = 'Límite Crédito'


@admin.register(Cartera)
class CarteraAdmin(admin.ModelAdmin):
    list_display = ['id', 'id_tercero', 'tipo', 'total_formatted', 'saldo_formatted', 'estado', 'fecha_vencimiento']
    list_filter = ['tipo', 'estado']
    search_fields = ['id', 'id_tercero__id', 'id_tercero__nombre']
    date_hierarchy = 'fecha_vencimiento'
    
    def total_formatted(self, obj):
        return f"${obj.total / 100:,.0f}"
    total_formatted.short_description = 'Total'
    
    def saldo_formatted(self, obj):
        return f"${obj.saldo / 100:,.0f}"
    saldo_formatted.short_description = 'Saldo'


@admin.register(Movimiento)
class MovimientoAdmin(admin.ModelAdmin):
    list_display = ['id', 'fecha', 'tipo_mov', 'valor_formatted', 'id_tercero']
    list_filter = ['tipo_mov', 'fecha']
    search_fields = ['id', 'id_cartera__id']


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ['timestamp', 'operacion', 'tabla', 'usuario', 'estado']
    list_filter = ['operacion', 'tabla', 'estado', 'timestamp']
    readonly_fields = ['timestamp', 'operacion', 'tabla', 'id_registro', 'usuario', 'datos_previos', 'datos_nuevos', 'estado']


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = ['id', 'nombre', 'stock', 'precio_formatted']
    search_fields = ['id', 'nombre']
    
    def precio_formatted(self, obj):
        return f"${obj.precio / 100:,.0f}"
    precio_formatted.short_description = 'Precio'
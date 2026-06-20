#!/usr/bin/env python
"""Models equivalentes a tu sistema Apps Script - MicroERP Cartera Pro"""

from django.db import models
from django.utils import timezone


class Tercero(models.Model):
    """Equivalente a hoja Terceros de Google Sheets"""
    
    id = models.CharField(max_length=20, primary_key=True, help_text="ID único (ej: CL-001)")
    nombre = models.CharField(max_length=100)
    telefono = models.CharField(max_length=20, blank=True, null=True)
    tipo = models.CharField(
        max_length=10,
        choices=[('CLIENTE', 'Cliente'), ('PROVEEDOR', 'Proveedor')],
        default='CLIENTE'
    )
    limite_credito = models.BigIntegerField(default=0, help_text="En centavos (ej: 5000000 = $50.000)")
    activo = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'terceros'
        verbose_name = 'Tercero'
        verbose_name_plural = 'Terceros'

    def __str__(self):
        return f"{self.id} - {self.nombre}"


class Cartera(models.Model):
    """Equivalente a hoja Cartera de Google Sheets"""
    
    ESTADOS = [
        ('ABIERTA', 'Abierta'),
        ('PARCIAL', 'Parcial'),
        ('CANCELADA', 'Cancelada'),
        ('VENCIDA', 'Vencida'),
    ]
    
    TIPOS = [
        ('CxC', 'Cuenta por Cobrar'),
        ('CxP', 'Cuenta por Pagar'),
    ]
    
    id = models.CharField(max_length=30, primary_key=True)
    fecha = models.DateField(default=timezone.now)
    id_tercero = models.ForeignKey(Tercero, on_delete=models.CASCADE, related_name='cartera_items')
    origen_id = models.CharField(max_length=50, blank=True, null=True)
    total = models.BigIntegerField(help_text="En centavos")
    saldo = models.BigIntegerField(help_text="En centavos")
    tipo = models.CharField(max_length=3, choices=TIPOS)
    estado = models.CharField(max_length=10, choices=ESTADOS, default='ABIERTA')
    fecha_vencimiento = models.DateField()
    vencida_timestamp = models.DateTimeField(blank=True, null=True)
    version = models.IntegerField(default=1, help_text="Para optimistic locking")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cartera'
        indexes = [
            models.Index(fields=['id_tercero']),
            models.Index(fields=['estado']),
            models.Index(fields=['tipo']),
            models.Index(fields=['fecha_vencimiento']),
        ]
        verbose_name = 'Cartera'
        verbose_name_plural = 'Cartera'

    def __str__(self):
        return f"{self.id} - {self.id_tercero.id} - {_format_moneda(self.saldo)}"


class Movimiento(models.Model):
    """Equivalente a hoja Movimientos_Cartera de Google Sheets"""
    
    TIPOS_MOV = [
        ('ABONO', 'Abono'),
        ('CANCELACION', 'Cancelación'),
    ]
    
    id = models.CharField(max_length=30, primary_key=True)
    fecha = models.DateField(default=timezone.now)
    id_cartera = models.ForeignKey(Cartera, on_delete=models.CASCADE, related_name='movimientos')
    id_tercero = models.CharField(max_length=20, help_text="Referencia al tercero")
    valor = models.BigIntegerField(help_text="En centavos")
    tipo_mov = models.CharField(max_length=12, choices=TIPOS_MOV)
    referencia = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'movimientos_cartera'
        verbose_name = 'Movimiento'
        verbose_name_plural = 'Movimientos'

    def __str__(self):
        return f"{self.id} - {self.tipo_mov} - {_format_moneda(self.valor)}"


class AuditLog(models.Model):
    """Equivalente a hoja AUDIT_LOG de Google Sheets"""
    
    id = models.CharField(max_length=30, primary_key=True)
    timestamp = models.DateTimeField(default=timezone.now)
    operacion = models.CharField(max_length=50)
    tabla = models.CharField(max_length=50)
    id_registro = models.CharField(max_length=50)
    usuario = models.EmailField()
    datos_previos = models.JSONField(default=dict)
    datos_nuevos = models.JSONField(default=dict)
    estado = models.CharField(max_length=20, default='SUCCESS')

    class Meta:
        db_table = 'audit_log'
        ordering = ['-timestamp']
        verbose_name = 'Log de Auditoría'
        verbose_name_plural = 'Logs de Auditoría'


class Producto(models.Model):
    """Equivalente a hoja Productos de Google Sheets"""
    
    id = models.CharField(max_length=30, primary_key=True)
    nombre = models.CharField(max_length=100)
    stock = models.IntegerField(default=0)
    precio = models.BigIntegerField(help_text="En centavos")
    version = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'productos'
        verbose_name = 'Producto'
        verbose_name_plural = 'Productos'

    def __str__(self):
        return f"{self.id} - {self.nombre}"


class Venta(models.Model):
    """Equivalente a lógica de ventas en Servicios.gs"""
    
    TIPOS_VENTA = [
        ('CONTADO', 'Contado'),
        ('CxC', 'Crédito'),
    ]
    
    id = models.CharField(max_length=30, primary_key=True)
    fecha = models.DateField(default=timezone.now)
    tipo = models.CharField(max_length=6, choices=TIPOS_VENTA, default='CONTADO')
    id_tercero = models.ForeignKey(Tercero, on_delete=models.SET_NULL, blank=True, null=True, related_name='ventas')
    total = models.BigIntegerField(help_text="En centavos")
    referencia = models.CharField(max_length=100, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'ventas'
        verbose_name = 'Venta'
        verbose_name_plural = 'Ventas'
    
    def __str__(self):
        return f"{self.id} - {self.tipo} - {_format_moneda(self.total)}"


class ItemVenta(models.Model):
    """Items de venta - equivalente al carrito en Servicios.gs"""
    
    id_venta = models.ForeignKey(Venta, on_delete=models.CASCADE, related_name='items')
    id_producto = models.ForeignKey(Producto, on_delete=models.CASCADE)
    cantidad = models.IntegerField()
    precio_unitario = models.BigIntegerField(help_text="En centavos")
    subtotal = models.BigIntegerField(help_text="En centavos")
    
    class Meta:
        db_table = 'items_venta'
        verbose_name = 'Item de Venta'
        verbose_name_plural = 'Items de Venta'
    
    def __str__(self):
        return f"{self.id_venta.id} - {self.id_producto.nombre} x {self.cantidad}"


class LoteInventario(models.Model):
    """Lotes de inventario para trazabilidad - optional enhancement"""
    
    id_producto = models.ForeignKey(Producto, on_delete=models.CASCADE, related_name='lotes')
    numero_lote = models.CharField(max_length=50)
    cantidad = models.IntegerField()
    fecha_entrada = models.DateField(default=timezone.now)
    
    class Meta:
        db_table = 'lotes_inventario'


def _format_moneda(centavos):
    """Formatea centavos a moneda COP (equivalente a _formatMoneda en Apps Script)"""
    return f"${centavos / 100:,.0f} COP"
#!/usr/bin/env python
"""Django REST Framework serializers - Equivalente a tu API.gs"""

from rest_framework import serializers
from .models import Tercero, Cartera, Movimiento, AuditLog, Producto


class TerceroSerializer(serializers.ModelSerializer):
    limite_credito_formatted = serializers.SerializerMethodField()
    
    class Meta:
        model = Tercero
        fields = ['id', 'nombre', 'telefono', 'tipo', 'limite_credito', 'limite_credito_formatted', 'activo']
    
    def get_limite_credito_formatted(self, obj):
        return f"${obj.limite_credito / 100:,.0f}"


class CarteraSerializer(serializers.ModelSerializer):
    nombre_tercero = serializers.CharField(source='id_tercero.nombre', read_only=True)
    total_formatted = serializers.SerializerMethodField()
    saldo_formatted = serializers.SerializerMethodField()
    
    class Meta:
        model = Cartera
        fields = ['id', 'fecha', 'id_tercero', 'origen_id', 'total', 'total_formatted', 
                  'saldo', 'saldo_formatted', 'tipo', 'estado', 'fecha_vencimiento', 'dias_vencido']
    
    def get_total_formatted(self, obj):
        return f"${obj.total / 100:,.0f}"
    
    def get_saldo_formatted(self, obj):
        return f"${obj.saldo / 100:,.0f}"


class MovimientoSerializer(serializers.ModelSerializer):
    valor_formatted = serializers.SerializerMethodField()
    
    class Meta:
        model = Movimiento
        fields = ['id', 'fecha', 'id_cartera', 'id_tercero', 'valor', 'valor_formatted', 'tipo_mov', 'referencia']
    
    def get_valor_formatted(self, obj):
        return f"${obj.valor / 100:,.0f}"


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = ['id', 'timestamp', 'operacion', 'tabla', 'id_registro', 'usuario', 'estado']


class ProductoSerializer(serializers.ModelSerializer):
    precio_formatted = serializers.SerializerMethodField()
    
    class Meta:
        model = Producto
        fields = ['id', 'nombre', 'stock', 'precio', 'precio_formatted']
    
    def get_precio_formatted(self, obj):
        return f"${obj.precio / 100:,.0f}"


# Serializers for write operations
class RegistrarAbonoSerializer(serializers.Serializer):
    id_tercero = serializers.CharField(max_length=20)
    valor = serializers.IntegerField(min_value=1)
    referencia = serializers.CharField(max_length=100, required=False, default='Abono')
    tipo = serializers.ChoiceField(choices=['CxC', 'CxP'], required=False, default='CxC')


class GuardarTerceroSerializer(serializers.Serializer):
    id = serializers.CharField(max_length=20, required=False)
    nombre = serializers.CharField(max_length=100)
    telefono = serializers.CharField(max_length=20, required=False, allow_blank=True)
    tipo = serializers.ChoiceField(choices=['CLIENTE', 'PROVEEDOR', 'AMBOS'])
    limite_credito = serializers.IntegerField(min_value=0, required=False, default=0)
    activo = serializers.BooleanField(required=False, default=True)
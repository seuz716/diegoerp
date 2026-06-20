#!/usr/bin/env python
"""Django REST Framework views - Equivalente a API.gs y Domain.gs"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db import transaction, models
from django.utils import timezone
from django.shortcuts import render
from .models import Tercero, Cartera, Movimiento, Producto
from .serializers import (
    TerceroSerializer, CarteraSerializer, MovimientoSerializer,
    RegistrarAbonoSerializer, GuardarTerceroSerializer
)


def _safe_date(fecha_str):
    """Equivalente a _safeDate en Apps Script"""
    if not fecha_str:
        return None
    try:
        if isinstance(fecha_str, str):
            # Handle dd/mm/yyyy format
            if '/' in fecha_str:
                parts = fecha_str.split('/')
                return timezone.datetime(int(parts[2]), int(parts[1]), int(parts[0])).date()
        return timezone.datetime.strptime(str(fecha_str), '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def _get_user_email(request):
    """Equivalente a Session.getActiveUser().getEmail()"""
    if request.user.is_authenticated:
        return request.user.email
    return None


def _check_permission(user, permiso):
    """Equivalente a AuthService.checkPermission"""
    # Roles simplificado - puedes expandir con Django Groups
    permisos_roles = {
        'ver_terceros': ['admin', 'operador', 'viewer'],
        'ver_cartera': ['admin', 'operador', 'viewer'],
        'ver_dashboard': ['admin', 'operador', 'viewer'],
        'registrar_abono': ['admin', 'operador'],
        'guardar_tercero': ['admin', 'operador'],
        'revisar_inventario': ['admin', 'operador'],
    }
    # Implementación básica - mejorar con Django Groups
    return True


# Vista principal del frontend (equivalente a Main.doGet)
def index(request):
    """Equivalente a Main.doGet() - Sirve el frontend HTML"""
    return render(request, 'index.html')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_terceros(request, tipo=None):
    """Equivalente a API.getTerceros()"""
    try:
        queryset = Tercero.objects.filter(activo=True)
        if tipo:
            queryset = queryset.filter(tipo=tipo.upper())
        serializer = TerceroSerializer(queryset, many=True)
        return Response(serializer.data)
    except Exception as e:
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_cartera(request, tipo=None, estado=None):
    """Equivalente a API.getCartera()"""
    try:
        queryset = Cartera.objects.all()
        if tipo:
            queryset = queryset.filter(tipo=tipo.upper())
        if estado:
            queryset = queryset.filter(estado=estado.upper())
        serializer = CarteraSerializer(queryset.select_related('id_tercero'), many=True)
        return Response({
            'items': serializer.data,
            'nextPageToken': None
        })
    except Exception as e:
        return Response({'items': [], 'error': str(e)}, status=500)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def save_tercero(request):
    """Equivalente a API.saveTercero() y DOMAIN.saveTercero()"""
    serializer = GuardarTerceroSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({'success': False, 'error': serializer.errors}, status=400)
    
    data = serializer.validated_data
    
    try:
        tercero, created = Tercero.objects.update_or_create(
            id=data.get('id') or Tercero.objects.model().id,
            defaults={
                'nombre': data['nombre'],
                'telefono': data.get('telefono', ''),
                'tipo': data['tipo'],
                'limite_credito': data.get('limite_credito', 0),
                'activo': data.get('activo', True),
            }
        )
        return Response({'success': True, 'id': tercero.id})
    except Exception as e:
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def registrar_abono(request):
    """Equivalente a API.registrarAbono() y DOMAIN.registrarAbonoAtomic()"""
    serializer = RegistrarAbonoSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({'success': False, 'error': serializer.errors}, status=400)
    
    data = serializer.validated_data
    id_tercero = data['id_tercero'].upper()
    valor = data['valor']
    tipo = data.get('tipo', 'CxC')
    referencia = data.get('referencia', 'Abono')
    
    try:
        with transaction.atomic():
            tercero = Tercero.objects.get(id=id_tercero)
            
            # Obtener cartera pendiente (equivalente a getCarteraByTerceroAndTipo)
            pendientes = Cartera.objects.filter(
                id_tercero=id_tercero,
                tipo=tipo,
                estado__in=['ABIERTA', 'PARCIAL']
            ).order_by('fecha')
            
            if not pendientes.exists():
                return Response({'success': False, 'error': 'No hay cartera pendiente'}, status=400)
            
            total_deuda = sum(c.saldo for c in pendientes)
            if valor > total_deuda:
                return Response({'success': False, 'error': f'Abono supera deuda total'}, status=400)
            
            # Aplicar abono (equivalente a _buildAbonoPlan)
            restante = valor
            movimientos_creados = 0
            
            for cartera_item in pendientes:
                if restante <= 0:
                    break
                
                aplicado = min(restante, cartera_item.saldo)
                nuevo_saldo = cartera_item.saldo - aplicado
                nuevo_estado = 'CANCELADA' if nuevo_saldo <= 0 else 'PARCIAL'
                
                # Optimistic locking
                cartera_item.version = models.F('version') + 1
                Cartera.objects.filter(
                    id=cartera_item.id, 
                    version=cartera_item.version - 1
                ).update(
                    saldo=nuevo_saldo,
                    estado=nuevo_estado
                )
                
                # Crear movimiento
                Movimiento.objects.create(
                    id=f"MOV{timezone.now().timestamp():.0f}",
                    id_cartera=cartera_item,
                    id_tercero=id_tercero,
                    valor=aplicado,
                    tipo_mov='CANCELACION' if aplicado >= cartera_item.saldo else 'ABONO',
                    referencia=referencia
                )
                movimientos_creados += 1
                restante -= aplicado
            
            return Response({
                'success': True,
                'aplicado': valor - restante,
                'movimientos': movimientos_creados
            })
    except Tercero.DoesNotExist:
        return Response({'success': False, 'error': f'Tercero {id_tercero} no existe'}, status=404)
    except Exception as e:
        return Response({'success': False, 'error': str(e)}, status=500)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_dashboard(request):
    """Equivalente a API.getDashboardCartera()"""
    try:
        hoy = timezone.now().date()
        
        # Calcular estadísticas
        cxc_queryset = Cartera.objects.filter(tipo='CxC', estado__in=['ABIERTA', 'PARCIAL'])
        cxp_queryset = Cartera.objects.filter(tipo='CxP', estado__in=['ABIERTA', 'PARCIAL'])
        
        por_cobrar = sum(c.saldo for c in cxc_queryset)
        por_pagar = sum(c.saldo for c in cxp_queryset)
        
        # Vencidas (equivalente a lógica de vencimiento)
        vencidas = Cartera.objects.filter(
            fecha_vencimiento__lt=hoy,
            estado__in=['ABIERTA', 'PARCIAL']
        )
        
        vencida_cxc = sum(c.saldo for c in vencidas.filter(tipo='CxC'))
        vencida_cxp = sum(c.saldo for c in vencidas.filter(tipo='CxP'))
        
        # Alertas top 10 (equivalente a lógica de prioridad)
        alertas = []
        for c in vencidas.select_related('id_tercero')[:10]:
            alertas.append({
                'id_tercero': c.id_tercero.id,
                'nombre': c.id_tercero.nombre,
                'saldo': c.saldo,
                'dias': (hoy - c.fecha_vencimiento).days
            })
        
        return Response({
            'porCobrar': por_cobrar,
            'porPagar': por_pagar,
            'vencidaCxC': vencida_cxc,
            'vencidaCxP': vencida_cxp,
            'alertas': alertas,
            'totalObligaciones': cxc_queryset.count() + cxp_queryset.count()
        })
    except Exception as e:
        return Response({'error': str(e)}, status=500)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_productos(request):
    """Equivalente a API.getProductos()"""
    try:
        productos = Producto.objects.all()
        serializer = ProductoSerializer(productos, many=True)
        return Response(serializer.data)
    except Exception as e:
        return Response({'error': str(e)}, status=500)
#!/usr/bin/env python
"""URLs de la app cartera - Equivalente a endpoints públicos en API.gs"""

from django.urls import path
from . import views

urlpatterns = [
    path('terceros/', views.get_terceros, name='get_terceros'),
    path('terceros/<str:tipo>/', views.get_terceros, name='get_terceros_tipo'),
    path('cartera/', views.get_cartera, name='get_cartera'),
    path('cartera/tipo/<str:tipo>/', views.get_cartera, name='get_cartera_tipo'),
    path('cartera/estado/<str:estado>/', views.get_cartera, name='get_cartera_estado'),
    path('tercero/save/', views.save_tercero, name='save_tercero'),
    path('abono/registrar/', views.registrar_abono, name='registrar_abono'),
    path('dashboard/', views.get_dashboard, name='get_dashboard'),
    path('productos/', views.get_productos, name='get_productos'),
]

# Note: La vista index principal está en diegoerp/urls.py
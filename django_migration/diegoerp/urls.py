#!/usr/bin/env python
"""Django URL configuration"""

from django.contrib import admin
from django.urls import path, include
from cartera import views as cartera_views

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('cartera.urls')),  # API REST endpoints
    path('', cartera_views.index, name='home'),  # Frontend principal
]
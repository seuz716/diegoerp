#!/usr/bin/env python
"""Migrate data from Google Sheets to Supabase/Django"""

import os
import gspread
from google.oauth2.service_account import Credentials
from cartera.models import Tercero, Cartera, Movimiento

def migrate_sheets_to_django():
    """Script de migración - ejecutar una vez"""
    
    scope = [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.readonly'
    ]
    
    creds = Credentials.from_service_account_file(
        os.environ.get('GOOGLE_CREDS_PATH', 'creds.json'),
        scopes=scope
    )
    
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(os.environ.get('SPREADSHEET_ID'))
    
    # Migrar Terceros
    sheet_terceros = spreadsheet.worksheet('Terceros')
    records = sheet_terceros.get_all_records()
    
    for row in records:
        Tercero.objects.get_or_create(
            id=str(row.get('ID', '')).strip().upper(),
            defaults={
                'nombre': row.get('Nombre', ''),
                'telefono': row.get('Teléfono', ''),
                'tipo': row.get('Tipo', 'CLIENTE').upper(),
                'limite_credito': int(row.get('Límite_Crédito', 0)),
                'activo': row.get('Activo', 'ACTIVO').upper() == 'ACTIVO',
            }
        )
    
    # Migrar Cartera
    sheet_cartera = spreadsheet.worksheet('Cartera')
    records = sheet_cartera.get_all_records()
    
    for row in records:
        Cartera.objects.get_or_create(
            id=str(row.get('ID', '')).strip(),
            defaults={
                'id_tercero_id': str(row.get('ID_Tercero', '')).strip(),
                'origen_id': row.get('Origen_ID', ''),
                'total': int(row.get('Total', 0)),
                'saldo': int(row.get('Saldo', 0)),
                'tipo': row.get('Tipo', 'CxC'),
                'estado': row.get('Estado', 'ABIERTA').upper(),
                'fecha_vencimiento': row.get('Fecha_Vencimiento'),
                'version': int(row.get('Version', 1)),
            }
        )
    
    print("Migración completada")

if __name__ == '__main__':
    import django
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'diegoerp.settings')
    django.setup()
    migrate_sheets_to_django()
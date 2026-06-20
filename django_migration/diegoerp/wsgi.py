#!/usr/bin/env python
"""Django WSGI application"""

import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'diegoerp.settings')
application = get_wsgi_application()
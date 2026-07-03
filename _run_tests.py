#!/usr/bin/env python3
import json
from google_auth_oauthlib.flow import Flow

flow = Flow.from_client_secrets_file(
    '/home/cesar/.google_tool/credentials.json',
    scopes=[
        'https://www.googleapis.com/auth/script.external_request',
        'https://www.googleapis.com/auth/script.projects',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/script.webapp.deploy',
        'https://www.googleapis.com/auth/userinfo.email',
    ],
    redirect_uri='urn:ietf:wg:oauth:2.0:oob'
)

auth_url, _ = flow.authorization_url(
    access_type='offline',
    include_granted_scopes='true',
    prompt='consent'
)

print("=" * 70)
print("ABRE ESTA URL EN TU NAVEGADOR:")
print("=" * 70)
print(auth_url)
print("=" * 70)
print("\nDespués de autorizar, Google te mostrará un código.")
print("Copia ese código y pégalo a continuación.\n")

code = input("Authorization code: ").strip()

if code:
    flow.fetch_token(code=code)
    creds = flow.credentials
    print(f"\nToken obtenido. Scopes: {creds.scopes}")
    
    # Save clasp credentials
    client_id = flow.client_config['client_id']
    client_secret = flow.client_config['client_secret']
    clasp_token = {
        "token": {
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_type": "Bearer",
            "expiry_date": int(creds.expiry.timestamp() * 1000) if creds.expiry else 0,
        },
        "oauth2ClientSettings": {
            "clientId": client_id,
            "clientSecret": client_secret,
            "redirectUri": "urn:ietf:wg:oauth:2.0:oob"
        },
        "isLocalCreds": True
    }
    
    with open('/home/cesar/mis_proyectos/diegoerp/.clasprc.json', 'w') as f:
        json.dump(clasp_token, f, indent=2)
    print("Credenciales guardadas en .clasprc.json del proyecto.")
    
    # Call the Apps Script API
    from googleapiclient.discovery import build
    service = build('script', 'v1', credentials=creds)
    print("\nEjecutando runAllRegressionTests...")
    print("(Esto puede tomar varios minutos)\n")
    request = service.scripts().run(
        scriptId='1ANnjrHVIeGQo4UiNi198cr_S3KfdoJpxDk9FJgohUO_9a_OLAItGFSQy',
        body={'function': 'runAllRegressionTests', 'devMode': True}
    )
    response = request.execute()
    print("\n" + "=" * 70)
    print("RESULTADOS COMPLETOS:")
    print("=" * 70)
    print(json.dumps(response, indent=2, default=str))
else:
    print("No se ingresó código.")

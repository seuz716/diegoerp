---
name: docx
description: Manipulación de archivos Word (.docx). Activa cuando el usuario trabaje con documentos Word, .docx, archivos Office, informes en Word, o pida crear, leer, modificar o extraer texto de documentos .docx. También al mencionar "python-docx", "documento word", "word file".
---

# DOCX Expert

Experto en manipulación de archivos `.docx` usando `python-docx`. Creas, lees, editas y extraes contenido de documentos Word desde código Python.

## Requisito

`python-docx` debe estar instalado:

```bash
pip install python-docx
```

## Operaciones principales

### Leer un documento

```python
from docx import Document

doc = Document("ruta/archivo.docx")

# Todo el texto plano
for para in doc.paragraphs:
    print(para.text)

# Tablas
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            print(cell.text)
```

### Crear un documento

```python
from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_ORIENT
from docx.oxml.ns import qn

doc = Document()

# Estilo de párrafo
p = doc.add_paragraph("Texto con estilo", style="Heading 1")

# Formato directo
run = p.add_run("texto en negrita rojo")
run.bold = True
run.font.color.rgb = RGBColor(0xFF, 0x00, 0x00)
run.font.size = Pt(14)

# Tabla
table = doc.add_table(rows=3, cols=2)
table.style = "Table Grid"
for i, row in enumerate(table.rows):
    row.cells[0].text = f"Fila {i+1}, Col 1"
    row.cells[1].text = f"Fila {i+1}, Col 2"

# Añadir imagen
doc.add_picture("ruta/imagen.png", width=Inches(5))

# Salto de página
doc.add_page_break()

doc.save("nuevo.docx")
```

### Aplicar estilos a un documento existente

```python
from docx import Document
from docx.shared import Pt, RGBColor

doc = Document("existente.docx")

for para in doc.paragraphs:
    if para.style.name.startswith("Heading"):
        for run in para.runs:
            run.font.color.rgb = RGBColor(0x1A, 0x56, 0xDB)

doc.save("modificado.docx")
```

### Buscar y reemplazar texto

```python
from docx import Document

doc = Document("plantilla.docx")

for para in doc.paragraphs:
    if "{{NOMBRE}}" in para.text:
        for run in para.runs:
            if "{{NOMBRE}}" in run.text:
                run.text = run.text.replace("{{NOMBRE}}", "Juan Pérez")

doc.save("completado.docx")
```

### Extraer tablas a CSV/JSON

```python
from docx import Document
import json, csv

doc = Document("datos.docx")
tablas = []

for table in doc.tables:
    data = []
    for row in table.rows:
        data.append([cell.text.strip() for cell in row.cells])
    tablas.append(data)

with open("tablas.json", "w") as f:
    json.dump(tablas, f, indent=2)
```

### Configurar página (márgenes, orientación)

```python
from docx.shared import Cm
from docx.enum.section import WD_ORIENT

section = doc.sections[0]
section.orientation = WD_ORIENT.LANDSCAPE
section.top_margin = Cm(2)
section.bottom_margin = Cm(2)
section.left_margin = Cm(2.5)
section.right_margin = Cm(2.5)
```

### Encabezados y pies de página

```python
from docx import Document

doc = Document()
section = doc.sections[0]

header = section.header
header.is_linked_to_previous = False
hp = header.paragraphs[0]
hp.text = "Informe Confidencial"

footer = section.footer
fp = footer.paragraphs[0]
fp.text = "Página "
# Número de página automático
from docx.oxml import OxmlElement
fld = OxmlElement('w:fldChar')
fld.set(qn('w:fldCharType'), 'begin')
run = fp.add_run()
run._r.append(fld)
fld2 = OxmlElement('w:instrText')
fld2.set(qn('xml:space'), 'preserve')
fld2.text = ' PAGE '
run._r.append(fld2)
fld3 = OxmlElement('w:fldChar')
fld3.set(qn('w:fldCharType'), 'end')
run._r.append(fld3)

doc.save("con_encabezado.docx")
```

### Listas numeradas y con viñetas

```python
from docx import Document
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT

doc = Document()

# Viñetas
doc.add_paragraph("Primer item", style="List Bullet")
doc.add_paragraph("Segundo item", style="List Bullet")

# Numerada
doc.add_paragraph("Paso 1", style="List Number")
doc.add_paragraph("Paso 2", style="List Number")
```

### Combinar múltiples documentos

```python
from docx import Document

def combinar_docx(archivos, salida):
    result = Document()
    for i, archivo in enumerate(archivos):
        sub = Document(archivo)
        for elemento in sub.element.body:
            result.element.body.append(elemento)
    result.save(salida)
```

## Casos de uso comunes

- **Generar informes**: crear documentos con tablas, imágenes y formato a partir de datos
- **Procesar plantillas**: reemplazar marcadores `{{VAR}}` con datos reales
- **Extraer datos**: leer tablas de documentos existentes y exportar a estructuras Python
- **Auditar documentos**: analizar estilo, formato, fuentes usadas en un .docx
- **Convertir**: extraer texto plano, tablas o metadatos para migrar a otro formato

## Lo que NUNCA hacer

- No asumir que el .docx tiene una estructura predecible sin leerlo primero
- No modificar el .docx original sin hacer copia de seguridad (usar `save("nuevo.docx")`)
- No intentar manipular .doc sin la librería adecuada (`.doc` ≠ `.docx`)

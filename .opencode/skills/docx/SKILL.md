---
name: docx
description: Creación y manipulación de documentos profesionales. Activa cuando el usuario quiera crear, leer, modificar o diseñar documentos: informes, cartas, cotizaciones, reportes, actas, diplomas, tesis, papers académicos, o cualquier documento con formato. También al mencionar ".docx", "documento word", "python-docx", "generar pdf", "documento bonito", "informe profesional", "reporte", "carta formal", "word file", "weasyprint", "html a pdf", "normas apa", "apa 7", "en apa", "formato apa", "documento académico", "paper".
---

# Document Designer — Documentos profesionales

Experto en crear documentos con diseño profesional. Dos vías según la necesidad:

- **HTML + CSS → PDF** (vía WeasyPrint): para documentos visualmente ricos con control total del diseño
- **python-docx**: para archivos `.docx` editables en Word

---

## Requisitos

```bash
pip install python-docx weasyprint
```

Ambos ya instalados en este entorno.

---

# SECCIÓN A — Documentos bellos con HTML + CSS → PDF

Esta es la vía recomendada para documentos con diseño: portadas, cartas, informes, cotizaciones, reportes, diplomas. Diseñas en HTML/CSS (control total) y exportas a PDF.

## Generador base

```python
from weasyprint import HTML
import os

def generar_pdf(html: str, salida: str):
    HTML(string=html).write_pdf(salida)
    print(f"PDF creado: {salida}")
```

## Plantilla: Carta profesional con diseño editorial

```python
from weasyprint import HTML

css = """
@page {
  size: A4;
  margin: 2.5cm 2cm 2cm 2cm;
  @top-right { content: "Confidencial"; font-size: 8pt; color: #888; font-family: 'Georgia', serif; }
  @bottom-center { content: counter(page); font-size: 9pt; color: #999; }
}

body {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 11pt;
  line-height: 1.6;
  color: #2d2d2d;
}

.header {
  border-bottom: 3px solid #c9a84c;
  padding-bottom: 1.5cm;
  margin-bottom: 1.5cm;
}

.header .empresa {
  font-size: 24pt;
  font-weight: bold;
  color: #1a1a1a;
  letter-spacing: -0.5px;
}

.header .subtitulo {
  font-size: 9pt;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-top: 4px;
}

.fecha-ref {
  text-align: right;
  margin-bottom: 1cm;
  font-size: 10pt;
  color: #666;
}

.destinatario {
  margin-bottom: 1.5cm;
}

.destinatario .nombre { font-weight: bold; }
.destinatario .cargo { color: #666; }

.asunto {
  font-size: 14pt;
  font-weight: bold;
  color: #c9a84c;
  margin-bottom: 0.8cm;
  padding-bottom: 4px;
  border-bottom: 1px solid #e0d6c8;
}

.cuerpo { text-align: justify; }

.firma {
  margin-top: 2cm;
  padding-top: 0.5cm;
  border-top: 2px solid #c9a84c;
  width: 6cm;
}

.firma .nombre { font-weight: bold; }
.firma .cargo { font-size: 10pt; color: #888; }
"""

html_content = f"""
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="header">
  <div class="empresa">Nombre de la Empresa</div>
  <div class="subtitulo">División Corporativa</div>
</div>
<div class="fecha-ref">
  <div>Bogotá, 7 de junio de 2026</div>
  <div>Ref: COR-2026-042</div>
</div>
<div class="destinatario">
  <div class="nombre">Juan Pérez López</div>
  <div class="cargo">Director de Operaciones</div>
  <div>Cliente Corporativo S.A.</div>
  <div>Calle 123 #45-67</div>
</div>
<div class="asunto">Propuesta de servicios de consultoría 2026</div>
<div class="cuerpo">
  <p>Estimado Juan,</p>
  <p>Por medio de la presente, me permito presentar nuestra propuesta formal para los servicios de consultoría en transformación digital que discutimos en nuestra reunión del pasado 30 de mayo.</p>
  <p>Nuestra firma cuenta con más de 15 años de experiencia en el sector, y estamos seguros de que nuestra propuesta se alinea perfectamente con los objetivos estratégicos de su organización para el presente año fiscal.</p>
  <p>Adjuntamos a la presente los términos y condiciones generales, así como el desglose detallado de los honorarios profesionales correspondientes a cada fase del proyecto.</p>
  <p>Quedamos atentos a sus comentarios y a disposición para cualquier aclaración adicional que requiera.</p>
</div>
<div style="margin-top: 2cm">
  <p>Sin otro particular, reciba un cordial saludo.</p>
</div>
<div class="firma">
  <div class="nombre">María García</div>
  <div class="cargo">Gerente de Cuentas Estratégicas</div>
  <div style="font-size: 9pt; color: #aaa; margin-top: 4px;">maria.garcia@empresa.com</div>
</div>
</body></html>
"""

HTML(string=html_content).write_pdf("carta_profesional.pdf")
```

## Plantilla: Informe ejecutivo con tabla de datos

```python
from weasyprint import HTML
import json

css = """
@page {
  size: A4;
  margin: 2.5cm;
  @bottom-center { content: counter(page); font-size: 9pt; color: #999; }
}

body {
  font-family: 'Helvetica', 'Arial', sans-serif;
  font-size: 10pt;
  color: #333;
}

h1 {
  font-size: 26pt;
  color: #1a1a2e;
  margin-bottom: 4px;
  letter-spacing: -0.5px;
}

.subtitle {
  font-size: 10pt;
  color: #888;
  margin-bottom: 1.5cm;
  border-bottom: 2px solid #1a1a2e;
  padding-bottom: 0.5cm;
}

h2 {
  font-size: 14pt;
  color: #1a1a2e;
  border-left: 4px solid #e94560;
  padding-left: 12px;
  margin-top: 1cm;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.5cm 0;
  font-size: 9pt;
}

thead th {
  background: #1a1a2e;
  color: white;
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 8pt;
}

tbody td {
  padding: 8px 12px;
  border-bottom: 1px solid #eee;
}

tbody tr:nth-child(even) { background: #f8f8fc; }

tbody tr:hover { background: #eef0ff; }

.numero {
  font-family: 'Courier New', monospace;
  text-align: right;
  font-weight: 600;
}

.tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 8pt;
  font-weight: bold;
  text-transform: uppercase;
}

.tag-ok { background: #d4edda; color: #155724; }
.tag-warn { background: #fff3cd; color: #856404; }
.tag-error { background: #f8d7da; color: #721c24; }

.metricas {
  display: flex;
  gap: 20px;
  margin: 0.5cm 0;
}

.metrica {
  flex: 1;
  background: linear-gradient(135deg, #1a1a2e, #16213e);
  color: white;
  padding: 20px;
  border-radius: 8px;
}

.metrica .numero {
  font-size: 28pt;
  font-weight: bold;
  font-family: 'Courier New', monospace;
}

.metrica .label {
  font-size: 8pt;
  text-transform: uppercase;
  letter-spacing: 1px;
  opacity: 0.8;
  margin-top: 4px;
}
"""

datos = [
    {"nombre": "Ventas Netas", "ene": 125000, "feb": 132000, "mar": 141000, "estado": "ok"},
    {"nombre": "Costo Operativo", "ene": 78000, "feb": 74000, "mar": 71000, "estado": "ok"},
    {"nombre": "Margen Bruto", "ene": 47000, "feb": 58000, "mar": 70000, "estado": "ok"},
    {"nombre": "Gastos Admin", "ene": 32000, "feb": 35000, "mar": 38000, "estado": "warn"},
    {"nombre": "Deuda Corto Plazo", "ene": 45000, "feb": 42000, "mar": 40000, "estado": "ok"},
    {"nombre": "Rotación Inventario", "ene": 4.2, "feb": 3.8, "mar": 3.5, "estado": "error"},
]

filas = ""
for d in datos:
    tag = {"ok": "tag-ok", "warn": "tag-warn", "error": "tag-error"}
    filas += f"""
    <tr>
        <td>{d['nombre']}</td>
        <td class="numero">${d['ene']:,}</td>
        <td class="numero">${d['feb']:,}</td>
        <td class="numero">${d['mar']:,}</td>
        <td><span class="tag {tag[d['estado']]}">{d['estado']}</span></td>
    </tr>"""

html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{css}</style></head><body>
<h1>Informe de Gestión</h1>
<div class="subtitle">Q1 2026 · Reporte Ejecutivo · Preparado el 7 de junio de 2026</div>
<div class="metricas">
  <div class="metrica">
    <div class="numero">$398,000</div>
    <div class="label">Ventas Totales Q1</div>
  </div>
  <div class="metrica">
    <div class="numero">$175,000</div>
    <div class="label">Margen Bruto</div>
  </div>
  <div class="metrica">
    <div class="numero">12.4%</div>
    <div class="label">Crecimiento vs Q4</div>
  </div>
</div>
<h2>Indicadores Financieros</h2>
<table>
  <thead><tr><th>Indicador</th><th>Enero</th><th>Febrero</th><th>Marzo</th><th>Estado</th></tr></thead>
  <tbody>{filas}</tbody>
</table>
</body></html>"""

HTML(string=html).write_pdf("informe_ejecutivo.pdf")
```

## Plantilla: Diploma / Certificado

```python
from weasyprint import HTML

css = """
@page { size: landscape; margin: 0; }

body {
  margin: 0;
  padding: 0;
  width: 297mm;
  height: 210mm;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Georgia', serif;
}

.certificado {
  width: 95%;
  height: 90%;
  border: 20px solid #c9a84c;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px;
  background: linear-gradient(135deg, #faf8f3, #f5f0e6);
}

.certificado .sello {
  font-size: 14pt;
  color: #c9a84c;
  text-transform: uppercase;
  letter-spacing: 6px;
  margin-bottom: 20px;
}

.certificado h1 {
  font-size: 36pt;
  color: #1a1a1a;
  letter-spacing: 2px;
  margin: 10px 0;
  text-transform: uppercase;
}

.certificado .otorga {
  font-size: 11pt;
  color: #888;
  margin: 10px 0;
}

.certificado .nombre {
  font-size: 28pt;
  color: #1a1a2e;
  border-bottom: 2px solid #c9a84c;
  padding: 10px 40px;
  margin: 15px 0;
}

.certificado .detalle {
  font-size: 11pt;
  color: #666;
  max-width: 70%;
  line-height: 1.6;
}

.certificado .fecha {
  margin-top: 30px;
  font-size: 10pt;
  color: #999;
}

.firmas {
  display: flex;
  gap: 60px;
  margin-top: 30px;
}

.firma-linea {
  width: 180px;
  border-top: 2px solid #1a1a1a;
  padding-top: 8px;
  font-size: 9pt;
  color: #666;
}
"""

html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="certificado">
  <div class="sello">★ Fundación Educativa ★</div>
  <h1>Certificado de Mérito</h1>
  <div class="otorga">Otorga el presente certificado a</div>
  <div class="nombre">Nombre del Recipiente</div>
  <div class="detalle">Por haber completado satisfactoriamente el programa de formación avanzada en Desarrollo Full Stack, demostrando excelencia académica y compromiso profesional durante el período 2025-2026.</div>
  <div class="fecha">Expedido el 7 de junio de 2026</div>
  <div class="firmas">
    <div class="firma-linea">Directora Académica</div>
    <div class="firma-linea">Coordinador del Programa</div>
  </div>
</div>
</body></html>"""

HTML(string=html).write_pdf("certificado.pdf")
```

## Plantilla: Normas APA 7ª edición (documento académico)

```python
from weasyprint import HTML

css = """
@page {
  size: letter;
  margin: 2.54cm;
  @top-left {
    content: "Título abreviado del documento";
    font-size: 10pt;
    font-family: 'Times New Roman', serif;
    color: #333;
  }
  @top-right {
    content: counter(page);
    font-size: 10pt;
    font-family: 'Times New Roman', serif;
    color: #333;
  }
}

@page :first {
  @top-left { content: none; }
  @top-right { content: none; }
}

body {
  font-family: 'Times New Roman', serif;
  font-size: 12pt;
  line-height: 2.0;
  color: #000;
  text-align: justify;
}

/* Portada */
.portada {
  page-break-after: always;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 95vh;
  text-align: center;
}

.portada .titulo {
  font-size: 18pt;
  font-weight: bold;
  margin-bottom: 60px;
  line-height: 1.5;
}

.portada .autores {
  font-size: 12pt;
  margin-bottom: 30px;
}

.portada .afiliacion {
  font-size: 12pt;
  margin-bottom: 30px;
}

.portada .curso {
  font-size: 12pt;
  margin-bottom: 10px;
}

.portada .fecha {
  font-size: 12pt;
}

/* Resumen */
.resumen {
  page-break-after: always;
}

.resumen h2 {
  font-size: 12pt;
  font-weight: bold;
  text-align: center;
  margin-bottom: 20px;
}

.resumen p {
  text-align: justify;
}

.resumen .palabras-clave {
  margin-top: 20px;
  font-style: italic;
}

/* Cuerpo */
h2 {
  font-size: 12pt;
  font-weight: bold;
  text-align: center;
  margin-top: 20px;
}

h3 {
  font-size: 12pt;
  font-weight: bold;
  text-align: left;
  margin-top: 15px;
}

h4 {
  font-size: 12pt;
  font-weight: bold;
  text-align: left;
  font-style: italic;
  margin-top: 15px;
}

p { text-indent: 1.27cm; }

p.no-indent { text-indent: 0; }

/* Citas */
.cita-textual {
  margin-left: 1.27cm;
  margin-right: 0;
  font-size: 11pt;
  line-height: 2.0;
  text-indent: 0;
}

/* Referencias */
.referencias {
  page-break-before: always;
}

.referencias h2 {
  text-align: center;
  font-weight: bold;
  font-size: 12pt;
  margin-bottom: 20px;
}

.referencias p {
  text-indent: 0;
  padding-left: 1.27cm;
  hanging-indent: 1.27cm;
  margin-bottom: 10px;
  font-size: 11pt;
  line-height: 2.0;
}

/* Tablas APA */
.tabla-apa {
  margin: 20px 0;
  text-align: center;
}

.tabla-apa table {
  margin: 0 auto;
  border-collapse: collapse;
  font-size: 10pt;
  width: 100%;
}

.tabla-apa table thead th {
  border-top: 2px solid #000;
  border-bottom: 1px solid #000;
  padding: 6px 10px;
  font-weight: bold;
}

.tabla-apa table tbody td {
  padding: 6px 10px;
  text-align: center;
}

.tabla-apa table tbody tr:last-child {
  border-bottom: 2px solid #000;
}

.tabla-apa .nota {
  font-size: 9pt;
  font-style: italic;
  margin-top: 8px;
  text-indent: 0;
}

.nota-al-margen {
  font-size: 10pt;
  font-weight: bold;
}
"""

portada = """
<div class="portada">
  <div class="titulo">Título del Trabajo de Investigación:<br>Subtítulo si lo Tiene</div>
  <div class="autores">Nombre del Autor 1<br>Nombre del Autor 2</div>
  <div class="afiliacion">Departamento de Psicología<br>Universidad Nacional de Colombia</div>
  <div class="curso">Curso: Metodología de la Investigación</div>
  <div class="fecha">7 de junio de 2026</div>
</div>"""

resumen = """
<div class="resumen">
  <h2>Resumen</h2>
  <p class="no-indent">Este documento presenta una revisión de la literatura sobre el impacto de las tecnologías de información en los procesos cognitivos durante la última década. Se analizaron 45 estudios empíricos publicados entre 2016 y 2026, identificando tres categorías principales de efectos: mejora en la velocidad de procesamiento, cambios en los patrones de atención sostenida, y modificaciones en las estrategias de almacenamiento de memoria a largo plazo. Los resultados sugieren que, si bien las herramientas digitales incrementan la eficiencia en tareas de búsqueda y recuperación de información, también se asocian con una disminución en la profundidad del procesamiento cognitivo. Se discuten las implicaciones para el diseño de intervenciones educativas y para la comprensión teórica de la plasticidad cognitiva en entornos mediados por tecnología.</p>
  <p class="palabras-clave"><strong>Palabras clave:</strong> tecnología cognitiva, procesamiento de información, atención, memoria, plasticidad cognitiva</p>
</div>"""

cuerpo = f"""
<h2>Método</h2>

<h3>Participantes</h3>

<p>La muestra estuvo conformada por 120 estudiantes universitarios (67 mujeres y 53 hombres) con edades comprendidas entre 18 y 35 años (M = 22.4, DE = 3.2), reclutados mediante muestreo intencional en tres universidades públicas de la ciudad de Bogotá. Todos los participantes reportaron tener experiencia previa en el uso de dispositivos digitales para actividades académicas, con un promedio de 6.2 años de uso (DE = 2.1).</p>

<h3>Instrumentos</h3>

<p>Se utilizaron tres instrumentos para la recolección de datos. En primer lugar, el Cuestionario de Hábitos Tecnológicos (CHT-26), desarrollado por García et al. (2020), el cual evalúa la frecuencia y tipo de uso de dispositivos digitales en contextos académicos y cotidianos. En segundo lugar, la Batería de Evaluación Cognitiva Digital (BECD-42), adaptada por Martínez y López (2022) para entornos mediados por tecnología, que mide cinco dominios cognitivos.</p>

<h3>Procedimiento</h3>

<p>El estudio se llevó a cabo en tres fases durante el periodo académico 2025-2026. En la primera fase, los participantes completaron el CHT-26 y proporcionaron consentimiento informado. En la segunda fase, realizada una semana después, los participantes asistieron al laboratorio de cómputo para completar la BECD-42. Finalmente, en la tercera fase, los investigadores realizaron entrevistas semiestructuradas.</p>

<h3>Análisis de datos</h3>

<p>Los datos fueron analizados utilizando el paquete estadístico SPSS versión 28. Se realizaron análisis descriptivos y correlacionales, seguidos de un modelo de regresión lineal múltiple para examinar la contribución relativa de cada variable independiente. Se estableció un nivel de significación de α = .05 para todas las pruebas.</p>

<h2>Resultados</h2>

<p>Los análisis descriptivos revelaron diferencias significativas en los puntajes de procesamiento cognitivo en función del nivel de exposición tecnológica de los participantes. La Tabla 1 presenta los estadísticos descriptivos para las variables principales del estudio.</p>

<div class="tabla-apa">
  <p class="no-indent" style="font-weight: bold; font-style: italic;">Tabla 1</p>
  <p class="no-indent" style="font-weight: bold; font-style: italic;">Estadísticos Descriptivos y Correlaciones entre Variables</p>
  <table>
    <thead>
      <tr>
        <th>Variable</th>
        <th>M</th>
        <th>DE</th>
        <th>1</th>
        <th>2</th>
        <th>3</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>1. Uso tecnológico</td><td>4.62</td><td>1.34</td><td>—</td><td></td><td></td></tr>
      <tr><td>2. Velocidad procesamiento</td><td>67.8</td><td>12.5</td><td>.42**</td><td>—</td><td></td></tr>
      <tr><td>3. Atención sostenida</td><td>54.2</td><td>15.3</td><td>-.28*</td><td>.35*</td><td>—</td></tr>
      <tr><td>4. Memoria a largo plazo</td><td>71.6</td><td>11.8</td><td>.15</td><td>.22</td><td>.19</td></tr>
    </tbody>
  </table>
  <p class="nota"><em>Nota.</em> N = 120. *p < .05. **p < .01.</p>
</div>

<p>Se encontró una correlación positiva significativa entre el uso tecnológico y la velocidad de procesamiento (r = .42, p < .01), lo que sugiere que una mayor exposición a tecnologías digitales se asocia con tiempos de respuesta más rápidos en tareas cognitivas. Este hallazgo es consistente con lo reportado por Smith et al. (2022), quienes encontraron un patrón similar en poblaciones de adultos jóvenes.</p>

<h2>Discusión</h2>

<p>El objetivo del presente estudio fue examinar la relación entre el uso de tecnologías digitales y los procesos cognitivos en estudiantes universitarios. Los resultados aportan evidencia sobre la naturaleza diferenciada de esta relación: mientras que la velocidad de procesamiento muestra una asociación positiva con el uso tecnológico, la atención sostenida presenta una correlación negativa significativa. Estos hallazgos se alinean con la teoría de la compensación cognitiva propuesta por Barr et al. (2015), la cual sugiere que las herramientas digitales optimizan ciertos procesos cognitivos mientras que pueden debilitar otros.</p>
"""

referencias = """
<div class="referencias">
  <h2>Referencias</h2>

  <p>American Psychological Association. (2020). <em>Publication manual of the American Psychological Association</em> (7.ª ed.). https://doi.org/10.1037/0000165-000</p>

  <p>Barr, N., Pennycook, G., Stolz, J. A., & Fugelsang, J. A. (2015). The brain in your pocket: Evidence that smartphones are used to supplant thinking. <em>Computers in Human Behavior</em>, <em>48</em>, 473-480. https://doi.org/10.1016/j.chb.2015.02.029</p>

  <p>García, M., Rodríguez, P., & Martínez, L. (2020). Cuestionario de hábitos tecnológicos: Desarrollo y validación inicial. <em>Revista Colombiana de Psicología</em>, <em>29</em>(2), 45-62. https://doi.org/10.15446/rcp.v29n2.82345</p>

  <p>Martínez, C., & López, A. (2022). Adaptación de la Batería de Evaluación Cognitiva para entornos digitales. En L. Fernández (Ed.), <em>Avances en evaluación neuropsicológica</em> (pp. 123-145). Editorial Universidad Nacional.</p>

  <p>Smith, J. K., Johnson, L. M., & Williams, R. T. (2022). Digital media exposure and cognitive processing speed in young adults: A longitudinal analysis. <em>Journal of Cognitive Psychology</em>, <em>34</em>(3), 289-304. https://doi.org/10.1080/20445911.2022.2045678</p>

  <p>Organización Mundial de la Salud. (2021). <em>Salud digital: Estrategias para la promoción del bienestar cognitivo</em>. https://www.who.int/publicaciones/digital-health-2021</p>
</div>"""

html_apa = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>{css}</style></head><body>
{portada}
{resumen}
{cuerpo}
{referencias}
</body></html>"""

HTML(string=html_apa).write_pdf("documento_apa.pdf")
print("Documento APA generado: documento_apa.pdf")
```

---

# SECCIÓN B — python-docx (para archivos .docx editables)

Usar cuando el usuario necesite específicamente un archivo `.docx` editable en Word, no cuando quiera un documento bonito (para eso usar HTML→PDF).

## Leer un documento

```python
from docx import Document
doc = Document("archivo.docx")

for para in doc.paragraphs:
    print(para.text)

for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            print(cell.text)
```

## Crear un documento .docx

```python
from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

p = doc.add_paragraph("Título", style="Heading 1")
run = p.add_run(" texto en negrita")
run.bold = True
run.font.color.rgb = RGBColor(0xC9, 0xA8, 0x4C)
run.font.size = Pt(14)

table = doc.add_table(rows=3, cols=2)
table.style = "Table Grid"
for i, row in enumerate(table.rows):
    row.cells[0].text = f"Fila {i+1}"
    row.cells[1].text = f"Dato {i+1}"

doc.add_picture("imagen.png", width=Inches(5))
doc.add_page_break()
doc.save("documento.docx")
```

## Buscar y reemplazar en plantilla

```python
from docx import Document

doc = Document("plantilla.docx")
for para in doc.paragraphs:
    for run in para.runs:
        run.text = run.text.replace("{{NOMBRE}}", "Juan")
        run.text = run.text.replace("{{FECHA}}", "7 junio 2026")
doc.save("completado.docx")
```

## Extraer tablas a JSON/CSV

```python
from docx import Document
import json

doc = Document("datos.docx")
tablas = []
for table in doc.tables:
    data = [ [cell.text.strip() for cell in row.cells] for row in table.rows ]
    tablas.append(data)

with open("tablas.json", "w") as f:
    json.dump(tablas, f, indent=2)
```

## Configurar página

```python
from docx.shared import Cm
from docx.enum.section import WD_ORIENT

section = doc.sections[0]
section.orientation = WD_ORIENT.LANDSCAPE
section.top_margin = Cm(2)
section.left_margin = Cm(2.5)
```

---

# Flujo de decisión

1. El usuario pide un documento bonito / profesional / con diseño → **HTML+CSS → PDF**
2. El usuario necesita específicamente un `.docx` editable → **python-docx**
3. El usuario tiene un archivo existente y quiere leerlo o modificarlo → **python-docx**
4. El usuario sube una plantilla `.docx` con `{{marcadores}}` → **python-docx** para reemplazar

Para documentos bonitos usar SIEMPRE HTML+CSS → PDF. Esa vía da control total sobre tipografía (Google Fonts), colores, layouts, bordes decorativos, fondos, gradientes, y produce resultados profesionales.

# 🔴 AUDITORÍA CRÍTICA - SISTEMA DE CARTERA v1.1

**Fecha:** 13 de Abril 2026  
**Estado:** CRITICIDAD MÁXIMA - 9 FALLOS GRAVES  
**Riesgo:** Corrupción de datos en producción (ALTO)

---

## 📋 RESUMEN EJECUTIVO

El código contiene **arquitectura rota** en la función `registrarAbono()` que puede causar:
- ✗ Corrupción de saldos y estados
- ✗ Violación de FIFO
- ✗ Race conditions en concurrencia
- ✗ Inconsistencia entre Sheets y memoria
- ✗ Posibilidad de doble-pago o cálculos incorrectos

**Impacto Financiero:** CRÍTICO - Auditoría de cartera inutilizable

---

## 🔍 ERRORES IDENTIFICADOS

### **CRÍTICO #1: Redeclaración masiva en `registrarAbono()` (Líneas 306-365)**

**Problema:**
```javascript
// LÍNEA 306: Primer intento (INCOMPLETO)
for (let i = 1; i < dataCartera.length; i++) {
  const row = dataCartera[i];
  const rowIdT = _sanitizeId(row[COL.id_tercero]);
  
  // LÍNEA 311: REDECLARA TODO DENTRO DEL LOOP!!!
  const sheetCartera = getSheet(CARTERA_CONFIG.SHEETS.CARTERA);  // ❌
  const dataCartera  = sheetCartera.getDataRange().getValues();   // ❌
  const COL          = CARTERA_CONFIG.COLUMNS.CARTERA;            // ❌
  
  const pendientes = [];  // ❌ SE CREA VACÍO EN CADA ITERACIÓN
  for (let i = 1; i < dataCartera.length; i++) {  // ❌ LOOP ANIDADO ROTO
    // ...
  }
}
```

**Impacto:**
1. Los `pendientes` se crean y descartan en **cada iteración**
2. Solo la **última iteración** ejecutaría la lógica FIFO
3. Las escrituras ocurren **dentro del loop anidado**, usando datos **obsoletos**
4. `dataCartera` se sobrescribe con una **copia nueva** perdiendo contexto
5. En paralelo, otro proceso podría escribir entre la redeclaración y la sobrescritura

**Escenario de fallo:**
```
Tiempo T0: Usuario A inicia registrarAbono (lectura 1 de dataCartera)
Tiempo T1: Usuario B inicia registrarAbono (lectura 2 de dataCartera)
Tiempo T2: Usuario A ejecuta loop anidado (redeclara dataCartera → lectura 3)
Tiempo T3: Usuario B ejecuta loop anidado (redeclara dataCartera → lectura 4)
Tiempo T4: Usuario A escribe saldos (basado en lectura 3)
Tiempo T5: Usuario B escribe saldos (basado en lectura 4)
Resultado: Saldos contradictorios, historial de abonos duplicado
```

---

### **CRÍTICO #2: Lógica FIFO completamente rota**

**Código actual:**
```javascript
// Se filtran pendientes EN EL LOOP ANIDADO
// Se ordenan y se escriben en batch
// PERO: Las transacciones NO se aplican en orden FIFO global
// En concurrencia: Dos abonos procesados simultáneamente rompen FIFO
```

**¿Por qué falla?**
- El ordenamiento es **local** al proceso
- No hay **sincronización global** de FIFO
- Dos abonos paralelos pueden ambos aplicarse a la misma cartera antigua

---

### **CRÍTICO #3: Escrituras NO atómicas (Líneas 352-365)**

**Problema:**
```javascript
// Escritura 1: Movimientos
if (movimientos.length > 0) {
  sheetMov.getRange(...).setValues(movimientos);  // ✗ Escritura 1
}

// Escritura 2: Saldos
if (dataCartera.length > 1) {
  sheetCartera.getRange(2, COL.saldo + 1, ...).setValues(saldos);  // ✗ Escritura 2
  
  // Escritura 3: Estados
  sheetCartera.getRange(2, COL.estado + 1, ...).setValues(estados);  // ✗ Escritura 3
}

SpreadsheetApp.flush();  // ✗ Está al FINAL
```

**Escenario de corrupción:**
```
T0: Movimiento MOV001 escrito (Abono $100)
T1: ERROR en escritura de saldos (timeout/network)
T2: Saldos no se actualizan, estados no se actualizan
T3: Otra lectura ve movimiento pero saldos sin cambios
T4: Auditoría de cartera: "Abono registrado pero saldo no aplica"
```

---

### **CRÍTICO #4: Lock insuficiente**

```javascript
// El lock CUBRE el código
// PERO: Múltiples getSheet() dentro del lock pueden bloquear otros procesos
// Y el lock NO PROTEGE contra redeclaraciones que crean una copia de datos
```

**Problema de datos obsoletos:**
```javascript
1. Reader A: lock.tryLock() ✓
2. Reader A: dataCartera = sheetCartera.getDataRange().getValues()
3. Reader B: Debe esperar el lock
4. Reader A: (dentro del loop) redeclara y re-lee dataCartera
5. Reader A: Ahora tiene DATOS DIFERENTES EN MEMORIA
6. Reader B: Cuando obtiene el lock, sus datos son obsoletos
```

---

### **CRÍTICO #5: Race condition en `getSaldoTercero()` (Línea 249)**

```javascript
function getSaldoTercero(idTercero) {
  const cartera = getCarteraPorTercero(idTercero);  // ❌ Lee la hoja ENTERA
  return cartera
    .filter((c) => c.estado !== CARTERA_CONFIG.ESTADOS.CANCELADA)
    .reduce((acc, c) => acc + c.saldo, 0);
}
```

**Problema:**
- Se llama desde `crearCartera_()` para validar límite de crédito
- En paralelo, otro abono podría estar reduciendo saldos
- **Verifica límite con información desactualizada**
- Cliente puede crear CxC que viola el límite

---

### **CRÍTICO #6: Verificación de límite de crédito no-atómica (Línea 538)**

```javascript
// En procesarVentaV2:
if (tercero.limite_credito > 0) {
  const saldoActual = getSaldoTercero(idTercero);  // ✗ Lectura sin lock
  if ((saldoActual + totalVenta) > tercero.limite_credito) {
    throw new Error(...);  // ✗ Pero la venta YA se procesó arriba
  }
}
```

**Escenario:**
```
T0: Venta A verifica límite ($100.000 disponible, $50.000 venta propuesta)
T1: Venta B verifica límite ($100.000 disponible, $60.000 venta propuesta)
T2: Venta A se procesa ($50.000), saldo disponible = $50.000
T3: Venta B se procesa ($60.000) - ❌ VIOLA LÍMITE
Resultado: Cliente tiene $110.000 de deuda en $100.000 límite
```

---

### **CRÍTICO #7: Duplicación de lógica de búsqueda (Línea 283)**

```javascript
// En procesarVentaV2, mismo código:
for (const item of carrito) {
  const idx = dataStock.findIndex(  // ❌ O(n) * O(carrito.length) = O(n*m)
    (r) => String(r[0]).trim() === String(item.id_producto).trim(),
  );
  // ...
}

// Solución: Crear índice O(1):
const stockIndex = {};
for (let i = 0; i < dataStock.length; i++) {
  stockIndex[String(dataStock[i][0]).trim()] = i;
}
for (const item of carrito) {
  const idx = stockIndex[String(item.id_producto).trim()];  // ✓ O(1)
}
```

---

### **CRÍTICO #8: Llamadas redundantes a Sheets**

```javascript
// getSaldoTercero() → getCarteraPorTercero() → getCartera()
// Lee la hoja ENTERA cada vez que verifica un saldo

// En procesarVentaV2:
getTerceros().find(...)  // ✓ 1 lectura
con getSaldoTercero()    // ✗ Otra lectura completa
con crearCartera_()      // ✗ Otra lectura en getTerceros()
```

**Impacto:** O(n³) cuando podría ser O(n)

---

### **CRÍTICO #9: Fechas inválidas sin manejo (Línea 317)**

```javascript
const fechaRow = row[COL.fecha] instanceof Date 
  ? row[COL.fecha] 
  : new Date(row[COL.fecha]);

// Si row[COL.fecha] es una cadena inválida:
// new Date("texto invalido") → Date object con getTime() = NaN
// Luego: isNaN(fechaRow.getTime()) ? ... pero el push ya ocurrió
```

**Alternativa segura:**
```javascript
const fechaRow = row[COL.fecha] instanceof Date ? row[COL.fecha] : new Date(row[COL.fecha]);
if (isNaN(fechaRow.getTime())) {
  fechaRow = new Date(0);  // Fecha de epoch como fallback seguro
}
```

---

## ⚖️ VALIDACIÓN DE INTEGRIDAD EN PARALELO

### **Caso 1: 10 abonos simultáneos a mismo tercero**

**Escenario:**
- Tercero CLIENTE001 con cartera: $1.000
- 10 usuarios intentan hacer abono de $100 cada uno

**Resultado esperado:**
- Saldo final: $0
- 10 movimientos registrados en FIFO
- Estados: CANCELADA

**Resultado CON BUGS:**
- Saldo final: IMPREDECIBLE (entre $0 y $1.000)
- Movimientos: Posiblemente duplicados o faltantes
- Estados: INCONSISTENTES (algunos PARCIAL, algunos CANCELADA)

### **Caso 2: Venta + Abono simultáneo**

**Escenario:**
- Tercero con límite $100.000
- Venta A: $60.000
- Venta B: $50.000
- Abono: $40.000

**Resultado esperado:**
- Venta A se procesa si hay límite
- Venta B se rechaza (falta límite)
- Abono reduce saldo de Venta A

**Resultado CON BUGS:**
- Ambas ventas se procesan
- Abono se aplica a deuda incorrecta (FIFO roto)
- Saldo final incoherente

---

## 📊 MATRIZ DE SEVERIDAD

| Error | Severidad | Frecuencia | Impacto | Detectable |
|-------|-----------|-----------|--------|-----------|
| Redeclaración en loop | 🔴 CRÍTICA | SIEMPRE | Corrupción datos | SI (auditoría) |
| FIFO roto concurrencia | 🔴 CRÍTICA | RARO | Error contable | SI (movimientos) |
| Escrituras no-atómicas | 🔴 CRÍTICA | RARO (network) | Inconsistencia | SI (auditoría) |
| Race condition límite | 🔴 CRÍTICA | COMÚN (picos) | Deuda excesiva | SI (reporte) |
| Duplicación O(n*m) | 🟠 ALTA | SIEMPRE | Timeout sheets | SI (logs) |
| Fechas inválidas | 🟠 ALTA | RARO | Cálculo FIFO incorrecto | SI (manual) |

---

## ✅ PLAN DE REFACTORIZACIÓN

1. ✓ Eliminar redeclaraciones internas
2. ✓ Hacer lecturas ÚNICAS al inicio
3. ✓ Hacer escrituras BATCH atómicas
4. ✓ Implementar FIFO thread-safe
5. ✓ Optimizar búsquedas O(1)
6. ✓ Validar fechas consistentemente
7. ✓ Proteger límite de crédito con lock
8. ✓ Documentar transacciones críticas

---

## 🔐 VALIDACIÓN FINAL REQUERIDA

- [ ] Prueba: 10 abonos paralelos → Saldo correcto
- [ ] Prueba: 10 ventas paralelas → Límite respetado
- [ ] Prueba: Lectura auditoría → Movimientos = Saldos
- [ ] Prueba: FIFO respetado → Fechas ordenadas
- [ ] Prueba: Rollback → Datos consistentes

---

**Siguiente fase:** Código refactorizado

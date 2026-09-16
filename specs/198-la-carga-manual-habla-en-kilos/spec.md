# 198 · La carga de compras habla en kilos

**Issue:** [#323](https://github.com/gachetponzellini/RestaurantOS-app/issues/323) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-16)

**Depende de**: [`165`](../165-el-renglon-por-insumo/spec.md) (el renglón en
envases y la RPC que actualiza el costo), [`172`](../172-el-parser-de-facturas/spec.md)
(el lector y `aPropuesta`, que ya convierte kilos a envases),
[`173`](../173-cargar-compra-en-pantalla-propia/spec.md) (la pantalla y el visor
de fotos), [`188`](../188-el-iva-del-comprobante/spec.md) (el cartel de IVA del
editor).

---

## Por qué

**Input — Rocío, encargada del Golf, 2026-09-16, dos audios de WhatsApp**,
cargando la factura de los lácteos. Transcriptos con whisper.cpp local:

> *«primero que no me deja cargar la foto desde los archivos, no sé por qué»*

> *«cuando es algo con coma no me deja poner coma, por ejemplo 2,900 me escribe
> 2,90 — y no son 2,90 kilos, son 2 kilos 900»*

> *«no me está dando el total: 58 y 72.500 me está dando un millón 15, no entiendo
> qué es lo que estoy haciendo mal»*

> *«por defecto tiene la manteca con el pan de 200 gramos y la crema de leche el
> sachet de litro. Nosotros no lo tenemos así, sino que seleccionamos cómo se
> cuenta, si por kilos o por litros, y después ponemos la cantidad. No hay un
> paquete por defecto, porque no siempre viene lo mismo.»*

Es la primera vez que alguien carga renglones a mano de verdad (el cloud tenía
**0** al cerrar la 188). Y se rompe en los cuatro lugares por donde pasa.

### 1 · El archivo se descarta en silencio

[`invoice-visor.tsx:113`](../../src/components/admin/proveedores/invoice-visor.tsx):

```ts
const files = Array.from(entrada ?? []).filter((f) => f.type.startsWith("image/"));
if (files.length === 0) return;
```

Sin un toast. Se elige el archivo y no pasa nada. Le pasa a dos cosas reales:

- **El PDF.** Es como mandan la factura A casi todos los proveedores con
  facturación electrónica. El `accept="image/*"` ni siquiera lo deja elegir, y el
  lector lo rechaza a propósito ([`leer.ts:157`](../../src/lib/proveedores/lectura/leer.ts)).
- **La foto HEIC de un iPhone en la compu de Windows.** Chrome no conoce el tipo y
  lo reporta vacío: el filtro la tira.

Medido en el cloud: el bucket no tiene límite de tipo ni de tamaño, las policies
dejan subir a cualquier miembro, y las subidas del 15 entraron. **Hoy no subió ni
un objeto**, que es lo que dice el síntoma: el archivo no llegó a salir del
navegador.

### 2 · Los números se rompen mientras se tipean

Los dos campos del renglón son inputs controlados que convierten en cada tecla:

```ts
onChange={(e) => set(i, { units: Number(e.target.value) || 0 })}
```

`Number("2,")` es `NaN`, o sea `0`: la coma borra lo que había. `Number("72.")` es
`72`: el punto desaparece apenas se escribe. Tipear «2,900» termina en cualquier
cosa menos 2,9. La pantalla de revisión de la lectura tiene los mismos dos
inputs, con el mismo problema.

El importe del comprobante ya había pasado por esto y se arregló en la 173 con
texto + `parseNumeroAR`. Los renglones no.

### 3 · No hay contra qué comparar la línea de la factura

El editor muestra **una sola** suma, la de todos los renglones. No hay subtotal
por renglón: cuando «58 × 72.500» no da lo que la factura dice, no hay forma de
ver en qué renglón está la diferencia. No se pudo reconstruir de dónde salió el
«un millón 15» sin su pantalla; lo que sí se puede es que el número de cada
renglón esté a la vista.

### 4 · El editor impone el envase

El renglón guarda **envases** (165·D5): `units` son envases y `unit_cost_cents` es
el precio de UN envase, porque es lo que la RPC sabe propagar al costo del
insumo. Y el editor muestra eso tal cual: al elegir la manteca, precarga su
presentación por defecto —«Pan 200 g»— y pregunta cuántos panes y a cuánto el pan.

Pero la factura de los lácteos dice kilos y litros, y lo que Rocío tiene en la
cabeza también. El lector de la 172 ya resolvió esto del otro lado —`aPropuesta`
convierte «82,600 kg a $17.500» en «8,26 envases de 10 kg a $175.000»—; el editor
manual nunca lo hizo.

## Las decisiones

**D1 · Ningún archivo se descarta en silencio.**

Lo que no se puede usar se dice, con el nombre del archivo y el motivo. Un botón
que no hace nada se lee como «el sistema no anda», y termina en un audio de
WhatsApp.

**D2 · El PDF entra, entero, y el lector lo lee como PDF.**

Se sube tal cual —no hay nada que achicar—, el visor lo muestra con el visor de
PDF del navegador, y el lector lo manda a la API como bloque `document`: Claude lee
PDF nativo, con sus varias hojas. No se convierte a imagen en el navegador: sería
una librería de 1 MB para hacer peor algo que el modelo hace directo.

El tope es 10 MB por PDF, que entra en el techo de 12 MB del lote (`leer.ts`).

**D3 · La HEIC que el navegador no abre se explica, no se sube.**

Safari decodifica HEIC y el achicado ya la convierte a JPG. Chrome en Windows no
puede, y hoy la sube igual con extensión `.jpg` —bytes HEIC adentro—, así que ni
se ve la vista previa ni la lee el modelo. Convertirla en el navegador es otra
librería pesada para un caso que se evita con un ajuste del teléfono. Se detecta
y se dice cómo resolverlo.

**D4 · Los números se escriben como se escribe la plata acá.**

Un componente solo, `InputNumeroAR`, para los cuatro campos (cantidad y precio,
en el editor y en la revisión): texto libre mientras se tipea, `parseNumeroAR`
para entenderlo, y el número formateado recién al salir del campo. «2,900» son
2,9; «72.500» son setenta y dos mil quinientos. Mientras el campo tiene el foco,
**lo que se ve es lo que se tipeó**, nunca una reinterpretación a mitad de camino.

**D5 · La cantidad se carga en la unidad del insumo, y el envase es opcional.**

Cada renglón tiene un selector «cómo viene»: la unidad del insumo (kg, lt, un) —el
default— o su envase, para la factura que sí dice «3 cajas». En unidad, se tipea
«2,9 kg a $7.250 el kg» y el código lo convierte a envases antes de mandarlo, con
la misma aritmética de `aPropuesta`. **El contrato con el server no cambia**: la
RPC sigue recibiendo envases, y por eso el costo del insumo se sigue actualizando.

Si el insumo no tiene envase cargado, la unidad es la única opción y entra el
stock sin actualizar el costo — que es lo que ya pasaba, y se sigue avisando.

**D6 · Cada renglón muestra su subtotal.**

`cantidad × precio = $` al final de la fila: es el número que se compara contra la
línea impresa. La suma del detalle queda abajo, como está.

## Alcance

- `src/lib/proveedores/archivos.ts` — puro: `clasificarArchivo` decide imagen, PDF
  o rechazo con motivo, mirando tipo **y** extensión.
- `invoice-visor.tsx` — usa eso, avisa lo rechazado, `accept` con PDF y HEIC, y
  muestra el PDF en un `<iframe>`.
- `invoice-photos-uploader.tsx` — el PDF sube sin achicar; la HEIC que no se pudo
  decodificar no sube y dice por qué.
- `lectura/leer.ts` — el PDF viaja como `document`.
- `src/lib/proveedores/renglon-en-unidades.ts` — puro: envases ↔ unidades.
- `input-numero-ar.tsx` — el campo numérico.
- `renglones-editor.tsx` — «cómo viene», los campos nuevos y el subtotal.
- `revision-lectura.tsx` — los campos nuevos.
- `cuenta-corriente-panel.tsx` — un comprobante guardado en PDF se abre, no se
  intenta mostrar como imagen.

## Qué NO entra

- **Convertir HEIC o PDF a imagen en el navegador** (D2, D3).
- **Elegir entre todas las presentaciones del insumo.** El selector ofrece la
  unidad y el envase por defecto. Si aparece la manteca que viene en pan de 200 g
  un día y en caja de 5 kg otro, se carga en kilos, que es justo lo que D5 hace
  posible.
- **Reescribir renglones ya guardados.** Están en envases y siguen estando.

## Escenarios de aceptación

1. **Dado** un PDF elegido desde el explorador de archivos, **entonces** sube, se
   ve en el visor y la lectura lo manda como documento.
2. **Dado** un archivo que no es imagen ni PDF, **entonces** aparece un aviso con
   su nombre y no pasa en silencio.
3. **Dado** una foto `.heic` que el navegador no puede abrir, **entonces** no se
   sube y el aviso dice cómo mandarla en JPG.
4. **Dado** que se tipea «2,900» en la cantidad, **entonces** el campo muestra
   «2,900» mientras se escribe y el renglón queda en 2,9.
5. **Dado** que se tipea «72.500» en el precio, **entonces** son $72.500.
6. **Dado** la manteca con envase «Pan 200 g», **cuando** se carga en kg «2,9 kg a
   $7.250», **entonces** viajan 14,5 envases a $1.450 cada uno, el subtotal dice
   $21.025 y el costo del insumo se actualiza.
7. **Dado** un renglón en envase, **entonces** se comporta como hasta ahora.
8. **Dado** un insumo sin envase, **entonces** sólo se ofrece la unidad y se avisa
   que no actualiza el costo.
9. **Dado** cualquier renglón con cantidad y precio, **entonces** muestra su
   subtotal.
10. **Dado** un comprobante guardado con PDF, **entonces** en la cuenta corriente se
    abre el PDF en vez de una imagen rota.

## Verificación

**Implementada y verificada el 2026-09-16.** `pnpm typecheck` limpio y la suite
entera en verde: **3.324 tests**, 27 nuevos de esta spec.

**Lo puro, en CI:**
- `clasificarArchivo` (6 casos): el PDF entra por tipo y **por extensión** —el de
  WhatsApp llega como `octet-stream`—, el de más de 10 MB se rechaza con motivo, la
  HEIC con tipo vacío entra como imagen, y un `.xlsx` vuelve con motivo, nunca
  callado.
- `aEnvases`/`aUnidades` (7 casos): la manteca de la spec —2,9 kg a $7.250 son
  14,5 panes de 200 g a $1.450, subtotal $21.025 en las dos lecturas—, la crema en
  sachet, el envase que no convierte, el insumo sin envase, y el caso de oro de la
  172 (82,6 kg a $17.500 → 8,26 envases a $175.000), que da **lo mismo que el
  lector**.
- `InputNumeroAR` (5 casos, con Testing Library): «2,900» y «72.500» tipeados **de
  a un carácter**, afirmando en cada tecla que lo que se ve es lo que se tipeó. Es
  justo donde estaba el bug viejo: no en el valor final, sino en el camino.
- `leerPagina` (4 casos nuevos): el PDF viaja como bloque `document`, también si
  Storage lo guardó como `octet-stream`; el modelo recibe el aviso de que puede
  traer varias hojas; y el techo es propio (un PDF de 5 MB entra, la foto de 5 MB
  no).

**En vivo, como Sofía (encargada) sobre `demo`, stack local:**

- **Subida.** Por el mismo `<input type="file">` que usa la pantalla, un
  `planilla.xlsx` y un `Factura lacteos 0527.pdf` **sin tipo**: el primero dio el
  aviso «planilla.xlsx no es una foto ni un PDF…»; el segundo entró por la
  extensión, subió a Storage (`POST …/…pdf → 200`), quedó «PDF · Lista» en el rail
  y se ve en el visor de PDF del navegador.
- **La lectura del PDF salió al proveedor y volvió 401** (`API key is invalid`): es
  el pendiente de la API key que arrastra la 172, no el bloque — la forma del
  bloque la cubre el test.
- **El renglón.** Manteca («Pan 200g»): el campo pregunta «Cantidad en kg» y
  «Precio por kg». Tipeando «2,900» el campo muestra **«2,900»** mientras se escribe
  y **«2,9»** al salir; «7.250» queda en $7.250. La fila dice **$21.025** y abajo
  «Entran 2,9 kg · 14,5 × Pan 200g a $1.450 c/u». Cambiando «cómo viene» a «Pan
  200g», la misma fila pasa a **14,5 × $1.450 = $21.025**: cambia la lectura, no la
  plata.

### Lo que queda pendiente

**El «58 × 72.500 = un millón 15» no se reconstruyó.** Con el `Number()` por tecla
cualquier combinación de coma y punto daba un número distinto al tipeado, así que
es consistente con el bug, pero no se pudo reproducir la cifra exacta sin su
pantalla. Lo que cambia es que ahora el subtotal de cada renglón está a la vista.

**El Supabase local no tiene buckets de Storage.** Para probar la subida se
replicó `supplier-invoices` con las mismas cuatro policies de miembro que tiene la
nube. Ni el bucket ni sus policies están en ninguna migración: un ambiente nuevo
nace sin poder subir comprobantes. No es de esta spec; queda anotado.

**La HEIC en Chrome/Windows** está cubierta por el test de clasificación y por el
camino del uploader, pero no se probó en una compu con Windows.

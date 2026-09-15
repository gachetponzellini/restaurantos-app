# 188 · El IVA del comprobante de compra

**Issue:** [#312](https://github.com/gachetponzellini/RestaurantOS-app/issues/312) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-15)

**Depende de**: [`172`](../172-el-parser-de-facturas/spec.md) (el lector, sus
cuatro capas puras y la regla de que el modelo transcribe y la aritmética
decide), [`165`](../165-el-renglon-por-insumo/spec.md) (el renglón y la RPC que
escribe el costo), [`158`](../158-comprar-y-pagarle-al-proveedor/spec.md) (el
comprobante), `10` (el costeo, que es quien consume el precio).

---

## Por qué

**Input — Rocío, encargada del Golf, 2026-09-15, por WhatsApp:**

> *«Cuando se suba la foto el sistema discrimina los artículos y le pone iva a
> cada uno para dejarlos con el precio final?»*

Hoy no. Y la respuesta larga es más interesante que el no.

### Lo que hace el lector, y por qué está bien

El modelo transcribe verbatim y **no calcula nada** — es la 172·D1, y el prompt
lo dice literal: *«No calculés el IVA»*
([`prompt.ts:52`](../../src/lib/proveedores/lectura/prompt.ts)). Sobre la factura
A, el mismo prompt es explícito:

> *«En una factura A los precios de línea están SIN IVA y el total del pie está
> CON IVA. Copiá los dos como están: no ajustes nada.»*

Esa decisión no se toca: un modelo que devuelve un número ya calculado decidió en
el único lugar donde no lo podemos verificar. Lo que falta es la capa de después
—la aritmética, que es nuestra— y el lugar donde guardar el resultado.

### Los tres agujeros, medidos

**1 · El libro de IVA está hecho a la mitad.**

`invoices` —las ventas— ya tiene `neto_cents`, `iva_cents` e `iva_rate`, un
[`libro-iva.ts`](../../src/lib/afip/libro-iva.ts) puro con tests, y
`calculateAmounts` que desagrega el neto del total. `supplier_invoices` guarda
**sólo `total_cents`**. No hay neto, no hay IVA, no hay percepciones. El
subdiario de IVA compras —una de las cinco cosas que MaxiRest dispara al procesar
un comprobante— no se puede armar, y ya estaba anotado como gap en el
relevamiento:

> *Neto / IVA por tasa / percepciones / imp. internos | sólo `total_cents` | 25%
> fiscal (necesario para el subdiario)* —
> [`compras-y-proveedores.md:213`](https://github.com/gachetponzellini/restaurantos-brain/blob/main/wiki/negocio/competencia/maxirest/compras-y-proveedores.md)

**2 · La base del precio del renglón es invisible.**

`supplier_invoice_items.unit_cost_cents` recibe el precio impreso, tal cual. En
una factura A ese precio es **neto**; en un ticket, una B o una compra sin
comprobante es **final**. Los dos van a la misma columna, y esa columna pisa
`ingredient_presentations.cost_cents`, que es lo que re-costea las recetas y lo
que alimenta el `salto_de_precio` de
[`a-propuesta.ts`](../../src/lib/proveedores/lectura/a-propuesta.ts).

Mirando un costo guardado hoy, nadie —ni el código— puede decir en qué base está.

**3 · `source_text` y `match_source` están vacíos.**

Las columnas existen desde la 0092 y la 172·D6 las declaró («sin `match_source`
no hay forma de responder *la máquina propuso X y la persona lo corrigió a Y*»),
pero `registrar_items_comprobante_tx` nunca las escribe: el `insert` de la 0085
no las nombra y la RPC ignora las claves de más del JSON.

Medido en el cloud, 2026-09-15:

| | |
|---|---|
| `supplier_invoice_items` | **0 filas** en los tres negocios |
| ídem con `source_text` | 0 |
| `supplier_ingredient_aliases` | 0 |
| comprobantes de compra en `golf-jcr` | 4 (1 factura A, 2 tickets, 1 interno) |

Cero renglones. El lector de la 172 todavía no cargó uno solo de verdad —la
`ANTHROPIC_API_KEY` daba 401 cuando se implementó—, así que **esto se arregla
antes de que haya un solo dato viejo que migrar**. Es la ventana entera.

## Las decisiones

**D1 · El costo de la receta es el NETO, y eso no cambia.**

Es la decisión que hay que escribir antes que ninguna, porque es la que Rocío
está preguntando sin preguntarla.

El negocio es **responsable inscripto**: emite factura A con IVA discriminado
—`invoices` tiene 4 en `demo` y el módulo de la 156 elige A o B solo—. Para un RI
el IVA de compras es **crédito fiscal**: no es costo, se recupera. El kilo de
entrecot que la factura A lista a $17.500 + IVA le cuesta al restaurante $17.500,
no $21.175.

Y del otro lado: el ticket, la factura B, la C del monotributista y la compra sin
comprobante **no dan crédito fiscal**. Ahí el IVA está adentro del precio y no se
recupera, así que el costo es el precio final — que también es el precio impreso.

O sea que **en los dos casos el costo es el número que dice el papel**, que es
exactamente lo que el sistema hace hoy copiándolo. La aritmética ya estaba bien;
lo que falta es que se sepa. Es lo mismo que hace MaxiRest, donde `mxinspre` —el
histórico de precio— coincide con el `precio` de la línea, que en una A es el
neto.

> **Lo que esta spec NO hace, a propósito:** convertir todos los costos a una
> base común «final». Sería fabricar un 21% de costo que el negocio no paga, y
> encima taparía la única señal honesta que hay — que comprarle a un
> monotributista *sale más caro* que comprarle a un RI, aunque el papel diga el
> mismo número.

**D2 · Entonces `price_base` se guarda, no se calcula después.**

Un renglón sabe en qué base está su precio el día que se carga —lo dice el tipo
de comprobante— y nunca más. Si el tipo se corrigiera después (la 163 deja editar
`document_type` mientras no haya pagos), un cálculo derivado reescribiría en
silencio la base de un costo que ya se propagó a las recetas.

Así que la línea guarda `price_base` (`neto` | `final`) y `tasa_iva`, y son
inmutables como `source_text`: se escriben en el `insert` y no se tocan. La regla
que los produce es una función pura de una línea —`baseDelComprobante`— y la
única entrada es el `document_type`: **`factura_a` es neto; todo lo demás es
final.** La factura C no discrimina IVA por definición, así que no es una
excepción olvidada: es final.

**D3 · Lo que no se leyó llega vacío, nunca en cero.**

La regla de la 172·D2, que acá tiene un filo propio: un `iva_cents = 0` en una
factura A no es un dato faltante, es la declaración de que la compra fue exenta.
Sobre el subdiario, eso es crédito fiscal que se pierde — plata.

Las tres columnas nuevas son `null`-ables y el lector manda `null` cuando no
encontró el renglón del pie. Cero es un valor que alguien tipeó.

**D4 · El pie se concilia, se muestra, y no bloquea.**

`neto + IVA + percepciones` tiene que dar el total. Cuando no da, lo que hay es
un número mal leído o un concepto que no modelamos (impuestos internos, un
redondeo del proveedor).

Se aplica la misma política que la 165·D2 con `Σ renglones ≠ total`: **se muestra
la diferencia y se carga igual.** Un CHECK en la base que lo exigiera haría
imposible cargar la mitad de los comprobantes reales, y un formulario que lo
exigiera haría que se tipee cualquier cosa para poder guardar.

La tolerancia es de un peso, que es el redondeo del papel, no el margen de error
de nadie.

**D5 · La tasa por renglón se lee si está impresa, se hereda si no, y sólo sirve
para MOSTRAR.**

La factura A4 con columna `TASA` es la minoría. Cuando está, se copia verbatim
(D1 de la 172: el modelo transcribe); cuando no, el renglón hereda la tasa del
comprobante, que sale del pie (`iva / neto`) o del 21% por defecto.

Y la tasa heredada **nunca escribe plata**: alimenta el «$17.500/kg + IVA 21% =
$21.175 final» de la pantalla de revisión y nada más. Un renglón al 10,5% que se
mostró al 21% es un cartel equivocado; si además escribiera el costo, sería una
receta equivocada.

**D6 · La alarma de salto de precio dice en qué base compara.**

`salto_de_precio` sigue comparando el $/unidad-base nuevo contra el actual, sin
tocar el umbral (±35%, 172). Lo que gana es la etiqueta: si el costo anterior
venía de un ticket y el nuevo de una factura A, el 21% de diferencia es real —el
insumo efectivamente cambió de costo— pero la persona tiene que poder ver **por
qué** antes de decidir que el proveedor le bajó el precio.

**D7 · Se cierra la 172·D6 de paso.**

`source_text` y `match_source` se empiezan a escribir en el mismo `insert` que
gana las columnas nuevas. No es scope creep: es la misma línea de SQL, las
columnas ya existen, el payload ya trae los valores desde la pantalla de
revisión, y sin eso el umbral 0,62 del matcher sigue sin poder medirse nunca.

La firma de `registrar_items_comprobante_tx` **no cambia** — los campos viajan
adentro del `jsonb` —, así que los `grant` y el `revoke` de la 0094 quedan como
están.

## Alcance

**Datos** — migración `0110`:
- `supplier_invoices` += `neto_cents`, `iva_cents`, `percepciones_cents`
  (`bigint`, nullable, `check >= 0`). Van en `bigint` y no en `integer` como
  `total_cents`: esa columna topa en $21.474.836 y no se arregla acá, pero no se
  repite.
- `supplier_invoice_items` += `tasa_iva numeric(5,2)` (nullable,
  `check in (0, 2.5, 5, 10.5, 21, 27)`) y `price_base text`
  (`check in ('neto','final')`).
- `registrar_items_comprobante_tx` escribe las cuatro columnas nuevas más
  `source_text` y `match_source`, con la misma firma.

**Dominio:**
- `src/lib/proveedores/iva.ts` — puro: `baseDelComprobante`, `aFinalCents`,
  `aNetoCents`, `tasaDelPie`, `conciliarPie`, `TASAS_IVA`.
- `schema.ts` — las tres columnas de cabecera en `SupplierInvoiceInput`; `tasa_iva`,
  `price_base`, `source_text` y `match_source` en `SupplierInvoiceItemInput`.
- `lectura/` — `neto`, `iva`, `percepciones` en la cabecera del modelo y
  `tasa_iva` en el renglón (strings verbatim, nullables); el prompt que los pide
  y deja de tirarlos; `unirPaginas` que los une con la regla del pie (última
  página que lo traiga, como el total); `a-propuesta` que propaga la tasa.
- `actions.ts` — pasa las tres columnas al insert.

**UI:**
- Pantalla de carga: bloque «Desglose fiscal» —neto, IVA, percepciones— visible
  sólo para comprobantes que discriminan, precargado de la foto, con la línea de
  conciliación contra el total.
- Pantalla de revisión: por renglón, «$17.500/kg · +21% → $21.175 final», y la
  aclaración de que lo que se carga al costo es el neto.

## Qué NO entra

- **El subdiario de IVA compras como pantalla.** Esta spec guarda los datos que
  hoy no existen; el informe (y el libro IVA compras que lo cruza con ventas) es
  una spec propia, que ahora se puede escribir.
- **Neto por tasa.** MaxiRest guarda tres pares `tasaN`/`ivaN` por comprobante.
  Acá va un neto y un IVA: el comprobante con dos tasas existe (21% y 10,5% en la
  misma factura de almacén) y cuando aparezca se agrega la tabla hija. Modelar
  tres pares fijos hoy es copiar el formulario de MaxiRest, no su uso.
- **Percepciones desagregadas** (IIBB, IVA percepción, Ganancias). Una columna
  suma, porque lo que hace falta para el subdiario es que el pie cierre.
- **Impuestos internos.** No aparecen en ninguno de los comprobantes relevados
  del Golf.
- **Cambiar la base del costo a «final»** (D1). Si el contador dice que la
  condición fiscal del negocio no es la que este spec asume, lo que cambia es una
  función pura de tres líneas — y ese es justamente el punto de guardarla.
- **Reescribir los costos ya cargados.** Son 0 filas (arriba). No hay backfill.

## Escenarios de aceptación

1. **Dado** una factura A que al pie dice NETO $2.045.661, IVA 21% $429.589 y
   TOTAL $2.475.250, **entonces** los tres quedan guardados y la pantalla no
   muestra ninguna diferencia.
2. **Dado** que el pie no cierra por $30, **entonces** se carga igual y la
   pantalla muestra la diferencia.
3. **Dado** que el modelo no leyó el IVA, **entonces** `iva_cents` queda **null**
   —nunca 0— y el campo aparece vacío.
4. **Dado** un renglón de factura A de 82,600 kg × $17.500, **entonces** se guarda
   con `price_base = 'neto'`, `unit_cost_cents = 17.500.000` por el envase de 10
   kg (lo mismo que hoy) y la pantalla dice «$21.175 el kg con IVA».
5. **Dado** el mismo renglón en un ticket, **entonces** `price_base = 'final'` y
   la pantalla no le suma nada.
6. **Dado** una factura C, **entonces** `price_base = 'final'`: no discrimina IVA.
7. **Dado** un renglón con tasa 10,5% impresa en su columna, **entonces** se
   guarda 10,5 y no la del comprobante.
8. **Dado** un renglón sin tasa impresa en una factura A cuyo pie da 21%,
   **entonces** hereda 21 y el costo guardado no cambia ni un centavo.
9. **Dado** cualquier renglón cargado desde el lector, **entonces** `source_text`
   trae el texto del papel y `match_source` de dónde salió la propuesta.
10. **Dado** un renglón corregido a mano en la revisión, **entonces**
    `match_source = 'manual_corregido'`.
11. **Dado** un comprobante interno (sin factura), **entonces** el bloque de
    desglose fiscal no aparece.
12. **Dado** una nota de crédito con neto e IVA, **entonces** los tres importes
    quedan en negativo, igual que el total.

## Verificación

> **Ampliada el mismo día.** La primera versión mostraba el IVA **sólo en la
> pantalla de revisión de la lectura**, y ahí se veía un momento: apenas se
> confirma, esa pantalla desaparece y lo que queda a la vista es el editor manual
> de renglones, que no lo mostraba. Juan lo cazó con una captura —«no marca el
> IVA en ningún lado»— sobre una compra con tipo «Sin comprobante», donde además
> es correcto no mostrarlo.
>
> Ahora el cartel vive en `LineaIva`, un componente solo, y aparece en **las tres
> pantallas**: la revisión, el editor manual y el comprobante ya cargado en la
> cuenta corriente (que lee `price_base` y `tasa_iva` de la fila, así que editarle
> el tipo al comprobante después no le reescribe el cartel a una compra vieja).
> Y dice el **monto en pesos**, no sólo la alícuota: «El kg: $17.500 + $3.675 de
> IVA (21%) = $21.175 final · al costo va el neto».

**Implementada y verificada el 2026-09-15.** `pnpm typecheck` limpio y la suite
entera en verde: **3.274 tests**. La migración `0110` está aplicada **al cloud**
(`tjfufswzsxfujcpoxapx`) y al stack local.

**La aritmética, que es casi todo, corre en CI** (`iva.test.ts`, 25 casos):

- el entrecot del caso de oro, $17.500/kg neto → **$21.175 final** al 21%, y
  $17.500 sobre un ticket, donde no hay nada que sumar;
- `baseDelComprobante` devuelve `neto` **sólo** para `factura_a`, y `final` para
  la C, la B, el ticket, el remito, el interno y lo desconocido — un default al
  revés le restaría un 21% a un costo real;
- `tasaDelPie` deduce el 21 y el 10,5, acepta el 0 como alícuota (no como dato
  faltante) y **se abstiene** cuando el promedio no es ninguna de ARCA, que es lo
  que pasa con una factura de dos tasas: mostrar «IVA 16,3%» sería inventarla;
- `conciliarPie` cuadra el pie real de la factura A, tolera el peso de redondeo
  del papel, suma las percepciones y, cuando no cierra, **dice por cuánto**;
- `parseTasa` lee «21%», «21,00» y «IVA 10,5%», y devuelve null ante «2,1»: un
  dígito mal leído no puede convertirse en 21.

**Contra Postgres de verdad** (`compra-contado-e-iva.integration.test.ts`, local,
negocio propio y descartable) — que es donde vive la mitad de esta spec, porque
`price_base` lo decide la RPC:

- una **factura A** con pie guarda `neto_cents` y `iva_cents`, deja
  `percepciones_cents` en **null** (no en 0), y su renglón queda con
  `price_base = 'neto'`, `tasa_iva = 21`, `source_text` con el texto del papel y
  `match_source = 'fuzzy'` — las dos columnas que la 172·D6 declaró y que tenían
  **0 filas** en los tres negocios;
- **el costo no cambió**: `ingredient_presentations.cost_cents` quedó en
  $175.000, el número del papel, no el final;
- el mismo renglón en un **ticket** queda en `price_base = 'final'` y con
  `tasa_iva` en null: sin tasa impresa no se inventa ninguna, la herencia es sólo
  para mostrar;
- una **nota de crédito** guarda el pie en negativo, como el total.

**En vivo, como Sofía (encargada) sobre `demo`:** en el editor manual de
renglones, con Factura A, la fila dice **«El Bidón 5lt: $2.974 + $625 de IVA
(21%) = $3.599 final · al costo va el neto»**; cambiando el tipo a Ticket el
cartel desaparece —de 1 a 0 líneas en el DOM— y vuelve al elegir Factura A. Con
«Sin comprobante» no hay bloque fiscal; al elegir **Factura A** aparece «Desglose fiscal» con neto, IVA y
percepciones. Cargados el total $2.475.250, neto $2.045.661,16 e IVA $429.588,84
dice **«Cierra contra el total. El IVA es crédito fiscal: al costo de los insumos
va el neto.»**; bajando el IVA a $429.000 pasa a **«Neto + IVA + percepciones da
$2.474.661 y el total dice $2.475.250: hay $589 de diferencia. Se carga igual —
mirá si falta una percepción.»** — y el botón de guardar nunca se bloquea (D4).

### Lo que queda pendiente

**La lectura del pie por el modelo no se pudo probar**: el prompt pide
`neto`, `iva`, `percepciones` y `tasa_iva`, el esquema los valida y `unirPaginas`
los une, pero la corrida real necesita la `ANTHROPIC_API_KEY` del entorno, que
sigue devolviendo 401 desde la 172. Los escenarios 1, 2 y 7 están verificados con
los números cargados a mano; falta confirmarlos leyendo el papel.

**El renglón de la pantalla de revisión** sólo aparece con una lectura en curso,
así que su verificación en vivo depende de lo mismo. El editor manual y el panel
de la cuenta corriente usan el mismo componente y sí están verificados — el
segundo por la query, que devuelve `priceBase` y `tasaIva` desde Postgres.

**El subdiario de IVA compras no existe todavía.** Esta spec guarda los datos;
el informe es la spec siguiente, y ahora se puede escribir.

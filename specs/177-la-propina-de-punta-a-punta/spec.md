# 177 · La propina de punta a punta

**Issue:** [#285](https://github.com/gachetponzellini/RestaurantOS-app/issues/285) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ **implementada** (2026-09-10, migraciones `0099`–`0102` aplicadas
al cloud). **Sin verify por navegador** — ver [Verificación](#verificación).

**Input:** Juan, reunión con KCC del 2026-09-09 y decisiones del 2026-09-10.
Tres pedidos que son el mismo circuito:

1. *"lo que se cobra demás se toma como propina al mozo asignado a la mesa"*
2. *"el vuelto habría darselo a los mozos en la rendición"* — y sobre tarjeta:
   *"yo sacaría efectivo de la caja para darle a los mozos"*
3. *"vamos a tener que manejar en caja un fondo fijo que pueda ir variando"*

Más dos aclaraciones al revisar el diseño: *"el excedente no debería de
facturarse, pero debería quedar registrado todo"* y *"cuánto se lleva cada mozo
sería la propina"*.

**Depende de**: [`098`](../098-tres-decisiones-de-plata/spec.md) (H-09: la
convención `amount` / `tip` — esta spec la refina, ver D5),
[`130`](../130-cerrar-caja/spec.md) (**D2**, que la parte C revierte, y **D3**,
que la hace barata), [`139`](../139-el-cierre-en-papel/spec.md) (la rendición
obligatoria y el papel del cierre),
[`151`](../151-lo-cobrado-por-tarjeta-no-se-rinde/spec.md) (qué se rinde y qué
no), [`140`](../140-los-mozos-en-la-compu-del-salon/spec.md) (la atribución: la
mesa manda), migración `0076` (la distinción bruto / base) y spec 36 · R-C1 (la
propina fuera de la base imponible).

**Número:** la 176 fue la última cerrada; la 174 sigue en curso en otra sesión.

---

## Por qué

Tres agujeros del mismo circuito. Van juntos porque **arreglar sólo la entrada
deja abierta la salida**, y la salida es la que descuadra el cajón todas las
noches.

### 1 · El excedente se comporta distinto según el método

Cuenta de $42.000, el cliente da $50.000:

| Método | Qué pasa hoy | Consecuencia |
|---|---|---|
| **Efectivo** | `cashCharge` acota a $42.000 y muestra «Vuelto: $8.000» ([`totals.ts:93`](../../src/lib/billing/totals.ts)) | El excedente **se descarta**. Si el cliente dijo «quedátelo», el mozo se lo lleva y el sistema no se enteró |
| **Tarjeta / transferencia** | Pasa derecho: se registra un pago de **$50.000** con `tip_cents = 0` | Los $8.000 entran como **venta del negocio**. Arqueo inflado, `total_paid > total`, y el mozo no cobra nada |

El caso de tarjeta no es una feature faltante: es plata mal contada, hoy, en
producción.

### 2 · La propina de tarjeta sale del cajón y el arqueo no se entera

`calculateExpectedCash` descuenta la propina **sólo de los pagos en efectivo**
([`expected-cash.ts:33`](../../src/lib/caja/expected-cash.ts)). La 098 lo dejó
así a propósito: *«una propina cobrada con tarjeta entra a la cuenta del negocio
pero no al cajón físico»*. O sea, el modelo asume que la propina de tarjeta el
negocio se la paga al mozo **por otro lado**.

En KCC no. Sale del cajón. Una noche con $200.000 en efectivo y $100.000 en
tarjeta con $8.000 de propina:

```
El sistema espera en el cajón:   apertura + $200.000
Sacás $8.000 para el mozo    →   apertura + $192.000 contado
                                 ─────────────────────────────
                                 faltante de $8.000, sin una línea que lo explique
```

Y el caso de efectivo tiene el espejo: el sistema **ya** descuenta la propina,
así que si nadie la saca del cajón antes de contar, el arqueo cierra con
**sobrante** hasta que se pague. Con la caja cobrando —que es KCC— eso pasa
siempre: el mozo no está ahí para llevarse su billete.

Las dos diferencias son fantasmas: la plata está donde tiene que estar, el
sistema es el que mira mal.

### 3 · El cajón arranca en cero todas las noches

La spec 130 lo decidió por escrito:

> **D2** — No hay retiro parcial ni fondo de cambio configurable: si mañana
> ponen $50.000 de cambio, eso entra como Ingreso cuando lo ponen. *Es una
> decisión menos en el peor momento del día.*

El argumento era bueno, y **se cae cuando el fondo es fijo**: justamente no hay
nada que decidir a la 1 de la mañana, es un número configurado una vez que el
cierre aplica solo. Y con la parte B encima hay una razón nueva: si la propina
se paga en efectivo del cajón, el cajón necesita tener con qué.

---

## Lo que ya está construido

Cuatro cosas que hacen que esto sea más chico de lo que parece:

**La atribución ya es la que KCC pide.** `deriveAttributedMozo` toma el mozo de
la mesa y sólo cae a `loaded_by` si no hay mesa
([`cobro-actions.ts:147`](../../src/lib/billing/cobro-actions.ts)). No se toca.

**La factura ya excluye la propina.** `emitInvoiceCore` calcula
`facturable = total_cents − tip_cents + ajuste`
([`emit-core.ts:255`](../../src/lib/afip/emit-core.ts)). Esto es lo que hace
posible D1: subir la propina **no cambia el comprobante en un peso**.

**El retiro ya es una sangría de verdad.** La D3 de la 130 lo dejó como línea
del libro y no como columna de `caja_cortes`, justamente para que
`calculateExpectedCash` no se tuviera que tocar. Eso vuelve el fondo fijo casi
gratis: cambia el monto del retiro, no la fórmula.

**La propina por mozo ya se calcula.** `calcularRendicionMozo` devuelve
`total_propinas_cents` y `agruparCobrosPorMozo` lo parte por mozo
([`liquidacion-mozo.ts`](../../src/lib/caja/liquidacion-mozo.ts)). El número
existe; lo que falta es poder pagarlo.

---

## Decisiones

### D1 · El excedente sube `orders.tip_cents` **y** `orders.total_cents`

La alternativa era una propina a nivel pago, fuera del total de la orden —
siguiendo el patrón de la `0076`, que ya separó «el bruto que entró al cajón»
(`amount_cents`) de «lo que cubre la deuda» (`amount − adjustment`).

Se descarta porque **no hace falta**: como la factura ya resta `tip_cents`,
subir los dos deja `facturable = (total + X) − (tip + X) = total − tip`. El
comprobante no se entera. Y a cambio se conserva todo lo demás sin tocar una
línea: `total_paid == total`, el arqueo, la rendición, el ticket de cierre y las
guardas de saldado de la RPC.

Una propina fuera del total obligaría a cambiar la guarda `ORDER_ALREADY_PAID`,
`order_splits.paid_amount_cents` y `fully_paid` — los tres lugares que la 0076
enumera— para ganar exactamente nada.

### D2 · En efectivo se pregunta; en tarjeta es automático

En efectivo, **tipear $50.000 es la forma normal de calcular el vuelto**. Tomar
el excedente como propina por default convertiría cada cálculo de vuelto en una
propina que nadie quiso dar. Así que:

| Método | Excedente | Por qué |
|---|---|---|
| `cash` | **vuelto** por default, propina si lo tildan | El billete grande es el caso normal |
| `card_manual`, `transfer`, `other` | **propina**, sin preguntar | No hay vuelto posible: si se cobró de más, es porque se quiso |
| `mp_link`, `mp_qr` | fuera de alcance | El monto lo fija la preferencia, no el cajero — ver [#286](https://github.com/gachetponzellini/RestaurantOS-app/issues/286) |

### D3 · El billete recibido queda registrado (`payments.received_cents`)

Hoy `payments` no tiene dónde guardar **lo que el cliente entregó**: se persiste
`chargeCents` y el billete se descarta. No se puede reconstruir si de $50.000 se
devolvieron $8.000 o se los quedó alguien.

⚠️ **Esto es lectura mía de una respuesta ambigua.** La pregunta era si
registrábamos el vuelto; la respuesta fue *«el vuelto habría darselo a los mozos
en la rendición»*, que responde otra cosa. Va incluido porque es **una columna
nullable ahora** y una migración con backfill imposible después. Si no lo
querés, se saca sin tocar nada más.

### D4 · Una sola propina por mozo, sin separar origen

*"cuánto se lleva cada mozo sería la propina"*. La que el cliente cargó en la
cuenta y el excedente que apareció al cobrar caen las dos en `tip_cents` y se
suman. Lo que se pierde, dicho para que esté dicho: no se puede auditar después
cuánta propina vino por cada camino.

### D5 · El cajón tiene lo que entró

`calculateExpectedCash` **deja de descontar la propina**. El efectivo esperado
pasa a ser lo que físicamente pasa: todo lo que entró, menos todo lo que salió.

Esto **refina la 098, no la contradice**. El objetivo de la H-09 —que el arqueo
no cierre con una diferencia fantasma— se cumple mejor así: hoy sólo cierra bien
si la propina en efectivo sale del cajón *antes* de contar, y nunca cierra bien
con propina de tarjeta pagada del cajón. Con el pago como movimiento real, los
dos métodos se comportan igual.

⚠️ **Hay 4 tests que fijan la convención actual**
([`expected-cash.test.ts:92,104,114,128`](../../src/lib/caja/expected-cash.test.ts)).
Se reescriben con el porqué en el diff, no se borran.

### D6 · Pagar la propina es un movimiento de caja

`caja_movimientos.kind` pasa de `('sangria','ingreso')` a incluir `propina`, con
el mozo en una columna propia (`mozo_id`) y no en el texto de `reason`.

Por qué un `kind` nuevo y no una sangría con motivo: el reparto del cierre, el
libro y los reportes necesitan poder separar «plata que se llevó el dueño» de
«plata que se le pagó al personal», y una sangría con `reason` libre no lo
permite. Además el `mozo_id` estructurado es lo que hace que la pregunta *"¿le
pagamos a Pedro lo de anoche?"* tenga respuesta.

Sale del cajón como cualquier sangría, así que `calculateExpectedCash` lo
absorbe sin cambios extra.

### D7 · El fondo fijo vive en la caja, y cada cambio queda fechado

`cajas.fondo_fijo_cents`, editable desde Ajustes. La casilla «Retirar todo — $X»
del cierre pasa a «Retirar $X, dejar $Y de fondo», con el retiro calculado como
`contado − fondo`.

El *"que pueda ir variando"* es la parte delicada: **si el fondo cambia, cambia
lo que el arqueo espera**. Un cierre viejo releído con el fondo de hoy da mal.
Por eso el valor efectivo del fondo se congela en el `resumen` del corte (la
`0063` ya guarda un snapshot ahí), y el cambio del fondo queda con su fecha.

### D8 · El bump va adentro de `registrar_pago_tx`

Es plata, y la RPC existe justamente para serializar esto: ya tiene el
`for update` sobre la orden. Hacerlo desde TS después del cobro abre una ventana
donde el total y los pagos no cuadran.

⚠️ `v_order` se lee **al principio** de la RPC, así que `v_fully_paid`
compararía contra el total viejo. Hay que recalcular después del bump.

---

## Qué se construye

### Parte 0 · El prorrateo de splits — **blocker de A**

`cobrar-desktop-client.tsx` le pasa `orderTipCents` —la propina **entera de la
orden**— a **cada tarjeta de split**
([`:342`](<../../src/app/[business_slug]/admin/(authed)/mesa/[id]/cobrar/cobrar-desktop-client.tsx>)
→ [`:629`](<../../src/app/[business_slug]/admin/(authed)/mesa/[id]/cobrar/cobrar-desktop-client.tsx>)),
y cada una la manda como su `tip_cents`. Cuenta de $10.000 con $1.000 de propina
dividida en 3 → quedan registrados **$3.000 de propina**: la venta baja $2.000
en el arqueo y el mozo aparece con el triple en la liquidación. Mismo cableado
en la pantalla del mozo
([`cobrar-client.tsx:555`](<../../src/app/[business_slug]/mozo/mesa/[id]/cobrar/cobrar-client.tsx>)).

Sin splits (cuenta entera) no pasa.

**Es blocker**: con D1 encima, el excedente sube `orders.tip_cents` y ese número
inflado se re-difunde a los splits que falten cobrar. El excedente empeoraría la
cuenta en vez de arreglarla.

El prorrateo correcto ya existe y es el mismo que usa `expectedByAmounts` para
armar los splits ([`totals.ts:229`](../../src/lib/billing/totals.ts)): la
propina de cada split es proporcional a su subtotal, y el último absorbe el
residuo. Hay que **leerlo del split**, no recalcularlo en el cliente.

**Test primero**, y que falle: hoy no hay ninguno que cubra esto.

### Parte A · El excedente es propina

1. `CobroForm`: cuando el monto supera lo que falta, ofrecer **vuelto / propina**
   según D2. En tarjeta el excedente ya es propina y el cartel lo dice, no lo
   pregunta.
2. `registrarPago` deja de acotar ciegamente con `cashCharge`: acota si es
   vuelto, y si es propina manda el excedente como tal.
3. `registrar_pago_tx` sube `orders.tip_cents` y `orders.total_cents` bajo el
   lock, y recalcula `v_fully_paid` contra el total nuevo (D8).
4. `payments.received_cents` guarda el billete (D3).
5. El excedente hereda la atribución que ya calcula `deriveAttributedMozo`.

### Parte B · La propina se paga

1. `caja_movimientos.kind` admite `propina`, con `mozo_id` (D6).
2. `calculateExpectedCash` deja de descontar propina (D5) — y sus 4 tests.
3. En la tab de rendición, junto a lo que el mozo entrega, **cuánto se le debe
   de propina y el botón de pagarla**. El número ya lo da
   `calcularRendicionMozo.total_propinas_cents`.
4. El ticket de cierre y el resumen del corte muestran la propina **pagada**,
   no sólo la devengada.

### Parte C · El fondo fijo

1. `cajas.fondo_fijo_cents` + su campo en Ajustes.
2. `cerrar_caja_tx`: el retiro pasa a `contado − fondo` en vez de `contado`.
3. El modal del cierre lo dice en una línea, sin pedir que nadie calcule.
4. El fondo efectivo se congela en el `resumen` del corte (D7).

---

## Verificación

**Lo que sí está verificado.**

`pnpm typecheck` en verde, `eslint` limpio, **2768 tests** (0 rojos; el único
error de lint del repo, `cuenta.integration.test.ts:296`, es preexistente).

Los tres caminos de plata se probaron **contra la base del cloud**, en `DO` con
`raise` final para revertir — la técnica que ya se usó para el bug de
`text[] || 'campo'`:

| Escenario | Resultado |
|---|---|
| $50.000 sobre una cuenta de $42.000, «quedátelo» | pago `amount=50000 tip=8000 received=50000`, orden `tip=8000 total=50000 paid=50000`, `fully_paid` · **facturable = 42000, sin cambio** |
| Dividida en 2, una sub-cuenta deja $1.000 | **propina registrada = 1000** (no 2000: el bug de la Parte 0 no revive), `expected_amount_cents` intactos, las dos saldadas, facturable sin cambio |
| Los checks de `caja_movimientos` | rechaza propina sin mozo, rechaza sangría **con** mozo, acepta la propina con dueño |
| Cierre con $80.000 contados y fondo de $50.000 | retiro $30.000, el turno siguiente arranca en $50.000 |

**Lo que NO está verificado, y por qué.**

El verify por navegador con el rol real (Sofía, encargada) **no se pudo hacer**:
`.env.local` apunta al stack local (`127.0.0.1:54321`) y Docker no está
corriendo, así que ni el dev server ni `scripts/magic-link.mjs` levantan. Las
migraciones se aplicaron al **cloud**, no a un stack local.

Queda pendiente mirar con los ojos: el tilde «se lo dejan de propina», el cartel
de propina en tarjeta, el modal de rendición pagando, y la casilla del cierre con
el fondo.

## Riesgos

⚠️ **El más grande es D5, y sigue abierto.** `calculateExpectedCash` la leen el
cierre, la pantalla de caja y el resumen del corte. La fórmula nueva **cambia lo
que golf-jcr y kcc ven todas las noches en cuanto esto se deploye**, y los cortes
ya cerrados se releen con ella (spec 149).

Concretamente: hasta ahora el esperado descontaba la propina en efectivo. Desde
el deploy no la descuenta, y sale por el movimiento de la rendición. **En el
período de transición** —propinas cobradas antes del deploy, rendiciones después—
el esperado va a subir por esa propina sin que exista el movimiento que la baja.
El primer cierre después del deploy puede mostrar sobrante por ese monto.

Hay que decidir si se corrige el histórico o se marca un corte hacia adelante,
igual que hizo la 098 con el stock (*"de acá en adelante ajusta solo"*). **No se
hizo nada de eso todavía.**

**La rendición del mozo pide plata que en KCC el mozo no tiene.** La D3 de la
139 excluye de la rendición al operador de la caja y a los encargados, pero la
obligación se calcula por **atribución** (`.eq("attributed_mozo_id", mozoId)`,
[`queries.ts:987`](../../src/lib/caja/queries.ts)). Si en KCC cobra la caja, el
efectivo de Pedro está en el cajón y Pedro igual aparece en «deben rendir». No
descuadra la plata —la rendición es un registro, no un movimiento— pero es un
trámite diario sobre algo que ya pasó. **Confirmar con KCC quién cobra antes de
implementar B.**

---

## Preguntas abiertas

1. ~~¿La propina se paga en cada rendición o se acumula?~~ **Respondida** (Juan,
   2026-09-10): *"la propina que se pague en la misma rendición"*. Por eso
   alcanza con el movimiento de caja y no hace falta saldo por mozo.
2. ~~¿Quién cobra en KCC?~~ **Respondida**: *"los 3 roles pueden cobrar,
   encargado terminal y mozo"*. Eso deja vivo el riesgo de abajo — con la caja
   cobrando, la rendición le pide plata al mozo que el mozo no tiene.
3. ~~¿El fondo es realmente fijo?~~ **Respondida**: *"capaz varía, pero va a ser
   siempre más o menos parecido"* — o sea configurable y estable, que es lo que
   D7 implementa.
4. **¿Se corrige el histórico de arqueos** al cambiar la fórmula, o se marca un
   corte hacia adelante? **Sigue abierta, y bloquea el deploy tranquilo.**
5. **D3 (`received_cents`)** — sigue sin confirmar. Está implementado; si no era
   eso, se saca sin tocar nada más.
6. **Corregir la propina de un cobro no ajusta la orden.** `corregir_pago_tx`
   cambia `payments.tip_cents` y **nunca toca `orders.tip_cents`** (migración
   `0032`). Es una asimetría preexistente —la propina de la cuenta y la etiqueta
   del pago siempre vivieron aparte— pero con el excedente se vuelve visible:
   corregir hacia abajo una propina que subió el total deja la orden cerrada con
   `total > total_paid`. Y si la rendición ya la pagó, al mozo se le pagó de más
   y nada lo rebalancea. Hay que decidir si la corrección debe sincronizar.
7. **La propina sin dueño.** Un pago sin `attributed_mozo_id` («Sin mozo») nunca
   genera pago de propina, así que esa plata se queda en el cajón. Es lo honesto
   —nadie la reclamó— pero conviene decidir si el local quiere sacarla por
   sangría o dejarla.

---

## Archivos

| Archivo | Parte |
|---|---|
| `src/lib/billing/totals.ts` | 0, A — `cashCharge` y el prorrateo |
| `src/components/billing/cobro-form.tsx` | A — vuelto / propina |
| `src/app/[business_slug]/**/cobrar/cobrar-{client,desktop-client}.tsx` | 0 — el `tip_cents` del split |
| `src/lib/billing/cobro-actions.ts` | A — `registrarPago` |
| `supabase/migrations/00XX_*` | A, B, C — `registrar_pago_tx`, `received_cents`, `kind='propina'`, `fondo_fijo_cents`, `cerrar_caja_tx` |
| `src/lib/caja/expected-cash.ts` (+ test) | B — D5 |
| `src/lib/caja/actions.ts` | B — pagar propina |
| `src/components/admin/local/rendicion-mozos-tab.tsx` | B — el botón |
| `src/components/admin/local/cerrar-caja-modal.tsx` | C — el fondo |
| `src/lib/print/cierre-ticket.ts` | B — propina pagada |

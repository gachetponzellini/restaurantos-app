# 187 · La condición de pago: contado o cuenta corriente

**Issue:** [#311](https://github.com/gachetponzellini/RestaurantOS-app/issues/311) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-15)

**Depende de**: [`158`](../158-comprar-y-pagarle-al-proveedor/spec.md) (el
comprobante, el pago y el saldo derivado),
[`160`](../160-la-caja-administrativa/spec.md) (el efectivo sale siempre de la
Caja Mayor y la resuelve el server),
[`161`](../161-las-lecturas-de-proveedores-no-mienten/spec.md) (la RPC
transaccional que se reusa tal cual),
[`173`](../173-cargar-compra-en-pantalla-propia/spec.md) (la pantalla donde entra
el control).

---

## Por qué

**Input — Rocío, encargada del Golf, 2026-09-15, por WhatsApp:**

> *«En la misma carga debería estar la opción de pago»*
> *«Efectivo o cta cte»*

Es el segundo pedido que llega de la primera usuaria real del módulo, una semana
después del primero (el lector de facturas, spec 172). Y es el mismo patrón: la
feature existe entera y está a dos pantallas de distancia.

Hoy el comprobante **siempre** nace como deuda. Para decir «esto ya lo pagué» hay
que guardar, salir a la ficha del proveedor, abrir el diálogo de pago, buscar el
comprobante que se acaba de cargar entre los impagos, tildarlo, elegir el medio y
confirmar. Seis pasos para el caso más común de todos: la verdulería que cobra al
dejar el cajón.

### No es un capricho: es el 36% de los comprobantes

El `Z` de MaxiRest —la compra diaria sin factura— son **1.871 comprobantes, el
36%**, $645 M en 2025-26. En ese tipo el número del comprobante *es la fecha* y
el sentido literal de la fila es *«hoy le pagué $482.100 a la verdulería»*. Un
comprobante que nace debiendo es, en ese caso, una deuda que nunca existió: se
crea y se cancela en el mismo minuto, o —lo más probable— no se cancela nunca y
la cuenta corriente del proveedor queda inflada para siempre.

Y MaxiRest lo tiene exactamente donde Rocío lo pide: en el **pie de la carga**,
como *condición de pago (contado / cta. cte.)* —
[`compras-y-proveedores.md:85`](https://github.com/gachetponzellini/restaurantos-brain/blob/main/wiki/negocio/competencia/maxirest/compras-y-proveedores.md).
Su ayuda (tópico 48) lo dice al revés y dice lo mismo: *«condición "cuenta
corriente" deja el comprobante pendiente»*. O sea: **pendiente es el caso
especial, no el default.**

### El dato ya está impreso en el papel

El prompt del lector tira a la basura, a propósito, una línea que dice justo
esto — [`prompt.ts:79`](../../src/lib/proveedores/lectura/prompt.ts):

> *«Formas de pago: EFECTIVO, TRANSFERENCIA, CTA CTE, CHEQUE»*

Está en la lista de «lo que no es un ítem», que es correcto —no es un renglón—
pero de ahí a descartarlo hay un paso que nadie tomó a propósito. Es cabecera, no
basura.

### Estado medido en el cloud (2026-09-15)

| | |
|---|---|
| comprobantes de compra en `golf-jcr` | 4 |
| pagos registrados (los tres negocios) | 8 |
| imputaciones | 5 |

El módulo recién arranca. Es el momento exacto para arreglar el default: todavía
no hay 300 comprobantes cargados con la condición equivocada.

## Las decisiones

**D1 · La condición de pago NO es una columna.**

Es lo primero que uno quiere hacer —`supplier_invoices.payment_condition`— y es
exactamente lo que la 158·D3 prohíbe: *«la única forma de que un saldo mienta es
que tenga dos fuentes»*.

El saldo se deriva de `Σ comprobantes vivos − Σ pagos vivos`. Si además hubiera
una columna diciendo «contado», habría dos respuestas posibles a «¿está pagado?»
—la columna y la aritmética— y se van a separar el día que alguien anule el pago:
la columna seguiría diciendo contado sobre un comprobante que volvió a deber.

Así que **contado no es un estado: es un pago**. Cargar con condición contado
escribe el mismo `supplier_payments` + `supplier_payment_allocations` que
escribiría el diálogo de pago, imputado al comprobante recién creado, por el
total. Cuenta corriente es la ausencia de eso. La pantalla no gana un modo nuevo:
gana un atajo.

Consecuencia buena: **esta spec no necesita migración**. Ni una.

**D2 · Lo que puede fallar, falla ANTES de crear el comprobante.**

El pago en efectivo tiene tres cosas que pueden decir que no: el permiso de
sangría, que exista la Caja Mayor y que esté activa. Las tres son verificables
sin escribir nada.

Si se chequean después de insertar el comprobante, el «no» llega cuando la
compra ya está cargada y la pantalla tiene que explicar un estado mixto. Si se
chequean antes, el «no» llega con el formulario intacto y todo lo que hay que
hacer es cambiar el medio a transferencia o destildar contado.

**D3 · Si el pago falla igual, el comprobante NO se anula.**

Es la diferencia con los renglones (165·D3), y la razón es que el comprobante sin
pago **es un estado válido del sistema** —es literalmente la cuenta corriente,
donde vivían todos los comprobantes hasta ayer—, mientras que un comprobante sin
sus renglones es un comprobante que *parece* cargado y no movió nada.

Anularlo, además, tendría que revertir los renglones que ya entraron: stock
adentro, costo pisado, `ingredient_price_log` escrito. Deshacer una compra buena
porque falló el paso opcional de después es perder trabajo para dejar la pantalla
prolija.

Entonces: el comprobante queda, la action devuelve `pago_pendiente` con el
motivo, y el toast dice qué pasó y dónde terminar de pagarlo. Un estado raro que
se nombra es un estado raro; uno que se tapa es un bug.

**D4 · `paid_at` es la fecha del comprobante; la sangría es de hoy.**

Contado significa que la plata salió contra ese comprobante, así que el pago se
fecha ahí. El movimiento de caja, en cambio, se estampa cuando se escribe: la RPC
inserta en `caja_movimientos` sin fecha explícita y toma `now()`.

No es una inconsistencia: es que son dos hechos distintos. La Caja Mayor se
entera hoy. Y es la propiedad que hace que esto sea seguro — **cargar el remito
del martes no puede descuadrar el arqueo del martes**, porque el egreso no va al
cajón del turno sino a la caja administrativa, que no corta nunca (160).

**D5 · El efectivo pide lo mismo que una sangría, entre desde donde entre.**

`canMakeSangria` hoy da lo mismo que `canManageProveedores` (admin y encargado
los dos), así que la guarda no cambia el resultado para nadie. Se pone igual, por
la misma razón que la puso la 158: el día que un rol nuevo pueda cargar compras
sin poder tocar el cajón, el techo tiene que estar donde dice el nombre, no donde
quedó por casualidad.

**D6 · La nota de crédito no se paga.**

Su total es negativo (158·D4) y `SupplierPaymentInput` exige monto positivo. En
vez de dejar que reviente en el Zod del pago, el control desaparece de la
pantalla cuando el tipo es nota de crédito.

## Alcance

**Datos:** ninguno. D1.

**Dominio:**
- `schema.ts` — `SupplierInvoiceInput` += `payment_condition`
  (`cuenta_corriente` | `contado`, default `cuenta_corriente`) y
  `payment_method` (los cuatro de `SUPPLIER_PAYMENT_METHODS`, default `cash`),
  con el `refine` que prohíbe contado sobre nota de crédito y sobre importe ≤ 0.
- `actions.ts` — `createSupplierInvoice` resuelve la caja y los permisos antes de
  escribir, y llama a `registrar_pago_proveedor_tx` después de los renglones. El
  `ActionResult` gana `pago` (`registrado` | `pendiente` | `no_aplica`).
- `lectura/` — `condicion_pago` en la cabecera del modelo, el prompt que la pide,
  `unirPaginas` que la propaga, y `condicionDePagoLeida()` puro que mapea el
  texto impreso («CONTADO», «EFECTIVO», «CTA CTE», «30 DÍAS») a la condición y el
  medio.

**UI:** el control en la pantalla de carga, arriba de «Vence» — dos botones
(Cuenta corriente / Pagado) y, con Pagado, el selector de medio y la línea que
dice de dónde sale la plata. El chip de «lo llenó la foto» sobre el control
cuando vino del papel.

## Qué NO entra

- **El pago parcial al cargar.** «Le di $50.000 de los $180.000» existe en
  MaxiRest y acá no: el diálogo de pago ya hace pagos a cuenta y esta pantalla es
  un atajo, no un segundo módulo de pagos. Contado es por el total o no es.
- **La columna de condición de pago** (D1), y por lo tanto el informe de «cuánto
  compré al contado este mes». Sale de los pagos, que ya están.
- **El diálogo viejo** (`invoice-dialog.tsx`). Sigue existiendo por compatibilidad
  y nadie lo abre; agregarle el control sería mantener dos pantallas de carga.
- **Cheque y valores en cartera.** `SUPPLIER_PAYMENT_METHODS` tiene cuatro medios
  y no es esta spec la que discute si faltan.

## Escenarios de aceptación

1. **Dado** una compra cargada con condición cuenta corriente, **entonces** el
   saldo del proveedor sube por el total y no hay ningún pago. Es lo de hoy.
2. **Dado** una compra de $100.000 cargada como contado en efectivo, **entonces**
   el saldo del proveedor no se mueve, existe un pago imputado al comprobante por
   $100.000, y la Caja Mayor tiene una sangría de $100.000 que dice «Pago a
   proveedor · <nombre>».
3. **Dado** contado por transferencia, **entonces** hay pago e imputación y
   **ningún** movimiento de caja.
4. **Dado** un negocio sin Caja Mayor y una compra contado en efectivo,
   **entonces** la action falla **sin crear el comprobante** y el mensaje dice que
   falta la Caja Mayor.
5. **Dado** un rol sin `canMakeSangria`, **entonces** contado en efectivo se
   rechaza antes de escribir nada.
6. **Dado** que el tipo es nota de crédito, **entonces** no se puede elegir
   contado.
7. **Dado** que el comprobante se creó y la RPC del pago falla, **entonces** el
   comprobante queda vivo, el resultado dice `pago: "pendiente"` y el mensaje
   manda a la ficha del proveedor.
8. **Dado** que la foto dice «CONTADO EFECTIVO» en el pie, **entonces** el control
   llega en Pagado · Efectivo, marcado como llenado por la foto, y se puede
   cambiar.
9. **Dado** que la foto dice «CTA CTE 30 DÍAS», **entonces** el control queda en
   Cuenta corriente.
10. **Dado** que el comprobante trae renglones y es contado, **entonces** el orden
    es comprobante → renglones → pago, y si fallan los renglones no se paga nada
    (el comprobante ya se anuló solo).

## Verificación

**Implementada y verificada el 2026-09-15.** `pnpm typecheck` limpio y la suite
entera en verde: **3.274 tests**, 21 nuevos de esta spec.

**El orden, que es toda la decisión, está fijado con mocks del borde**
(`compra-al-contado.test.ts`, 11 casos): sin Caja Mayor o sin permiso de sangría
la action falla con **cero comprobantes creados** y cero RPC llamadas (D2); el
pago va después de los renglones y si los renglones fallan no se paga nada (D3);
si el pago falla, el comprobante queda vivo, `pago: "pendiente"`, y **nadie lo
anuló** —el test afirma sobre los `update`—.

**Contra Postgres de verdad** (`compra-contado-e-iva.integration.test.ts`, local,
negocio propio y descartable): una compra de $482.100 al contado en efectivo deja
las **tres filas**, y se leen de la base:

- `supplier_payments`: $482.100, `method = cash`, `paid_at = 2026-09-15` (la
  fecha del papel, D4), `caja_id` = la Caja Mayor;
- `supplier_payment_allocations`: una imputación contra el comprobante recién
  creado, por el total;
- `caja_movimientos`: `kind = 'sangria'` —el literal que filtra el arqueo— por
  el mismo monto, con motivo «Pago a proveedor · …».

Y la misma compra en cuenta corriente **no escribe ningún pago**: la garantía de
que el default no cambió para nadie.

De paso quedó probado que un negocio nuevo **nace pudiendo pagar en efectivo**:
el test no crea la Caja Mayor, la lee, porque la siembra el trigger
`caja_administrativa_seed_on_business` de la 160.

**El contrato:** sin mandar nada, `payment_condition` sale `cuenta_corriente` y
`payment_method` `cash`, así que el diálogo viejo y todo caller existente cargan
igual que ayer. Una nota de crédito al contado rebota en el Zod con el mensaje
bueno (D6).

**Lo que lee del papel** (`condicion-pago.test.ts`, 6 casos): «CONTADO»,
«EFECTIVO», «CTA CTE», «Cta. Cte.», «A 30 DÍAS» y «Condición: crédito» caen donde
tienen que caer; «CONTADO - TRANSFERENCIA» elige el medio; y el recuadro
preimpreso que nombra las cuatro formas de pago a la vez gana **cuenta
corriente**, porque leer mal un «CTA CTE» como contado inventa una sangría.
`unirPaginas` la toma de la **última** página que la traiga, como el total.

**En vivo, como Sofía (encargada) sobre `demo`:** el control «Cómo se paga»
aparece en la pantalla de carga con Cuenta corriente / Ya la pagué, y la línea de
abajo dice a dónde va la plata antes de apretar («Queda como deuda en la cuenta
corriente del proveedor»).

### Lo que queda pendiente

**El escenario 8 no se pudo probar de punta a punta**: precargar la condición
desde una foto necesita el lector, y la `ANTHROPIC_API_KEY` del entorno sigue
devolviendo 401 (es el mismo pendiente que dejó abierto la 172). Lo que rodea al
modelo —el prompt, el esquema, la unión de páginas y la interpretación— está
verificado sin él.

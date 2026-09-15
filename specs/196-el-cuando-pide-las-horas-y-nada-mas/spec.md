# 196 · «¿Para cuándo?» pide las dos horas y nada más

Issue [#321](https://github.com/gachetponzellini/RestaurantOS-app/issues/321).

## El problema

Juan, cargando un pedido: *«esto quedó muy confuso, como que dice dos veces lo
mismo, lo de nota y hora, cuál de los dos se imprime realmente en la comanda?»*

El paso de datos apilaba **cuatro campos que se leían como dos pares
repetidos** — dos notas pegadas arriba, dos horas pegadas abajo:

| Campo | A qué papel va |
|---|---|
| Nota para el pedido (`delivery_notes`) | ticket de control |
| Nota para cocina (`kitchen_notes`) | comanda |
| Hora de cocina (`kitchen_at`) | comanda |
| Hora del pedido (`scheduled_at`) | ticket de control |

Los cuatro son distintos y los cuatro se usan. El problema no era que sobrara
uno: era que **estaban agrupados por tipo de dato** (las notas con las notas,
las horas con las horas) en vez de por lo que describen. Así, la única forma de
saber cuál de los dos salía en la comanda era leer el texto chico gris — y a
las 21:30, con el cliente esperando en el teléfono, nadie lo lee.

De paso, el placeholder de la nota de entrega («tocar timbre, portón negro…»)
aparecía **también en retiro**, donde no hay timbre que tocar.

## Lo que NO se toca

`kitchen_at` no es informativa: es contra la que se calcula la ventana de
marcha (`marchLeadForOrder`, `src/lib/orders/scheduled.ts`) y el pase a
`preparing`. Meter la hora adentro de un campo de texto libre sería reponer
exactamente el enredo que la spec 127 desarmó — antes la hora vivía dentro de
`kitchen_notes`, y por eso el banner de la comanda imprimía `ENTREGAR <lo que
fuera que hubieras escrito>`.

Las dos horas quedan, las dos a mano, como las dejó la 127. Las cuatro columnas
quedan como están: cero migración, cero cambio de contrato.

## La solución

Cada campo se va con **lo que describe**:

- **«¿Para cuándo?» pide las dos horas y nada más.** Cada una dice a qué papel
  va, en negrita y simétricamente: «Sale impresa **en la comanda**» / «Sale
  **en el ticket de control**».
- **La indicación de entrega baja a pegarse a la dirección**, renombrada a
  «Indicaciones para la entrega», y **sólo existe en delivery**.
- **La nota para cocina se va con el pedido en armado**, que es lo que la
  cocina prepara. No aparece en modo agregar: ahí el pedido ya existe y su nota
  ya se definió — pisarla desde la hoja sería un efecto lateral invisible.

Nunca quedan dos notas juntas, ni una nota al lado de una hora.

**Un bug que el layout destapa:** con el campo de entrega oculto en retiro, una
nota tipeada en delivery y después cambiada a «Para llevar» viajaba invisible
al ticket. Ahora `delivery_notes` se descarta en retiro, igual que ya se hacía
con `delivery_address`.

## Dónde vive

`src/components/admin/cargar-pedido-sheet.tsx` — las tres secciones de la
columna izquierda y el `delivery_notes` del submit.

## Verificación en vivo

`demo` con el rol real de **Sofía (encargada)**, Operación → Pedidos online →
Cargar pedido:

- **Para llevar:** Cliente/Teléfono · «¿Para cuándo?» con las dos horas solas ·
  «Tu pedido» con la nota para cocina. Sin campo de entrega.
- **Delivery:** aparece Dirección + «Indicaciones para la entrega» pegada
  abajo; el resto igual.

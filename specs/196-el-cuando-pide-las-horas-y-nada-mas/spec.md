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

Los campos se agrupan por **papel**, no por tipo de dato. Un recuadro por papel,
con el encabezado diciendo cuál es y quién lo lee:

```
¿PARA CUÁNDO?   [Para hoy] [Programado]

  Para cocina · sale en la comanda
    Hora [HH:MM]   Nota (opcional) [junto con la mesa 5…]

  Para el cliente · sale en el ticket de control
    Hora [HH:MM]
```

**La hora y la nota de cocina se leen como una sola cosa**, que es como se
piensan: son las dos mitades de lo mismo, «qué le digo a la cocina». Siguen
siendo dos campos porque la hora dispara la ventana de marcha — pero el
encargado ve un solo lugar.

**La indicación de entrega no entra acá**: baja a pegarse a la dirección,
renombrada a «Indicaciones para la entrega», y **sólo existe en delivery**. Su
papel es el mismo que el de la hora del pedido, pero su contexto es la
dirección: quien la escribe la está escuchando junto con la calle y el número.

### Una pasada intermedia que no funcionó

La primera versión mandó la nota para cocina al bloque «Tu pedido», con el
argumento de que es sobre cómo sacar esa comida. Juan, viéndolo: *«lo de hora
para cocina y nota para cocina debería de ser un solo campo»*. Tenía razón —
quedaban **dos cosas que decían «cocina» en dos recuadros distintos y lejanos**,
peor que el problema original. Agrupar por papel exige agrupar *todo* el papel.

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

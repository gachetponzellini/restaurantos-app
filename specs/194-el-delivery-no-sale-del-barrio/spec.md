# 194 · El delivery no sale del barrio, y la dirección es un lote

Issue [#319](https://github.com/gachetponzellini/RestaurantOS-app/issues/319).

## El problema

Kentucky Club House (`kcc`) reparte **sólo adentro del club de campo**. El
checkout de la carta le pedía «Dirección · Calle y número», que para ese negocio
no significa nada: el que pide es un socio y el único dato que hace falta es
**su número de lote**. Y encima no lo dejaba escribirlo: el campo exige 5
caracteres y `12` es un lote válido.

Nada avisaba, además, que afuera del barrio no se entrega — se enteraban por
teléfono, después de armar el carrito.

## La solución

Un solo lugar decide cómo se pide el lugar de entrega:
`src/lib/orders/entrega-por-lote.ts`. Para los negocios del set (hoy `kcc`):

- el campo se llama **«Nro de lote»**, con placeholder `Ej: 124` y teclado
  numérico en el celular;
- el mínimo baja de 5 caracteres a 1 — `12` entra;
- se esconde **«Piso / depto»**, que adentro del barrio no aplica;
- aparece el cartel **«Hacemos envíos sólo dentro del barrio»** en el checkout y
  en el resumen del carrito;
- las direcciones guardadas pasan a ser «Mis lotes».

**No valida zonas ni geocodifica.** El propio campo es la restricción: lo único
que se puede escribir es un lote. Si entra uno de afuera, lo resuelve el local.

Para el resto de los negocios **no cambia nada**: mismo label, mismo mínimo,
mismo piso/depto.

## Dónde vive

| Archivo | Qué hace |
|---|---|
| `src/lib/orders/entrega-por-lote.ts` | `copyDeEntrega(slug)` y `lugarDeEntrega(slug, address)`. El set `NEGOCIOS_POR_LOTE` es el único lugar con un slug escrito. |
| `src/components/checkout/checkout-form.tsx` | Cartel, label, placeholder, mínimo, piso/depto. |
| `src/components/cart/cart-page-client.tsx` | El aviso, en el resumen. |
| `src/components/admin/cargar-pedido-sheet.tsx` | El encargado/telefonista pide lo mismo: «Nro de lote (requerido)». |
| `src/components/admin/order-detail-sheet.tsx`, `admin/(authed)/pedidos/[id]/page.tsx` | El pedido se lee **«Lote 124»**, no `124` suelto. |
| `src/lib/print/control-ticket.ts` + `api/print-agent/route.ts` | El papel del repartidor dice `Lote: 124` en vez de `Direccion: 124`. El ticket recibe `business_slug`. |
| `src/components/public/addresses-screen.tsx`, `profile-screen.tsx`, `admin/customers/customer-detail.tsx` | «Lotes» donde decía «Direcciones». |

Sin migración: lo guardado en `orders.delivery_address` sigue siendo el mismo
texto libre; el prefijo «Lote » es de presentación.

## Por qué un set en el código y no una columna

Es la decisión de **un** negocio y nadie la va a cambiar desde una pantalla. El
set centralizado evita los `if (slug === "kcc")` desparramados por los seis
formularios que muestran la dirección, y el día que haya que configurarlo se
reemplaza el cuerpo de `copyDeEntrega` por una lectura de `businesses` sin tocar
ninguna vista.

## Tests

`entrega-por-lote.test.ts`: el copy de `kcc` vs. el del resto, el mínimo que
deja pasar `12`, y `lugarDeEntrega` (prefija «Lote», no lo duplica si el cliente
ya lo escribió).

## Verificación en vivo

Local, con `demo` agregado al set a mano y revertido después:

- `/demo/carrito` → «Retiro en local sin cargo… **Hacemos envíos sólo dentro del
  barrio.**»
- `/demo/checkout` → ENTREGA: el cartel, **Nro de lote** (`Ej: 124`), sin piso /
  depto. Confirmar vacío da «Completá tu número de lote»; con `12` el error se
  va (antes rebotaba por el mínimo de 5).
- Operación → Pedidos online → Cargar pedido → Delivery, como **Sofía
  (encargada)**: «Nro de lote (requerido)», `Ej: 124`, y la guarda dice «El
  delivery necesita el número de lote».
- Revertido el set, `/demo/checkout` vuelve a «Dirección» + «Piso / depto», sin
  cartel.

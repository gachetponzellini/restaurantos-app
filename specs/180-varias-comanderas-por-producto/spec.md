# 180 · Varias comanderas por producto

**Issue:** [#292](https://github.com/gachetponzellini/RestaurantOS-app/issues/292) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ **implementada y verificada en vivo** (2026-09-13, migración `0105`
aplicada al cloud y al local; config real de KCC y Golf importada)

**Input:** KCC, reunión del 2026-09-09: *"la comandera de cocina imprime todas
las comandas, es como una comandera maestra"*. Y las fotos de la encargada
(2026-09-13): la pantalla de artículo de MaxiRest con **1ª / 2ª / 3ª
Comandera** por producto, y los tres tickets de un mismo pedido. Decisiones de
Juan sobre eso: *"copiá el modelo de MaxiRest"*, *"la copia de cocina es una
comanda"*, la 2ª/3ª se configura por categoría con override por producto, no
hay barra con comandera, y revisar los dos backups para importar la config.

**Depende de**: [`28`](../../../../wiki/specs/28-comanderas-config-por-sector/)
(el sector por producto/categoría y su impresora), [`05`](../../../../wiki/specs/05-estados-pedido-y-comandas/)
(la comanda con estado y el kanban), [`035`](../../../../wiki/specs/35-reimpresion-y-fallos-de-impresion/)
y [`049`](../049-comanda-anulada-ticket/spec.md) (reimpresión y anulación por
comanda), [`124`](../124-print-agents-por-alcance/spec.md) (por qué el acuse
tiene que ser por identidad propia).

---

## Por qué

### No hay comandera maestra

Lo que parecía un flag es configuración: MaxiRest deja elegir **hasta tres
comanderas por producto**. Cocina "sale con todo" porque le pusieron COCINA como
2ª comandera a cada plato — y a la Heineken no le pusieron ninguna. La encargada
lo dijo con todas las letras: *"eso lo elegimos nosotros, qué producto sale en
cada comanda, y si sale o no en la cocina"*.

Los tres tickets del pedido de la mesa 7 (entrecot, papas, pollo):

| Papel | Ítems propios | Combina con |
|---|---|---|
| **COCINA** | los tres | *(nada — todo está acá)* |
| **FRITERA** | papas | entrecot, pollo |
| **PARRILLA** | entrecot, pollo | papas |

Es exactamente lo que ya imprime `otros_sectores`, si el ruteo fuera multi-sector.

### Y ya estaba anotado

El relevamiento de KCC ([`kcc-relevamiento-maxirest.md`](../../../../wiki/negocio/kcc-relevamiento-maxirest.md))
lo tenía como **gap #1, impacto alto**: *"96 artículos (29%) imprimen en 2 o 3
comanderas a la vez. `resolveStation()` devuelve una sola station. Sin esto, la
napolitana no llega a la fritera."* Y un segundo hallazgo que esta spec también
cierra: *"9 productos que en MaxiRest no imprimen comanda pero cuya categoría sí
tiene sector: en RestaurantOS van a imprimir en Cocina. No hay forma de decir
«este producto no imprime» cuando su categoría tiene sector."*

## Lo que ya está construido

Casi todo. **El ruteo ya es un `Map<station, items[]>`** y
`createComandasForItems` crea una comanda por sector con `batch` propio
([`route-items.ts`](../../src/lib/comandas/route-items.ts)). **`comanda_items`
ya admite el mismo ítem en dos comandas**: su PK es el par `(comanda_id,
order_item_id)`, sin único sobre el ítem. Cada comanda ya tiene su impresora, su
acuse, su reimpresión y su anulación. Lo que falta es que el ruteo meta el ítem
en más de un bucket — y cuidar dos lugares que hoy asumen "un ítem, una comanda".

---

## Decisiones

### D1 · El modelo de MaxiRest, con la herencia que ya tenemos

`products.station_id` sigue siendo la **1ª comandera** — el sector principal,
el que cocina. Se suman:

- `products.extra_station_ids uuid[]` · `null` = hereda de la categoría, `[]` =
  ninguna extra, `[a, b]` = 2ª y 3ª.
- `categories.extra_station_ids uuid[]` · el default del rubro.
- `products.sin_comanda boolean` · **no imprime en ningún lado**, aunque la
  categoría tenga sector. Es la Heineken, y los 9 postres del relevamiento.

`resolveStations()` devuelve la lista, primaria primero, sin repetidos.
`resolveStation()` queda como `resolveStations()[0]` para los que sólo necesitan
el principal (`order_items.station_id`).

Por qué arrays y no una tabla `product_stations`: son dos valores como máximo,
se leen en cada ruteo junto con `station_id`, y heredan las policies que las
tablas ya tienen. El costo es que un `uuid[]` no tiene FK: cuando se borra un
sector, `eliminarSector` lo saca de los arrays con `array_remove`.

### D2 · La copia es una comanda, y la 1ª comandera manda el estado

Decisión de Juan: *"la copia de cocina es una comanda"*. Cada sector de la
lista recibe **una fila de `comandas`** con su estado, en el kanban, con su
acuse y su reimpresión. Nada nuevo que mantener.

Lo que hay que cuidar: hoy marcar una comanda «entregada» **espeja
`kitchen_status = delivered` a todos sus ítems**. Con la comanda de cocina
llevando las papas de fritera, marcarla entregaría las papas que fritera no
terminó — y la mesa dejaría de verse demorada por un plato que no salió.

Regla: **el estado de un ítem lo mueve sólo la comanda de su sector principal**
(`order_items.station_id === comandas.station_id`). La comanda de cocina puede
marcarse entregada —es su papel, su estado— pero no toca las papas. Es lo que
significa «1ª comandera» en la pantalla de MaxiRest: la que cocina.

### D3 · «Combina con» es lo que NO está en este papel

Hoy se calcula por sector: *"los ítems del envío cuyo `station_id` no es el
mío"*. Con la comanda de cocina llevando las papas, las papas aparecerían **dos
veces**: como propias y en «combina con». Pasa a calcularse por **membresía**:
lo del envío que no está en `comanda_items` de esta comanda. En la foto, COCINA
no tiene «combina con» — y con esta regla, tampoco.

### D4 · Las bebidas siguen sin comanda

KCC no tiene barra con comandera. Las bebidas quedan como hoy: sin sector, sin
papel, las lleva el mozo. `sin_comanda` es para cuando la categoría sí tiene
sector y el producto no debería imprimir.

### D5 · La config real se importa, no se carga

Los dos catálogos vinieron del backup de MaxiRest y **el backup tiene la
config** (`mxart.comanda1/2/3`). Para KCC ya está extraída con códigos por
artículo en [`kcc-carta-20260720.md`](../../../../raw/maxirest/kcc-carta-20260720.md)
(`1` Cocina · `Z` Fritera · `[` Parrilla). Para Golf hay que levantar el datadir.
Cargar «cocina» 200 veces a mano no es una opción cuando el dato existe.

---

## Qué se construye

1. **Migración `0105`**: las tres columnas.
2. **`resolveStations`** en `routing.ts`, con tests.
3. **El ruteo** mete el ítem en cada bucket: `enviarComanda` (ítems, huérfanos,
   hijos de menú) y `routeOrderToCocina`.
4. **D2** en `marcarComandaEntregada` y `advanceComandaStatus`.
5. **D3** en `agruparOtrosSectores` del GET del agente, con test.
6. **`eliminarSector`** limpia los arrays.
7. **Editor de producto** (2ª, 3ª, «no imprime») y **de categoría** (2ª, 3ª).
8. **Importación** KCC (y Golf).

## Archivos

| Archivo | Qué |
|---|---|
| `supabase/migrations/0105_varias_comanderas_por_producto.sql` | esquema |
| `src/lib/comandas/routing.ts` (+ test) | `resolveStations` |
| `src/lib/comandas/actions.ts`, `src/lib/orders/route-to-cocina.ts` | ruteo multi-bucket + D2 |
| `src/app/api/print-agent/route.ts` (+ test) | D3 |
| `src/lib/catalog/schemas.ts`, `station-actions.ts` | validación y limpieza |
| `src/components/admin/catalog/product-form.tsx`, `category-dialog.tsx` | UI |
| `scripts/import-comanderas-maxirest.*` | D5 |

## Importación (D5)

| Negocio | Fuente | Con 2ª/3ª | `sin_comanda` | Notas |
|---|---|---|---|---|
| **kcc** | `raw/maxirest/kcc-carta-20260720.md` (cmd1/2/3 ya extraídos) | **94** (48 +Cocina, 16 +Fritera, 27 +Parrilla, 3 +Fritera+Parrilla) | **9** | los 9 postres del relevamiento; el código `2` (3 ítems de cafetería) sin destino identificado, se saltearon |
| **golf-jcr** | `mxart.comanda1..3` del datadir (`Exp.rar`, levantado en Docker) | **3** (los lomitos, +Cocina) | **15** | Golf casi no usa la 2ª: 5 artículos en total, 1 descontinuado, 1 con la extra igual al principal. Códigos inferidos cruzando `comanda1` con el sector que ya tenían en la nube: `1` Cocina · `4` Fritera · `S` Parrilla · `6` Postres y Café · `T` Cocina |

Script reproducible para KCC: `scripts/import-maxirest-comanderas-kcc.ts`.
Golf se hizo a mano sobre el dump (los pasos están en el log del brain).

## Verificado en vivo

Stack local sembrado. Como **admin**: en el editor de «Papas Fritas» (sector
Fritera) se ve «También imprime en: 2ª · Cocina / 3ª · ninguna», el texto
«Propio de este producto · Volver a heredar», y el tilde «No imprime comanda».
Se guardó Cocina como 2ª.

Como **Sofía**, en la mesa R01, un envío con Papas Fritas + Lomito Simple →
toast **«Enviado · 3 comandas»**. El GET del agente sirvió los tres papeles:

| Papel | Ítems | Combina con |
|---|---|---|
| FRITERA | Papas Fritas | Lomito Simple |
| **COCINA** | Papas Fritas | Lomito Simple — **las papas no se repiten abajo** (D3) |
| PARRILLA | Lomito Simple | Papas Fritas |

Exactamente la foto de la encargada. Y D2 en las dos direcciones:

- Cocina «Empezar» → «Entregar»: la comanda de cocina queda `entregado` y
  **Papas Fritas sigue `pending`**. Antes habría pasado a `delivered`.
- Fritera «Empezar»: **Papas Fritas → `preparing`**. Su sector principal sí la
  mueve.

Tests: 13 del ruteo, 1 del «combina con» por membresía, 2808 en total.

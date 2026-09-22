# 207 · La pizza es un ítem con gustos

**Issue:** [#373](https://github.com/gachetponzellini/RestaurantOS-app/issues/373) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ aplicado (2026-09-21). Juan aprobó la opción 2 *"como excepción
para las pizzas"* y dio el OK para migrar los datos de kcc. Código en verde,
datos migrados, verificado en vivo en `https://restaurant.mithandir.com/kcc/carta`
con el rol público real (sin login, sin service_role).

**Input:** audio de kcc (2026-09-21): *"las pizzas se pueden agrupar en un solo
ítem y que apretando en pizzas estén las opciones de las diferentes pizzas con
sus respectivos precios […] si no hay pizzas yo tengo que sacar todos los
gustos. En cambio si hay un solo ítem saco el stock de pizzas en general y ya está."*

## Por qué

Hoy kcc tiene 4 productos sueltos en *Pizzas* (Muzarella $16.000, Napolitana
$18.000, Especial $22.000 y Veggie $22.000). Cuando se queda sin masa tiene que
apagarlos de a uno. El catálogo ya sabe expresar «un producto con opciones
que suman precio» (`modifier_groups` + `price_delta_cents`), pero muestra
«+$2.000», y la carta del QR no muestra los adicionales. Si se modela la pizza
así, la carta pierde los gustos.

## Qué cambia

**ADDED — `modifier_groups.is_variant`** (boolean, default `false`). Es opt-in:
un grupo que no está marcado se comporta exactamente como hoy. Es la excepción
que se pidió, no un cambio general a los adicionales.

### R1 · Forma del grupo variante (Zod, `schemas.ts`)
- Dado un grupo con `is_variant = true`, Cuando no es `min 1 / max 1 / obligatorio`, Entonces se rechaza.
- Dado un producto con dos grupos variante, Cuando se guarda, Entonces se rechaza (a lo sumo uno).

### R2 · Precio final (`lib/catalog/variantes.ts`, puro)
- El precio de un gusto es `price_cents + price_delta_cents` del producto.
- El rango de un producto con variante sale de los gustos **disponibles**. Sin variante, el rango es su precio.
- Etiqueta: si el mínimo difiere del máximo, «desde $mín»; si no, el precio.

### R3 · Mozo y web muestran precio final
- Dado el grupo variante, Cuando se listan sus opciones en `product-modal` (mozo) o en `product-sheet` (web), Entonces cada una muestra el precio final, sin «+», y no aparece la etiqueta «sin cargo».
- La card y el header del producto muestran «desde $X».
- Los otros grupos no cambian.

### R4 · Carta del QR
- Dado un producto con variante, Cuando se dibuja en `/carta`, Entonces sale **una fila por gusto disponible**: «{producto} {gusto} ····· $final». Visualmente es igual a la carta de hoy, con los productos sueltos.
- Si el producto está apagado, se dibujan todas las filas tachadas (como hoy un producto agotado).

### R5 · Disponibilidad
- Apagar el producto «Pizza» apaga todos los gustos: no cambia nada, es el `is_available` del producto.
- Un gusto puntual se apaga con el `is_available` del modificador, que ya existe. El mozo ya lo oculta.
- **Caso borde (agregado en code-review, no estaba en la propuesta original):**
  si se apagan **todos** los gustos de a uno sin apagar el producto, «Pizza»
  queda técnicamente prendida pero sin nada que vender. Se trata como agotada:
  en la carta y en la card sale tachada/al precio base sin ofrecerse
  (`estaAgotado`), y el mozo directamente no la lista.

### R6 · Admin
- El editor de grupos tiene un switch «Variante (precio final)». Al prenderlo fija min 1 / max 1 / obligatorio.

## Fuera de alcance
- Recetas o costeo por gusto (costeo es para más adelante).
- Menú del día y chatbot: siguen viendo el grupo como un adicional común.
- Reportes por gusto: la venta queda como «Pizza» + modificador.

## Datos kcc — aplicado (2026-09-21)
«Pizza» ($16.000, categoría *Pizzas*) con el grupo «Gusto» (variante):
Muzarella +0, Napolitana +2.000, Especial +6.000 y Veggie +6.000. Los 4 productos
viejos (sin ventas) quedan `is_active=false, is_available=false, show_online=false`.

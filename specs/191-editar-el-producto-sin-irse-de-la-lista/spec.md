# 191 · Editar el producto sin irse de la lista

Issue [#315](https://github.com/gachetponzellini/RestaurantOS-app/issues/315).

## El problema

Editar un producto en **Productos e inventario → Productos** era una navegación
entera a `/admin/catalogo/productos/[id]`, y volver a la lista era otra. Dos
round-trips de RSC contra la nube para cambiar un precio. Con 398 productos en
el demo, corregir varios seguidos es pagar la ida y la vuelta cada vez.

Y lo que se pagaba ya estaba pago: la lista del admin trae **el producto
entero** (`getAdminCatalog` selecciona los mismos campos que `getAdminProduct`,
grupos de adicionales y modificadores incluidos). La página de edición volvía a
pedir al server lo que el browser ya tenía en memoria.

## La solución

El click en la fila abre un **modal**. El form se pinta con el producto que la
lista ya tiene: abrir no espera nada.

Lo único que el modal no tiene es la **receta** — y es justo el pedazo caro
(`calculateFoodCost` resuelve recursivamente el costo de los insumos
compuestos). Se trae al abrir, con un esqueleto mientras llega, sin bloquear la
edición de lo demás. Los insumos del buscador de la receta tampoco se piden:
salen de `ingredients`, que el shell del catálogo ya carga para la tab Insumos.

## Decisiones

- **La página `/admin/catalogo/productos/[id]` se conserva.** La fila sigue
  siendo un `<a href>` y sólo se intercepta el click normal: cmd/ctrl/shift/alt
  + click abren la página como en cualquier lista. El link directo (un
  favorito, algo pegado en Discord) sigue funcionando.
- **El modal guarda el `id`, no el producto.** Cuando guardar dispara
  `router.refresh()`, la lista vuelve del server y el modal tiene que mostrar
  esa fila, no la copia con la que se abrió. Los `defaultValues` del form se
  capturan una sola vez, así que un refresh no pisa lo que estás tipeando.
- **Guardar vive en el footer fijo**, afuera del `<form>` (lo ata `form={id}`).
  Para eso `ProductForm` acepta `onSubmittingChange`: el botón de afuera
  necesita saber cuándo bloquearse.
- **Eliminar** entra al footer en modo `compact` y, con `onDeleted`, cierra el
  modal en vez de empujar un `router.push` a la página en la que ya estabas.

## Dónde vive

- [`product-dialog.tsx`](../../src/components/admin/catalog/product-dialog.tsx) — el modal.
- [`catalog-client.tsx`](../../src/components/admin/catalog/catalog-client.tsx) — `editingId` + los insumos derivados.
- [`product-row.tsx`](../../src/components/admin/catalog/product-row.tsx) — el click interceptado.
- `fetchProductRecipe()` en [`ingredients/actions.ts`](../../src/lib/ingredients/actions.ts), con gate `requireCatalogAdmin` + scope de tenant sobre el `productId` (viaja desde el browser).

## Fuera de alcance

«Nuevo producto» sigue siendo página: se usa mucho menos y no tiene lista
detrás de la cual quedarse.

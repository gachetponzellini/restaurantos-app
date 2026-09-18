# 205 · Catálogo rediseñado: listas y editores de las 7 tabs

**Issue:** [#334](https://github.com/gachetponzellini/RestaurantOS-app/issues/334) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 🚧 en curso (2026-09-18) · mockup: https://claude.ai/artifact/L99GnYFRkpgrNkxdPaCKCM

**Depende de**: 204 (anatomía de modales, `components/ui/modal.tsx`), 065 (filtros
persistidos), 180 (2ª/3ª comandera).

## Por qué

Juan (2026-09-18): *"le podríamos hacer un rediseño, para que la ux/ui y navegabilidad
sea mucho mejor al modal que se abre y al listado de productos, en la vista del
encargado / admin"*. Aprobado el mockup de Productos, pidió *"expandirlo al resto de las
tabs del catálogo"*.

Relevamiento en vivo (`/demo/admin/catalogo`, como Sofía, 398 productos):

**Lista**
- Cada producto es una tarjeta de ~115px con **sólo nombre y precio**: entran 4 por
  pantalla; recorrer 398 es scrollear ~45 pantallas.
- No se ve la categoría, el sector/comandera, si está en la carta online, si tiene
  adicionales ni el food cost: para saber cualquiera de esas cosas hay que abrir el modal.
- 20+ categorías como chips que ocupan dos filas arriba de la lista; la lista es plana
  (no agrupa), así que filtrando «Todas» no se sabe dónde termina una categoría.
- Prender/apagar «disponible» (lo más frecuente en servicio) exige abrir el modal,
  buscar el checkbox al fondo y guardar.
- Estado «oculto» (`is_active=false`) sólo es un ojito tachado de 12px.

**Modal**
- Un solo scroll largo de ~14 campos + adicionales + receta, sin índice: para llegar a
  «Disponible» o a la receta hay que scrollear todo.
- Mezcla lo técnico (slug) con lo importante al mismo nivel; textos de ayuda largos
  debajo de cada campo.
- Los tres estados (`is_available`, `is_active`, `show_online`) son tres checkboxes en
  una fila con etiquetas que se confunden («Activo (visible en el menú)» vs «Mostrar en la
  carta online»).
- No hay forma de pasar al producto siguiente: editar precios de 20 bebidas = abrir,
  guardar, cerrar, buscar, abrir… ×20.
- Guardar y cerrar son lo mismo; no hay aviso de cambios sin guardar al cerrar.
- Food cost de la receta no está junto al precio, que es donde importa.
- «Nuevo producto» navega a otra página con otro layout.
- Estilo propio (Dialog shadcn retocado), fuera de la anatomía de la 204.

## Qué

### D1 · Lista densa agrupada por categoría

- Filas de ~52px en una tabla: miniatura 34px · nombre + descripción en una línea ·
  **Comanda** (sector efectivo, con «+ 2ª/3ª» si tiene; «Sin comanda» si `sin_comanda`)
  · **Precio** · **Food cost %** (de `getCosteoOverview`, ya se trae en la página; color
  por umbral ≤30 / ≤40 / >40; «sin receta» si no hay) · **switch Disponible**.
- Agrupada por categoría con header pegajoso (nombre + cantidad), en el orden de la carta.
- Pills de estado en la fila: `Agotado` (`!is_available`), `Fuera de la carta online`
  (`!show_online`), `De baja` (`!is_active`, fila atenuada, switch deshabilitado),
  `N grupos de adicionales`.
- En teléfono: nombre + precio + switch; comanda y food cost se esconden.

### D2 · Navegación y filtros

- **Categorías en una columna lateral** (desktop) con conteos; en teléfono, barra
  horizontal scrolleable. Reemplaza las dos filas de chips.
- Toolbar pegajosa: búsqueda (atajo `/`), estado como control segmentado con conteos
  **Todos · Disponibles · Agotados · Ocultos** (Ocultos = fuera de la carta online o de
  baja — hoy no hay forma de listarlos), selector de sector.
- Contador «N de 398 productos» y estado vacío con «Limpiar filtros».
- Teclado: `↑`/`↓` mueve la selección, `Enter` abre, `Esc` limpia la búsqueda.
- Se mantienen: filtros persistidos por máquina+negocio (065 · FR-007), búsqueda no
  persistida (FR-008), cmd+click abre la página del producto.

### D3 · Disponibilidad desde la fila

El switch de la fila cambia `is_available` sin abrir el modal (`toggleProductAvailability` en `lib/catalog/product-actions.ts`, ya existe;
optimista con rollback y toast de error). Es la acción de servicio: «se
acabó el salmón».

### D4 · Modal de producto con secciones

Sobre `ModalContent size="xl"` de la 204 (ancho ~880px), alto fijo, footer fijo.

- **Header**: miniatura, categoría (eyebrow), nombre, pills de precio y estado;
  **‹ 3 / 42 ›** para ir al producto anterior/siguiente **dentro de la lista filtrada**
  (atajos `←`/`→` fuera de un input); cerrar.
- **Índice lateral** (scroll-spy) con cinco secciones; en teléfono, tabs horizontales:
  1. **Básico** — imagen, nombre, categoría, descripción. Slug pasa a «Avanzado»
     (colapsado, «Dirección en la carta», se autogenera del nombre).
  2. **Precio y costo** — precio base + tarjeta costo receta / food cost / margen, con
     «Editar receta» (la `RecipeSection` actual). Sin receta: CTA «Cargar receta».
  3. **Adicionales** — grupos como tarjetas (nombre, regla «elegí 1 · obligatorio»,
     opciones con delta); el editor actual se abre por grupo. Conteo en el índice.
  4. **Cocina e impresión** — switch «Imprime comanda» (invierte `sin_comanda`; si está
     apagado se ocultan los demás); sector principal y «También imprime en» como chips
     (con chip «Hereda · X»); tiempo de preparación.
  5. **Visibilidad** — tres switches con explicación, de más operativo a más definitivo:
     **Disponible ahora** · **En la carta online** · **Activo**.
- **Footer**: Eliminar (izq., confirmación `ModalContent sm` tono danger) · estado
  («● Cambios sin guardar» / «✓ Guardado») · Cancelar · **Guardar** (`⌘↵`).
- **Guardar no cierra**: queda abierto con «✓ Guardado» para seguir con ‹ ›. Cerrar o
  navegar con cambios pendientes pide confirmar descartarlos.
- **Nuevo producto** abre el mismo modal vacío (categoría del filtro activo precargada)
  en vez de navegar. La página `/productos/nuevo` y `/productos/[id]` quedan para links
  directos.

### D6 · Un solo patrón para las 7 tabs

Lo que se definió para Productos (D1–D4) es el patrón de **todo** el catálogo:
**toolbar pegajosa → tabla densa agrupada → el mismo editor** (`ModalContent xl` con
header ‹ ›, índice de secciones, footer «Guardar no cierra» + guard de cambios).

- **Tabs agrupadas** en tres familias con rótulo chico: **Carta** (Productos, Categorías,
  Menú del día) · **Cocina** (Sectores) · **Costos e inventario** (Insumos, Costeo, Stock).
  Badge rojo con conteo en las tabs que tienen algo que atender (Costeo: platos que
  pierden plata; Stock/Insumos: bajo mínimo).
- **La acción principal de cada tab va en el header**, siempre en el mismo lugar
  («Nuevo producto», «Nueva categoría», «Nuevo menú», «Nuevo sector», «Nuevo insumo»,
  «Ingresar mercadería»). Hoy cada tab la pone en otro lado. Las secundarias
  («Nueva supercategoría», «Importar CSV») van al lado, en botón neutro.
- **Editores enlazados**: todo nombre de otra entidad dentro de un editor es un link
  que abre su editor (categoría → producto, sector → categoría, insumo → producto que lo
  usa, receta → insumo, menú → producto). Se apilan: el header muestra «‹ Volver a X» y
  `Esc` vuelve un nivel. Los cambios sin guardar piden confirmar antes de saltar.

### D7 · Categorías

- Una tabla con las **supercategorías como headers de grupo** (punto de color + ícono +
  «N categorías · N productos»); click en el header abre el editor de la supercategoría.
- Fila: manija de arrastre (reordena la carta), nombre + slug, productos, comanda por
  defecto (+ 2ª/3ª).
- Editor de categoría: **Básico** (nombre, supercategoría, slug en Avanzado) · **Comanda**
  (sector y «también imprime en» como chips; aviso de productos con sector propio) ·
  **Productos** (lista enlazada + «Nuevo producto en X»).
- Editor de supercategoría: nombre, ícono (grilla), color (swatches), categorías enlazadas.

### D8 · Menú del día

- Banda **«Hoy · <día>»** con lo que el cliente ve ahora (reemplaza la caja «Activo
  ahora»).
- Fila: nombre + pasos («Entrada · Principal · Postre»), tira de días L‑D, precio,
  switch Disponible, pills «Hoy en la carta» / «Salón» / «Carta online».
- Editor: **Básico** (nombre, precio cerrado, descripción) · **Cuándo y dónde** (días
  como chips con atajos «Lunes a viernes / Fin de semana / Todos», salón/online,
  Disponible hoy, Activo) · **Componentes** (cada paso como tarjeta, opciones enlazadas
  a su producto).

### D9 · Sectores

- Grilla de tarjetas (son 4–6): nombre, **«N productos imprimen acá»**, categorías que
  rutean, pill «2ª comanda de …», pill de productos con sector propio. Tarjeta punteada
  «Nuevo sector».
- Editor: nombre (título de la comanda impresa) · **Qué imprime** (categorías, 2ª
  comanda y overrides, todo enlazado). Es la vista de solo‑lectura del ruteo que hoy no
  existe en ningún lado.

### D10 · Insumos

- Segmentado **Todos · Bajo mínimo (rojo) · Sin usar**. Meta: valor total en stock.
- Fila: unidad como miniatura, nombre + presentaciones, **barra stock vs. mínimo**, costo
  por unidad, merma %, «N recetas», pill «Bajo mínimo»/«Sin stock».
- Editor: **Básico** (nombre, unidad base) · **Presentaciones** (tabla editable, radio de
  default, costo por unidad resultante) · **Stock y merma** (stock actual de solo lectura
  + link a historial, mínimo, merma %) · **Usado en** (productos enlazados con su food
  cost — «si cambia el costo, cambia esto»). La sub‑receta queda como hoy dentro de
  Básico.

### D11 · Costeo

- KPIs que **son filtros**: Margen promedio · Pierden plata · Food cost > 40% · Sin
  receta (click filtra la tabla).
- Tabla ordenada **de peor a mejor**: precio, costo, barra de food cost coloreada,
  margen $ (rojo si es negativo).
- Click en una fila abre el **editor del producto directo en «Precio y costo»**: se
  corrige precio o receta sin salir de Costeo, y ‹ › recorre la lista de peores.

### D12 · Stock

- Sub‑tabs como segmentado con badge de bajo mínimo: **Bebidas · Cocina · Bar · Merma
  del mes**.
- Tabla ordenada por lo que falta primero: estado (OK / Bajo mínimo / Sin stock), barra
  stock vs. mínimo, acciones **Ingresar** (botón con texto), Ajustar e Historial (íconos).
- **Ingresar / Ajustar**: `ModalContent sm` con selector Ingreso/Ajuste, cantidad grande,
  motivo obligatorio en ajuste, preview «hoy hay X → quedaría Y». Mismo comportamiento que
  `stock-movement-sheet` (ajuste exige motivo).
- **Historial**: `PanelContent` lateral (movimientos con fecha, origen y ±).
- «Configurar productos» pasa a «Elegir productos con stock» (panel con buscador).
- Merma: selector de período, KPI total y mayor pérdida, tabla por insumo.

### D5 · Regla dura: no cambian datos ni validaciones (aplica a las 7 tabs)

Mismos campos, mismo `ProductInput` (Zod), mismas actions (`createProduct`,
`updateProduct`, disponibilidad, receta), mismos permisos. Precio en centavos con
`PrecioField`. Cambia la presentación y la navegación.

## Fuera de alcance

- Edición masiva (cambiar precio a varios a la vez, % de aumento) — candidata a spec
  aparte; la navegación ‹ › cubre el caso inmediato.
- Drag & drop para reordenar (sigue en la tab Categorías / `sort_order`).
- Modales de admin fuera del catálogo (proveedores, compras, RRHH…).
- Datos nuevos: todo sale de las queries que ya trae `catalogo/page.tsx`. Si algo de lo
  de arriba necesitara una query nueva (ej. «editado hace 3 días por Sofía»), se omite.

## Tareas

Se implementa por fases, una PR por fase; cada una deja el catálogo usable.

**Fase 0 · base compartida**
- [x] `CatalogTable` (tabla densa, grupos pegajosos, navegación ↑↓/Enter), `CatalogToolbar`
      + `CatalogSearch` (`/`, Esc, ↓) + `Segmented`.
- [x] Lógica del editor: `lib/catalog/editor-nav.ts` (‹ › en la lista filtrada, pila «Volver»).
- [x] Tabs agrupadas + badges de atención (`lib/catalog/attention.ts`) + slot de acción
      en el header (`CatalogHeaderAction`, portal).
- [ ] `EntityEditor` visual (header ‹ ›, índice con scroll-spy, footer, guard) — **espera a
      que la 204 commitee `components/ui/modal.tsx`**.

**Fase 1 · Productos**

- [ ] `ProductTable` (filas, grupos, pills, columnas) + reemplazo de `ProductRow`.
- [ ] Rail de categorías + barra móvil; control segmentado con conteos (incl. «Ocultos»).
- [ ] Navegación por teclado en la lista (`/`, ↑↓, Enter) — test.
- [ ] Switch de disponibilidad en la fila (optimista + rollback) — test.
- [ ] Food cost por fila desde `costeo` (sin query nueva).
- [ ] `ProductDialog` sobre `modal.tsx` 204: header con ‹ ›, índice con scroll-spy,
      secciones; `ProductForm` partido en secciones sin tocar schema.
- [ ] Guardar sin cerrar + guard de cambios sin guardar (cerrar / ‹ › / Esc) — test.
- [ ] «Nuevo producto» en el modal.
- [ ] Mobile: hoja desde abajo, tabs de secciones.

**Fase 2 · Carta**: Categorías + supercategorías (D7), Menú del día (D8).
**Fase 3 · Cocina**: Sectores (D9).
**Fase 4 · Costos e inventario**: Insumos (D10), Costeo (D11), Stock + movimiento +
historial + merma (D12).

**En cada fase**
- [ ] typecheck + tests (incl. `product-form.precio.test.tsx`, `daily-menu-form.test.tsx`
      sin regresión).
- [ ] Verify en vivo como Sofía en `/demo/admin/catalogo` (desktop + 375px).
- [ ] Wiki: `features/` catálogo + log.

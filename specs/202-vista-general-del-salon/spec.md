# 202 · Vista general: todos los salones juntos

**Issue:** [#328](https://github.com/gachetponzellini/RestaurantOS-app/issues/328) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-16)

**Depende de**: `065` (filtro de salones del operativo), plano partido de KCC
(Casona / Salón vidriado / Jardín), `FloorPlanViewer`.

## Por qué

KCC (2026-09-16): separar el plano en tres salones está bien para trabajar cada uno,
pero la encargada pierde el panorama. **Juan:** «tendría que haber una opción para
verlos todos juntos también, como la vista general».

Hoy el operativo (`salon-desktop.tsx`) muestra **un** salón por vez: el
`SegmentedSelector` elige cuál y el `FloorPlanViewer` dibuja ese solo.

## Qué

1. En el selector de salón, un botón más al principio: **«Todos»** (con el total de
   mesas activas). Sólo aparece si hay más de un salón para elegir (`shownPlans > 1`).
2. Con «Todos» elegido, el área del plano muestra **cada salón en su propio recuadro**,
   con el nombre arriba, en una grilla que se ajusta al espacio (2 columnas en
   pantallas anchas, 1 en angostas). Cada plano se escala con `contain` como hoy.
   - No se fusionan los planos en un lienzo único: cada salón tiene sus propias
     coordenadas (`plan.width/height`) y pegarlos inventaría una geografía que no existe.
3. Las mesas funcionan **igual que en la vista de un salón**: tocar abre el detalle,
   colores/estado/mozo/demora iguales, y valen los modos «elegir mesa» (reserva) y
   «distribuir» (pintar mozo).
4. Respeta el filtro de salones de la spec 065: «Todos» = todos los **visibles**.
5. La elección se recuerda como hoy (localStorage con `storageKey`, valor `"all"`).
6. Stats al pie y leyenda de mozos: con «Todos», suman los salones mostrados.

### Fuera de alcance

- App del mozo (`mozo-client.tsx`): queda con un salón por vez. Si la piden, otra spec.
- Editor del plano (configuración): no cambia.

## Decisiones abiertas

- **D1 · ¿«Todos» por defecto?** Propuesta: no; el default sigue siendo el último
  elegido (o el primer salón). Confirmar con la encargada de KCC.
- **D2 · Legibilidad con 3 salones chicos**: si en una notebook las mesas quedan muy
  chicas, alternativa = una columna con scroll vertical. Se decide en el verify en vivo.

## Tareas

- [x] Extraer el render del plano + handlers de mesa a algo reusable por salón.
- [x] `SegmentedSelector`: item «Todos» (`id: "all"`) + persistencia.
- [x] Grilla de recuadros por salón con título.
- [x] Stats/leyenda sobre la unión de salones mostrados.
- [x] Test: `effectivePlanId` / `shownPlans` con `"all"` y con filtro 065.
- [x] Verify en vivo como encargada (`sofia@demo.test`, demo: 2 salones) — tocar una mesa del Salón 2 en «Todos» abre su carga. Pendiente en kcc con los 3 salones.

## Implementación

- `src/lib/admin/salon/vista-salon.ts` (+ test): `resolverVistaSalon` decide un salón o «Todos».
- `salon-desktop.tsx`: item «Todos» en el `SegmentedSelector`; con «Todos», `tables` es la
  unión de los salones mostrados y el plano es una grilla (1 columna con scroll, 2 desde
  `2xl`) de un `FloorPlanViewer` por salón. El tap de mesa se extrajo a
  `handlePlanoTableClick` y es el mismo en las dos vistas. «Nueva reserva» toma la zona de
  la mesa elegida. D1: no es default (se recuerda lo último elegido).

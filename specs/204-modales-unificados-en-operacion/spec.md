# 204 · Modales unificados en Operación

**Issue:** [#333](https://github.com/gachetponzellini/RestaurantOS-app/issues/333) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-18)

## Por qué

Juan (2026-09-18): *"en la vista del encargado hay que unificar más el diseño de las
interfaces, lo que podríamos unificar es el estilo de los modales, ya que son todos
distintos y eso no queda nada profesional"*.

Relevamiento: en `/operacion` conviven seis estilos de modal — `Dialog` de shadcn sin
tocar (`rounded-xl p-4`, título `text-base font-medium`), `Dialog` retocado a mano
(`p-5 max-w-md`), `Dialog` grande con footer que scrollea (cerrar caja), overlays
`fixed inset-0` hechos a mano heredados del mozo (`rounded-3xl`, `font-heading text-lg`,
CTA `h-14` en sky/emerald), sheets desde abajo y desde la derecha con headers distintos.
Cuatro tamaños de título, tres ubicaciones de botones, cinco colores de CTA.

## Qué

### D1 · Una anatomía: `components/ui/modal.tsx`

Todo modal se arma con las mismas piezas:

- **`ModalHeader`** — ícono opcional (recuadro `size-9` en `bg-muted`, o en tono
  `danger` / `success` / `warning`), título (`font-heading text-lg font-semibold`),
  descripción (`text-sm text-muted-foreground`), botón cerrar arriba a la derecha.
- **`ModalBody`** — el único que scrollea.
- **`ModalFooter`** — fijo abajo, `border-t bg-muted/40`. Secundario (`outline`/`ghost`) a
  la izquierda de la primaria; en teléfono se apilan a lo ancho con la primaria arriba.
- Botones del footer: `Button size="xl"` (`h-11 rounded-xl font-semibold`). Primaria =
  `default` (el color primario del tema); destructiva = `destructive-solid`.
- **Tamaños fijos:** `sm` (confirmaciones, 384px) · `md` (formularios cortos, 448px) ·
  `lg` (672px) · `xl` (768px). Alto máximo `min(90dvh, 880px)`.

### D2 · Tres cáscaras, mismo look

| Cáscara | Cuándo | Base |
|---|---|---|
| `ModalContent` | Confirmar algo o formulario corto | `Dialog` de base-ui (portal, foco, Esc) |
| `PanelContent` | Ver detalle o flujo largo | `Sheet` derecho de base-ui |
| `InlineModal` | Modales **anclados al panel del salón** (`overlay="absolute"`) o que ya resuelven foco/teclas a mano | `div role="dialog"` propio |

`InlineModal` existe porque varios modales del mozo se reusan en el salón del encargado
**anclados al `<aside>`** para dejar el plano vivo (spec 146), y su `role="dialog"` es el
contrato con el que el panel decide de quién son las teclas (spec 143 · D5). Pasarlos a un
portal cambiaría el comportamiento: no se hace. Sólo cambia la cáscara visual.

En teléfono (`< sm`), las tres cáscaras centradas bajan a hoja desde abajo con manija,
como ya hacían los modales del mozo.

### D3 · Piezas de contenido

- **`SectionLabel`** — la etiqueta chica en mayúsculas (hoy hay 5 variantes).
- **`AmountCard`** — el recuadro «esperado / a cobrar / saldo» con monto grande (hoy
  cada modal lo arma con otro tamaño y peso).

### D4 · Qué se migra

Diálogos: movimiento de caja, cobrar saldo (cuenta corriente), asignar caja, rendición,
cerrar caja, anular mesa / anular ítem (salón), cancelar ítem (cuenta), cancelar pedido,
cancelar pedido desde fila.

Anclados / propios (`InlineModal`): elegir mozo, trasladar mesa, cliente de la mesa,
walk-in (versión modal), comensales, ayuda de atajos, rechazar pedido online.

Paneles (`PanelContent` / header común): nueva reserva, detalle de asiento del libro,
detalle de pedido, cobrar pedido.

**Excepciones explícitas:**
- **Fichaje** conserva su modal oscuro: es un modo kiosco a pantalla completa, a propósito.
- **Cargar pedido** (hoja de dos columnas con atajos propios) conserva su layout; sólo
  adopta el header común.
- **Modal de producto** y **asistente del menú del día**: son el camino rápido de la
  carga de comandas; quedan para otra spec.

### D5 · Regla dura: el comportamiento no cambia

Mismas acciones, validaciones, atajos, foco inicial, `role="dialog"`/`aria-*`, anclaje
(`fixed`/`absolute`) y z-index relativo. Cambia sólo la presentación.

## Fuera de alcance

- Pasar el resto de `/operacion` a tokens del tema y a `<Button>` (paso 3 del análisis).
- Modales de admin fuera de operación (catálogo, proveedores, stock…).

## Tareas

- [x] `components/ui/modal.tsx` + `SectionLabel` + `AmountCard` + `Button size="xl"` / `destructive-solid`.
- [x] Test de la anatomía (título accesible, cerrar, footer).
- [x] Migrar diálogos (D4).
- [x] Migrar `InlineModal` (D4) sin tocar handlers de teclado.
- [x] Migrar paneles (D4).
- [x] typecheck + tests (sin regresiones contra la línea base del 2026-09-18).
- [x] Verify en vivo como Sofía (encargada) en `/demo/admin/operacion`.
- [x] Wiki: regla de modales en `wiki/arquitectura/` + log.

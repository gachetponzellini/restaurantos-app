# 205 · Operación con los colores del tema y botones estándar

**Issue:** [#335](https://github.com/gachetponzellini/RestaurantOS-app/issues/335) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-18)

**Depende de:** 204 (modales unificados).

## Por qué

Paso 3 del análisis de diseño de `/operacion` (2026-09-18). Todo lo que se renderiza en
Operación tenía 1.482 clases `zinc-*` fijas en 65 archivos, al lado de componentes que
usan los tokens del tema. `zinc` es un gris con tinte azul y los tokens son gris neutro:
en la misma pantalla se notan dos grises. Además los botones de acción están hechos a
mano, con cinco alturas (`h-9`…`h-14`) y cinco colores de CTA (azul, verde, celeste,
índigo, negro).

Nota: el admin **no tiene modo oscuro activo** (no hay `ThemeProvider`). Esto no lo
activa; deja el terreno listo.

## Qué

### D1 · Colores → tokens (codemod con tabla fija)

Equivalencia de luminosidad en modo claro:

| zinc | token |
|---|---|
| `text-zinc-900/950` · `800` · `700` · `600` | `text-foreground` · `/90` · `/80` · `/70` |
| `text-zinc-500` · `400` · `300` | `text-muted-foreground` · `/70` · `/50` |
| `bg-white` | `bg-card` |
| `bg-zinc-50` · `100` · `200` · `300` | `bg-muted/50` · `bg-muted` · `bg-border` · `bg-muted-foreground/30` |
| `bg-zinc-700` · `800` · `900/950` | `bg-primary/80` · `/90` · `bg-primary` |
| `border/ring/divide-zinc-100` · `200` · `300` | `…-border/60` · `…-border` · `…-foreground/20` |
| `ring/border-zinc-900` | `…-primary` |

Las alfas se componen (`bg-zinc-50/60` → `bg-muted/30`). Los variants (`hover:`,
`focus:`, `sm:`…) se conservan.

**Excepción:** el **kiosco de fichaje** (`components/fichar/*`, el modal oscuro de
`fichaje-tab`, `present-employee-card`) es oscuro por diseño y se queda en colores fijos.

### D2 · Botones de acción → `<Button>`

Un `<button>` hecho a mano que es un **botón de acción** (tiene un texto de acción,
fondo sólido o borde, y dispara algo) pasa a `<Button>` con variante y tamaño estándar:

- Primario: `default` (color primario). Los CTA azul/verde/celeste/índigo pasan a primario.
- Destructivo principal: `destructive-solid`; destructivo al paso: `destructive`.
- Secundario: `outline` / `secondary`; íconos sueltos (cerrar, volver): `ghost` + `size="icon"`.
- Tamaños: `xl` (h-11) CTA táctil principal; `lg` (h-9) acciones de barra; `default` (h-8)
  acciones chicas.

**No** se convierten las superficies interactivas: filas de lista, tarjetas de mesa,
tiles de producto, chips de filtro, controles segmentados, el teclado numérico. Son
componentes propios, no botones.

### D3 · Regla dura

El comportamiento no cambia: mismos handlers, `type`, `disabled`, `aria-*`, refs y
atajos. Los tests existentes pasan sin tocarlos.

## Fuera de alcance

- Pantallas del mozo que no se ven en Operación (siguen en `zinc`; mismo codemod después).
- Activar el modo oscuro.

## Tareas

- [x] D1 codemod sobre el cierre de imports de `/operacion` + ajustes a mano (planos SVG).
- [x] D1 excepción kiosco de fichaje.
- [x] D2 botones por grupo: salón · carga/cuenta · cobro/caja · reservas.
- [x] typecheck + tests sin regresiones.
- [x] Verify en vivo como Sofía.
- [x] Wiki: `arquitectura/modales.md` → sumar la regla de tokens y botones + log.

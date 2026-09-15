# 189 · Reservas abre en el plano, y el plano tiene la ficha entera

Issue [#313](https://github.com/gachetponzellini/RestaurantOS-app/issues/313).

## El problema

Reservas abría en **Lista**. El plano del día (spec 137) —el que contesta «cómo
queda el salón a las 21»— vivía detrás de un toggle, y cuando se abría
contestaba a medias:

- la mesa azul no decía **de quién** era;
- tocarla mostraba tres datos sueltos (nombre, comensales, hora) y, como mucho,
  confirmar/rechazar una pendiente. Sentar, editar, no vino y cancelar obligaban
  a volver a la lista;
- las reservas **sin mesa** —mayoría en flexible, donde la mesa se define al
  llegar (spec 059)— eran un contador que no se podía abrir.

## La solución

**El plano es la vista de entrada.** Eso le cambia el trabajo: además de pintar
el estado, tiene que contestar toda la ficha y dejar operar, porque el que lo
mira ya no tiene la lista delante.

1. **La mesa habla sola.** Debajo del número: `HH:MM · Np` y el nombre de pila.
   El parque va de 35 a 160 unidades de ancho, así que el detalle **se cae con
   orden**: primero se va la hora, después el nombre; los cubiertos nunca se
   van, porque son el dato con el que se decide si entra otra reserva encima.
   Reglas puras en `renglonesDeMesa` / `nombreEnMesa`, con test.
2. **La ficha completa al tocar.** Mesa + salón + lugares, estado, rango
   horario, comensales, servicio, teléfono clickeable, nota, origen (web/admin),
   cuándo se creó. Y las mismas acciones que la fila de la lista:
   confirmar/rechazar (spec 131), sentar, no vino, cancelar, completar, más el
   panel de edición de la spec 097 embebido — el mismo componente, no una copia.
3. **«No vino» y «Cancelar» piden un segundo tap** (`¿Seguro?`), como en la
   lista piden un diálogo: se disparan con el pulgar sobre un plano lleno.
4. **Las genéricas se abren.** El contador `N sin mesa · M cubiertos` despliega
   las filas (hora, nombre, comensales, salón, teléfono, estado, nota).
   `sinMesa` devuelve las filas ordenadas por hora, no sólo el número.
5. **En el plano la bandeja baja.** Al lado se comía 340px y el salón quedaba
   dibujado a media escala — el nombre y la hora dentro de la mesa no se leían,
   que es justo lo que el plano tiene que contestar de un vistazo. En la lista
   vuelve a la derecha (spec 136). El SVG sube a `72vh`.

## Dónde vive

| Qué | Dónde |
|---|---|
| Reglas puras (renglones, nombre, genéricas) | `src/lib/reservations/plano-del-dia.ts` |
| Tests | `src/lib/reservations/plano-del-dia.test.ts` |
| Plano + ficha + acciones | `src/components/reservations/plano-del-dia.tsx` |
| Renglones dentro de la mesa | `src/components/reservations/mesa-figura.tsx` |
| Vista de entrada + layout | `src/components/reservations/reservas-workspace.tsx`, `admin-day-list.tsx` |

Sin migración: `ReservaEnPlano` ya venía de `AdminRow`, que trae la fila entera;
lo único que faltaba era pedirle los campos.

## Verificación en vivo

Como **Sofía** (encargada, negocio `demo`, magic link): abre en plano; `BAR2`
muestra `20:00 · 3p` + `QA`; la ficha trae teléfono, nota, «Web», «creada hace
1m»; **Confirmar** vacía la bandeja; **No vino** pide `¿Seguro?`; **Sentar**
deja la ficha en «Completar»; **Editar** abre el panel de la spec 097 dentro
del plano; el bloque de sin-mesa se despliega. Mobile 375px sin scroll
horizontal. `pnpm typecheck` limpio y 214 tests de reservas en verde.

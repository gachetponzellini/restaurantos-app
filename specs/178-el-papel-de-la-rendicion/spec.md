# 178 · El papel de la rendición

**Issue:** [#290](https://github.com/gachetponzellini/RestaurantOS-app/issues/290) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ **implementada y verificada en vivo** (2026-09-13, migración `0103`
aplicada al cloud y al local)

**Input:** KCC, reunión del 2026-09-09, anotado por Juan: *"a la hora de la
rendición imprimir un ticket chiquito por cada empleado, que esto sea opcional
tocando un btn"*.

**Depende de**: [`139`](../139-el-cierre-en-papel/spec.md) (el papel del cierre —
esta spec es su hermana chica: misma familia `print_jobs`, misma comandera, mismo
criterio de snapshot, misma reimpresión), [`177`](../177-la-propina-de-punta-a-punta/spec.md)
(la rendición ahora paga la propina, y eso tiene que estar en el papel),
[`07`](../../../../wiki/specs/07-caja-rendicion-mozos/spec.md) y
[`151`](../151-lo-cobrado-por-tarjeta-no-se-rinde/spec.md) (qué se rinde y qué
no).

---

## Por qué

La 139 dejó **un** papel por noche: el del corte, con el bloque de mozos adentro.
Es el que va al sobre. Pero cuando Pedro entrega su efectivo, **no se lleva
nada**: lo que entregó, lo que le faltó, lo que se le pagó de propina queda en
`mozo_rendiciones` y en ninguna mano. Si mañana discute que entregó de más, la
única prueba está en una tabla que él no puede abrir.

Es el papel que MaxiRest imprime al liquidar un mozo y que el mozo firma. Y
desde la 177 tiene una línea más que decir: *«se te pagaron $4.200 de propina»*
— que es plata que salió del cajón y que hoy no consta en ningún lado que la
recibió.

## Lo que ya está construido

Todo el circuito, por la 139. **Esta spec no abre ningún camino nuevo**: agrega
un `kind` a una familia que ya tiene cinco.

| Pieza | Dónde | Se reusa |
|---|---|---|
| El pull del agente, las cinco familias aisladas, el acuse por id | `route.ts` · `safePrintables` | tal cual — se suma una sexta |
| La comandera del cierre (cuenta por negocio → control) | `resolveCierrePrinter` | tal cual |
| El armador condensado a 42 columnas, `fila`, `monto`, `fechaLarga` | `cierre-ticket.ts` | se importan |
| La reimpresión que re-sella en vez de insertar | `reimprimirCierre` · D8 | mismo patrón |
| El snapshot como fuente del papel | `caja_cortes.resumen` · D3 | `mozo_rendiciones` **ya es** un snapshot |

Lo último es lo que hace barata la spec: la fila de la rendición guarda
`expected`, `delivered`, `difference`, `por_metodo`, `estado`, `notes` y
`created_at` — es lo que el encargado vio al registrar, congelado. No hay
snapshot nuevo que armar.

---

## Decisiones

### D1 · A pedido, no automático

KCC lo pidió así (*"opcional tocando un btn"*) y tiene lógica: el cierre es uno
por noche y la 139 lo hizo automático; esto es **uno por mozo**, y en un turno
de ocho mozos son ocho papeles que no siempre alguien quiere. El botón vive en
la fila del historial de rendiciones, donde ya está el registro.

### D2 · Uno por rendición, y reimprimir re-sella

`print_jobs (rendicion_id) where kind='rendicion'` único, igual que el cierre.
La primera impresión inserta; la segunda vuelve a poner `pendiente` la misma
fila con `reprint_requested_at`, y el papel sale marcado `*** REIMPRESION ***`.
Es lo que hace que apretar dos veces no imprima dos veces (139 · D8).

### D3 · La propina pagada entra al snapshot

Desde la 177 la rendición paga la propina con un movimiento `kind='propina'`.
Ese monto **no está en la fila de la rendición**: para el papel habría que ir a
buscarlo al libro por `(mozo_id, created_at)`, que es un join por coincidencia
de timestamp. Se agrega `mozo_rendiciones.propina_pagada_cents`, escrito por la
misma action en la misma pasada. Duplica un número a propósito, por el mismo
motivo que `por_metodo` duplica `payments`: **el papel se firma, y lo que se
firma no se recalcula**.

### D4 · Misma comandera que el cierre

Juan (2026-09-03, para la 139): *"debería de salir por la misma comandera que
por la que salen los tickets para las mesas"*. La rendición pasa por el mismo
mostrador. `resolveCierrePrinter`, sin fallback nuevo.

### D5 · El mismo círculo que registra

`canRendirMozo`: encargado y admin. La `terminal` registra rendiciones? No —
`canRendirMozo("terminal")` es `false` (spec 140), así que tampoco imprime.

### D6 · «No entregó» también tiene papel

Es justamente el caso donde más sirve: la deuda declarada, con el motivo, en un
papel que se le puede mostrar al mozo cuando vuelve. Sale con un `NO ENTREGO`
grande en vez del bloque de efectivo.

---

## El papel

Font B condensado, 42 columnas, como el cierre. Lo que no tenemos se omite, no se
inventa.

```
        *** REIMPRESION ***          ← sólo si lo es
        RENDICION DE TURNO
        Restaurante Demo
------------------------------------------
Mozo:                          Pedro Mozo
Fecha:               10/09/2026 · 23:41
Registro:                          Sofia
------------------------------------------
COBRADO EN EL TURNO
Efectivo                       18.500,00
Tarjeta                        38.500,00
TOTAL                          57.000,00
------------------------------------------
EFECTIVO
Debia entregar                 18.500,00
Entrego                        18.500,00
DIFERENCIA                          0,00
------------------------------------------
Propina pagada                  4.200,00
------------------------------------------
OBSERVACIONES
Faltante chico, lo cubre manana
------------------------------------------
Firma mozo:        ____________________
Firma encargado:   ____________________
```

Con `estado = 'no_entrego'`, el bloque EFECTIVO se reemplaza por:

```
------------------------------------------
        *** NO ENTREGO ***
Debia entregar                 18.500,00
Queda como deuda               18.500,00
```

y no hay propina pagada (la 177 no paga contra una deuda abierta).

---

## Qué se construye

1. **Migración `0103`**: `mozo_rendiciones.propina_pagada_cents`,
   `print_jobs.rendicion_id`, `kind='rendicion'` en el check, el único parcial,
   y la rama del target check. Backfill best-effort de la propina desde el
   movimiento con el mismo `(mozo_id, created_at)`.
2. **`rendicion-ticket.ts`** — el armador puro, con sus tests.
3. **`imprimirRendicion(rendicionId, slug)`** — la action: inserta o re-sella.
4. **El GET del agente** — sexta familia: `buildPrintableRendicionTickets`.
5. **`registrarRendicionMozo`** escribe `propina_pagada_cents`.
6. **El botón** en la fila del historial.

## Archivos

| Archivo | Qué |
|---|---|
| `supabase/migrations/0103_el_papel_de_la_rendicion.sql` | esquema |
| `src/lib/print/rendicion-ticket.ts` (+ test) | armador |
| `src/lib/caja/rendicion-print-actions.ts` | la action |
| `src/lib/caja/actions.ts` | `propina_pagada_cents` en el insert |
| `src/app/api/print-agent/route.ts` | la sexta familia |
| `src/components/admin/local/rendicion-mozos-tab.tsx` | el botón |
| `src/lib/caja/types.ts` | `MozoRendicion.propina_pagada_cents` |

## Verificado en vivo

Stack local sembrado, como **Sofía** (encargada, el rol que registra):

1. Registrar la rendición de Lucía ($317.200, cuadra perfecto) → el toast dice
   *«propina pagada $ 26.460»* y la fila queda con `propina_pagada_cents =
   2646000`, igual que el movimiento de caja.
2. **Imprimir** desde el historial → `print_jobs` con `kind='rendicion'`,
   `pendiente`, colgado de la rendición. El botón pasa a «Reimprimir».
3. El `GET /api/print-agent` la sirve a la comandera del cierre con el papel
   entero: cobrado por método (efectivo / tarjeta / QR / total), el bloque de
   efectivo, la propina pagada, las dos firmas. Sin tildes.
4. Acuse `ok` del agente → `impreso`. **Reimprimir** → la misma fila (sigue
   habiendo una) vuelve a `pendiente` con `reprint_requested_at`, y el GET la
   sirve con `*** REIMPRESION ***` arriba.

Tests: 12 del armador, 2 del botón (que llama a la action con el id correcto
— el cableado que a la 177 se le escapó), 2785 en total en verde.

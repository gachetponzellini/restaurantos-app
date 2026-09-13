# 179 · Las asistencias se corrigen

**Issue:** [#291](https://github.com/gachetponzellini/RestaurantOS-app/issues/291) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ **implementada y verificada en vivo** (2026-09-13, migración `0104`
aplicada al cloud y al local)

**Input:** KCC, reunión del 2026-09-09, anotado por Juan: *"que se puedan editar
las asistencias, solo por los encargados obvio"*.

**Depende de**: [`11`](../../../../wiki/specs/11-fichaje-asistencia-onsite/spec.md)
(el fichaje por PIN y `clock_entries`), [`070`](../070-caja-correccion-de-lineas-y-libro/spec.md)
(el molde de corrección con motivo + audit log, que acá se copia), [`14`](../../../../wiki/specs/14-multi-local-y-deploy-onsite/dashboard-y-permisos.md)
(la matriz de secciones: RRHH era admin-only).

---

## Por qué

Una fichada mal hecha hoy es para siempre. El mozo que se olvidó de marcar la
salida queda «presente» hasta que alguien lo note —y su fichada abierta bloquea
la siguiente, porque `clockPunch` la toma como la entrada de la que hay que
salir—. El que fichó a las 9 y llegó a las 10 cobra la hora. El que marcó dos
veces por error tiene dos entradas. Y no hay forma de tocar nada: `clock_entries`
tiene **sólo policy de SELECT** ([`0001_baseline.sql:4018`](../../supabase/migrations/0001_baseline.sql)),
se escribe por service-role desde `clockPunch` y punto.

Es lo que alimenta la liquidación de horas. Un dato de sueldo que no se puede
corregir se corrige por afuera, en un papel, y el sistema queda mintiendo.

## Lo que ya está construido

- **El molde de corrección** (spec 070): motivo obligatorio, un renglón de audit
  por campo, nunca borrar —anular y que quede visible—. `caja_audit_log` y
  `caja_movimientos.cancelled_*` son exactamente la forma que necesita esto.
- **La pantalla**: RRHH → Asistencia tiene el mes por empleado y el drill-down
  por día con cada fichada ([`asistencia-tab.tsx`](../../src/components/admin/rrhh/asistencia-tab.tsx)).
  El lugar de la edición es esa tabla.
- **`duration_minutes` es columna generada**: corregir la hora recalcula sola.

---

## Decisiones

### D1 · Tres operaciones, las tres con motivo

| | Qué | Cuándo |
|---|---|---|
| **Corregir** | entrada y/o salida de una fichada | fichó a las 9 y llegó a las 10; se olvidó de marcar la salida |
| **Agregar** | una fichada que no existe | se olvidó de fichar la entrada, o no fichó el día |
| **Anular** | una fichada entera | fichó dos veces, fichó por otro |

No hay «borrar». Lo anulado queda **tachado** en el detalle del día y no suma
horas — el mismo criterio que el libro de caja (070): la caja nunca borra, marca.

### D2 · El rastro es por campo, no por fila

`clock_audit_log (entry_id, field, from_value, to_value, by_user_id, reason)`,
copiado de `caja_audit_log`. Un renglón por campo cambiado. Es lo que permite
responder *«¿quién le movió la entrada a Pedro el martes, y de qué hora a qué
hora?»* sin reconstruir nada.

`clock_entries` suma `created_by` (null = fichó él; con valor = la cargó un
encargado) y `cancelled_at / cancelled_reason / cancelled_by`.

### D3 · Las reglas duras viven en la base

Un empleado no puede tener **dos fichadas abiertas** ni **dos que se pisen**.
Hoy la primera regla la asume `clockPunch` con un `maybeSingle()` que revienta
si se rompe, y la segunda no existe. Con edición manual las dos se pueden romper
desde un formulario, así que:

- **Único parcial** `(business_id, user_id) where clock_out is null and cancelled_at is null`.
- **La superposición se valida en la action** con una función pura y testeada
  (`fichadaSePisa`), leyendo las fichadas vivas del empleado alrededor. Un
  `exclusion constraint` con `tstzrange` sería lo canónico, pero obliga a la
  extensión `btree_gist` y a razonar sobre fichadas abiertas como rangos
  infinitos — más de lo que este cambio necesita.

Verificado antes de escribir el índice: en el cloud no hay ningún empleado con
dos abiertas.

### D4 · La encargada ve Asistencia, no Equipo

⚠️ **Revierte parcialmente la decisión del 2026-06-15** («RRHH admin-only»).

*"Solo por los encargados"* no se puede cumplir con RRHH cerrado para el
encargado. La celda pasa a `limited`: ve la pestaña **Asistencia** —y la edita—,
y **Equipo** (PINs, roles, altas y bajas) sigue siendo admin-only. Es la misma
partición que Operación tiene para la terminal: lo del piso sí, las llaves no.

Si la lectura era «encargado = admin», es una celda para volver atrás.

### D5 · El permiso es uno y dice lo que hace

`canEditarAsistencia(role)`: admin y encargado. La terminal no — es una cuenta
compartida y esto es sueldo.

### D6 · Lo anulado no cuenta en ningún lado

Seis lectores de `clock_entries` suman horas o buscan la abierta:
`getClockHistory`, `getTodaySummary`, `getMonthlyOverview`, `getWeeklySummary`,
`getMozoAttendance` y `clockPunch`/`getCurrentPresent`. Todos filtran
`cancelled_at is null`. El único que la muestra es el detalle del día, tachada.

---

## Qué se construye

1. **Migración `0104`**: columnas en `clock_entries`, `clock_audit_log`, el
   único parcial, índice para la abierta.
2. **`asistencia-reglas.ts`** — puro: `fichadaSePisa`, `validarFichada`.
3. **`asistencia-actions.ts`** — `corregirFichada`, `agregarFichada`,
   `anularFichada`.
4. **`canEditarAsistencia`** + `rrhh: encargado → limited` + Equipo gateada.
5. **Lectores** filtran anuladas.
6. **UI**: en el detalle del día, editar / anular por fila y «Agregar fichada».

## Archivos

| Archivo | Qué |
|---|---|
| `supabase/migrations/0104_las_asistencias_se_corrigen.sql` | esquema |
| `src/lib/rrhh/asistencia-reglas.ts` (+ test) | reglas puras |
| `src/lib/rrhh/asistencia-actions.ts` | las tres actions |
| `src/lib/rrhh/clock-queries.ts`, `clock-actions.ts`, `src/lib/mozo/queries.ts` | D6 |
| `src/lib/permissions/can.ts`, `sections.ts` (+ tests) | D4, D5 |
| `src/components/admin/rrhh/asistencia-tab.tsx`, `fichada-modal.tsx` | UI |
| `src/app/[business_slug]/admin/(authed)/rrhh/page.tsx` | Equipo admin-only |

## Verificado en vivo

Stack local sembrado, como **Sofía** (encargada — el rol que la D4 abre):

1. Entra a RRHH y ve **sólo Asistencia**: la pestaña Equipo no existe para ella
   y `?tab=equipo` a mano cae en Asistencia sin error.
2. **Corregir**: la salida de Pedro 18:18 → 18:30 con motivo. La fila muestra
   8h 12m, el total del día se recalcula, y `clock_audit_log` tiene
   `clock_out | 18:18 → 18:30 | por Sofía Encargada | <motivo>`.
3. **Anular** la de Diego con motivo: queda tachada, sin acciones, «1 anulada»
   en el subtítulo, y el detalle por empleado del mes deja de contarla.
4. **Agregar** la buena de Diego (08:00–15:00): aparece con el rótulo
   «manual» (`created_by` con valor) y su renglón `created` en el rastro.
5. **Superposición**: intentar 14:00–16:00 sobre la de 08–15 → *«Se pisa con
   otra fichada del mismo empleado»*, el modal se queda abierto.
6. **Dos abiertas**: el único parcial de la 0104 rechaza la segunda (probado
   con un `DO` con rollback).

Tests: 12 de las reglas puras, 3 de permisos, 2799 en total en verde.

## De paso

El título del detalle del día decía **«Miércoles, 2 de septiembre» para el
día 3**: `new Date("2026-09-03")` es medianoche UTC, que en AR es el 2 a las
21:00. Preexistente, pero en la pantalla donde se corrigen horas, el día
equivocado en el título es corregir el día equivocado. Arreglado con `T12:00:00`.

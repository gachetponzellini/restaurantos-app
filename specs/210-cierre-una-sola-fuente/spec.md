# 210 · El cierre tiene una sola fuente de verdad, en la base

**Issue:** [#380](https://github.com/gachetponzellini/RestaurantOS-app/issues/380) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesto ([análisis](../../../../wiki/analyses/2026-10-06-cierre-y-rendicion-ux.md)).
Toca dinero, así que pasa por el gate de design: las decisiones están acá abajo.

## Por qué

La franja de la spec 209 promete algo concreto: **si está en verde, cierra**. Hoy la
base no garantiza eso, por cuatro motivos.

- **El esperado se calcula dos veces.** Una en TS (`expected-cash.ts:45`,
  `queries.ts:639-666` y el desglose) y otra en SQL (`efectivo_esperado_caja`, 0122).
  Cuando no coinciden, el usuario ve `EXPECTED_CHANGED`. El epic #361 nació de esta
  familia de bugs: una regla de plata escrita en varios lugares.
- **"Quién debe rendir" tiene dos versiones, y no dicen lo mismo.**
  - En TS: `deben-rendir.ts` + `canal-rendicion.ts`.
  - En SQL: el subquery de `cerrar_caja_tx`, que no mira efectivo ni canal.
  - Con `cajaId`, `getRendicionesPendientesTodosLosMozos` no calcula
    `mesas_sin_cobrar` (`queries.ts:1105`).
  - `rindeSoloSinMesa` contempla al admin, pero la query nunca lo trae
    (`queries.ts:1099`). Es una rama muerta.
- **Hay validaciones duras que viven sólo en TS:**
  - la nota obligatoria con diferencia, en el cierre y en la rendición;
  - el techo de $5.000 del encargado (`can.ts:36`);
  - el bloqueo de la rendición por mesas sin cobrar (`mesas-sin-cobrar.ts`).

  Cualquier otro camino hacia las RPC se las saltea.
- **`retiro_cents` se recalcula en TS** (`actions.ts:623`) en lugar de leerse de la base.

## Qué cambia

- **R1 · `estado_cierre_caja(p_caja_id, p_business_id)`** es una RPC `security definer`
  que sólo puede ejecutar `service_role`, como las de la 0122. Devuelve en un jsonb
  todo lo que hoy arma `getCierreCajaData`:
  - el esperado y su desglose (apertura, efectivo bruto, ingresos, sangrías, propinas pagadas);
  - el reparto (cajón / mozos);
  - `cuentas_abiertas`, `deben_rendir` (con `motivo`: `efectivo` | `propina` | `solo_cobros`)
    y `mesas_sin_cobrar` por persona;
  - `pedidos_abiertos`, `salon`, `barre_salon` y `sin_operadores`.

  `getCierreCajaData` queda como un wrapper que valida el tenant y tipa el resultado.
- **R2 · Una sola regla de "debe rendir".** Pasa a ser la función SQL
  `mozos_que_deben_rendir(p_business_id, p_caja_id)`. La usan `estado_cierre_caja`
  y `cerrar_caja_tx`. Se borran la versión TS y el subquery duplicado.
- **R3 · El esperado vive sólo en SQL.**
  - `getCajaLiveStats`, el board y el resumen archivado (spec 149, con ventana
    `desde`/`hasta`) leen `efectivo_esperado_caja`.
  - El desglose sale de la misma función.
  - `expected-cash.ts` se borra. Sus unit tests pasan a ser tests de integración contra Postgres.
- **R4 · Las validaciones duras pasan a la base.**
  - `cerrar_caja_tx` rechaza `NOTES_REQUIRED` y `DIFFERENCE_OVER_LIMIT:<techo>`. El
    rol lo lee de `business_users` con `p_encargado_id`, sin confiar en un parámetro.
  - `registrar_rendicion_tx` rechaza `NOTES_REQUIRED` y `MOZO_HAS_OPEN_TABLES:<labels>`.
  - TS conserva la validación para dar feedback inmediato, y la base es la que decide.
  - El techo pasa a ser una constante SQL. `can.ts` la sigue exponiendo para la UI.
    Un test cruza que las dos valgan lo mismo.
- **R5 · El retiro sale de la base.** `cerrar_caja_tx` devuelve `retiro_cents`, y la
  action deja de recalcularlo.
- **R6 · Scope explícito.**
  - **La rendición es por negocio**: el mozo rinde una vez por todas las cajas. La
    franja muestra el monto del negocio.
  - **El reparto del cajón es por caja.** Cuando un mozo cobró en más de una caja, la
    fila lo aclara con "de esta caja $X".
  - `mesas_sin_cobrar` se calcula siempre.

## Decisiones

- **D1 · SQL y no TS como fuente.** La base es la que firma el cierre con la caja
  bloqueada (#358). Si la pantalla calcula distinto, gana la base y el usuario se
  entera tarde. Con una sola función, la pantalla muestra lo mismo que se va a validar.
- **D2 · La aritmética de la rendición sigue en TS** (por canal, propina): la
  decisión del #253 no se toca. Lo que pasa a la base es **quién** debe rendir y las
  guardas.
- **D3 · Sin cambios de schema.** Son funciones nuevas o reemplazadas en una
  migración numerada nueva. No cambia ninguna tabla.

## Escenarios

- **Dado** cualquier estado de caja, **entonces** `estado_cierre_caja.esperado_cents`
  coincide con el esperado que `cerrar_caja_tx` recalcula bajo lock. Esto se prueba
  con un test de integración con cobros, ingresos, sangrías, propinas, anulados y fondo.
- **Dado** un mozo que sólo cobró con tarjeta, **entonces** aparece en `deben_rendir`
  con `motivo = 'solo_cobros'` o `'propina'`, y `cerrar_caja_tx` lo bloquea con la
  misma regla.
- **Dado** un encargado con una diferencia de $6.000 que llama a la RPC directo,
  **entonces** `DIFFERENCE_OVER_LIMIT`.
- **Dado** un mozo con la mesa 5 abierta que se rinde por RPC directo, **entonces**
  `MOZO_HAS_OPEN_TABLES:5`.
- **Dado** un cierre con fondo de $20.000 y $100.000 contados, **entonces** la action
  devuelve `retiro_cents = 8000000`, leído de la base.

## Fuera de alcance

- UI (specs 209 y 211).
- Cambiar la fórmula del esperado: es la misma de la spec 177, sólo que en un único lugar.

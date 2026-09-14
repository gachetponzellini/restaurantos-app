# 182 · La terminal ve lo suyo, y sólo eso

**Issue:** [#301](https://github.com/gachetponzellini/RestaurantOS-app/issues/301) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ **implementada y verificada en vivo** (2026-09-14). Sin migración:
es permisos y payload.

**Input:** Juan, 2026-09-14: *"al rol de terminal, le sacaría la pantalla de
reservas, que vean solo las reservas de mesas, y en la de comandas tendrían que
tener permisos mínimos"*. Y, sobre Comandas, la respuesta a la pregunta:
**ver y entregar**.

**Depende de**: [`140`](../140-los-mozos-en-la-compu-del-salon/spec.md) (el rol
`terminal` y su matriz), [`167`](../167-el-gate-vive-en-la-seccion/spec.md) (el
gate vive en la sección), [`#294`](https://github.com/gachetponzellini/RestaurantOS-app/issues/294)
(los loaders del plano, que era la otra mitad de este mismo descuido).

---

## Por qué

La terminal no es una persona: es **una PC compartida por todo el salón**. Lo que
esa pantalla muestra lo ve cualquiera que pase por ahí, y lo que su navegador
descarga lo lee cualquiera que abra «ver código fuente».

La spec 140 la dejó adentro de Operación con cuatro tabs. Un año de features
después, tres cosas se desalinearon: una tab que la matriz ya cerraba por otro
lado, botones que sólo sirven para que el server los rechace, y datos de plata
que viajan a esa compu sin que nadie los pida.

## Lo que ya está construido

**La matriz ya decía que no.** `sections.ts` tiene `reservas: terminal: "none"`
([`sections.ts:130`](../../src/lib/permissions/sections.ts)): `/admin/reservas`
está cerrada para la terminal desde la 167. Lo que quedó abierto es la tab
Reservas **adentro** de Operación, que vive en otra lista
(`TABS_POR_ROL`, [`local-shell.tsx:134`](../../src/components/admin/local/local-shell.tsx)).

**Las reservas del salón ya están en el plano.** El aside del plano tiene
«Reservas hoy» con Sentar, asignar mesa y no-show
([`reservations-panel.tsx`](../../src/components/admin/local/reservations-panel.tsx)),
y `canManageReservations` ya incluye a `terminal`. Eso es exactamente lo que Juan
pide que quede.

**El server ya rechaza casi todo lo del kanban.** `canReimprimirComanda`,
`canModifyPostEnvio` y `canCancelItem` son admin/encargado. La excepción es
`advanceComandaStatus` («Empezar»), que **no tiene gate de rol**.

---

## Decisiones

### D1 · La terminal pierde la tab Reservas, no las reservas

`TABS_POR_ROL.terminal` queda `["salon", "comandas", "fichaje"]`.

Lo que se va es **el libro del día**: navegar fechas, editar una reserva,
cancelarla, y la bandeja «A confirmar» —que además la terminal no puede resolver,
porque decidir una solicitud es `canDecideReservation` (admin/encargado). Eso es
agenda del negocio, no operación del salón.

Lo que queda es lo del turno: las reservas de hoy en el aside del plano, con
«Sentar» y asignar mesa. Es la misma frase de Juan — *«que vean solo las reservas
de mesas»*.

Dos puntas más, o el gate es de mentira:

- **El pill.** El contador de Reservas en la barra de tabs no está gateado por
  rol (los de Caja, Cuentas y Rendición sí). Sin eso, la tab desaparece pero su
  número sigue ahí.
- **El loader.** `getReservasTabData` pasa a `soloSupervision: true`, el mismo
  criterio que ya usan caja, rendición y pedidos
  ([`operacion/actions.ts`](<../../src/app/[business_slug]/admin/(authed)/operacion/actions.ts>)).

### D2 · En Comandas: ver y entregar

Hoy `ComandasKanban` **no recibe el rol**, así que le pinta a la terminal los
tres botones que el server le va a rechazar. Un botón que existe para fallar es
peor que no tenerlo: enseña a ignorar los errores.

| Acción | Terminal | Por qué |
|---|:---:|---|
| Ver el tablero, las demoras, la saturación por sector | ✅ | Es para lo que mira la pantalla |
| **Entregar** | ✅ | Es el acto del mozo: lo llevé a la mesa |
| Empezar | ❌ | Es de cocina |
| Reimprimir / Reintentar | ❌ | Ya rechazada (`canReimprimirComanda`) |
| Editar ítems | ❌ | Ya rechazada (`canModifyPostEnvio`) |
| Anular comanda | ❌ | Ya rechazada (`canCancelItem`) |

**«Empezar» se gatea también en el server.** `advanceComandaStatus` no mira el
rol y la llama sólo el kanban; sin gate, la UI sería la única puerta — y una
puerta de UI no es una puerta. Nace `canEmpezarComanda` (admin/encargado).

**«Entregar» no se toca.** `marcarComandaEntregada` la usa además el panel de la
mesa («Entregar Fritera»), que es del mozo y de la terminal. Gatearla rompería el
flujo que la 140 abrió a propósito.

El aviso de «no se imprimió» **se queda**. La terminal no puede reintentarlo,
pero es la que está parada ahí: que vea que la comanda no salió y avise vale más
que el silencio.

### D3 · Lo que el rol no ve, no se carga

Esto no estaba en el pedido de Juan; salió mirando el HTML de la terminal.

`operacion/page.tsx` arma las ocho promesas para todos los roles y se las pasa a
`LocalShell`. El shell no monta el pane que el rol no ve —eso funciona— pero la
promesa **se pasa igual a un componente cliente**, y React la serializa y la
streamea al navegador. Verificado en vivo como `terminal@demo.test`:

```
expected_cash_cents … closing_cash_cents … difference_cents … closing_notes
rendicionPendientes … efectivo_bruto_cents … total_propinas_cents
customer_name … customer_phone
```

Todo eso está en el código fuente de la página, en la compu que comparten seis
personas. No se ve en pantalla; se lee con F12.

El arreglo es de una línea conceptual: **la promesa se crea sólo si el rol ve esa
tab**. Para eso la lista de tabs por rol —hoy una constante adentro de un
componente cliente— se muda a `lib/permissions/operacion-tabs.ts`, que leen los
dos lados. Es la misma idea de la 167 (*una matriz sola*) aplicada al payload.

Las props gateadas de `LocalShell` pasan a `Promise<X> | null`.

## Alcance

1. `lib/permissions/operacion-tabs.ts`: `OPERACION_TABS`, `OperacionTab`,
   `tabsVisiblesEnOperacion(role)`. `local-shell` lo importa en vez de definirlo.
2. `TABS_POR_ROL.terminal` sin `reservas`; el pill de Reservas gateado por `ve()`.
3. `getReservasTabData` → `soloSupervision: true`.
4. `can.ts`: `canEmpezarComanda`. Gate en `advanceComandaStatus`.
5. `ComandasKanban` recibe `role`: sin «Empezar» ni ⋯ para quien no puede.
6. `operacion/page.tsx`: una promesa por tab visible; el resto, `null`.

## No-objetivos

- **Tocar el rol `mozo`.** No ve Operación; nada de esto lo alcanza.
- **Que la terminal pueda confirmar o rechazar solicitudes de reserva.** Sigue
  siendo del encargado (`canDecideReservation`).
- **Rediseñar el kanban para el salón.** Sacarle lo que no puede tocar no lo
  convierte en la pantalla del mozo; si hace falta esa vista, es otra spec.

## Riesgos

- **Si en KCC nadie más mira el tablero, «Empezar» deja de apretarse.** Las
  comandas quedarían en pendiente hasta que alguien con rol de encargado las
  mueva. Es la consecuencia buscada —el estado lo mueve cocina— pero hay que
  mirarlo el primer día.
- **`Promise | null` en las props del shell.** El riesgo es olvidarse un
  `ve(tab)` y romper la tab para el encargado. Lo cubren los tests de tabs.

## Verificado — 2026-09-14

Stack local, con los roles reales (`node scripts/magic-link.mjs`), nunca
service_role.

**Como `terminal@demo.test`:**

1. La barra de tabs dice **Mesas · Comandas · Fichaje**. No hay Reservas, ni su
   contador. ✅
2. `?tab=reservas` escrito a mano cae en Mesas. ✅
3. El aside del plano sigue teniendo «Reservas hoy» y «Nueva reserva»: las
   reservas del turno no se perdieron. ✅
4. En Comandas: las cards de «Pendientes» **no tienen ningún botón**, las de «En
   cocina» sólo «Entregar», y el ⋯ no está en ninguna. ✅
5. El payload de la página ya no trae `expected_cash_cents`, `Caja Bar`,
   `rendicionPendientes`, `cajaAssignments` ni los teléfonos de las reservas.
   **326 kB → 267 kB** de HTML. ✅

**Como `sofia@demo.test` (encargada), para ver que no se rompió nada:** las ocho
tabs, 11 «Empezar», 10 «Entregar», 21 menús ⋯, y la tab Reservas abre el libro
del día con la bandeja «A confirmar». ✅

**Server:** el test de integración corre `advanceComandaStatus` como mozo y
espera el rechazo, y el cross-tenant se movió a encargado-del-otro-negocio para
que siga probando la pertenencia y no el gate nuevo.

### Lo que sólo apareció verificando

La fuga del payload (D3) no estaba en el pedido de Juan: salió de mirar el HTML
de la terminal con `document.documentElement.innerHTML`. El gate de UI estaba
bien hecho —el pane no se monta— y aun así el dato viajaba, porque **una promesa
pasada a un componente cliente la serializa React aunque nadie la lea**. Es el
mismo modo de falla que [#294](https://github.com/gachetponzellini/RestaurantOS-app/issues/294):
el rol nuevo se agrega a la pantalla y la capa de datos no se entera.

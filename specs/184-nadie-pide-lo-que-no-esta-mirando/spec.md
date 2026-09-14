# 184 · Nadie pide lo que no está mirando

**Issue:** [#303](https://github.com/gachetponzellini/RestaurantOS-app/issues/303) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** propuesta

**Input:** Juan, 2026-09-14, revisando la factura de Vercel. Tres hallazgos
distintos del mismo repaso, que van juntos porque comparten criterio: **pedir
sólo lo que alguien está mirando, y una sola vez**.

**Depende de**: [`102`](../102-salon-sin-refresh/spec.md) (el `onChange` que
reemplaza al `router.refresh()`; esto la termina),
[`052`](../052-kds-refetch-comandas/spec.md) (el refetch acotado del kanban, que
es el patrón a copiar), [`101`](../101-tabs-sin-red/spec.md) (el keep-alive de
tabs y el guard `active`), [`039`](../039-fundaciones-perf-percibida/spec.md)
(la iniciativa de perf percibida).

**Se mide contra** [`#304`](https://github.com/gachetponzellini/RestaurantOS-app/issues/304).

---

## Por qué

La spec 102 diagnosticó bien el problema —*"cada evento hacía `router.refresh()`,
que re-corría los 6 loaders de `/admin/operacion`"*— y lo arregló en el kanban y
en el plano. Lo que quedó afuera no es una omisión chica: es el canal que
decide **cuándo** se dispara ese refetch, y ese canal escucha de más.

El patrón bueno ya está escrito dos veces en el repo. Esto es terminar de
aplicarlo, y sacar los tres lugares donde el panel le pide al server cosas que
nadie está mirando.

## Lo que ya está construido

**El refetch acotado.** `ComandasKanban` tiene `refetchComandas` con guard de
secuencia, `serverData` como único escritor y `useOnActivate` para refrescar al
volver a la tab ([`comandas-kanban.tsx:298`](../../src/components/admin/local/comandas-kanban.tsx)).
Es exactamente la forma correcta. No hay que inventar nada.

**La guarda de visibilidad.** `orders-realtime-board.tsx:184` ya escucha
`visibilitychange` y refetchea al volver. Es **el único archivo del repo** que
lo hace.

**El `onChange` opcional.** `useTablesRealtime` y `useReservationsRealtime` ya
aceptan un refetch acotado del caller; lo que sigue vivo es el *fallback* a
`router.refresh()` para quien no lo pasa
([`use-tables-realtime.ts:60`](../../src/lib/mozo/use-tables-realtime.ts)).

**El debounce de 200ms** ya está en los tres hooks de realtime. Ese lado está
resuelto: el problema no es la ráfaga, es que el evento llegue.

---

## Decisiones

### D1 · El canal de comandas deja de escuchar toda la base

Hoy `ComandasKanban` se suscribe a `comandas` **sin filtro**, y el comentario lo
dice con todas las letras ([`comandas-kanban.tsx:414`](../../src/components/admin/local/comandas-kanban.tsx)):

> *"Comandas no tiene business_id directo, así que el canal escucha TODA la
> tabla; el filtro por negocio lo aplica el refetch server"*

Eso era aceptable como razonamiento de **correctitud** —el refetch devuelve sólo
lo nuestro, gracias a RLS— y es un desastre como razonamiento de **costo**.
`demo`, `golf-jcr` y `kcc` viven en la misma base cloud: **una comanda de golf
dispara un `getComandasTabData` completo en cada panel abierto de kcc y del
demo**. Multiplicado por cada tablet con la tab abierta.

Dos arreglos, de distinto tamaño:

- **`orders` se filtra ya.** El segundo handler del mismo canal escucha `orders`
  UPDATE sin filtro, y `orders` **sí** tiene `business_id`. Es una línea
  (`filter: business_id=eq.…`), igual que la que ya usa `admin-sidebar.tsx:328`.
- **`comandas` necesita la columna.** Migración que agrega `business_id` a
  `comandas`, backfilleado desde `orders` y mantenido por trigger (o por
  `enviarComanda`, que es el único que inserta). Con eso el canal filtra
  server-side como los demás.

La columna denormalizada **no** reemplaza a la RLS actual, que seguirá yendo por
`orders`: es para el filtro del canal, no para el permiso. Que el dato de
permiso siga viviendo en un solo lugar es lo que evita que una fila mal
backfilleada se convierta en un agujero.

### D2 · `/api/caja/stats` contesta por todas las cajas

`caja-admin-board.tsx:157` hace un `fetch` **por caja** dentro de un
`Promise.all`. Dos cajas por seis tablets son doce requests cada 30s donde
alcanzaría una.

La ruta pasa a aceptar el negocio en vez de una caja y devuelve el mapa
completo; el cliente deja de mapear sobre `cajas`. Y la cadencia pasa de 30s a
**60s**: es un tablero de supervisión, no la pantalla de cobro — el número que
importa en el momento de cobrar lo trae el flujo de cobro, no este poll.

El guard `if (!active)` de la spec 101 se queda tal cual. Funciona.

### D3 · Un poll que nadie mira no corre

En un restaurante las tablets quedan con la pestaña abierta toda la noche. Hoy
ningún `setInterval` que hace red mira si la pantalla está prendida.

Nace `useVisiblePolling(fn, ms)` en `lib/hooks/`: corre `fn` cada `ms` **sólo**
mientras `document.visibilityState === "visible"`, y dispara una vez al volver
—para que la pantalla que se reactiva no muestre el snapshot viejo esperando el
próximo tick. Es la misma lógica que `orders-realtime-board` ya tiene a mano,
extraída.

Pasan a usarlo los `setInterval` que **hacen red**:

| Dónde | Hoy | Queda |
|---|---|---|
| [`inbox-shell.tsx:38`](../../src/components/admin/conversations/inbox-shell.tsx) | `router.refresh()` cada 10s, sin guarda | 30s, con guarda |
| [`caja-admin-board.tsx:183`](../../src/components/admin/local/caja-admin-board.tsx) | `load` cada 30s | 60s, con guarda (D2) |
| [`fichaje-tab.tsx:66`](../../src/components/admin/local/fichaje-tab.tsx) | `getCurrentPresent` cada 60s | igual, con guarda |

**La bandeja es el peor caso y merece su párrafo.** `router.refresh()` no es un
fetch chiquito: re-ejecuta *todos* los server components de la ruta. Una pestaña
de conversaciones olvidada son 8.600 renders completos por día para que nadie
los lea. Pasa a 30s porque el dato que muestra —mensajes del chatbot de
reservas— no tiene urgencia de segundos; y sigue siendo polling y no realtime
porque las tablas `chatbot_*` son service-role-only, que es la razón que ya
estaba escrita ahí y no cambió.

**Los que NO se tocan**, y por qué:

- Los `setInterval` de reloj (`setNow`, `useNow`) no hacen red. Que el contador
  de demora de una comanda avance con la pestaña de fondo no le cuesta nada a
  nadie.
- `payment-status-poller` (3s) y `cobro-form` (pago MP) son **acotados**:
  corren durante un cobro, con deadline, y el usuario está mirando la pantalla
  esperando justamente eso. Meterles una guarda de visibilidad los rompería en
  el caso real de mandar al cliente a otra app a pagar y volver.

### D4 · El fallback a `router.refresh()` se retira

`useTablesRealtime` y `useReservationsRealtime` pasan a exigir `onChange`: deja
de ser opcional, y con él se va el `router.refresh()` de adentro de los hooks.
Mientras el fallback exista, cualquier consumidor nuevo hereda el problema por
olvido —que es literalmente cómo la app del mozo quedó donde quedó.

El consumidor que falta es la app del mozo. Su refetch acotado es el de su
propia pantalla de mesas, en la forma de la 052.

## Alcance

1. Migración: `comandas.business_id` + backfill + trigger. `db:types`.
2. `ComandasKanban`: `filter` por negocio en los dos handlers del canal.
3. `lib/hooks/use-visible-polling.ts` + test.
4. `/api/caja/stats`: respuesta por negocio; `caja-admin-board` deja de hacer
   fan-out y pasa a 60s vía `useVisiblePolling`.
5. `inbox-shell` (30s) y `fichaje-tab` migrados al hook.
6. `useTablesRealtime` / `useReservationsRealtime`: `onChange` obligatorio, sin
   `router.refresh()` adentro. Refetch acotado en la app del mozo.
7. Tests: el hook (visible/oculto/vuelta), y que el canal de comandas filtre por
   negocio.

## No-objetivos

- **Migrar las tablas `chatbot_*` a realtime.** Son service-role-only por
  diseño; abrirlas es una decisión de seguridad, no de performance. El polling
  de 30s es suficiente para una bandeja de mensajes.
- **Tocar el print-agent.** Es la [`183`](../183-el-agente-que-pregunta-cada-segundo/spec.md)
  y es ~10× más grande que todo esto junto.
- **Cachear la carta pública.** Es real (cada escaneo de QR es un SSR completo)
  y depende de cuánto tráfico haya: sale de los números de
  [`#304`](https://github.com/gachetponzellini/RestaurantOS-app/issues/304),
  no de acá.
- **Rediseñar `getComandasTabData`.** Las 4 queries de la tab están bien; el
  problema es cuántas veces se llama.

## Riesgos

- **`comandas.business_id` mal backfilleado deja un negocio sin realtime.** El
  KDS se congelaría hasta el refetch de `useOnActivate` —degradación silenciosa,
  que es la peor clase. Mitigación: la migración verifica que no queden NULL, y
  el trigger cubre las filas nuevas. Verificar en vivo en el demo antes de
  aplicar al cloud.
- **60s en caja puede sentirse lento en un arqueo.** Si pasa, es señal de que el
  arqueo necesita su propio refetch al abrir el modal —no de que el poll de
  fondo tenga que ser más rápido.
- **Sacar el fallback rompe un consumidor que no vimos.** Lo agarra el
  typecheck: `onChange` obligatorio es un error de tipos, no un bug en runtime.

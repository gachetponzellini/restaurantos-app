-- ────────────────────────────────────────────────────────────────────────
-- 0107 — la propina de antes del deploy (issue #287, spec 177 · D5)
--
-- La 177 cambió la fórmula del efectivo esperado: el cajón pasó a esperar **lo
-- que entró** (bruto, propina adentro) y la propina sale por un movimiento
-- `kind='propina'` que crea la rendición. Correcto de acá en adelante; el
-- problema es lo de antes.
--
-- `calculateExpectedCash` no congela nada: se recalcula en vivo sobre los
-- `payments` y `caja_movimientos` de la ventana (spec 149 · D1). Entonces una
-- propina en efectivo cobrada **antes** del deploy deja de descontarse —fórmula
-- nueva— pero tampoco existe el movimiento que la baje, porque cuando esa
-- rendición se registró el flujo no lo creaba. El corte que alguien contó y
-- firmó se relee hoy con un esperado más alto, y el primer cierre después del
-- deploy muestra sobrante por ese monto.
--
-- Esto regulariza eso: por cada propina en efectivo **que una rendición ya
-- registrada cubrió**, crea el movimiento que esa rendición habría creado. La
-- rendición no se vuelve a correr nunca, así que si no se escribe acá no lo
-- escribe nadie.
--
-- ## Las cuatro decisiones, y por qué
--
-- **1 · Sólo propina en EFECTIVO.** La fórmula vieja descontaba propina sólo de
-- los pagos `cash` (`expected-cash.ts`, pre-177), así que es lo único que el
-- esperado firmado ya tenía descontado. La propina de tarjeta nunca salió del
-- esperado *ni salió del cajón* en esa época —el pago del mozo por tarjeta es
-- justamente lo que la 177 vino a construir—, así que backfillearla inventaría
-- una salida que no ocurrió y dejaría el corte **por debajo** de lo firmado.
-- Medido en el cloud: kcc tiene exactamente una propina, $5.050 por
-- `card_manual`. Queda afuera a propósito.
--
-- **2 · Fechado en el COBRO, no en la rendición.** El issue proponía «un
-- movimiento por cada rendición». No alcanza: la neutralidad es por ventana de
-- corte, y la rendición puede caer semanas después del corte que contuvo esos
-- cobros. En `demo` la rendición del 01-09 cubre cobros del 13-08, de un corte
-- cerrado el mismo 13-08: fechar el movimiento en la rendición **sube** el
-- corte viejo y baja otro período. Fechándolo en el cobro, el movimiento cae en
-- la misma ventana que la propina que neutraliza, y el corte relee exactamente
-- lo que se firmó. Un movimiento por cobro, por eso.
--
-- **3 · Sólo rendiciones `rendida`.** Espeja el flujo vivo, que paga $0 cuando
-- el estado es `no_entrego` (`actions.ts` · registrarRendicionMozo): no se paga
-- propina contra una deuda abierta.
--
-- **4 · La propina TODAVÍA NO rendida no se toca.** Su rendición está por
-- venir, y cuando ocurra el flujo nuevo va a crear el movimiento. Backfillearla
-- acá la descontaría dos veces.
--
-- **5 · La rendición que YA pagó su propina queda afuera.** Si el flujo nuevo
-- alcanzó a correr para una rendición, su movimiento ya existe y cubre toda la
-- propina de esa ventana —efectivo y tarjeta juntos, que es como paga la 177—.
-- Backfillear encima descuenta la parte en efectivo dos veces. Se detecta por el
-- instante: `registrarRendicionMozo` escribe la fila y el movimiento con el
-- MISMO `corteIso`, así que un `propina` de ese mozo fechado exactamente en la
-- rendición es la marca de que ya se pagó. Se mira eso y no
-- `propina_pagada_cents` porque esa columna la agregó la `0103`: una rendición
-- registrada entre la `0101` y la `0103` tiene el movimiento hecho y la columna
-- en 0, y mirando sólo la columna se le volvería a pagar.
--
-- ## Lo que NO cubre, dicho
--
-- Propina en efectivo sin mozo atribuido, o de un mozo que nunca rindió, no
-- tiene rendición que la respalde y queda sin movimiento. Es lo honesto —nadie
-- la pagó— pero esa ventana sigue leyéndose distinta de lo que se firmó. En el
-- cloud hay un caso así, en `demo`: $1.750 del 03-09 de un usuario que no es
-- miembro del negocio.
--
-- ## Qué inserta hoy (medido en el cloud, 2026-09-14)
--
--   golf-jcr → 0 filas. Cero propina en efectivo en toda su historia.
--   kcc      → 0 filas. Su única propina es de tarjeta (ver decisión 1).
--
-- O sea: hoy es una red, no una corrección. Se aplica igual porque entre esta
-- medición y el deploy real puede cobrarse una propina en efectivo, y si se
-- cobra queda cubierta sola en vez de aparecer como sobrante esa noche.
--
-- Idempotente: no reinserta si ya hay un `propina` para ese cajón, ese mozo y
-- ese instante. Sólo INSERT — no toca ni una fila existente.
-- ────────────────────────────────────────────────────────────────────────

with rendiciones as (
  -- El piso del período de un mozo es su rendición anterior, y el techo es la
  -- rendición misma: la misma ventana que lee `getRendicionPendienteMozo`.
  select
    r.business_id,
    r.mozo_id,
    r.created_at,
    r.estado,
    r.registered_by,
    lag(r.created_at) over (
      partition by r.business_id, r.mozo_id
      order by r.created_at
    ) as piso
  from public.mozo_rendiciones r
),
a_regularizar as (
  select
    p.business_id,
    p.caja_id,
    p.attributed_mozo_id as mozo_id,
    p.tip_cents,
    p.created_at,
    r.registered_by,
    coalesce(bu.full_name, 'Mozo') as mozo_name
  from public.payments p
  join rendiciones r
    on  r.business_id = p.business_id
    and r.mozo_id     = p.attributed_mozo_id
    and r.estado      = 'rendida'
    and p.created_at <= r.created_at
    and (r.piso is null or p.created_at > r.piso)
    -- Decisión 5: si el flujo nuevo ya pagó esta rendición, su movimiento está
    -- fechado en el mismo instante que la fila. Ese ya cubrió la propina de la
    -- ventana entera; volver a escribirla la descontaría dos veces.
    and not exists (
      select 1
      from public.caja_movimientos ya
      where ya.kind        = 'propina'
        and ya.business_id = r.business_id
        and ya.mozo_id     = r.mozo_id
        and ya.created_at  = r.created_at
    )
  left join public.business_users bu
    on  bu.user_id     = p.attributed_mozo_id
    and bu.business_id = p.business_id
  where p.payment_status        = 'paid'
    and p.method                = 'cash'
    and p.tip_cents             > 0
    and p.caja_id            is not null
    and p.attributed_mozo_id is not null
)
insert into public.caja_movimientos
  (business_id, caja_id, kind, mozo_id, amount_cents, reason, created_by, created_at)
select
  x.business_id,
  x.caja_id,
  'propina',
  x.mozo_id,
  x.tip_cents,
  -- El nombre adentro del motivo porque el papel del cierre (spec 139) arma sus
  -- renglones con `reason`. El rótulo dice que es reconstruido: nadie contó ese
  -- billete saliendo del cajón esa noche, se está reponiendo la línea que la
  -- fórmula vieja daba por implícita.
  'Propina · ' || x.mozo_name || ' · regularización spec 177',
  x.registered_by,
  x.created_at
from a_regularizar x
where not exists (
  select 1
  from public.caja_movimientos m
  where m.kind       = 'propina'
    and m.caja_id    = x.caja_id
    and m.mozo_id    = x.mozo_id
    and m.created_at = x.created_at
);

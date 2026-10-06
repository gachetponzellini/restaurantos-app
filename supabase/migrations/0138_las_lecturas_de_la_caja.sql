-- ────────────────────────────────────────────────────────────────────────
-- 0138 — las lecturas de la caja salen de la base (spec 210 v2 · R2, R3; spec 211)
--
-- La pantalla recalculaba el «debería haber» en TS (expected-cash.ts) y la
-- base lo recalculaba para firmar el cierre: dos implementaciones de la misma
-- cuenta, y de ahí los EXPECTED_CHANGED y los números que no coincidían. Con el
-- modelo nuevo la cuenta cambia, así que en vez de reescribirla dos veces se
-- lee de la base:
--
--   · `desglose_esperado_caja(caja, hasta)` — los sumandos del «debería haber»
--     de la ventana abierta en `hasta`, y su total (= efectivo_esperado_caja).
--   · `saldos_mozos(business)` — cada mozo con plata en cada caja: lo cobrado
--     en efectivo (lo de las cuentas), su propina de tarjeta/QR (neta), la de
--     efectivo (ya la tiene), lo entregado, el saldo y si está resuelto.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.desglose_esperado_caja(p_caja_id uuid, p_hasta timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_desde       timestamptz;
  v_arrastre    bigint;
  v_retiro      bigint;
  v_efectivo    bigint;
  v_ingresos    bigint;
  v_rendiciones bigint;
  v_sangrias    bigint;
  v_propinas    bigint;
  v_total       bigint;
begin
  select created_at, closing_cash_cents into v_desde, v_arrastre
    from caja_cortes
   where caja_id = p_caja_id and created_at <= p_hasta
   order by created_at desc
   limit 1;
  if v_desde is null then
    select created_at into v_desde from cajas where id = p_caja_id;
    v_arrastre := 0;
  end if;

  -- El retiro del corte anterior nace 1 ms después del corte: se netea contra
  -- el arrastre para que la apertura sea lo que de verdad quedó en el cajón.
  select coalesce(sum(case when kind = 'ingreso' then -amount_cents else amount_cents end), 0)
    into v_retiro
    from caja_movimientos
   where caja_id = p_caja_id and cancelled_at is null and corte_id is not null
     and created_at > v_desde and created_at <= p_hasta;

  select coalesce(sum(amount_cents), 0) into v_efectivo
    from payments
   where caja_id = p_caja_id and payment_status = 'paid' and method = 'cash'
     and rinde_mozo_id is null
     and created_at > v_desde and created_at <= p_hasta;

  select
    coalesce(sum(amount_cents) filter (where kind = 'ingreso'), 0),
    coalesce(sum(amount_cents) filter (where kind = 'rendicion'), 0),
    coalesce(sum(amount_cents) filter (where kind = 'sangria'), 0),
    coalesce(sum(amount_cents) filter (where kind = 'propina'), 0)
    into v_ingresos, v_rendiciones, v_sangrias, v_propinas
    from caja_movimientos
   where caja_id = p_caja_id and cancelled_at is null and corte_id is null
     and created_at > v_desde and created_at <= p_hasta;

  v_total := coalesce(v_arrastre, 0) - v_retiro + v_efectivo + v_ingresos + v_rendiciones - v_sangrias - v_propinas;

  return jsonb_build_object(
    'desde', v_desde,
    'apertura_cents', coalesce(v_arrastre, 0) - v_retiro,
    'retiro_cierre_cents', v_retiro,
    'efectivo_cents', v_efectivo,
    'ingresos_cents', v_ingresos,
    'rendiciones_cents', v_rendiciones,
    'sangrias_cents', v_sangrias,
    'propinas_pagadas_cents', v_propinas,
    'esperado_cents', v_total
  );
end;
$function$;

revoke all on function public.desglose_esperado_caja(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.desglose_esperado_caja(uuid, timestamptz) to service_role;

create or replace function public.saldos_mozos(p_business_id uuid)
returns table(
  mozo_id uuid, mozo_name text, caja_id uuid, caja_name text,
  efectivo_cents bigint, propina_tarjeta_cents bigint, propina_efectivo_cents bigint,
  cobros_count integer, entregado_cents bigint, pagado_cents bigint,
  saldo_cents bigint, resuelto boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with pares as (
    select distinct p.rinde_mozo_id as mozo, p.caja_id as caja
      from payments p
     where p.business_id = p_business_id and p.rinde_mozo_id is not null and p.payment_status = 'paid'
    union
    select distinct m.mozo_id, m.caja_id
      from caja_movimientos m
     where m.business_id = p_business_id and m.kind in ('rendicion', 'propina')
       and m.mozo_id is not null and m.cancelled_at is null
       and m.created_at >= coalesce((select caja_modelo_v2_desde from businesses where id = p_business_id), 'infinity')
  )
  select
    pr.mozo,
    coalesce(bu.full_name, 'Sin nombre'),
    pr.caja,
    c.name,
    coalesce((select sum(p.amount_cents - p.tip_cents) from payments p
               where p.rinde_mozo_id = pr.mozo and p.caja_id = pr.caja
                 and p.payment_status = 'paid' and p.method = 'cash'), 0)::bigint,
    coalesce((select sum(p.tip_cents) from payments p
               where p.rinde_mozo_id = pr.mozo and p.caja_id = pr.caja
                 and p.payment_status = 'paid' and p.method <> 'cash'), 0)::bigint,
    coalesce((select sum(p.tip_cents) from payments p
               where p.rinde_mozo_id = pr.mozo and p.caja_id = pr.caja
                 and p.payment_status = 'paid' and p.method = 'cash'), 0)::bigint,
    (select count(*) from payments p
      where p.rinde_mozo_id = pr.mozo and p.caja_id = pr.caja and p.payment_status = 'paid')::integer,
    coalesce((select sum(m.amount_cents) from caja_movimientos m
               where m.mozo_id = pr.mozo and m.caja_id = pr.caja and m.kind = 'rendicion'
                 and m.cancelled_at is null), 0)::bigint,
    coalesce((select sum(m.amount_cents) from caja_movimientos m
               where m.mozo_id = pr.mozo and m.caja_id = pr.caja and m.kind = 'propina'
                 and m.cancelled_at is null
                 and m.created_at >= (select caja_modelo_v2_desde from businesses where id = p_business_id)), 0)::bigint,
    public.saldo_mozo(pr.mozo, pr.caja),
    public.mozo_resuelto(pr.mozo, pr.caja)
  from pares pr
  join cajas c on c.id = pr.caja and c.business_id = p_business_id
  left join business_users bu on bu.business_id = p_business_id and bu.user_id = pr.mozo
  order by c.name, coalesce(bu.full_name, '');
$function$;

revoke all on function public.saldos_mozos(uuid) from public, anon, authenticated;
grant execute on function public.saldos_mozos(uuid) to service_role;

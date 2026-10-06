-- ────────────────────────────────────────────────────────────────────────
-- 0141 — los saldos de los mozos, del turno (spec 211 · R1)
--
-- El saldo del mozo es una cuenta corriente: se arrastra entre turnos (una
-- deuda reconocida sigue a su nombre). Para la pantalla, «cobró en efectivo» no
-- puede ser el acumulado de siempre: tiene que ser lo de este turno, más un
-- «saldo anterior» si venía algo de antes. La fila cierra igual:
--
--   anterior + cobró − su propina − entregó + le pagó la caja = saldo
--
-- `saldos_mozos(negocio, desde)` devuelve las cifras de la ventana `> desde` y
-- el anterior. Lista los pares mozo×caja con movimiento en la ventana o con
-- saldo distinto de cero.
-- ────────────────────────────────────────────────────────────────────────

drop function if exists public.saldos_mozos(uuid);

create or replace function public.saldos_mozos(p_business_id uuid, p_desde timestamptz default '-infinity')
returns table(
  mozo_id uuid, mozo_name text, caja_id uuid, caja_name text,
  anterior_cents bigint,
  efectivo_cents bigint, propina_tarjeta_cents bigint, propina_efectivo_cents bigint,
  cobros_count integer, entregado_cents bigint, pagado_cents bigint,
  saldo_cents bigint, resuelto boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with v2 as (
    select coalesce(caja_modelo_v2_desde, 'infinity'::timestamptz) as desde
      from businesses where id = p_business_id
  ), pares as (
    select distinct p.rinde_mozo_id as mozo, p.caja_id as caja
      from payments p
     where p.business_id = p_business_id and p.rinde_mozo_id is not null and p.payment_status = 'paid'
    union
    select distinct m.mozo_id, m.caja_id
      from caja_movimientos m, v2
     where m.business_id = p_business_id and m.kind in ('rendicion', 'propina')
       and m.mozo_id is not null and m.cancelled_at is null and m.created_at >= v2.desde
  ), cifras as (
    select
      pr.mozo, pr.caja,
      coalesce((select sum(p.amount_cents - p.tip_cents) from payments p
                 where p.rinde_mozo_id = pr.mozo and p.caja_id = pr.caja and p.payment_status = 'paid'
                   and p.method = 'cash' and p.created_at > p_desde), 0)::bigint as efectivo,
      coalesce((select sum(p.tip_cents) from payments p
                 where p.rinde_mozo_id = pr.mozo and p.caja_id = pr.caja and p.payment_status = 'paid'
                   and p.method <> 'cash' and p.created_at > p_desde), 0)::bigint as prop_tarjeta,
      coalesce((select sum(p.tip_cents) from payments p
                 where p.rinde_mozo_id = pr.mozo and p.caja_id = pr.caja and p.payment_status = 'paid'
                   and p.method = 'cash' and p.created_at > p_desde), 0)::bigint as prop_efectivo,
      (select count(*) from payments p
        where p.rinde_mozo_id = pr.mozo and p.caja_id = pr.caja and p.payment_status = 'paid'
          and p.created_at > p_desde)::integer as cobros,
      coalesce((select sum(m.amount_cents) from caja_movimientos m
                 where m.mozo_id = pr.mozo and m.caja_id = pr.caja and m.kind = 'rendicion'
                   and m.cancelled_at is null and m.created_at > p_desde), 0)::bigint as entregado,
      coalesce((select sum(m.amount_cents) from caja_movimientos m, v2
                 where m.mozo_id = pr.mozo and m.caja_id = pr.caja and m.kind = 'propina'
                   and m.cancelled_at is null and m.created_at >= v2.desde
                   and m.created_at > p_desde), 0)::bigint as pagado,
      public.saldo_mozo(pr.mozo, pr.caja) as saldo,
      public.mozo_resuelto(pr.mozo, pr.caja) as resuelto
    from pares pr
  )
  select
    c.mozo,
    coalesce(bu.full_name, 'Sin nombre'),
    c.caja,
    cj.name,
    c.saldo - (c.efectivo - c.prop_tarjeta - c.entregado + c.pagado),
    c.efectivo, c.prop_tarjeta, c.prop_efectivo, c.cobros, c.entregado, c.pagado,
    c.saldo, c.resuelto
  from cifras c
  join cajas cj on cj.id = c.caja and cj.business_id = p_business_id
  left join business_users bu on bu.business_id = p_business_id and bu.user_id = c.mozo
  where c.cobros > 0 or c.entregado > 0 or c.pagado > 0 or c.saldo <> 0
  order by cj.name, coalesce(bu.full_name, '');
$function$;

revoke all on function public.saldos_mozos(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.saldos_mozos(uuid, timestamptz) to service_role;

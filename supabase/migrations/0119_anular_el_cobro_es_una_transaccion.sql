-- ────────────────────────────────────────────────────────────────────────
-- 0119 — anular el cobro de una cuenta es una transacción (issue #355, #361)
--
-- `anularCobro` (TS) eran seis escrituras sueltas contra la base: reabrir la
-- orden, reembolsar los pagos, auditarlos, borrar los pendientes, resetear las
-- sub-cuentas y resetear lo pagado. Sin transacción: un error en el medio
-- dejaba la cuenta reabierta con los pagos vivos, o reembolsada sin rastro.
--
-- Y le faltaba lo que la 0113 le dio a anular UNA línea: devolver la propina
-- del excedente (spec 177). Anular la cuenta entera dejaba `tip_cents` y
-- `total_cents` inflados, y al volver a cobrarla se cobraba la propina
-- fantasma de nuevo.
--
-- Las guardas que miran el contexto (arqueo cerrado, rendición, factura viva)
-- siguen en TS, antes de llamar — son lecturas con mensaje para el encargado.
-- La restitución de la mesa también: depende de la mesa, no de la plata.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.anular_cobro_tx(
  p_order_id uuid, p_business_id uuid, p_by_user_id uuid, p_reason text
)
returns table(reembolsados integer, reabierta boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order     orders%rowtype;
  v_reason    text := btrim(coalesce(p_reason, ''));
  v_extra     bigint;
  v_count     integer;
  v_reabierta boolean := false;
begin
  if v_reason = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_order from orders
   where id = p_order_id and business_id = p_business_id
   for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Reabrir primero (spec 092 · H-08): si la mesa ya tiene otra cuenta abierta,
  -- el índice único salta acá y la transacción entera se revierte — no se toca
  -- un peso.
  if v_order.lifecycle_status = 'closed' then
    begin
      update orders set
        lifecycle_status = 'open',
        closed_at        = null,
        status           = 'preparing'
      where id = p_order_id;
    exception when unique_violation then
      raise exception 'TABLE_HAS_OPEN_ORDER' using errcode = 'P0001';
    end;
    v_reabierta := true;
  end if;

  -- La propina que los excedentes le sumaron a la cuenta se va con ellos.
  select coalesce(sum(extra_tip_cents), 0) into v_extra
    from payments
   where order_id = p_order_id and payment_status = 'paid';

  with reembolsados as (
    update payments set
      payment_status  = 'refunded',
      refunded_at     = now(),
      refunded_reason = v_reason
    where order_id = p_order_id and payment_status = 'paid'
    returning id, caja_id
  ), auditados as (
    insert into caja_audit_log (
      business_id, caja_id, entity_type, entity_id, field,
      from_value, to_value, by_user_id, reason
    )
    select p_business_id, caja_id, 'payment', id, 'payment_status',
           'paid', 'refunded', p_by_user_id, v_reason
      from reembolsados
    returning 1
  )
  select count(*) into v_count from auditados;

  if v_extra > 0 then
    update orders set
      tip_cents   = greatest(tip_cents - v_extra, 0),
      total_cents = greatest(total_cents - least(v_extra, tip_cents), 0)
    where id = p_order_id;
  end if;

  -- Los pendientes (MP en curso) no son plata: se borran.
  delete from payments where order_id = p_order_id and payment_status = 'pending';

  -- Sub-cuentas y lo pagado de la orden: la regla común (0117). Las
  -- `cancelled` no resucitan (spec 36 · R-C4).
  perform public.recalcular_pagado_orden(p_order_id);

  return query select v_count, v_reabierta;
end;
$function$;

revoke all on function public.anular_cobro_tx(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.anular_cobro_tx(uuid, uuid, uuid, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 0117 — lo pagado es una sola cuenta (issue #352, epic #361)
--
-- «Cuánto se pagó de esta cuenta» estaba escrito cuatro veces, y no decía lo
-- mismo en todas:
--
--   · registrar_pago_tx (0076) y closeOrderIfFullyPaid → en BASE
--     (monto − ajuste por método), porque `total_cents` es lo que se debe sin
--     recargo ni descuento.
--   · anular_pago_tx y corregir_pago_tx → en BRUTO (monto con el ajuste
--     adentro).
--
-- Con un método con recargo, anular una línea dejaba `total_paid_cents` por
-- encima de lo real; con descuento, por debajo — y como la cuenta cerrada con
-- saldo (0113) y el bloqueo de la rendición (#351) leen ese número, aparecían
-- saldos fantasma que le trababan la rendición al mozo. Con descuento, además,
-- ninguna corrección de una cuenta cerrada pasaba: ORDER_WOULD_BE_UNCOVERED.
--
-- Y la otra mitad de la regla, «¿está saldada?», también divergía: con
-- sub-cuentas se decidía mirándolas a ellas (`bool_and(paid >= expected)`).
-- El saldo de una cuenta dividida y cerrada se cobra desde el pedido, sin
-- sub-cuenta, así que esa cuenta no quedaba pagada nunca. Y al revés, unas
-- sub-cuentas que no cubrían el total la daban por saldada.
--
-- ## La regla, en un solo lugar
--
-- `recalcular_pagado_orden(order)`:
--   · cada sub-cuenta: pagado = Σ base de sus pagos vivos; estado según eso;
--   · la orden: pagado = Σ base de todos sus pagos vivos;
--   · saldada ⇔ total > 0 y pagado ≥ total. Con o sin sub-cuentas: las
--     sub-cuentas son la guía para cobrar, no la definición de «pagado».
--
-- La llaman las tres RPC que mueven plata de una cuenta. El caller ya tiene la
-- orden bloqueada (`for update`).
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.recalcular_pagado_orden(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total      bigint;
  v_paid       bigint;
  v_fully_paid boolean;
begin
  update order_splits s set
    paid_amount_cents = coalesce(x.base, 0),
    status = case
      when s.status = 'cancelled' then 'cancelled'
      when coalesce(x.base, 0) >= s.expected_amount_cents then 'paid'
      else 'pending'
    end
  from (
    select sp.id,
           (select sum(p.amount_cents - coalesce(p.adjustment_cents, 0))
              from payments p
             where p.split_id = sp.id and p.payment_status = 'paid') as base
      from order_splits sp
     where sp.order_id = p_order_id
  ) x
  where s.id = x.id;

  select coalesce(sum(amount_cents - coalesce(adjustment_cents, 0)), 0)
    into v_paid
    from payments
   where order_id = p_order_id and payment_status = 'paid';

  select total_cents into v_total from orders where id = p_order_id;
  v_fully_paid := coalesce(v_total, 0) > 0 and v_paid >= v_total;

  -- `failed`/`refunded` son estados de la orden que no nacen de este cálculo
  -- (MP, pedidos online reembolsados): no se pisan.
  update orders set
    total_paid_cents = v_paid,
    payment_status = case
      when payment_status in ('pending', 'paid')
        then case when v_fully_paid then 'paid' else 'pending' end
      else payment_status
    end
  where id = p_order_id;

  return v_fully_paid;
end;
$function$;

revoke all on function public.recalcular_pagado_orden(uuid) from public, anon, authenticated;
grant execute on function public.recalcular_pagado_orden(uuid) to service_role;

-- ── Cobrar ──────────────────────────────────────────────────────────────────
-- Misma firma que la 0113. Cambia sólo el final: el recálculo es el común.

create or replace function public.registrar_pago_tx(
  p_order_id uuid, p_business_id uuid, p_split_id uuid, p_caja_id uuid,
  p_operated_by uuid, p_attributed_mozo_id uuid, p_method text,
  p_amount_cents bigint, p_tip_cents bigint, p_last_four text,
  p_card_brand text, p_notes text, p_adjustment_percent numeric,
  p_adjustment_cents bigint, p_request_id uuid,
  p_credit_customer_id uuid default null,
  p_received_cents bigint default null,
  p_extra_tip_cents bigint default 0
)
returns table(payment jsonb, split_done boolean, fully_paid boolean, idempotent boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order         orders%rowtype;
  v_split         order_splits%rowtype;
  v_existing      payments%rowtype;
  v_payment       payments%rowtype;
  v_split_done    boolean := false;
  v_fully_paid    boolean := false;
  v_paid_sum      bigint;
begin
  select * into v_order
    from orders
    where id = p_order_id and business_id = p_business_id
    for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.lifecycle_status <> 'open' then
    -- #339 — la cuenta cerrada con saldo sí se cobra.
    if not (v_order.lifecycle_status = 'closed'
            and v_order.status <> 'cancelled'
            and v_order.payment_status <> 'paid'
            and v_order.total_cents > 0
            and v_order.total_paid_cents < v_order.total_cents) then
      raise exception 'ORDER_CLOSED' using errcode = 'P0001';
    end if;
  end if;

  if p_request_id is not null then
    select * into v_existing
      from payments
      where business_id = p_business_id and request_id = p_request_id
      limit 1;
    if found then
      return query
        select to_jsonb(v_existing),
               coalesce((select s.status = 'paid' from order_splits s
                          where s.id = v_existing.split_id), false),
               false,
               true;
      return;
    end if;
  end if;

  if p_split_id is not null then
    select * into v_split
      from order_splits
      where id = p_split_id and business_id = p_business_id
      for update;
    if not found then
      raise exception 'SPLIT_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_split.order_id <> p_order_id then
      raise exception 'SPLIT_ORDER_MISMATCH' using errcode = 'P0001';
    end if;
    if v_split.status = 'cancelled' then
      raise exception 'SPLIT_CANCELLED' using errcode = 'P0001';
    end if;
    if v_split.paid_amount_cents >= v_split.expected_amount_cents then
      raise exception 'SPLIT_ALREADY_PAID' using errcode = 'P0001';
    end if;
  else
    select coalesce(sum(amount_cents - coalesce(adjustment_cents, 0)), 0) into v_paid_sum
      from payments
      where order_id = p_order_id and payment_status = 'paid';
    if v_order.total_cents > 0 and v_paid_sum >= v_order.total_cents then
      raise exception 'ORDER_ALREADY_PAID' using errcode = 'P0001';
    end if;
  end if;

  insert into payments (
    order_id, business_id, split_id, caja_id, operated_by, attributed_mozo_id,
    method, amount_cents, tip_cents, last_four, card_brand, payment_status,
    notes, adjustment_percent, adjustment_cents, request_id, credit_customer_id,
    received_cents, extra_tip_cents
  ) values (
    p_order_id, p_business_id, p_split_id, p_caja_id, p_operated_by, p_attributed_mozo_id,
    p_method, p_amount_cents, p_tip_cents, p_last_four, p_card_brand, 'paid',
    p_notes, coalesce(p_adjustment_percent, 0), coalesce(p_adjustment_cents, 0), p_request_id, p_credit_customer_id,
    p_received_cents, greatest(coalesce(p_extra_tip_cents, 0), 0)
  )
  returning * into v_payment;

  -- spec 177 · Parte A — el excedente sube la propina Y el total de la orden.
  if coalesce(p_extra_tip_cents, 0) > 0 then
    update orders
       set tip_cents   = tip_cents + p_extra_tip_cents,
           total_cents = total_cents + p_extra_tip_cents
     where id = p_order_id;
  end if;

  v_fully_paid := public.recalcular_pagado_orden(p_order_id);

  if p_split_id is not null then
    select status = 'paid' into v_split_done from order_splits where id = p_split_id;
  end if;

  -- #339 — una cuenta cerrada que se termina de cobrar queda pagada (lo hace
  -- el recálculo); el cierre en TS sólo mira órdenes abiertas.
  return query select to_jsonb(v_payment), coalesce(v_split_done, false), v_fully_paid, false;
end;
$function$;

-- ── Anular una línea ────────────────────────────────────────────────────────

create or replace function public.anular_pago_tx(
  p_payment_id uuid, p_business_id uuid, p_by_user_id uuid, p_reason text
)
returns table(payment jsonb, fully_paid boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old        payments%rowtype;
  v_new        payments%rowtype;
  v_order      orders%rowtype;
  v_fully_paid boolean;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_extra      bigint;
begin
  if v_reason = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_old from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.business_id <> p_business_id then
    raise exception 'PAYMENT_OTHER_BUSINESS' using errcode = 'P0001';
  end if;
  if v_old.payment_status <> 'paid' then
    raise exception 'PAYMENT_NOT_PAID' using errcode = 'P0001';
  end if;
  if v_old.mp_payment_id is not null or v_old.method in ('mp_link', 'mp_qr') then
    raise exception 'PAYMENT_IS_MP' using errcode = 'P0001';
  end if;

  select * into v_order from orders where id = v_old.order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  update payments set
    payment_status  = 'refunded',
    refunded_at     = now(),
    refunded_reason = v_reason
  where id = v_old.id
  returning * into v_new;

  -- #339 — la propina que ESTA línea le sumó a la orden por el excedente se
  -- va con ella. Acotado a lo que la orden tiene: nunca negativo.
  v_extra := least(coalesce(v_old.extra_tip_cents, 0), v_order.tip_cents);
  if v_extra > 0 then
    update orders
       set tip_cents   = tip_cents - v_extra,
           total_cents = greatest(total_cents - v_extra, 0)
     where id = v_order.id;
  end if;

  v_fully_paid := public.recalcular_pagado_orden(v_order.id);

  insert into caja_audit_log (
    business_id, caja_id, entity_type, entity_id, field,
    from_value, to_value, by_user_id, reason
  ) values (
    p_business_id, v_new.caja_id, 'payment', v_new.id, 'cancelled',
    'activo', 'anulado', p_by_user_id, v_reason
  );

  return query select to_jsonb(v_new), v_fully_paid;
end;
$function$;

-- ── Corregir una línea ──────────────────────────────────────────────────────
-- Misma firma que la 0032. Cambia el recálculo (base, regla común).

create or replace function public.corregir_pago_tx(
  p_payment_id  uuid,
  p_business_id uuid,
  p_by_user_id  uuid,
  p_reason      text,
  p_patch       jsonb
)
returns table (
  payment        jsonb,
  fully_paid     boolean,
  changed_fields text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old           payments%rowtype;
  v_new           payments%rowtype;
  v_order         orders%rowtype;
  v_new_method    text;
  v_new_amount    bigint;
  v_new_tip       bigint;
  v_new_mozo      uuid;
  v_new_caja      uuid;
  v_new_last_four text;
  v_new_brand     text;
  v_new_notes     text;
  v_fully_paid    boolean := false;
  v_changed       text[] := '{}';
  v_reason        text := btrim(coalesce(p_reason, ''));
begin
  if v_reason = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_old from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.business_id <> p_business_id then
    raise exception 'PAYMENT_OTHER_BUSINESS' using errcode = 'P0001';
  end if;
  if v_old.payment_status <> 'paid' then
    raise exception 'PAYMENT_NOT_PAID' using errcode = 'P0001';
  end if;
  if v_old.mp_payment_id is not null or v_old.method in ('mp_link', 'mp_qr') then
    raise exception 'PAYMENT_IS_MP' using errcode = 'P0001';
  end if;

  select * into v_order from orders where id = v_old.order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_new_method := case when p_patch ? 'method'
    then p_patch->>'method' else v_old.method end;
  v_new_amount := case when p_patch ? 'amount_cents'
    then (p_patch->>'amount_cents')::bigint else v_old.amount_cents end;
  v_new_tip := case when p_patch ? 'tip_cents'
    then (p_patch->>'tip_cents')::bigint else v_old.tip_cents end;
  v_new_mozo := case when p_patch ? 'attributed_mozo_id'
    then nullif(p_patch->>'attributed_mozo_id', '')::uuid else v_old.attributed_mozo_id end;
  v_new_caja := case when p_patch ? 'caja_id'
    then (p_patch->>'caja_id')::uuid else v_old.caja_id end;
  v_new_last_four := case when p_patch ? 'last_four'
    then nullif(p_patch->>'last_four', '') else v_old.last_four end;
  v_new_brand := case when p_patch ? 'card_brand'
    then nullif(p_patch->>'card_brand', '') else v_old.card_brand end;
  v_new_notes := case when p_patch ? 'notes'
    then nullif(btrim(p_patch->>'notes'), '') else v_old.notes end;

  if v_new_method not in ('cash', 'card_manual', 'transfer', 'other') then
    raise exception 'METHOD_NOT_MANUAL' using errcode = 'P0001';
  end if;
  if v_new_amount <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = 'P0001';
  end if;
  if v_new_tip < 0 or v_new_tip > v_new_amount then
    raise exception 'TIP_GT_AMOUNT' using errcode = 'P0001';
  end if;
  if v_new_caja is distinct from v_old.caja_id then
    perform 1 from cajas
      where id = v_new_caja and business_id = p_business_id and is_active;
    if not found then
      raise exception 'CAJA_INVALID' using errcode = 'P0001';
    end if;
  end if;
  if v_new_mozo is not null and v_new_mozo is distinct from v_old.attributed_mozo_id then
    perform 1 from business_users
      where user_id = v_new_mozo
        and business_id = p_business_id
        and disabled_at is null
        and role in ('mozo', 'encargado', 'admin');
    if not found then
      raise exception 'MOZO_INVALID' using errcode = 'P0001';
    end if;
  end if;

  update payments set
    method             = v_new_method,
    amount_cents       = v_new_amount,
    tip_cents          = v_new_tip,
    attributed_mozo_id = v_new_mozo,
    caja_id            = v_new_caja,
    last_four          = v_new_last_four,
    card_brand         = v_new_brand,
    notes              = v_new_notes
  where id = v_old.id
  returning * into v_new;

  v_fully_paid := public.recalcular_pagado_orden(v_order.id);

  -- FR-012: una orden cerrada no se reabre desde la caja. El raise revierte
  -- todo lo de arriba (mismo transaction scope).
  if v_order.lifecycle_status = 'closed' and v_order.payment_status = 'paid'
     and not v_fully_paid then
    raise exception 'ORDER_WOULD_BE_UNCOVERED' using errcode = 'P0001';
  end if;

  if v_old.method is distinct from v_new.method then
    v_changed := array_append(v_changed, 'method');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'method', v_old.method, v_new.method, p_by_user_id, v_reason);
  end if;
  if v_old.amount_cents is distinct from v_new.amount_cents then
    v_changed := array_append(v_changed, 'amount_cents');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'amount_cents', v_old.amount_cents::text, v_new.amount_cents::text, p_by_user_id, v_reason);
  end if;
  if v_old.tip_cents is distinct from v_new.tip_cents then
    v_changed := array_append(v_changed, 'tip_cents');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'tip_cents', v_old.tip_cents::text, v_new.tip_cents::text, p_by_user_id, v_reason);
  end if;
  if v_old.attributed_mozo_id is distinct from v_new.attributed_mozo_id then
    v_changed := array_append(v_changed, 'attributed_mozo_id');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'attributed_mozo_id', v_old.attributed_mozo_id::text, v_new.attributed_mozo_id::text, p_by_user_id, v_reason);
  end if;
  if v_old.caja_id is distinct from v_new.caja_id then
    v_changed := array_append(v_changed, 'caja_id');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'caja_id', v_old.caja_id::text, v_new.caja_id::text, p_by_user_id, v_reason);
  end if;
  if v_old.last_four is distinct from v_new.last_four then
    v_changed := array_append(v_changed, 'last_four');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'last_four', v_old.last_four, v_new.last_four, p_by_user_id, v_reason);
  end if;
  if v_old.card_brand is distinct from v_new.card_brand then
    v_changed := array_append(v_changed, 'card_brand');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'card_brand', v_old.card_brand, v_new.card_brand, p_by_user_id, v_reason);
  end if;
  if v_old.notes is distinct from v_new.notes then
    v_changed := array_append(v_changed, 'notes');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'notes', v_old.notes, v_new.notes, p_by_user_id, v_reason);
  end if;

  if array_length(v_changed, 1) is null then
    raise exception 'NOTHING_TO_CHANGE' using errcode = 'P0001';
  end if;

  return query select to_jsonb(v_new), v_fully_paid, v_changed;
end;
$$;

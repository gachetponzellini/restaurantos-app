-- ────────────────────────────────────────────────────────────────────────
-- 0113 — la cuenta cerrada con saldo se puede cobrar, y anular devuelve la
--        propina del excedente (issue #339, sigue de #338)
--
-- El caso que lo destapó (2026-09-18): una transferencia cargada dos veces
-- dejó $17.500 de propina fantasma (el excedente de la 0100 sube
-- `orders.tip_cents` y `total_cents`). Para corregirlo se anularon las dos
-- líneas con `anular_pago_tx`, y la orden quedó:
--
--   · CERRADA, con $0 cobrado — y `registrar_pago_tx` rechaza toda orden que
--     no esté `open`: no había forma de volver a cobrarla desde ningún lado;
--   · con el total todavía inflado: anular la línea no devolvía la propina
--     que ESA línea le había sumado a la orden.
--
-- ## 1) `payments.extra_tip_cents`
--
-- Cuánto de `tip_cents` vino del excedente (y por lo tanto subió el total de
-- la orden). `tip_cents` mezcla la propina que ya traía la cuenta con el
-- excedente, y sólo el excedente se revierte al anular: la de la cuenta la
-- puso el mozo en el paso Cuenta y sigue siendo de la orden.
--
-- ## 2) `registrar_pago_tx` cobra una cuenta cerrada con saldo
--
-- Sólo si: no está cancelada, no figura pagada y lo cobrado no alcanza el
-- total. Al saldarla se marca `payment_status = 'paid'` acá adentro — el
-- cierre en TS (`closeOrderIfFullyPaid`) sólo mira órdenes abiertas.
--
-- ## 3) `anular_pago_tx` devuelve el excedente
--
-- Resta `extra_tip_cents` de `tip_cents` y de `total_cents`, igual que la 0100
-- los sumó. El `returning * into v_order` va antes del `fully_paid`: si no,
-- compararía contra el total viejo (el mismo cuidado que la 0100).
-- ────────────────────────────────────────────────────────────────────────

-- ── 1) La columna ───────────────────────────────────────────────────────────

alter table "public"."payments"
  add column if not exists "extra_tip_cents" bigint not null default 0;

alter table "public"."payments"
  drop constraint if exists "payments_extra_tip_cents_check";
alter table "public"."payments"
  add constraint "payments_extra_tip_cents_check"
  check ("extra_tip_cents" >= 0 and "extra_tip_cents" <= "tip_cents");

comment on column "public"."payments"."extra_tip_cents" is
  'Issue #339: la parte de `tip_cents` que vino del excedente (spec 177 · Parte A) y que por eso subió orders.tip_cents + total_cents. `anular_pago_tx` la resta al anular la línea. 0 en las filas anteriores.';

-- ── 2) El cobro ─────────────────────────────────────────────────────────────
--
-- Misma firma que la 0100: `create or replace` conserva los permisos.

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
  v_new_paid      bigint;
  v_split_done    boolean := false;
  v_fully_paid    boolean := false;
  v_paid_sum      bigint;
  v_active_splits int;
  v_all_paid      boolean;
  v_cerrada       boolean := false;
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
    if v_order.lifecycle_status = 'closed'
       and v_order.status <> 'cancelled'
       and v_order.payment_status <> 'paid'
       and v_order.total_cents > 0
       and v_order.total_paid_cents < v_order.total_cents then
      v_cerrada := true;
    else
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
    -- 0076: en BASE, no en bruto.
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
     where id = p_order_id
    returning * into v_order;
  end if;

  if p_split_id is not null then
    -- 0076: lo que el split acumula es la BASE.
    v_new_paid   := v_split.paid_amount_cents + (p_amount_cents - coalesce(p_adjustment_cents, 0));
    v_split_done := v_new_paid >= v_split.expected_amount_cents;
    update order_splits
      set paid_amount_cents = v_new_paid,
          status = case when v_split_done then 'paid' else 'pending' end
      where id = p_split_id;
  end if;

  -- 0076: en BASE, no en bruto.
  select coalesce(sum(amount_cents - coalesce(adjustment_cents, 0)), 0) into v_paid_sum
    from payments
    where order_id = p_order_id and payment_status = 'paid';
  select count(*) into v_active_splits
    from order_splits
    where order_id = p_order_id and status <> 'cancelled';
  if v_active_splits = 0 then
    v_fully_paid := v_paid_sum >= v_order.total_cents and v_order.total_cents > 0;
  else
    select bool_and(paid_amount_cents >= expected_amount_cents) into v_all_paid
      from order_splits
      where order_id = p_order_id and status <> 'cancelled';
    v_fully_paid := coalesce(v_all_paid, false);
  end if;

  -- spec 094 · H-07 — el progreso del cobro parcial se persiste. #339 — y la
  -- cuenta cerrada que se termina de cobrar queda pagada: el cierre en TS no
  -- la toca porque ya no está abierta.
  update orders
     set total_paid_cents = v_paid_sum,
         payment_status = case
           when v_cerrada and v_fully_paid then 'paid'
           else payment_status
         end
   where id = p_order_id;

  return query select to_jsonb(v_payment), v_split_done, v_fully_paid, false;
end;
$function$;

-- ── 3) La anulación ─────────────────────────────────────────────────────────

create or replace function public.anular_pago_tx(
  p_payment_id uuid, p_business_id uuid, p_by_user_id uuid, p_reason text
)
returns table(payment jsonb, fully_paid boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old           payments%rowtype;
  v_new           payments%rowtype;
  v_order         orders%rowtype;
  v_split_paid    bigint;
  v_paid_sum      bigint;
  v_active_splits int;
  v_all_paid      boolean;
  v_fully_paid    boolean := false;
  v_reason        text := btrim(coalesce(p_reason, ''));
  v_extra         bigint;
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
     where id = v_order.id
    returning * into v_order;
  end if;

  if v_old.split_id is not null then
    select coalesce(sum(amount_cents), 0) into v_split_paid
      from payments
      where split_id = v_old.split_id and payment_status = 'paid';
    update order_splits set
      paid_amount_cents = v_split_paid,
      status = case
        when status = 'cancelled' then status
        when v_split_paid >= expected_amount_cents then 'paid'
        else 'pending'
      end
    where id = v_old.split_id;
  end if;

  select coalesce(sum(amount_cents), 0) into v_paid_sum
    from payments
    where order_id = v_order.id and payment_status = 'paid';
  select count(*) into v_active_splits
    from order_splits
    where order_id = v_order.id and status <> 'cancelled';
  if v_active_splits = 0 then
    v_fully_paid := v_paid_sum >= v_order.total_cents and v_order.total_cents > 0;
  else
    select bool_and(paid_amount_cents >= expected_amount_cents) into v_all_paid
      from order_splits
      where order_id = v_order.id and status <> 'cancelled';
    v_fully_paid := coalesce(v_all_paid, false);
  end if;

  update orders set
    total_paid_cents = v_paid_sum,
    payment_status = case when v_fully_paid then payment_status else 'pending' end
  where id = v_order.id;

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

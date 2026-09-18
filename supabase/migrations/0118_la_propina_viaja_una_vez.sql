-- ────────────────────────────────────────────────────────────────────────
-- 0118 — la propina viaja una vez (issue #353, epic #361)
--
-- Sin dividir, la pantalla de cobro arma una sub-cuenta implícita que lleva la
-- propina ENTERA de la orden (`implicit-split.ts`). Con tarjeta o transferencia
-- se puede pagar de menos, así que una cuenta cobrada en dos pagos registraba
-- la propina dos veces: la rendición (que suma `payments.tip_cents`) se la
-- pagaba dos veces al mozo, del cajón, y la venta quedaba subdeclarada.
--
-- La propina de un pago ya no viene de la pantalla: la asigna la base. Es lo
-- que falta de propina en la cuenta —o en la sub-cuenta— y nunca más que lo
-- que el pago salda. El excedente (spec 177) se suma aparte, como siempre.
--
-- Dos invariantes de borde que faltaban:
--   · AMOUNT_NOT_POSITIVE — no hay cobros de $0.
--   · AMOUNT_EXCEEDS_REMAINING — lo que un pago salda en base no supera lo
--     que falta. La pantalla calcula el saldo antes del lock; si otro cobro
--     entró en el medio, sin esta guarda la plata de más entraba como venta.
--
-- Misma firma que la 0113/0117: `create or replace` conserva los permisos.
-- ────────────────────────────────────────────────────────────────────────

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
  v_extra         bigint := greatest(coalesce(p_extra_tip_cents, 0), 0);
  v_adjustment    bigint := coalesce(p_adjustment_cents, 0);
  v_base_venta    bigint;
  v_restante      bigint;
  v_tip_asignada  bigint;
  v_tip_libre     bigint;
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
    v_restante := v_split.expected_amount_cents - v_split.paid_amount_cents;
    -- Propina de ESTA sub-cuenta que todavía no viajó en ningún pago.
    select v_split.tip_cents - coalesce(sum(tip_cents - extra_tip_cents), 0)
      into v_tip_libre
      from payments
     where split_id = p_split_id and payment_status = 'paid';
  else
    select coalesce(sum(amount_cents - coalesce(adjustment_cents, 0)), 0) into v_paid_sum
      from payments
      where order_id = p_order_id and payment_status = 'paid';
    if v_order.total_cents > 0 and v_paid_sum >= v_order.total_cents then
      raise exception 'ORDER_ALREADY_PAID' using errcode = 'P0001';
    end if;
    v_restante := v_order.total_cents - v_paid_sum;
    -- Propina de la cuenta (sin la que sumaron los excedentes, que ya viajó
    -- con su pago) que todavía no viajó en ningún pago.
    select v_order.tip_cents - coalesce(sum(extra_tip_cents), 0)
                             - coalesce(sum(tip_cents - extra_tip_cents), 0)
      into v_tip_libre
      from payments
     where order_id = p_order_id and payment_status = 'paid';
  end if;

  -- #353 — un cobro de $0 no es un cobro. Va después de la idempotencia y
  -- de «ya cobrado»: un segundo tap llega con el saldo en 0 y tiene que
  -- recibir esas respuestas, no ésta.
  if coalesce(p_amount_cents, 0) <= 0 then
    raise exception 'AMOUNT_NOT_POSITIVE' using errcode = 'P0001';
  end if;
  if v_extra > p_amount_cents then
    raise exception 'EXTRA_TIP_GT_AMOUNT' using errcode = 'P0001';
  end if;

  -- #353 — lo que este pago salda (en base, sin el excedente, que es propina
  -- nueva) no puede superar lo que falta. Es la guarda del doble cobro: la
  -- pantalla calcula el saldo antes del lock, y si otro cobro entró en el medio
  -- el excedente que ella armó ya no existe — la plata entraría como venta.
  v_base_venta := p_amount_cents - v_adjustment - v_extra;
  if v_base_venta > v_restante then
    raise exception 'AMOUNT_EXCEEDS_REMAINING:%', v_restante using errcode = 'P0001';
  end if;

  -- #353 — la propina la asigna la base: lo que falta de propina, acotado a lo
  -- que este pago salda. La pantalla mandaba la propina entera de la cuenta en
  -- cada pago parcial, y la rendición la pagaba una vez por pago.
  v_tip_asignada := greatest(0, least(coalesce(v_tip_libre, 0), v_base_venta));

  insert into payments (
    order_id, business_id, split_id, caja_id, operated_by, attributed_mozo_id,
    method, amount_cents, tip_cents, last_four, card_brand, payment_status,
    notes, adjustment_percent, adjustment_cents, request_id, credit_customer_id,
    received_cents, extra_tip_cents
  ) values (
    p_order_id, p_business_id, p_split_id, p_caja_id, p_operated_by, p_attributed_mozo_id,
    p_method, p_amount_cents, v_tip_asignada + v_extra, p_last_four, p_card_brand, 'paid',
    p_notes, coalesce(p_adjustment_percent, 0), coalesce(p_adjustment_cents, 0), p_request_id, p_credit_customer_id,
    p_received_cents, v_extra
  )
  returning * into v_payment;

  -- spec 177 · Parte A — el excedente sube la propina Y el total de la orden.
  if v_extra > 0 then
    update orders
       set tip_cents   = tip_cents + v_extra,
           total_cents = total_cents + v_extra
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


-- ────────────────────────────────────────────────────────────────────────
-- 0100 — el excedente es propina, no venta (spec 177 · Parte A)
--
-- Lo que se cobraba de más se comportaba distinto según el método:
--
--   · efectivo  → `cashCharge` lo acotaba y lo llamaba vuelto. Si el cliente
--                 decía «quedátelo», el excedente se DESCARTABA.
--   · tarjeta   → pasaba derecho: el posnet cobraba $50.000 sobre una cuenta de
--                 $42.000 y esos $8.000 entraban como **venta del negocio**,
--                 con `tip_cents = 0`. Nadie los podía atribuir a nadie y el
--                 arqueo los contaba como facturación.
--
-- Ahora el excedente que no vuelve al bolsillo del cliente sube la propina de
-- la orden — `orders.tip_cents` **y** `orders.total_cents`, los dos en el mismo
-- monto.
--
-- ## Por qué los dos, y por qué no rompe la factura
--
-- `emitInvoiceCore` calcula la base fiscal como `total_cents − tip_cents +
-- ajuste` (spec 36 · R-C1: la propina no integra la base imponible en AR). Con
-- los dos sumando lo mismo, `(total + X) − (tip + X) = total − tip`: **el
-- comprobante no cambia en un peso**. Era la condición que puso Juan — «el
-- excedente no debería de facturarse, pero debería quedar registrado todo».
--
-- Y subiendo el total se conserva todo el resto sin tocarlo: `total_paid` sigue
-- cerrando contra `total_cents`, el arqueo lee `payments` como siempre, y las
-- tres guardas de saldado que la 0076 dejó en BASE siguen comparando lo mismo.
--
-- ## El bump va acá adentro
--
-- Es plata, y esta función ya tiene el `for update` sobre la orden. Hacerlo
-- desde TS después del cobro abre una ventana donde el total y los pagos no
-- cuadran. El `returning * into v_order` refresca la fila: sin eso `fully_paid`
-- compararía contra el total viejo, que es el bug que la spec anotó en D8.
--
-- ## `received_cents`
--
-- Lo que el cliente entregó. Hasta ahora se guardaba `chargeCents` y el billete
-- se descartaba: de un pago de $42.000 no había forma de saber si el cliente
-- había dado $50.000 y se le devolvieron $8.000, o si los había dejado.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1) El billete que entró ─────────────────────────────────────────────────

alter table "public"."payments"
  add column if not exists "received_cents" bigint;

alter table "public"."payments"
  drop constraint if exists "payments_received_cents_check";
alter table "public"."payments"
  add constraint "payments_received_cents_check"
  check ("received_cents" is null or "received_cents" >= 0);

comment on column "public"."payments"."received_cents" is
  'Spec 177 · Parte A: lo que el cliente ENTREGÓ. `amount_cents` es lo que se registró como cobrado (propina incluida); la diferencia es el vuelto que volvió al bolsillo. Null en las filas anteriores a la spec.';

-- ── 2) La RPC ───────────────────────────────────────────────────────────────
--
-- Dos parámetros nuevos, los dos con default para no romper a nadie que llame
-- por nombre. `create or replace` no alcanza: cambiar la firma crea una
-- SOBRECARGA y las llamadas quedan ambiguas. Se dropea la vieja primero, igual
-- que hizo la 0065.

drop function if exists public.registrar_pago_tx(
  uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint,
  text, text, text, numeric, bigint, uuid, uuid);

create function public.registrar_pago_tx(
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
begin
  select * into v_order
    from orders
    where id = p_order_id and business_id = p_business_id
    for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.lifecycle_status <> 'open' then
    raise exception 'ORDER_CLOSED' using errcode = 'P0001';
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
    received_cents
  ) values (
    p_order_id, p_business_id, p_split_id, p_caja_id, p_operated_by, p_attributed_mozo_id,
    p_method, p_amount_cents, p_tip_cents, p_last_four, p_card_brand, 'paid',
    p_notes, coalesce(p_adjustment_percent, 0), coalesce(p_adjustment_cents, 0), p_request_id, p_credit_customer_id,
    p_received_cents
  )
  returning * into v_payment;

  -- spec 177 · Parte A — el excedente sube la propina Y el total de la orden.
  --
  -- El `returning * into v_order` no es cosmético: sin él, el `fully_paid` de
  -- más abajo compararía contra el `total_cents` que se leyó al principio de la
  -- transacción, o sea contra un número que esta misma función acaba de dejar
  -- viejo.
  if coalesce(p_extra_tip_cents, 0) > 0 then
    update orders
       set tip_cents   = tip_cents + p_extra_tip_cents,
           total_cents = total_cents + p_extra_tip_cents
     where id = p_order_id
    returning * into v_order;
  end if;

  if p_split_id is not null then
    -- 0076: lo que el split acumula es la BASE, que es contra lo que se compara
    -- `expected_amount_cents`.
    --
    -- El excedente-propina entra acá adentro a propósito: la sub-cuenta quedó
    -- saldada (y de sobra), y ese sobrante es del mozo. `expected_amount_cents`
    -- NO se toca — es lo que a esa sub-cuenta le tocaba de la comida.
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

  -- spec 094 · H-07 — el progreso del cobro parcial se persiste.
  update orders set total_paid_cents = v_paid_sum where id = p_order_id;

  return query select to_jsonb(v_payment), v_split_done, v_fully_paid, false;
end;
$function$;

-- ── 3) Los permisos, que el DROP se lleva puestos ───────────────────────────
--
-- `registrar_pago_tx` es SECURITY DEFINER y escribe plata: su ACL en el cloud
-- es `{postgres, service_role}` — PUBLIC está revocado. Una función nueva
-- nace con EXECUTE para PUBLIC, así que sin esto el drop+create le abriría a
-- `anon` y `authenticated` una función que inserta pagos saltándose RLS.

revoke all on function public.registrar_pago_tx(
  uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint,
  text, text, text, numeric, bigint, uuid, uuid, bigint, bigint
) from public;
revoke all on function public.registrar_pago_tx(
  uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint,
  text, text, text, numeric, bigint, uuid, uuid, bigint, bigint
) from anon, authenticated;
grant execute on function public.registrar_pago_tx(
  uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, bigint,
  text, text, text, numeric, bigint, uuid, uuid, bigint, bigint
) to service_role;

comment on function public.registrar_pago_tx is
  'Cobro transaccional e idempotente (spec 42 / issue #58). Spec 177 · Parte A: p_extra_tip_cents sube orders.tip_cents + total_cents (el excedente que el cliente deja es del mozo, no venta), y p_received_cents guarda el billete que entró.';

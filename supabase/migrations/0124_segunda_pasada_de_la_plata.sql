-- ────────────────────────────────────────────────────────────────────────
-- 0124 — segunda pasada de la plata (auditoría 2026-09-20, epic #361)
--
-- Re-revisión de lo corregido en 0117–0123 más lo que quedaba:
--
-- 1. **El cobro huérfano de la rendición.** El #264 lo dejó escrito como
--    residual: la action lee los cobros del mozo y después guarda la
--    rendición; un cobro que entre en el medio queda con una hora anterior al
--    piso del próximo período —no lo rinde nadie— mientras el cajón lo sigue
--    esperando. Ahora:
--      · `registrar_pago_tx` toma un lock compartido por (negocio, mozo);
--      · `registrar_rendicion_tx` toma el exclusivo, vuelve a CONTAR los
--        cobros del período y, si no son los que la action leyó
--        (`p_pagos_leidos`), rechaza con RENDICION_CONCURRENTE;
--      · la hora de la rendición es la del reloj de la base, tomada con el
--        lock: todo cobro contado es anterior, todo cobro nuevo es posterior.
--        Se acabó depender de que Node y Postgres tengan la misma hora.
--
-- 2. **La propina pagada se sella con el reloj de la base.** Llevaba la hora
--    de Node: con un cierre de caja en el medio podía quedar fechada ANTES del
--    corte y fuera de su esperado — ni ese cierre ni el siguiente la contaban.
--
-- 3. **Corregir una propina hacia arriba** le sube propina y total a la cuenta
--    (es un excedente cargado tarde). Antes sólo crecía `payments.tip_cents`.
--
-- 4. **El costo del insumo sigue a la última compra**, sea cual sea la
--    presentación comprada: la receta cuesta con la presentación `default`, y
--    si se compraba otra (o a granel, sin presentación) el costo no se
--    actualizaba nunca.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1 y 2 · la rendición ────────────────────────────────────────────────────

drop function if exists public.registrar_rendicion_tx(uuid, uuid, uuid, uuid, timestamptz, bigint, bigint, bigint, text, jsonb, jsonb, text, bigint, uuid, text);

create or replace function public.registrar_rendicion_tx(
  p_business_id uuid,
  p_mozo_id uuid,
  p_registered_by uuid,
  p_desde_rendicion_id uuid,
  p_created_at timestamptz,          -- legado: ya no fija la hora (ver arriba)
  p_expected_cash_cents bigint,
  p_delivered_cash_cents bigint,
  p_difference_cents bigint,
  p_notes text,
  p_por_metodo jsonb,
  p_por_canal jsonb,
  p_estado text,
  p_propina_pagada_cents bigint,
  p_caja_id uuid,
  p_propina_reason text,
  p_pagos_leidos integer default null -- null = caller viejo, sin verificación
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ultima     uuid;
  v_ultima_ts  timestamptz;
  v_ts         timestamptz;
  v_pagos      integer;
  v_rendicion  mozo_rendiciones%rowtype;
begin
  -- Exclusivo: espera a los cobros en vuelo de este mozo (que lo toman
  -- compartido) y frena a los que lleguen hasta que esto termine.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_mozo_id::text, 0));

  select id, created_at into v_ultima, v_ultima_ts
    from mozo_rendiciones
   where business_id = p_business_id and mozo_id = p_mozo_id
   order by created_at desc
   limit 1;
  if v_ultima is distinct from p_desde_rendicion_id then
    raise exception 'RENDICION_CONCURRENTE' using errcode = 'P0001';
  end if;

  v_ts := clock_timestamp();

  if p_pagos_leidos is not null then
    select count(*) into v_pagos
      from payments
     where business_id = p_business_id
       and attributed_mozo_id = p_mozo_id
       and payment_status = 'paid'
       and created_at > coalesce(v_ultima_ts, '-infinity'::timestamptz)
       and created_at <= v_ts;
    if v_pagos <> p_pagos_leidos then
      raise exception 'RENDICION_CONCURRENTE' using errcode = 'P0001';
    end if;
  end if;

  insert into mozo_rendiciones (
    business_id, mozo_id, registered_by, expected_cash_cents,
    delivered_cash_cents, difference_cents, notes, por_metodo, por_canal,
    estado, propina_pagada_cents, created_at
  ) values (
    p_business_id, p_mozo_id, p_registered_by, p_expected_cash_cents,
    p_delivered_cash_cents, p_difference_cents, p_notes, p_por_metodo, p_por_canal,
    p_estado, coalesce(p_propina_pagada_cents, 0), v_ts
  )
  returning * into v_rendicion;

  if coalesce(p_propina_pagada_cents, 0) > 0 then
    perform 1 from cajas
     where id = p_caja_id and business_id = p_business_id
       and is_active and not is_administrative;
    if not found then
      raise exception 'CAJA_INVALID' using errcode = 'P0001';
    end if;
    -- Sin `created_at`: el trigger `entra_a_la_caja` (0122) toma el lock de la
    -- caja y lo sella con el reloj de la base.
    insert into caja_movimientos (
      business_id, caja_id, kind, mozo_id, amount_cents, reason, created_by
    ) values (
      p_business_id, p_caja_id, 'propina', p_mozo_id, p_propina_pagada_cents,
      p_propina_reason, p_registered_by
    );
  end if;

  return to_jsonb(v_rendicion);
end;
$function$;

revoke all on function public.registrar_rendicion_tx(uuid, uuid, uuid, uuid, timestamptz, bigint, bigint, bigint, text, jsonb, jsonb, text, bigint, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.registrar_rendicion_tx(uuid, uuid, uuid, uuid, timestamptz, bigint, bigint, bigint, text, jsonb, jsonb, text, bigint, uuid, text, integer) to service_role;

-- ── 1 · el cobro toma el lock compartido del mozo ───────────────────────────

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
  -- 0124 — el cobro de un mozo y su rendición se serializan: compartido acá,
  -- exclusivo en `registrar_rendicion_tx`. Un cobro en vuelo termina ANTES de
  -- que la rendición cuente, o espera y nace después de ella.
  if p_attributed_mozo_id is not null then
    perform pg_advisory_xact_lock_shared(
      hashtextextended(p_business_id::text || ':' || p_attributed_mozo_id::text, 0));
  end if;

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


-- ── 3 · corregir una propina hacia arriba ───────────────────────────────────

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
  v_new_adj       bigint;
  v_new_pct       numeric;
  v_new_extra     bigint;
  v_extra_devuelto bigint;
  v_venta         bigint;
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

  -- #356 — `mp_manual` (#350) es un manual más: se corrige y se elige.
  if v_new_method not in ('cash', 'card_manual', 'transfer', 'other', 'mp_manual') then
    raise exception 'METHOD_NOT_MANUAL' using errcode = 'P0001';
  end if;
  -- #356 — el ajuste por método sigue al método. Lo que el cliente consumió
  -- (con su propina de cuenta, sin el excedente) es la «venta»; el ajuste se
  -- aplica sobre eso con el porcentaje del método que queda.
  v_new_adj := coalesce(v_old.adjustment_cents, 0);
  v_new_pct := coalesce(v_old.adjustment_percent, 0);
  if v_new_method is distinct from v_old.method then
    select coalesce((select adjustment_percent from payment_method_configs
                      where business_id = p_business_id
                        and method = v_new_method
                        and is_active), 0)
      into v_new_pct;
    if p_patch ? 'amount_cents' then
      -- Monto tipeado: ya trae su ajuste adentro.
      v_new_adj := round((v_new_amount - v_old.extra_tip_cents) * v_new_pct / (100 + v_new_pct))::bigint;
    else
      v_venta := v_old.amount_cents - coalesce(v_old.adjustment_cents, 0) - v_old.extra_tip_cents;
      v_new_adj := round(v_venta * v_new_pct / 100)::bigint;
      v_new_amount := v_venta + v_new_adj + v_old.extra_tip_cents;
    end if;
  elsif p_patch ? 'amount_cents' and v_new_pct <> 0 then
    v_new_adj := round((v_new_amount - v_old.extra_tip_cents) * v_new_pct / (100 + v_new_pct))::bigint;
  end if;

  if v_new_amount <= 0 then
    raise exception 'AMOUNT_MUST_BE_POSITIVE' using errcode = 'P0001';
  end if;
  if v_new_tip < 0 or v_new_tip > v_new_amount then
    raise exception 'TIP_GT_AMOUNT' using errcode = 'P0001';
  end if;
  -- #356 — la propina del excedente es parte de `tip_cents`. Si la corrección
  -- la baja por debajo del excedente, lo que sobra se devuelve a la cuenta
  -- (igual que al anular, 0113): antes chocaba con el check y tiraba un error
  -- crudo.
  v_new_extra := least(v_old.extra_tip_cents, v_new_tip);
  -- 0124 — y si la SUBE, lo que sube es propina que el cliente dejó de más:
  -- es excedente (spec 177) y le sube propina y total a la cuenta, igual que
  -- si se hubiera cargado bien al cobrar. Sin esto `payments.tip_cents`
  -- crecía y la cuenta no: la venta del negocio bajaba por una propina.
  if v_new_tip > v_old.tip_cents then
    v_new_extra := v_old.extra_tip_cents + (v_new_tip - v_old.tip_cents);
  end if;
  v_extra_devuelto := v_old.extra_tip_cents - v_new_extra;
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
    notes              = v_new_notes,
    adjustment_cents   = v_new_adj,
    adjustment_percent = v_new_pct,
    extra_tip_cents    = v_new_extra
  where id = v_old.id
  returning * into v_new;

  -- Negativo = la propina subió: la cuenta crece por esa diferencia.
  if v_extra_devuelto <> 0 then
    update orders set
      tip_cents   = greatest(tip_cents - v_extra_devuelto, 0),
      total_cents = greatest(total_cents - v_extra_devuelto, 0)
    where id = v_order.id;
  end if;

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
  if v_old.adjustment_cents is distinct from v_new.adjustment_cents then
    v_changed := array_append(v_changed, 'adjustment_cents');
    insert into caja_audit_log (business_id, caja_id, entity_type, entity_id, field, from_value, to_value, by_user_id, reason)
      values (p_business_id, v_new.caja_id, 'payment', v_new.id, 'adjustment_cents', v_old.adjustment_cents::text, v_new.adjustment_cents::text, p_by_user_id, v_reason);
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

-- ── 4 · el costo del insumo sigue a la última compra ────────────────────────

create or replace function public.registrar_items_comprobante_tx(
  p_business_id uuid,
  p_invoice_id  uuid,
  p_created_by  uuid,
  p_items       jsonb   -- [{ingredient_id, presentation_id, units, unit_cost_cents,
                        --   tasa_iva?, source_text?, match_source?}]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it        jsonb;
  v_ing       uuid;
  v_pres      uuid;
  v_units     numeric;
  v_costo     bigint;
  v_neto      numeric;
  v_base      numeric;
  v_n         integer := 0;
  v_tipo      text;
  v_devuelve  boolean;
  v_base_precio text;
begin
  -- El comprobante tiene que ser de este negocio y estar vivo. El `document_type`
  -- sale de acá y no de un parámetro: el caller no puede mentir sobre el signo
  -- ni sobre la base del precio.
  select document_type into v_tipo
    from supplier_invoices
   where id = p_invoice_id and business_id = p_business_id and cancelled_at is null;
  if not found then
    raise exception 'COMPROBANTE_NO_DISPONIBLE';
  end if;

  v_devuelve := v_tipo = 'nota_credito';

  -- Spec 188·D2 · sólo la factura A discrimina IVA en el renglón. La C del
  -- monotributista no es una excepción olvidada: no discrimina, es final.
  v_base_precio := case when v_tipo = 'factura_a' then 'neto' else 'final' end;

  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_ing   := (v_it ->> 'ingredient_id')::uuid;
    v_pres  := nullif(v_it ->> 'presentation_id', '')::uuid;
    v_units := (v_it ->> 'units')::numeric;
    v_costo := (v_it ->> 'unit_cost_cents')::bigint;

    -- Tenant del insumo: el service client bypassa RLS y el FK sólo chequea
    -- existencia, no negocio.
    perform 1 from ingredients
     where id = v_ing and business_id = p_business_id for update;
    if not found then
      raise exception 'INSUMO_DE_OTRO_NEGOCIO' using detail = v_ing::text;
    end if;

    -- Cuántas unidades base entran. Sin presentación, `units` ya viene en base.
    v_neto := 1;
    if v_pres is not null then
      select net_quantity into v_neto
        from ingredient_presentations
       where id = v_pres and ingredient_id = v_ing;
      if v_neto is null then
        raise exception 'PRESENTACION_INVALIDA' using detail = v_pres::text;
      end if;
    end if;
    v_base := v_units * v_neto;
    if v_devuelve then
      v_base := -v_base;
    end if;

    insert into supplier_invoice_items (
      business_id, invoice_id, ingredient_id, presentation_id,
      units, quantity_base, unit_cost_cents, created_by,
      source_text, match_source, tasa_iva, price_base
    ) values (
      p_business_id, p_invoice_id, v_ing, v_pres,
      v_units, v_base, v_costo, p_created_by,
      nullif(v_it ->> 'source_text', ''),
      nullif(v_it ->> 'match_source', ''),
      (nullif(v_it ->> 'tasa_iva', ''))::numeric,
      v_base_precio
    );

    -- Alta (o baja) de stock. `v_base` ya trae el signo del comprobante.
    update ingredients
       set stock_quantity = stock_quantity + v_base,
           updated_at = now()
     where id = v_ing;

    -- El consumo, con el costo REAL. `cost_cents_snapshot` es la plata del
    -- MOVIMIENTO entero (units × precio del envase), que es la convención de
    -- todos los otros escritores y la columna que suma el CMV.
    --
    -- Sigue siendo el costo del PAPEL, en la base del papel (188·D1): para un
    -- responsable inscripto el IVA de compras es crédito fiscal y no es costo,
    -- y lo que no discrimina IVA no da crédito, así que su precio final SÍ lo
    -- es. Sumarle el IVA acá fabricaría un 21% de costo que el negocio no paga.
    insert into ingredient_consumptions (
      business_id, ingredient_id, quantity, cost_cents_snapshot, kind
    ) values (
      p_business_id, v_ing, v_base,
      round(v_costo * v_units),
      case when v_devuelve then 'reversion' else 'compra' end
    );

    -- La compra reescribe el costo del envase. El trigger
    -- `trg_ingredient_price_change` llena el histórico solo. La NC no: devolver
    -- mercadería no es un precio de compra.
    -- 0124 — el costo del insumo sigue a la última compra, sea cual sea la
    -- presentación. La receta cuesta con la presentación `default`: si se
    -- compraba otra (la bolsa de 5 en vez de la de 25) o a granel sin
    -- presentación, el costo de la receta no se enteraba nunca. Se lleva el
    -- precio por unidad base a la default, y a la comprada su propio precio.
    if v_costo > 0 and not v_devuelve then
      if v_pres is not null then
        update ingredient_presentations
           set cost_cents = v_costo
         where id = v_pres and cost_cents <> v_costo;
      end if;
      if v_neto > 0 then
        update ingredient_presentations d
           set cost_cents = round((v_costo::numeric / v_neto) * d.net_quantity)::bigint
         where d.ingredient_id = v_ing
           and d.is_default
           and d.id is distinct from v_pres
           and d.net_quantity > 0
           and d.cost_cents <> round((v_costo::numeric / v_neto) * d.net_quantity)::bigint;
      end if;
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- ── 5 · la plata no entra en 32 bits ────────────────────────────────────────
--
-- Cinco columnas de plata eran `integer`: tope $21.474.836,47. Una factura de
-- proveedor más grande no se podía cargar, y un renglón de compra por encima de
-- eso tiraba abajo `registrar_items_comprobante_tx` entera (el snapshot del
-- consumo desbordaba). Con la inflación de AR ese techo está a una compra de
-- carne de distancia. El resto del esquema ya usa `bigint`.
alter table public.supplier_invoices        alter column total_cents         type bigint;
alter table public.ingredient_consumptions  alter column cost_cents_snapshot type bigint;
alter table public.ingredient_presentations alter column cost_cents          type bigint;
alter table public.ingredient_price_log     alter column old_cost_cents      type bigint;
alter table public.ingredient_price_log     alter column new_cost_cents      type bigint;

-- ────────────────────────────────────────────────────────────────────────
-- 0120 — corregir un cobro deja la plata coherente (issue #356, epic #361)
--
-- Tres agujeros de `corregir_pago_tx`:
--
--   · Rechazaba `mp_manual` (#350) con METHOD_NOT_MANUAL: la pantalla ofrece
--     corregirlo y la base no lo dejaba — un MP cargado por error en vez de
--     efectivo sólo se arreglaba anulando y volviendo a cobrar.
--   · Cambiar el método no tocaba el ajuste: una tarjeta con +10 % corregida a
--     efectivo seguía cobrando el recargo; efectivo corregido a tarjeta no lo
--     tomaba. Ahora el ajuste sigue al método (config del negocio) y, si no se
--     tipeó un monto nuevo, el monto se recalcula: venta + ajuste + excedente.
--   · Bajar la propina por debajo de `extra_tip_cents` violaba el check de la
--     0113. Ahora el excedente se achica con la propina y lo que sobra vuelve a
--     la cuenta, como al anular.
--
-- (La guarda de «cobro ya rendido» vive en TS, `evaluarGuardas`: es una
-- lectura con nombre para el mensaje.)
-- ────────────────────────────────────────────────────────────────────────

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

  if v_extra_devuelto > 0 then
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

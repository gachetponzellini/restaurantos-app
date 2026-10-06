-- ────────────────────────────────────────────────────────────────────────
-- 0137 — corregir con vista previa, y lo rendido no se toca (spec 210 v2 · R6)
--
--   1. Guarda `MOZO_YA_RINDIO` (trigger en `payments`): en el modelo nuevo, un
--      cobro cuyo efectivo ya pudo haber entrado en una entrega del mozo no
--      cambia de plata —monto, método, propina, mozo, caja ni estado—. Tampoco
--      se le puede pasar a un mozo que ya entregó en esa caja después del
--      cobro. Primero se anula la entrega (0135), se corrige y se vuelve a
--      rendir. Es un trigger para que valga igual para corregir, anular o
--      cualquier otro camino.
--   2. `efecto_de_correccion` — sólo lectura: el «debería haber» de cada caja y
--      el saldo de cada mozo que la corrección toca, antes y después. Usa las
--      mismas reglas que la 0134 (mozo_que_rinde, saldo_mozo, esperado), así
--      que lo que muestra la pantalla es lo que va a quedar.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1 · lo rendido no se toca ───────────────────────────────────────────────

create or replace function public.entrego_despues(
  p_mozo_id uuid, p_caja_id uuid, p_desde timestamptz
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from caja_movimientos m
     where m.mozo_id = p_mozo_id and m.caja_id = p_caja_id
       and m.kind in ('rendicion', 'propina')
       and m.cancelled_at is null
       and m.created_at > p_desde
  );
$function$;

revoke all on function public.entrego_despues(uuid, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.trg_guarda_mozo_rendido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nuevo uuid;
begin
  -- Sólo importa si cambia la plata o a quién/dónde pertenece.
  if new.amount_cents is not distinct from old.amount_cents
     and new.method is not distinct from old.method
     and new.tip_cents is not distinct from old.tip_cents
     and new.attributed_mozo_id is not distinct from old.attributed_mozo_id
     and new.caja_id is not distinct from old.caja_id
     and new.payment_status is not distinct from old.payment_status then
    return new;
  end if;

  -- Del lado de donde sale: el mozo que tenía que rendir este cobro ya entregó
  -- en esa caja después de cobrarlo.
  if old.rinde_mozo_id is not null
     and public.entrego_despues(old.rinde_mozo_id, old.caja_id, old.created_at) then
    raise exception 'MOZO_YA_RINDIO' using errcode = 'P0001';
  end if;

  -- Del lado a donde va: se lo pasan a un mozo que ya entregó en esa caja.
  if new.attributed_mozo_id is distinct from old.attributed_mozo_id
     or new.caja_id is distinct from old.caja_id then
    if old.rinde_mozo_id is not null or
       (select caja_modelo_v2_desde from businesses where id = new.business_id) <= old.created_at then
      v_nuevo := public.mozo_que_rinde(new.business_id, new.caja_id, new.attributed_mozo_id, new.order_id);
      if v_nuevo is not null and public.entrego_despues(v_nuevo, new.caja_id, old.created_at) then
        raise exception 'MOZO_YA_RINDIO' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- «guarda» < «quien_rinde»: corre antes de que se recalcule quién rinde, con
-- el `old.rinde_mozo_id` todavía intacto.
drop trigger if exists guarda_mozo_rendido on public.payments;
create trigger guarda_mozo_rendido
  before update on public.payments
  for each row
  when (old.rinde_mozo_id is not null or new.rinde_mozo_id is not null
        or old.attributed_mozo_id is distinct from new.attributed_mozo_id
        or old.caja_id is distinct from new.caja_id)
  execute function public.trg_guarda_mozo_rendido();

-- ── 2 · la vista previa ─────────────────────────────────────────────────────

-- Lo que un cobro aporta: al cajón (si no lo rinde nadie) y al saldo del mozo
-- que lo rinde. Las mismas cuentas que efectivo_esperado_caja y saldo_mozo.
create or replace function public.efecto_de_correccion(
  p_business_id uuid, p_payment_id uuid, p_patch jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_p        payments%rowtype;
  v_anular   boolean := coalesce((p_patch->>'anular')::boolean, false);
  v_method   text;
  v_amount   bigint;
  v_tip      bigint;
  v_mozo     uuid;
  v_caja     uuid;
  v_rinde    uuid;
  v_cajas    jsonb := '[]'::jsonb;
  v_mozos    jsonb := '[]'::jsonb;
  v_ts       timestamptz := clock_timestamp();
  -- aporte viejo / nuevo
  v_caja_old bigint; v_caja_new bigint;
  v_mozo_old bigint; v_mozo_new bigint;
  r          record;
begin
  select * into v_p from payments where id = p_payment_id and business_id = p_business_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_method := coalesce(p_patch->>'method', v_p.method);
  v_amount := coalesce((p_patch->>'amount_cents')::bigint, v_p.amount_cents);
  v_tip    := coalesce((p_patch->>'tip_cents')::bigint, v_p.tip_cents);
  v_mozo   := case when p_patch ? 'attributed_mozo_id'
                then nullif(p_patch->>'attributed_mozo_id', '')::uuid else v_p.attributed_mozo_id end;
  v_caja   := coalesce((p_patch->>'caja_id')::uuid, v_p.caja_id);
  v_rinde  := case when v_p.rinde_mozo_id is null
                     and coalesce((select caja_modelo_v2_desde from businesses where id = p_business_id) > v_p.created_at, true)
                then null  -- cobro del modelo viejo: sigue como siempre
                else public.mozo_que_rinde(p_business_id, v_caja, v_mozo, v_p.order_id) end;

  -- Aporte al cajón: efectivo cobrado que nadie tiene que rendir.
  v_caja_old := case when v_p.payment_status = 'paid' and v_p.method = 'cash' and v_p.rinde_mozo_id is null
                     then v_p.amount_cents else 0 end;
  v_caja_new := case when not v_anular and v_method = 'cash' and v_rinde is null then v_amount else 0 end;

  -- Aporte al saldo del mozo: efectivo sin su propina; o −propina si no es efectivo.
  v_mozo_old := case when v_p.payment_status <> 'paid' or v_p.rinde_mozo_id is null then 0
                     when v_p.method = 'cash' then v_p.amount_cents - v_p.tip_cents
                     else -v_p.tip_cents end;
  v_mozo_new := case when v_anular or v_rinde is null then 0
                     when v_method = 'cash' then v_amount - v_tip
                     else -v_tip end;

  -- Cajas tocadas.
  for r in select distinct c from unnest(array[v_p.caja_id, v_caja]) as c loop
    declare
      v_antes bigint := public.efectivo_esperado_caja(r.c, v_ts);
      v_delta bigint := (case when r.c = v_caja then v_caja_new else 0 end)
                      - (case when r.c = v_p.caja_id then v_caja_old else 0 end);
    begin
      if v_delta <> 0 then
        v_cajas := v_cajas || jsonb_build_object(
          'caja_id', r.c, 'caja', (select name from cajas where id = r.c),
          'antes', v_antes, 'despues', v_antes + v_delta);
      end if;
    end;
  end loop;

  -- Saldos tocados (mozo × caja).
  for r in
    select distinct m, c from (values (v_p.rinde_mozo_id, v_p.caja_id), (v_rinde, v_caja)) as t(m, c)
     where m is not null
  loop
    declare
      v_antes bigint := public.saldo_mozo(r.m, r.c);
      v_delta bigint := (case when r.m = v_rinde and r.c = v_caja then v_mozo_new else 0 end)
                      - (case when r.m = v_p.rinde_mozo_id and r.c = v_p.caja_id then v_mozo_old else 0 end);
    begin
      if v_delta <> 0 then
        v_mozos := v_mozos || jsonb_build_object(
          'mozo_id', r.m, 'caja_id', r.c,
          'mozo', (select full_name from business_users where business_id = p_business_id and user_id = r.m),
          'caja', (select name from cajas where id = r.c),
          'antes', v_antes, 'despues', v_antes + v_delta);
      end if;
    end;
  end loop;

  return jsonb_build_object('cajas', v_cajas, 'mozos', v_mozos);
end;
$function$;

revoke all on function public.efecto_de_correccion(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.efecto_de_correccion(uuid, uuid, jsonb) to service_role;

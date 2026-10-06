-- ────────────────────────────────────────────────────────────────────────
-- 0139 — endurecer la caja v2 (revisión fresca de 0134–0137)
--
-- 1. Un miembro del negocio (un mozo con su JWT) no puede cargar una
--    `rendicion` ni una `propina` por PostgREST: sólo sangría e ingreso, como
--    siempre. Las entregas pasan por rendir_mozo_tx (service role).
-- 2. `rinde_mozo_id` no se toca a mano: sólo lo fija la base al cobrar y al
--    corregir mozo o caja. Cualquier otro UPDATE lo deja como estaba.
-- 3. Un cobro o un movimiento no puede apuntar a la caja de OTRO negocio.
-- 4. La guarda MOZO_YA_RINDIO no traba las transiciones de estado de los
--    cobros que no son efectivo (devoluciones y contracargos de Mercado Pago):
--    sólo protege la plata que el mozo pudo haber entregado. Y toma el lock
--    exclusivo del mozo, para no cruzarse con una entrega en curso.
-- 5. anular_entrega_tx bloquea la caja antes de mirar si hay arqueo: no se
--    cruza con un cierre que se está firmando.
-- 6. registrar_rendicion_tx (v1) no corre en el modelo nuevo (MODELO_NUEVO).
-- 7. La vista previa: no recalcula quién rinde si no cambia mozo ni caja (como
--    el trigger), recalcula el monto con el ajuste del método nuevo (como
--    corregir_pago_tx) y no mira cajas de otro negocio.
-- 8. Entregar $0 con saldo positivo no es una entrega. «No entregó» guarda la
--    huella del saldo (cobros y entregas): si algo cambia después, hay que
--    volver a resolver, aunque el monto dé igual.
-- 9. Borrar un usuario con plata pendiente no la manda al cajón en silencio.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1 · sólo sangría e ingreso por la API ──────────────────────────────────

drop policy if exists "caja_movimientos_insert" on public.caja_movimientos;
create policy "caja_movimientos_insert" on public.caja_movimientos
  for insert to authenticated
  with check (
    (public.is_business_member(business_id) or public.is_platform_admin())
    and kind in ('sangria', 'ingreso')
  );

-- ── 3 · la caja es del mismo negocio (en el trigger que ya toma su lock) ────

create or replace function public.trg_entra_a_la_caja()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.caja_id is not null then
    perform 1 from cajas where id = new.caja_id and business_id = new.business_id for share;
    if not found then
      raise exception 'CAJA_WRONG_BUSINESS' using errcode = 'P0001';
    end if;
  end if;
  if new.created_at = now() then
    new.created_at := clock_timestamp();
  end if;
  return new;
end;
$function$;

-- ── 2 · rinde_mozo_id sólo lo fija la base ─────────────────────────────────

create or replace function public.trg_quien_rinde()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_desde timestamptz;
begin
  if tg_op = 'UPDATE'
     and new.attributed_mozo_id is not distinct from old.attributed_mozo_id
     and new.caja_id is not distinct from old.caja_id then
    -- Ni mozo ni caja cambiaron: quién rinde queda como estaba, lo haya
    -- intentado cambiar quien sea. Sólo el pasaje (0140) lo completa a mano.
    if coalesce(current_setting('app.caja_pasaje', true), '') <> 'on' then
      new.rinde_mozo_id := old.rinde_mozo_id;
    end if;
    return new;
  end if;

  select caja_modelo_v2_desde into v_desde from businesses where id = new.business_id;
  if v_desde is null or new.created_at < v_desde then
    new.rinde_mozo_id := null;
    return new;
  end if;

  new.rinde_mozo_id := public.mozo_que_rinde(
    new.business_id, new.caja_id, new.attributed_mozo_id, new.order_id);
  return new;
end;
$function$;

drop trigger if exists quien_rinde on public.payments;
create trigger quien_rinde
  before insert or update on public.payments
  for each row execute function public.trg_quien_rinde();

-- ── 9 · no se borra un usuario con plata pendiente ─────────────────────────

alter table public.payments drop constraint if exists payments_rinde_mozo_id_fkey;
alter table public.payments
  add constraint payments_rinde_mozo_id_fkey
  foreign key (rinde_mozo_id) references public.users(id) on delete restrict;

-- ── 4 · la guarda: plata del mozo, con su lock ─────────────────────────────

create or replace function public.trg_guarda_mozo_rendido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nuevo uuid;
begin
  if new.amount_cents is not distinct from old.amount_cents
     and new.method is not distinct from old.method
     and new.tip_cents is not distinct from old.tip_cents
     and new.attributed_mozo_id is not distinct from old.attributed_mozo_id
     and new.caja_id is not distinct from old.caja_id
     and new.payment_status is not distinct from old.payment_status then
    return new;
  end if;

  -- Sólo cambia el estado de un cobro que no es efectivo (una devolución o un
  -- contracargo de Mercado Pago): no es plata que el mozo tenga en la mano.
  if old.method <> 'cash'
     and new.amount_cents is not distinct from old.amount_cents
     and new.method is not distinct from old.method
     and new.tip_cents is not distinct from old.tip_cents
     and new.attributed_mozo_id is not distinct from old.attributed_mozo_id
     and new.caja_id is not distinct from old.caja_id then
    return new;
  end if;

  if old.rinde_mozo_id is not null then
    -- Exclusivo, como rendir_mozo_tx: no se cruza con una entrega en curso.
    perform pg_advisory_xact_lock(hashtextextended(old.business_id::text || ':' || old.rinde_mozo_id::text, 0));
    if public.entrego_despues(old.rinde_mozo_id, old.caja_id, old.created_at) then
      raise exception 'MOZO_YA_RINDIO' using errcode = 'P0001';
    end if;
  end if;

  if new.attributed_mozo_id is distinct from old.attributed_mozo_id
     or new.caja_id is distinct from old.caja_id then
    if old.rinde_mozo_id is not null or
       (select caja_modelo_v2_desde from businesses where id = new.business_id) <= old.created_at then
      v_nuevo := public.mozo_que_rinde(new.business_id, new.caja_id, new.attributed_mozo_id, new.order_id);
      if v_nuevo is not null then
        if v_nuevo is distinct from old.rinde_mozo_id then
          perform pg_advisory_xact_lock(hashtextextended(new.business_id::text || ':' || v_nuevo::text, 0));
        end if;
        if public.entrego_despues(v_nuevo, new.caja_id, old.created_at) then
          raise exception 'MOZO_YA_RINDIO' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- ── 5 · anular una entrega bloquea la caja ─────────────────────────────────

create or replace function public.anular_entrega_tx(
  p_business_id uuid, p_rendicion_id uuid, p_motivo text, p_anulada_por uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_r      mozo_rendiciones%rowtype;
  v_mov    caja_movimientos%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then
    raise exception 'NOTES_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_r from mozo_rendiciones
   where id = p_rendicion_id and business_id = p_business_id
   for update;
  if not found then
    raise exception 'RENDICION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_r.caja_id is null then
    raise exception 'MODELO_VIEJO' using errcode = 'P0001';
  end if;
  if v_r.anulada_at is not null then
    raise exception 'YA_ANULADA' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || v_r.mozo_id::text, 0));

  if v_r.movimiento_id is not null then
    select * into v_mov from caja_movimientos where id = v_r.movimiento_id;
    -- Exclusivo sobre la caja, como cerrar_caja_tx: o el cierre ya terminó
    -- (y lo vemos), o espera a que esto termine.
    perform 1 from cajas where id = v_mov.caja_id for update;
    if exists (select 1 from caja_cortes k
                where k.caja_id = v_mov.caja_id and k.created_at > v_mov.created_at) then
      raise exception 'ARQUEO_CERRADO' using errcode = 'P0001';
    end if;
    update caja_movimientos
       set cancelled_at = clock_timestamp(),
           cancelled_reason = v_motivo,
           cancelled_by = p_anulada_por
     where id = v_mov.id;
  end if;

  update mozo_rendiciones
     set anulada_at = clock_timestamp(), anulada_por = p_anulada_por, anulada_motivo = v_motivo
   where id = v_r.id
  returning * into v_r;

  return jsonb_build_object(
    'rendicion', to_jsonb(v_r),
    'saldo', public.saldo_mozo(v_r.mozo_id, v_r.caja_id)
  );
end;
$function$;

-- ── 6 · la rendición v1 no corre en el modelo nuevo ────────────────────────

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
  -- 0139 · con el modelo nuevo la rendición es una entrega (rendir_mozo_tx):
  -- esta versión metería una propina con mozo_id que sube su saldo.
  if (select caja_modelo_v2_desde from businesses where id = p_business_id) is not null then
    raise exception 'MODELO_NUEVO' using errcode = 'P0001';
  end if;
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


-- ── 8 · huella del saldo, y entregar $0 no es entregar ──────────────────────

alter table public.mozo_rendiciones add column if not exists huella text;

create or replace function public.huella_mozo(p_mozo_id uuid, p_caja_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select md5(
    coalesce((select string_agg(p.id::text || ':' || p.amount_cents || ':' || p.tip_cents || ':' || p.method || ':' || p.payment_status, ',' order by p.id)
                from payments p where p.rinde_mozo_id = p_mozo_id and p.caja_id = p_caja_id), '')
    || '|' ||
    coalesce((select string_agg(m.id::text || ':' || m.amount_cents || ':' || coalesce(m.cancelled_at::text, ''), ',' order by m.id)
                from caja_movimientos m
               where m.mozo_id = p_mozo_id and m.caja_id = p_caja_id and m.kind in ('rendicion', 'propina')), '')
  );
$function$;

revoke all on function public.huella_mozo(uuid, uuid) from public, anon, authenticated;

create or replace function public.reconocer_deuda_tx(
  p_business_id uuid, p_mozo_id uuid, p_caja_id uuid,
  p_motivo text, p_registrado_por uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_saldo     bigint;
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_rendicion mozo_rendiciones%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_mozo_id::text, 0));
  perform public.caja_v2_valida(p_business_id, p_caja_id);
  if v_motivo is null then
    raise exception 'NOTES_REQUIRED' using errcode = 'P0001';
  end if;
  v_saldo := public.saldo_mozo(p_mozo_id, p_caja_id);
  if v_saldo <= 0 then
    raise exception 'NADA_QUE_RECONOCER' using errcode = 'P0001';
  end if;

  insert into mozo_rendiciones (
    business_id, mozo_id, registered_by, caja_id,
    expected_cash_cents, delivered_cash_cents, difference_cents,
    notes, por_metodo, por_canal, estado, propina_pagada_cents, huella, created_at
  ) values (
    p_business_id, p_mozo_id, p_registrado_por, p_caja_id,
    v_saldo, 0, -v_saldo, v_motivo, '{}'::jsonb, '{}'::jsonb, 'no_entrego', 0,
    public.huella_mozo(p_mozo_id, p_caja_id), clock_timestamp()
  )
  returning * into v_rendicion;

  return to_jsonb(v_rendicion);
end;
$function$;

create or replace function public.mozo_resuelto(p_mozo_id uuid, p_caja_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_saldo bigint := public.saldo_mozo(p_mozo_id, p_caja_id);
  v_ult   mozo_rendiciones%rowtype;
begin
  if v_saldo = 0 then
    return true;
  end if;
  if v_saldo < 0 then
    return false;
  end if;
  select * into v_ult from mozo_rendiciones
   where mozo_id = p_mozo_id and caja_id = p_caja_id and anulada_at is null
   order by created_at desc
   limit 1;
  -- Reconocido sobre ESTE saldo: misma huella (nada cambió desde entonces).
  return found and v_ult.estado = 'no_entrego'
     and v_ult.huella is not distinct from public.huella_mozo(p_mozo_id, p_caja_id);
end;
$function$;

-- rendir_mozo_tx: entregar $0 con saldo positivo no es una entrega.
create or replace function public.rendir_mozo_tx(
  p_business_id uuid, p_mozo_id uuid, p_caja_id uuid,
  p_entregado_cents bigint, p_registrado_por uuid, p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_saldo     bigint;
  v_mesas     text;
  v_mov       uuid := null;
  v_propina   bigint := 0;
  v_dif       bigint;
  v_notas     text := nullif(btrim(coalesce(p_notas, '')), '');
  v_rendicion mozo_rendiciones%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_mozo_id::text, 0));

  perform public.caja_v2_valida(p_business_id, p_caja_id);
  if coalesce(p_entregado_cents, 0) < 0 then
    raise exception 'AMOUNT_NEGATIVE' using errcode = 'P0001';
  end if;

  v_mesas := public.mesas_sin_cobrar_mozo(p_business_id, p_mozo_id);
  if v_mesas is not null then
    raise exception 'MOZO_HAS_OPEN_TABLES:%', v_mesas using errcode = 'P0001';
  end if;

  v_saldo := public.saldo_mozo(p_mozo_id, p_caja_id);

  if v_saldo < 0 then
    if coalesce(p_entregado_cents, 0) <> 0 then
      raise exception 'SALDO_A_FAVOR_DEL_MOZO:%', -v_saldo using errcode = 'P0001';
    end if;
    v_propina := -v_saldo;
    insert into caja_movimientos (business_id, caja_id, kind, mozo_id, amount_cents, reason, created_by)
    values (p_business_id, p_caja_id, 'propina', p_mozo_id, v_propina,
            'Propina de tarjeta y QR (no tenía efectivo)', p_registrado_por)
    returning id into v_mov;
    v_dif := 0;
  else
    if coalesce(p_entregado_cents, 0) = 0 then
      -- Con saldo, entregar $0 no es una entrega: es «no entregó» (con motivo).
      raise exception '%', case when v_saldo = 0 then 'NADA_QUE_RENDIR' else 'AMOUNT_NOT_POSITIVE' end
        using errcode = 'P0001';
    end if;
    v_dif := p_entregado_cents - v_saldo;
    if v_dif > 0 and v_notas is null then
      raise exception 'NOTES_REQUIRED' using errcode = 'P0001';
    end if;
    insert into caja_movimientos (business_id, caja_id, kind, mozo_id, amount_cents, reason, created_by)
    values (p_business_id, p_caja_id, 'rendicion', p_mozo_id, p_entregado_cents,
            coalesce(v_notas, 'Rendición'), p_registrado_por)
    returning id into v_mov;
  end if;

  insert into mozo_rendiciones (
    business_id, mozo_id, registered_by, caja_id, movimiento_id,
    expected_cash_cents, delivered_cash_cents, difference_cents,
    notes, por_metodo, por_canal, estado, propina_pagada_cents, huella, created_at
  ) values (
    p_business_id, p_mozo_id, p_registrado_por, p_caja_id, v_mov,
    greatest(v_saldo, 0), coalesce(p_entregado_cents, 0), v_dif,
    v_notas, '{}'::jsonb, '{}'::jsonb, 'rendida', v_propina,
    public.huella_mozo(p_mozo_id, p_caja_id), clock_timestamp()
  )
  returning * into v_rendicion;

  return jsonb_build_object(
    'rendicion', to_jsonb(v_rendicion),
    'saldo_restante', public.saldo_mozo(p_mozo_id, p_caja_id)
  );
end;
$function$;

-- ── 7 · la vista previa dice lo que va a quedar ────────────────────────────

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
  v_pct      numeric;
  v_venta    bigint;
  v_cajas    jsonb := '[]'::jsonb;
  v_mozos    jsonb := '[]'::jsonb;
  v_ts       timestamptz := clock_timestamp();
  v_caja_old bigint; v_caja_new bigint;
  v_mozo_old bigint; v_mozo_new bigint;
  r          record;
  v_antes    bigint;
  v_delta    bigint;
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

  if not exists (select 1 from cajas where id = v_caja and business_id = p_business_id) then
    raise exception 'CAJA_INVALID' using errcode = 'P0001';
  end if;

  -- Cambio de método sin monto tipeado: el monto se recalcula con el ajuste
  -- del método nuevo, igual que en corregir_pago_tx (0124).
  if v_method is distinct from v_p.method and not (p_patch ? 'amount_cents') then
    select coalesce((select adjustment_percent from payment_method_configs
                      where business_id = p_business_id and method = v_method and is_active), 0)
      into v_pct;
    v_venta  := v_p.amount_cents - coalesce(v_p.adjustment_cents, 0) - coalesce(v_p.extra_tip_cents, 0);
    v_amount := v_venta + round(v_venta * v_pct / 100)::bigint + coalesce(v_p.extra_tip_cents, 0);
  end if;

  -- Quién rinde: como el trigger, sólo se recalcula si cambia mozo o caja.
  if v_mozo is not distinct from v_p.attributed_mozo_id and v_caja = v_p.caja_id then
    v_rinde := v_p.rinde_mozo_id;
  elsif v_p.rinde_mozo_id is null
        and coalesce((select caja_modelo_v2_desde from businesses where id = p_business_id) > v_p.created_at, true) then
    v_rinde := null;
  else
    v_rinde := public.mozo_que_rinde(p_business_id, v_caja, v_mozo, v_p.order_id);
  end if;

  v_caja_old := case when v_p.payment_status = 'paid' and v_p.method = 'cash' and v_p.rinde_mozo_id is null
                     then v_p.amount_cents else 0 end;
  v_caja_new := case when not v_anular and v_p.payment_status = 'paid' and v_method = 'cash' and v_rinde is null
                     then v_amount else 0 end;
  v_mozo_old := case when v_p.payment_status <> 'paid' or v_p.rinde_mozo_id is null then 0
                     when v_p.method = 'cash' then v_p.amount_cents - v_p.tip_cents
                     else -v_p.tip_cents end;
  v_mozo_new := case when v_anular or v_p.payment_status <> 'paid' or v_rinde is null then 0
                     when v_method = 'cash' then v_amount - v_tip
                     else -v_tip end;

  for r in select distinct c from unnest(array[v_p.caja_id, v_caja]) as c loop
    v_antes := public.efectivo_esperado_caja(r.c, v_ts);
    v_delta := (case when r.c = v_caja then v_caja_new else 0 end)
             - (case when r.c = v_p.caja_id then v_caja_old else 0 end);
    if v_delta <> 0 then
      v_cajas := v_cajas || jsonb_build_object(
        'caja_id', r.c, 'caja', (select name from cajas where id = r.c),
        'antes', v_antes, 'despues', v_antes + v_delta);
    end if;
  end loop;

  for r in
    select distinct m, c from (values (v_p.rinde_mozo_id, v_p.caja_id), (v_rinde, v_caja)) as t(m, c)
     where m is not null
  loop
    v_antes := public.saldo_mozo(r.m, r.c);
    v_delta := (case when r.m = v_rinde and r.c = v_caja then v_mozo_new else 0 end)
             - (case when r.m = v_p.rinde_mozo_id and r.c = v_p.caja_id then v_mozo_old else 0 end);
    if v_delta <> 0 then
      v_mozos := v_mozos || jsonb_build_object(
        'mozo_id', r.m, 'caja_id', r.c,
        'mozo', (select full_name from business_users where business_id = p_business_id and user_id = r.m),
        'caja', (select name from cajas where id = r.c),
        'antes', v_antes, 'despues', v_antes + v_delta);
    end if;
  end loop;

  return jsonb_build_object('cajas', v_cajas, 'mozos', v_mozos, 'amount_cents', v_amount);
end;
$function$;

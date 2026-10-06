-- ────────────────────────────────────────────────────────────────────────
-- 0135 — la rendición es una entrega (spec 210 v2 · R3, R4, R7)
--
-- Sobre la base de la 0134 (el efectivo del mozo queda a su nombre):
--
--   · `rendir_mozo_tx` — el mozo entrega plata a una caja. Entra como
--     movimiento `rendicion` de esa caja y baja su saldo. Puede ser justo, de
--     menos (le queda saldo: es una entrega parcial) o de más (sobrante, con
--     nota). Si el saldo es negativo —cobró con tarjeta y no tiene efectivo del
--     que quedarse la propina— la caja le paga: movimiento `propina`.
--   · `reconocer_deuda_tx` — «no entregó»: no mueve plata, deja la deuda
--     reconocida con motivo. El saldo sigue a su nombre.
--   · `anular_entrega_tx` — deshace una entrega mal registrada: el movimiento
--     queda anulado (visible) y el saldo vuelve. Sólo en el período abierto de
--     la caja.
--   · `mozo_resuelto(mozo, caja)` y `mozos_sin_resolver(caja)` — lo que mira el
--     cierre de caja (0136): saldo en cero, o deuda reconocida sobre el saldo
--     de ahora.
--   · `mesas_sin_cobrar_mozo` — la regla de `mesas-sin-cobrar.ts` en la base:
--     con una mesa suya sin cobrar, no se rinde (MOZO_HAS_OPEN_TABLES).
--
-- Todo exige el modelo nuevo (MODELO_VIEJO): un negocio con
-- `caja_modelo_v2_desde` null sigue con `registrar_rendicion_tx`.
-- ────────────────────────────────────────────────────────────────────────

alter table public.mozo_rendiciones
  add column if not exists caja_id uuid references public.cajas(id) on delete set null,
  add column if not exists movimiento_id uuid references public.caja_movimientos(id) on delete set null,
  add column if not exists anulada_at timestamptz,
  add column if not exists anulada_por uuid references public.users(id) on delete set null,
  add column if not exists anulada_motivo text;

create index if not exists mozo_rendiciones_mozo_caja_idx
  on public.mozo_rendiciones (business_id, mozo_id, caja_id, created_at desc);

comment on column public.mozo_rendiciones.caja_id is
  'Spec 210 v2: la caja a la que se entregó. null = rendición del modelo viejo.';

-- ── mesas del mozo sin cobrar (misma regla que mesas-sin-cobrar.ts) ─────────

create or replace function public.mesas_sin_cobrar_mozo(p_business_id uuid, p_mozo_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select string_agg(coalesce(t.label, '?'), ', ' order by t.label)
    from orders o
    left join tables t on t.id = o.table_id
   where o.business_id = p_business_id
     and o.table_id is not null
     and o.status <> 'cancelled'
     and o.lifecycle_status <> 'cancelled'
     and o.created_at >= now() - interval '30 days'
     and (o.lifecycle_status = 'open'
          or (o.lifecycle_status = 'closed' and o.payment_status <> 'paid'))
     and o.total_cents > 0
     and o.total_cents - coalesce(o.total_paid_cents, 0) > 0
     and (t.mozo_id = p_mozo_id
          or o.mozo_id = p_mozo_id
          or exists (select 1 from payments p
                      where p.order_id = o.id and p.attributed_mozo_id = p_mozo_id));
$function$;

revoke all on function public.mesas_sin_cobrar_mozo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mesas_sin_cobrar_mozo(uuid, uuid) to service_role;

-- ── guardas comunes ─────────────────────────────────────────────────────────

create or replace function public.caja_v2_valida(p_business_id uuid, p_caja_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if (select caja_modelo_v2_desde from businesses where id = p_business_id) is null then
    raise exception 'MODELO_VIEJO' using errcode = 'P0001';
  end if;
  perform 1 from cajas
   where id = p_caja_id and business_id = p_business_id
     and is_active and not is_administrative;
  if not found then
    raise exception 'CAJA_INVALID' using errcode = 'P0001';
  end if;
end;
$function$;

revoke all on function public.caja_v2_valida(uuid, uuid) from public, anon, authenticated;

-- ── la entrega ──────────────────────────────────────────────────────────────

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
  -- Exclusivo por mozo: espera a sus cobros en vuelo (0124 los toma compartido).
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_mozo_id::text, 0));

  perform public.caja_v2_valida(p_business_id, p_caja_id);
  if coalesce(p_entregado_cents, 0) < 0 then
    raise exception 'AMOUNT_NEGATIVE' using errcode = 'P0001';
  end if;

  -- Rendir con una mesa sin cobrar obliga a una segunda rendición cuando se
  -- cobre (caso kcc 2026-09-18). La pantalla lo avisa; la base lo exige.
  v_mesas := public.mesas_sin_cobrar_mozo(p_business_id, p_mozo_id);
  if v_mesas is not null then
    raise exception 'MOZO_HAS_OPEN_TABLES:%', v_mesas using errcode = 'P0001';
  end if;

  v_saldo := public.saldo_mozo(p_mozo_id, p_caja_id);

  if v_saldo < 0 then
    -- La caja le debe: cobró con tarjeta y no tiene efectivo del que quedarse
    -- la propina (R4). No entrega nada; se le paga.
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
    if v_saldo = 0 and coalesce(p_entregado_cents, 0) = 0 then
      raise exception 'NADA_QUE_RENDIR' using errcode = 'P0001';
    end if;
    v_dif := p_entregado_cents - v_saldo;
    -- De menos no pide nota: es una entrega parcial, el resto queda en su
    -- saldo. De más sí: entra plata que nadie esperaba.
    if v_dif > 0 and v_notas is null then
      raise exception 'NOTES_REQUIRED' using errcode = 'P0001';
    end if;
    if p_entregado_cents > 0 then
      -- Sin `created_at`: `entra_a_la_caja` (0122) toma el lock de la caja y
      -- lo sella con el reloj de la base.
      insert into caja_movimientos (business_id, caja_id, kind, mozo_id, amount_cents, reason, created_by)
      values (p_business_id, p_caja_id, 'rendicion', p_mozo_id, p_entregado_cents,
              coalesce(v_notas, 'Rendición'), p_registrado_por)
      returning id into v_mov;
    end if;
  end if;

  insert into mozo_rendiciones (
    business_id, mozo_id, registered_by, caja_id, movimiento_id,
    expected_cash_cents, delivered_cash_cents, difference_cents,
    notes, por_metodo, por_canal, estado, propina_pagada_cents, created_at
  ) values (
    p_business_id, p_mozo_id, p_registrado_por, p_caja_id, v_mov,
    greatest(v_saldo, 0), coalesce(p_entregado_cents, 0), v_dif,
    v_notas, '{}'::jsonb, '{}'::jsonb, 'rendida', v_propina, clock_timestamp()
  )
  returning * into v_rendicion;

  return jsonb_build_object(
    'rendicion', to_jsonb(v_rendicion),
    'saldo_restante', public.saldo_mozo(p_mozo_id, p_caja_id)
  );
end;
$function$;

revoke all on function public.rendir_mozo_tx(uuid, uuid, uuid, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.rendir_mozo_tx(uuid, uuid, uuid, bigint, uuid, text) to service_role;

-- ── «no entregó» ────────────────────────────────────────────────────────────

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
    notes, por_metodo, por_canal, estado, propina_pagada_cents, created_at
  ) values (
    p_business_id, p_mozo_id, p_registrado_por, p_caja_id,
    v_saldo, 0, -v_saldo, v_motivo, '{}'::jsonb, '{}'::jsonb, 'no_entrego', 0, clock_timestamp()
  )
  returning * into v_rendicion;

  return to_jsonb(v_rendicion);
end;
$function$;

revoke all on function public.reconocer_deuda_tx(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.reconocer_deuda_tx(uuid, uuid, uuid, text, uuid) to service_role;

-- ── anular una entrega ──────────────────────────────────────────────────────

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
    select * into v_mov from caja_movimientos where id = v_r.movimiento_id for update;
    -- Una entrega que ya entró en un arqueo no se toca: ese cierre está firmado.
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

revoke all on function public.anular_entrega_tx(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.anular_entrega_tx(uuid, uuid, text, uuid) to service_role;

-- ── ¿está resuelto el mozo con esta caja? ───────────────────────────────────

-- Resuelto = saldo en cero, o «no entregó» reconocido sobre el saldo de ahora
-- (si cobró algo después de reconocer, hay que volver a resolver). Un saldo
-- negativo NO está resuelto: la caja le debe la propina.
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
  return found and v_ult.estado = 'no_entrego' and v_ult.expected_cash_cents = v_saldo;
end;
$function$;

revoke all on function public.mozo_resuelto(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mozo_resuelto(uuid, uuid) to service_role;

create or replace function public.mozos_sin_resolver(p_caja_id uuid)
returns table(mozo_id uuid, saldo_cents bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mozos as (
    select distinct rinde_mozo_id as id
      from payments
     where caja_id = p_caja_id and rinde_mozo_id is not null and payment_status = 'paid'
    union
    select distinct mozo_id
      from caja_movimientos
     where caja_id = p_caja_id and kind in ('rendicion', 'propina') and mozo_id is not null
       and cancelled_at is null
  )
  select m.id, public.saldo_mozo(m.id, p_caja_id)
    from mozos m
   where not public.mozo_resuelto(m.id, p_caja_id);
$function$;

revoke all on function public.mozos_sin_resolver(uuid) from public, anon, authenticated;
grant execute on function public.mozos_sin_resolver(uuid) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 0136 — el turno y el cierre de caja v2 (spec 210 v2 · R5, R7, R8)
--
--   1. `turnos` — un turno para todo el local, como en MaxiRest: siempre hay
--      uno abierto por negocio (del modelo nuevo).
--   2. `cerrar_caja_tx` — en el modelo nuevo, NINGUNA caja cierra con mesas
--      abiertas (se podrían cobrar en ella) ni con plata de mozos sin resolver
--      en ella (decisión de Juan, 2026-10-06), y ya no barre el salón: eso pasa
--      a cerrar el turno. Devuelve también el retiro (antes lo recalculaba TS).
--      En el modelo viejo hace exactamente lo de siempre.
--   3. `cerrar_turno_tx` — con todas las cajas contadas: libera las mesas,
--      limpia la distribución, cierra el turno y abre el siguiente.
--   4. Pasaje (R8) — `businesses.caja_modelo_v2_pedido`: el negocio que lo
--      pide entra al modelo nuevo en su próximo cierre de la caja principal,
--      que en el modelo viejo exige mesas cobradas y todos rendidos: no queda
--      plata de mozos en el aire. Los cobros desde ese instante usan el modelo
--      nuevo; los de antes quedan como estaban.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1 · turnos ──────────────────────────────────────────────────────────────

create table if not exists public.turnos (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  abierto_at  timestamptz not null default now(),
  cerrado_at  timestamptz,
  cerrado_por uuid references public.users(id) on delete set null,
  resumen     jsonb,
  created_at  timestamptz not null default now()
);

create unique index if not exists turnos_uno_abierto
  on public.turnos (business_id) where cerrado_at is null;
create index if not exists turnos_business_idx
  on public.turnos (business_id, abierto_at desc);

alter table public.turnos enable row level security;

drop policy if exists turnos_select on public.turnos;
create policy turnos_select on public.turnos
  for select to authenticated
  using (public.is_business_member(business_id) or public.is_platform_admin());
-- Sin políticas de escritura: el turno se abre y se cierra sólo por RPC.

comment on table public.turnos is
  'Spec 210 v2: un turno para todo el local. Siempre hay uno abierto por negocio del modelo nuevo; se cierra con cerrar_turno_tx.';

alter table public.businesses
  add column if not exists caja_modelo_v2_pedido boolean not null default false;

comment on column public.businesses.caja_modelo_v2_pedido is
  'Spec 210 v2 · R8: el negocio pasa al modelo nuevo en su próximo cierre de la caja principal.';

-- ── barrer el salón (era parte de cerrar_caja_tx) ───────────────────────────

create or replace function public.barrer_salon(p_business_id uuid, p_por uuid, p_motivo text)
returns table(mesas_liberadas integer, mozos_limpiados integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan_ids uuid[];
  v_mesas    integer := 0;
  v_mozos    integer := 0;
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into v_plan_ids
    from floor_plans where business_id = p_business_id;

  if coalesce(array_length(v_plan_ids, 1), 0) > 0 then
    with previas as (
      select id, operational_status
        from tables
       where floor_plan_id = any(v_plan_ids)
         and operational_status <> 'libre'
       for update
    ), liberadas as (
      update tables t set
        operational_status = 'libre',
        opened_at = null,
        current_order_id = null
      from previas p
      where t.id = p.id
      returning t.id, p.operational_status as desde
    ), auditadas as (
      insert into tables_audit_log (table_id, business_id, kind, from_value, to_value, by_user_id, reason)
      select id, p_business_id, 'status', desde, 'libre', p_por, p_motivo from liberadas
      returning 1
    )
    select count(*) into v_mesas from auditadas;

    with previas as (
      select id, mozo_id
        from tables
       where floor_plan_id = any(v_plan_ids)
         and mozo_id is not null
       for update
    ), limpiadas as (
      update tables t set mozo_id = null
      from previas p
      where t.id = p.id
      returning t.id, p.mozo_id as desde
    ), auditadas as (
      insert into tables_audit_log (table_id, business_id, kind, from_value, to_value, by_user_id, reason)
      select id, p_business_id, 'assignment', desde::text, null, p_por, p_motivo from limpiadas
      returning 1
    )
    select count(*) into v_mozos from auditadas;
  end if;

  return query select v_mesas, v_mozos;
end;
$function$;

revoke all on function public.barrer_salon(uuid, uuid, text) from public, anon, authenticated;

-- ── 2 · cerrar_caja_tx ──────────────────────────────────────────────────────

drop function if exists public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb);

create or replace function public.cerrar_caja_tx(
  p_caja_id uuid, p_business_id uuid, p_encargado_id uuid,
  p_expected_cash_cents bigint, p_closing_cash_cents bigint,
  p_closing_notes text, p_denomination_count jsonb,
  p_retirar boolean, p_barrer_salon boolean, p_resumen jsonb default null::jsonb
)
returns table(corte jsonb, retiro_id uuid, mesas_liberadas integer, mozos_limpiados integer,
              print_job_id uuid, retiro_cents bigint)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caja            cajas%rowtype;
  v_corte           caja_cortes%rowtype;
  v_retiro_id       uuid := null;
  v_retiro_cents    bigint := 0;
  v_fondo_cents     bigint := 0;
  v_print_job_id    uuid := null;
  v_mesas           integer := 0;
  v_mozos           integer := 0;
  v_abiertas        integer := 0;
  v_sin_rendir      integer := 0;
  v_numero          integer;
  v_ts              timestamptz;
  v_esperado        bigint;
  v_v2_desde        timestamptz;
  v_v2_pedido       boolean;
  v_v2              boolean;
begin
  -- spec 160 · la caja administrativa no se arquea.
  if exists (select 1 from public.cajas
             where id = p_caja_id and is_administrative) then
    raise exception 'CAJA_ADMINISTRATIVA_NO_SE_ARQUEA';
  end if;
  select * into v_caja from cajas where id = p_caja_id for update;
  if not found then
    raise exception 'CAJA_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_caja.business_id <> p_business_id then
    raise exception 'CAJA_WRONG_BUSINESS' using errcode = 'P0001';
  end if;
  if not v_caja.is_active then
    raise exception 'CAJA_INACTIVE' using errcode = 'P0001';
  end if;
  if p_closing_cash_cents < 0 then
    raise exception 'CLOSING_CASH_NEGATIVE' using errcode = 'P0001';
  end if;

  select caja_modelo_v2_desde, caja_modelo_v2_pedido into v_v2_desde, v_v2_pedido
    from businesses where id = p_business_id;
  v_v2 := v_v2_desde is not null;

  -- #358 — el esperado se calcula ACÁ, con la caja bloqueada.
  v_ts := clock_timestamp();
  v_esperado := public.efectivo_esperado_caja(p_caja_id, v_ts);
  if v_esperado <> p_expected_cash_cents then
    raise exception 'EXPECTED_CHANGED:%', v_esperado using errcode = 'P0001';
  end if;

  -- Mesas abiertas. Modelo viejo: sólo la caja que barre el salón.
  -- Modelo nuevo: cualquier caja, porque la mesa se podría cobrar en ella.
  if p_barrer_salon or v_v2 then
    select count(*) into v_abiertas
      from orders
      where business_id = p_business_id
        and lifecycle_status = 'open'
        and table_id is not null;
    if v_abiertas > 0 then
      raise exception 'OPEN_TABLE_ORDERS:%', v_abiertas using errcode = 'P0001';
    end if;
  end if;

  if v_v2 then
    -- 210 v2 · ninguna caja cierra con plata de un mozo sin resolver en ella.
    select count(*) into v_sin_rendir from public.mozos_sin_resolver(p_caja_id);
    if v_sin_rendir > 0 then
      raise exception 'UNRENDERED_MOZOS:%', v_sin_rendir using errcode = 'P0001';
    end if;
  elsif p_barrer_salon then
    -- Modelo viejo, igual que la 0122.
    select count(*) into v_sin_rendir
      from (
        select p.attributed_mozo_id as mozo_id, max(p.created_at) as ultimo_pago
          from payments p
          join orders o on o.id = p.order_id
          join business_users bu
            on bu.business_id = p_business_id
           and bu.user_id     = p.attributed_mozo_id
         where p.business_id = p_business_id
           and p.payment_status = 'paid'
           and p.attributed_mozo_id is not null
           and (
                 (bu.role = 'mozo' and not exists (
                    select 1
                      from caja_user_assignments a
                     where a.business_id = p_business_id
                       and a.caja_id     = p_caja_id
                       and a.user_id     = p.attributed_mozo_id))
              or (bu.role = 'encargado' and o.table_id is null)
           )
         group by p.attributed_mozo_id
      ) cobros
     where cobros.ultimo_pago > coalesce(
             (select max(r.created_at)
                from mozo_rendiciones r
               where r.business_id = p_business_id
                 and r.mozo_id     = cobros.mozo_id),
             '-infinity'::timestamptz
           );
    if v_sin_rendir > 0 then
      raise exception 'UNRENDERED_MOZOS:%', v_sin_rendir using errcode = 'P0001';
    end if;
  end if;

  select coalesce(max(numero), 0) + 1 into v_numero
    from caja_cortes
    where business_id = p_business_id;

  insert into caja_cortes (
    caja_id, business_id, encargado_id,
    expected_cash_cents, closing_cash_cents, difference_cents,
    closing_notes, denomination_count, numero, resumen, created_at
  ) values (
    p_caja_id, p_business_id, p_encargado_id,
    v_esperado, p_closing_cash_cents,
    p_closing_cash_cents - v_esperado,
    nullif(btrim(coalesce(p_closing_notes, '')), ''), p_denomination_count,
    v_numero, p_resumen, v_ts
  )
  returning * into v_corte;

  -- Spec 177 · Parte C — se retira lo contado MENOS el fondo.
  if p_retirar then
    v_fondo_cents := coalesce(v_caja.fondo_fijo_cents, 0);
    v_retiro_cents := greatest(0, p_closing_cash_cents - v_fondo_cents);
    if v_retiro_cents > 0 then
      insert into caja_movimientos (
        caja_id, business_id, kind, amount_cents, reason, created_by, created_at,
        corte_id
      ) values (
        p_caja_id, p_business_id, 'sangria', v_retiro_cents,
        case when v_fondo_cents > 0
             then 'Retiro del cierre (deja fondo de caja)'
             else 'Retiro del cierre de caja' end,
        p_encargado_id,
        v_corte.created_at + interval '1 millisecond',
        v_corte.id
      )
      returning id into v_retiro_id;
    end if;
  end if;

  insert into print_jobs (business_id, kind, status, corte_id)
  values (p_business_id, 'cierre', 'pendiente', v_corte.id)
  returning id into v_print_job_id;

  -- Modelo viejo: la principal barre el salón. Modelo nuevo: lo hace el turno.
  if p_barrer_salon and not v_v2 then
    select b.mesas_liberadas, b.mozos_limpiados into v_mesas, v_mozos
      from public.barrer_salon(p_business_id, p_encargado_id, 'Cierre de caja') b;
  end if;

  -- R8 · pasaje: el negocio que lo pidió entra al modelo nuevo ahora, en el
  -- cierre de su principal (sin mesas abiertas y con todos rendidos). El turno
  -- arranca en el mismo instante.
  if not v_v2 and v_v2_pedido and v_caja.is_default then
    update businesses set caja_modelo_v2_desde = v_ts + interval '2 milliseconds'
     where id = p_business_id;
    insert into turnos (business_id, abierto_at) values (p_business_id, v_ts + interval '2 milliseconds');
  end if;

  return query select to_jsonb(v_corte), v_retiro_id, v_mesas, v_mozos, v_print_job_id, v_retiro_cents;
end;
$function$;

revoke all on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb) to service_role;

-- ── 3 · cerrar el turno ─────────────────────────────────────────────────────

create or replace function public.cajas_sin_contar(p_business_id uuid)
returns table(caja_id uuid, caja_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Una caja «sin contar» tuvo cobros o movimientos después de su último corte
  -- (el retiro del propio corte, que nace 1 ms después, no cuenta).
  with ultimo as (
    select c.id, c.name, coalesce(max(k.created_at), c.created_at) as desde
      from cajas c
      left join caja_cortes k on k.caja_id = c.id
     where c.business_id = p_business_id and c.is_active and not c.is_administrative
     group by c.id, c.name, c.created_at
  )
  select u.id, u.name
    from ultimo u
   where exists (select 1 from payments p
                  where p.caja_id = u.id and p.payment_status = 'paid' and p.created_at > u.desde)
      or exists (select 1 from caja_movimientos m
                  where m.caja_id = u.id and m.cancelled_at is null and m.corte_id is null
                    and m.created_at > u.desde);
$function$;

revoke all on function public.cajas_sin_contar(uuid) from public, anon, authenticated;
grant execute on function public.cajas_sin_contar(uuid) to service_role;

create or replace function public.cerrar_turno_tx(p_business_id uuid, p_por uuid, p_resumen jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_turno    turnos%rowtype;
  v_abiertas integer;
  v_sin      text;
  v_mesas    integer;
  v_mozos    integer;
  v_ts       timestamptz;
begin
  if (select caja_modelo_v2_desde from businesses where id = p_business_id) is null then
    raise exception 'MODELO_VIEJO' using errcode = 'P0001';
  end if;

  select * into v_turno from turnos
   where business_id = p_business_id and cerrado_at is null
   for update;
  if not found then
    -- Defensivo: un negocio del modelo nuevo siempre tiene uno abierto.
    insert into turnos (business_id) values (p_business_id) returning * into v_turno;
  end if;

  select count(*) into v_abiertas
    from orders
   where business_id = p_business_id and lifecycle_status = 'open' and table_id is not null;
  if v_abiertas > 0 then
    raise exception 'OPEN_TABLE_ORDERS:%', v_abiertas using errcode = 'P0001';
  end if;

  select string_agg(caja_name, ', ' order by caja_name) into v_sin
    from public.cajas_sin_contar(p_business_id);
  if v_sin is not null then
    raise exception 'CAJA_SIN_CONTAR:%', v_sin using errcode = 'P0001';
  end if;

  select b.mesas_liberadas, b.mozos_limpiados into v_mesas, v_mozos
    from public.barrer_salon(p_business_id, p_por, 'Cierre del turno') b;

  v_ts := clock_timestamp();
  update turnos
     set cerrado_at = v_ts, cerrado_por = p_por, resumen = p_resumen
   where id = v_turno.id
  returning * into v_turno;

  insert into turnos (business_id, abierto_at) values (p_business_id, v_ts);

  return jsonb_build_object(
    'turno', to_jsonb(v_turno),
    'mesas_liberadas', v_mesas,
    'mozos_limpiados', v_mozos
  );
end;
$function$;

revoke all on function public.cerrar_turno_tx(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cerrar_turno_tx(uuid, uuid, jsonb) to service_role;

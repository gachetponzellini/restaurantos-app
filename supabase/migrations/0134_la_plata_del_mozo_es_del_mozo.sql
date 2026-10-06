-- ────────────────────────────────────────────────────────────────────────
-- 0134 — la plata del mozo es del mozo hasta que la entrega (spec 210 v2 · R1, R2, R3 base)
--
-- Hasta acá el efectivo que cobra un mozo entraba al «debería haber» de la
-- caja en el momento del cobro, aunque estuviera en su bolsillo. Con dos cajas,
-- o con una caja que cierra antes de que el mozo rinda, la cuenta se rompía
-- (verificado en vivo el 2026-10-06, ver la spec).
--
-- Esta migración pone la base del modelo nuevo, **apagado por defecto**:
--
--   1. `businesses.caja_modelo_v2_desde` — desde cuándo el negocio usa el
--      modelo nuevo. `null` = modelo viejo: nada cambia.
--   2. `payments.rinde_mozo_id` — quién tiene que rendir este cobro. Lo fija la
--      base al cobrar (y al corregir mozo o caja) con UNA regla, la misma que
--      hoy decide quién rinde:
--        · el mozo, salvo que opere la caja del cobro (spec 139 · D3);
--        · el encargado, sólo por lo cobrado sin mesa (spec 203).
--      Sólo se completa para cobros del modelo nuevo; los viejos quedan `null`.
--   3. `caja_movimientos.kind = 'rendicion'` — la entrega del mozo, con su
--      `mozo_id`. Es la única forma en que su plata entra a un cajón.
--   4. `saldo_mozo(mozo, caja)` — lo que el mozo tiene que entregar a esa caja:
--      efectivo cobrado (sin su propina en efectivo, que ya tiene) − su propina
--      de tarjeta/QR (se la queda de lo que trae) − lo entregado + lo que la
--      caja le pagó de propina (cuando el saldo daba negativo).
--   5. `efectivo_esperado_caja` v2 — el efectivo de un cobro con
--      `rinde_mozo_id` no entra al cajón hasta la entrega; la entrega suma.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1 · el interruptor ─────────────────────────────────────────────────────

alter table public.businesses
  add column if not exists caja_modelo_v2_desde timestamptz;

comment on column public.businesses.caja_modelo_v2_desde is
  'Spec 210 v2: desde cuándo el efectivo de los mozos queda a su nombre hasta que lo entregan. null = modelo viejo.';

-- ── 2 · quién rinde cada cobro ─────────────────────────────────────────────

alter table public.payments
  add column if not exists rinde_mozo_id uuid references public.users(id) on delete set null;

create index if not exists payments_rinde_mozo_idx
  on public.payments (business_id, rinde_mozo_id, caja_id)
  where rinde_mozo_id is not null;

comment on column public.payments.rinde_mozo_id is
  'Spec 210 v2: quién tiene que rendir este cobro. Lo fija la base al cobrar. null = la plata entró al cajón (o cobro del modelo viejo).';

-- La regla única de «quién rinde» (antes repartida entre deben-rendir.ts,
-- canal-rendicion.ts y el subquery de cerrar_caja_tx).
create or replace function public.mozo_que_rinde(
  p_business_id uuid, p_caja_id uuid, p_mozo_id uuid, p_order_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role     text;
  v_con_mesa boolean;
begin
  if p_mozo_id is null then
    return null;
  end if;
  select role into v_role
    from business_users
   where business_id = p_business_id and user_id = p_mozo_id;

  if v_role = 'mozo' then
    -- El operador de la caja cobra directo al cajón: no rinde (spec 139 · D3).
    if exists (select 1 from caja_user_assignments a
                where a.business_id = p_business_id
                  and a.caja_id = p_caja_id
                  and a.user_id = p_mozo_id) then
      return null;
    end if;
    return p_mozo_id;
  end if;

  if v_role = 'encargado' then
    -- Lo de salón entra derecho al cajón; rinde lo de mostrador y delivery (spec 203).
    select o.table_id is not null into v_con_mesa from orders o where o.id = p_order_id;
    if coalesce(v_con_mesa, true) then
      return null;
    end if;
    return p_mozo_id;
  end if;

  return null;
end;
$function$;

revoke all on function public.mozo_que_rinde(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mozo_que_rinde(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.trg_quien_rinde()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_desde timestamptz;
begin
  -- En un UPDATE sólo se recalcula si cambió lo que decide la regla: una
  -- corrección de mozo o de caja (spec 210 · R6). Un cambio de monto, método o
  -- estado no mueve quién rinde.
  if tg_op = 'UPDATE'
     and new.attributed_mozo_id is not distinct from old.attributed_mozo_id
     and new.caja_id is not distinct from old.caja_id then
    return new;
  end if;

  select caja_modelo_v2_desde into v_desde from businesses where id = new.business_id;
  if v_desde is null or new.created_at < v_desde then
    -- Modelo viejo: el cobro queda como siempre.
    new.rinde_mozo_id := null;
    return new;
  end if;

  new.rinde_mozo_id := public.mozo_que_rinde(
    new.business_id, new.caja_id, new.attributed_mozo_id, new.order_id);
  return new;
end;
$function$;

-- El nombre importa: los triggers BEFORE corren en orden alfabético, y éste
-- tiene que correr DESPUÉS de `entra_a_la_caja` (0122), que fija la hora real.
drop trigger if exists quien_rinde on public.payments;
create trigger quien_rinde
  before insert or update of attributed_mozo_id, caja_id on public.payments
  for each row execute function public.trg_quien_rinde();

-- ── 3 · la entrega es un movimiento de caja ────────────────────────────────

alter table public.caja_movimientos
  drop constraint if exists caja_movimientos_kind_check;
alter table public.caja_movimientos
  add constraint caja_movimientos_kind_check
  check (kind in ('sangria', 'ingreso', 'propina', 'rendicion'));

-- Una propina o una rendición sin mozo no tiene dueño; una sangría o un
-- ingreso con mozo contaría en el reporte por mozo plata que no es suya.
alter table public.caja_movimientos
  drop constraint if exists caja_movimientos_mozo_check;
alter table public.caja_movimientos
  add constraint caja_movimientos_mozo_check
  check ((kind in ('propina', 'rendicion')) = (mozo_id is not null));

create index if not exists caja_movimientos_rendicion_mozo_idx
  on public.caja_movimientos (business_id, mozo_id, caja_id)
  where kind = 'rendicion';

-- ── 4 · el saldo del mozo con una caja ─────────────────────────────────────

create or replace function public.saldo_mozo(p_mozo_id uuid, p_caja_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_business  uuid;
  v_desde     timestamptz;
  v_efectivo  bigint;
  v_propinas  bigint;
  v_movs      bigint;
begin
  select business_id into v_business from cajas where id = p_caja_id;
  select caja_modelo_v2_desde into v_desde from businesses where id = v_business;
  if v_desde is null then
    return 0;
  end if;

  -- Lo de las cuentas en efectivo: la propina en efectivo ya la tiene.
  select coalesce(sum(amount_cents - tip_cents), 0) into v_efectivo
    from payments
   where rinde_mozo_id = p_mozo_id and caja_id = p_caja_id
     and payment_status = 'paid' and method = 'cash';

  -- Su propina de tarjeta/QR/transferencia: se la queda de lo que trae (R4).
  select coalesce(sum(tip_cents), 0) into v_propinas
    from payments
   where rinde_mozo_id = p_mozo_id and caja_id = p_caja_id
     and payment_status = 'paid' and method <> 'cash';

  -- Lo que ya entregó resta; lo que la caja le pagó de propina (saldo
  -- negativo, R4) suma. Sólo movimientos del modelo nuevo.
  select coalesce(sum(case when kind = 'rendicion' then -amount_cents else amount_cents end), 0)
    into v_movs
    from caja_movimientos
   where mozo_id = p_mozo_id and caja_id = p_caja_id
     and kind in ('rendicion', 'propina')
     and cancelled_at is null
     and created_at >= v_desde;

  return v_efectivo - v_propinas + v_movs;
end;
$function$;

revoke all on function public.saldo_mozo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.saldo_mozo(uuid, uuid) to service_role;

-- ── 5 · el «debería haber» v2 ───────────────────────────────────────────────

create or replace function public.efectivo_esperado_caja(p_caja_id uuid, p_hasta timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_desde    timestamptz;
  v_arrastre bigint;
  v_cobros   bigint;
  v_movs     bigint;
begin
  select created_at, closing_cash_cents into v_desde, v_arrastre
    from caja_cortes
   where caja_id = p_caja_id and created_at <= p_hasta
   order by created_at desc
   limit 1;
  if v_desde is null then
    select created_at into v_desde from cajas where id = p_caja_id;
    v_arrastre := 0;
  end if;

  -- 210 v2 · el efectivo que tiene que rendir un mozo no está en el cajón:
  -- entra cuando lo entrega (movimiento `rendicion`). Los cobros del modelo
  -- viejo tienen `rinde_mozo_id` null y cuentan como siempre.
  select coalesce(sum(amount_cents), 0) into v_cobros
    from payments
   where caja_id = p_caja_id
     and payment_status = 'paid'
     and method = 'cash'
     and rinde_mozo_id is null
     and created_at > v_desde and created_at <= p_hasta;

  -- Incluye el retiro del corte anterior (+1 ms). La entrega de un mozo suma,
  -- como un ingreso; la propina que se le paga resta, como una sangría.
  select coalesce(sum(case when kind in ('ingreso', 'rendicion') then amount_cents else -amount_cents end), 0)
    into v_movs
    from caja_movimientos
   where caja_id = p_caja_id
     and cancelled_at is null
     and created_at > v_desde and created_at <= p_hasta;

  return coalesce(v_arrastre, 0) + v_cobros + v_movs;
end;
$function$;

revoke all on function public.efectivo_esperado_caja(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.efectivo_esperado_caja(uuid, timestamptz) to service_role;

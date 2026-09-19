-- ────────────────────────────────────────────────────────────────────────
-- 0122 — el cierre calcula el esperado adentro (issue #358, epic #361)
--
-- `cerrarCaja` calculaba el efectivo esperado en TS y `cerrar_caja_tx` lo
-- guardaba sin mirar. Un cobro que entraba entre esa lectura y el INSERT del
-- corte quedaba con `created_at` anterior al corte —o sea en el período
-- cerrado— pero fuera del esperado que se firmó: no lo contaba ni este cierre
-- ni el siguiente. Y los `created_at` salían del inicio de cada transacción
-- (`now()`), así que un cobro lento podía quedar «antes» de un corte que se
-- firmó después de él.
--
-- Tres piezas:
--
--   1. `efectivo_esperado_caja(caja, hasta)` — la fórmula de
--      `calculateExpectedCash` en SQL: arrastre del último corte + efectivo
--      cobrado + ingresos − sangrías − propinas pagadas, en la ventana
--      (último corte, hasta]. TS sigue calculándolo para mostrarlo; la base
--      lo recalcula para firmarlo.
--   2. Trigger en `payments` y `caja_movimientos`: al entrar a una caja toman
--      un lock compartido sobre la fila de la caja y, si traen la hora por
--      defecto, la reemplazan por la del reloj. El cierre toma el lock
--      exclusivo: se serializan, y la hora de cada uno ordena bien.
--   3. `cerrar_caja_tx` bloquea, recalcula y, si el esperado cambió respecto
--      del que vio el encargado, rechaza con EXPECTED_CHANGED:<nuevo>.
--
-- También la guarda de rendiciones pasa a espejar la de la pantalla (el
-- encargado rinde lo sin mesa).
-- ────────────────────────────────────────────────────────────────────────

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

  select coalesce(sum(amount_cents), 0) into v_cobros
    from payments
   where caja_id = p_caja_id
     and payment_status = 'paid'
     and method = 'cash'
     and created_at > v_desde and created_at <= p_hasta;

  -- Incluye el retiro del corte anterior (+1 ms): la apertura en TS lo netea
  -- contra el arrastre, que es la misma suma.
  select coalesce(sum(case when kind = 'ingreso' then amount_cents else -amount_cents end), 0)
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

-- ── Lo que entra a una caja se ordena contra su cierre ──────────────────────

create or replace function public.trg_entra_a_la_caja()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.caja_id is not null then
    -- Compartido: los cobros no se esperan entre sí; sólo esperan a un cierre
    -- en curso (que toma la fila `for update`).
    perform 1 from cajas where id = new.caja_id for share;
  end if;
  -- `now()` es el inicio de la transacción. Si la fila trae ése (el default),
  -- se lo cambia por la hora real, tomada ya con el lock. Una hora explícita
  -- (el retiro del corte, la propina de una rendición, un backfill) se respeta.
  if new.created_at = now() then
    new.created_at := clock_timestamp();
  end if;
  return new;
end;
$function$;

drop trigger if exists entra_a_la_caja on public.payments;
create trigger entra_a_la_caja
  before insert on public.payments
  for each row execute function public.trg_entra_a_la_caja();

drop trigger if exists entra_a_la_caja on public.caja_movimientos;
create trigger entra_a_la_caja
  before insert on public.caja_movimientos
  for each row execute function public.trg_entra_a_la_caja();

-- ── El cierre ───────────────────────────────────────────────────────────────

create or replace function public.cerrar_caja_tx(
  p_caja_id uuid, p_business_id uuid, p_encargado_id uuid,
  p_expected_cash_cents bigint, p_closing_cash_cents bigint,
  p_closing_notes text, p_denomination_count jsonb,
  p_retirar boolean, p_barrer_salon boolean, p_resumen jsonb default null::jsonb
)
returns table(corte jsonb, retiro_id uuid, mesas_liberadas integer, mozos_limpiados integer, print_job_id uuid)
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
  v_plan_ids        uuid[];
  v_numero          integer;
  v_ts              timestamptz;
  v_esperado        bigint;
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

  -- #358 — el esperado se calcula ACÁ, con la caja bloqueada. Los cobros y
  -- movimientos que entran a esta caja toman un lock compartido sobre la
  -- misma fila (trigger de abajo), así que desde este punto nada entra a la
  -- ventana sin que lo veamos; y la hora del corte es la del reloj, no la del
  -- inicio de la transacción, para ordenarse bien contra esos cobros.
  v_ts := clock_timestamp();
  v_esperado := public.efectivo_esperado_caja(p_caja_id, v_ts);
  if v_esperado <> p_expected_cash_cents then
    -- Lo que el encargado vio y contó ya no es el número: que lo vea antes de
    -- firmar, en vez de guardar una diferencia que nadie explicó.
    raise exception 'EXPECTED_CHANGED:%', v_esperado using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_plan_ids
    from floor_plans where business_id = p_business_id;

  -- D7 · cerrar con una cuenta abierta es cerrar el día con plata sin cobrar.
  if p_barrer_salon then
    select count(*) into v_abiertas
      from orders
      where business_id = p_business_id
        and lifecycle_status = 'open'
        and table_id is not null;
    if v_abiertas > 0 then
      raise exception 'OPEN_TABLE_ORDERS:%', v_abiertas using errcode = 'P0001';
    end if;
  end if;

  -- Spec 139 · D1/D5 (repuesta por la 0077). «Resolver» no es «entregar»: la
  -- rendición puede registrarse como `no_entrego` con motivo y eso alcanza. Lo
  -- que no se puede es ignorar a alguien que cobró.
  --
  -- #358 — la misma regla que la pantalla (`mozosQueDebenRendir` +
  -- `calcularRendicionPorCanal`): el mozo rinde todo lo que cobró salvo que
  -- opere esta caja; el encargado rinde sólo lo sin mesa (takeaway, delivery),
  -- aunque opere la caja; el admin no rinde. La 0080 sacaba al encargado
  -- entero, así que la base no respaldaba lo que la pantalla exigía.
  if p_barrer_salon then
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
  --
  -- El monto sigue saliendo de lo **contado** y no de lo esperado (D2 de la
  -- 130): se saca del cajón lo que hay adentro, no lo que debería haber. Con
  -- `fondo_fijo_cents = 0` esto es exactamente el comportamiento anterior.
  --
  -- `greatest(0, …)` porque el cajón puede cerrar con menos que el fondo (una
  -- noche floja, un faltante): ahí no se retira nada y queda lo que haya. Una
  -- sangría negativa sería plata inventada.
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

  if p_barrer_salon and coalesce(array_length(v_plan_ids, 1), 0) > 0 then
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
      insert into tables_audit_log (
        table_id, business_id, kind, from_value, to_value, by_user_id, reason
      )
      select id, p_business_id, 'status', desde, 'libre', p_encargado_id,
             'Cierre de caja'
        from liberadas
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
      insert into tables_audit_log (
        table_id, business_id, kind, from_value, to_value, by_user_id, reason
      )
      select id, p_business_id, 'assignment', desde::text, null,
             p_encargado_id, 'Cierre de caja'
        from limpiadas
      returning 1
    )
    select count(*) into v_mozos from auditadas;
  end if;

  return query select to_jsonb(v_corte), v_retiro_id, v_mesas, v_mozos, v_print_job_id;
end;
$function$;

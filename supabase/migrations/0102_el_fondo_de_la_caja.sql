-- ────────────────────────────────────────────────────────────────────────
-- 0102 — el cajón no arranca en cero (spec 177 · Parte C)
--
-- La spec 130 lo había descartado por escrito:
--
--   > D2 — No hay retiro parcial ni fondo de cambio configurable: si mañana
--   > ponen $50.000 de cambio, eso entra como Ingreso cuando lo ponen. Es una
--   > decisión menos en el peor momento del día.
--
-- El argumento era bueno y se cae cuando el fondo está **configurado**:
-- justamente no hay nada que decidir a la 1 de la mañana, es un número que el
-- cierre aplica solo. Pedido de Juan (2026-09-10): *"vamos a tener que manejar
-- en caja un fondo fijo que pueda ir variando"* — variando de local en local y
-- de temporada en temporada, no de noche en noche.
--
-- Y con la Parte B encima hay una razón nueva: si la propina se paga en
-- efectivo del cajón, el cajón necesita tener con qué.
--
-- ## Por qué es barato
--
-- Por la D3 de esa misma spec: el retiro ya es *«una sangría de verdad»* y no
-- una columna de `caja_cortes`, precisamente para que `calculateExpectedCash`
-- no se tuviera que tocar. Un retiro parcial no cambia la fórmula — cambia el
-- monto. El período nuevo arranca con apertura = lo contado y una sangría por
-- lo retirado, o sea con el fondo adentro.
--
-- El `+ 1 millisecond` del timestamp sigue siendo tan necesario como en la
-- 130: sin él la sangría no cae ni en el período viejo ni en el nuevo.
-- ────────────────────────────────────────────────────────────────────────

alter table "public"."cajas"
  add column if not exists "fondo_fijo_cents" bigint not null default 0;

alter table "public"."cajas"
  drop constraint if exists "cajas_fondo_fijo_cents_check";
alter table "public"."cajas"
  add constraint "cajas_fondo_fijo_cents_check" check ("fondo_fijo_cents" >= 0);

comment on column "public"."cajas"."fondo_fijo_cents" is
  'Spec 177 · Parte C: cuánto efectivo queda en el cajón al cerrar, para tener cambio (y con qué pagar propinas) al abrir. 0 = se retira todo, que es el comportamiento de la spec 130. El valor aplicado queda congelado en el resumen del corte: si el fondo cambia, un cierre viejo releído con el fondo de hoy daría mal.';

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
  if p_barrer_salon then
    select count(*) into v_sin_rendir
      from (
        select p.attributed_mozo_id as mozo_id, max(p.created_at) as ultimo_pago
          from payments p
         where p.business_id = p_business_id
           and p.payment_status = 'paid'
           and p.attributed_mozo_id is not null
         group by p.attributed_mozo_id
      ) cobros
     where not exists (
             select 1
               from caja_user_assignments a
              where a.business_id = p_business_id
                and a.caja_id     = p_caja_id
                and a.user_id     = cobros.mozo_id
           )
       -- 0080 · el encargado tampoco rinde: maneja la caja.
       and not exists (
             select 1
               from business_users bu
              where bu.business_id = p_business_id
                and bu.user_id     = cobros.mozo_id
                and bu.role in ('admin', 'encargado')
           )
       and cobros.ultimo_pago > coalesce(
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
    closing_notes, denomination_count, numero, resumen
  ) values (
    p_caja_id, p_business_id, p_encargado_id,
    p_expected_cash_cents, p_closing_cash_cents,
    p_closing_cash_cents - p_expected_cash_cents,
    nullif(btrim(coalesce(p_closing_notes, '')), ''), p_denomination_count,
    v_numero, p_resumen
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

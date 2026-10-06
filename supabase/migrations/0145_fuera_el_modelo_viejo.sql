-- ────────────────────────────────────────────────────────────────────────
-- 0145 — fuera el modelo viejo de caja (spec 210 v2)
--
-- Todos los negocios pasaron al modelo nuevo (0140, en producción desde el
-- 2026-10-06) y los nuevos nacen en él. Lo que sostenía la vuelta atrás ya no
-- tiene uso:
--
--   · `caja_modelo_v2_desde` pasa a NOT NULL: no hay negocio en el modelo
--     viejo, ni puede volver a haberlo. (Sigue siendo la fecha de corte: los
--     cobros de antes no tienen quién rinda.)
--   · Se borran `registrar_rendicion_tx` (la rendición por período), el pasaje
--     (`pasar_al_modelo_nuevo`) y `caja_modelo_v2_pedido`.
--   · `cerrar_caja_tx` sin las ramas del modelo viejo. El historial de
--     `mozo_rendiciones` del modelo viejo queda como está.
-- ────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from public.businesses where caja_modelo_v2_desde is null) then
    raise exception 'Hay negocios en el modelo viejo: correr pasar_al_modelo_nuevo antes de 0145';
  end if;
end;
$$;

alter table public.businesses alter column caja_modelo_v2_desde set not null;

drop function if exists public.registrar_rendicion_tx(uuid, uuid, uuid, uuid, timestamptz, bigint, bigint, bigint, text, jsonb, jsonb, text, bigint, uuid, text, integer);
drop function if exists public.pasar_al_modelo_nuevo(uuid);

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
begin
  -- spec 160 · la caja administrativa no se arquea. `p_barrer_salon` queda en
  -- la firma por compatibilidad: el salón lo barre cerrar_turno_tx.
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

  -- #358 — el esperado se calcula ACÁ, con la caja bloqueada.
  v_ts := clock_timestamp();
  v_esperado := public.efectivo_esperado_caja(p_caja_id, v_ts);
  if v_esperado <> p_expected_cash_cents then
    raise exception 'EXPECTED_CHANGED:%', v_esperado using errcode = 'P0001';
  end if;

  -- Ninguna caja cierra con mesas abiertas (se podrían cobrar en ella) ni con
  -- plata de un mozo sin resolver en ella. El salón lo barre el turno.
  select count(*) into v_abiertas
    from orders
   where business_id = p_business_id
     and lifecycle_status = 'open'
     and table_id is not null;
  if v_abiertas > 0 then
    raise exception 'OPEN_TABLE_ORDERS:%', v_abiertas using errcode = 'P0001';
  end if;

  select count(*) into v_sin_rendir from public.mozos_sin_resolver(p_caja_id);
  if v_sin_rendir > 0 then
    raise exception 'UNRENDERED_MOZOS:%', v_sin_rendir using errcode = 'P0001';
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

  return query select to_jsonb(v_corte), v_retiro_id, v_mesas, v_mozos, v_print_job_id, v_retiro_cents;
end;
$function$;

revoke all on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.cerrar_caja_tx(uuid, uuid, uuid, bigint, bigint, text, jsonb, boolean, boolean, jsonb) to service_role;

alter table public.businesses drop column if exists caja_modelo_v2_pedido;

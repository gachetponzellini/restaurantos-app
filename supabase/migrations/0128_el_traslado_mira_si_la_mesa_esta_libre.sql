-- ────────────────────────────────────────────────────────────────────────
-- 0128 — el traslado mira si la mesa destino está libre (#148 · H-53)
--
-- `trasladar_mesa_tx` validaba el destino sólo por ausencia de una orden
-- abierta. Una mesa `ocupada` que todavía no cargó nada (recién sentados, o
-- abierta y sin cuenta) pasaba el chequeo, y el traslado le pisaba el estado,
-- el mozo y el `opened_at` al grupo que ya estaba ahí. Las dos UIs filtran
-- destinos libres, pero la server action acepta cualquier `toTableId`.
--
-- Ahora el destino tiene que estar `libre`; si no, `DESTINATION_OCCUPIED` (el
-- mismo error que ya traduce la action). Se toma `for update` sobre la fila
-- destino para que dos traslados simultáneos a la misma mesa no se crucen.
--
-- ⚠️ Basada en la definición DESPLEGADA en producción (`pg_get_functiondef`,
-- 2026-09-21), no en 0015: la lógica coincide y la de prod no tiene los
-- comentarios. Único cambio: el bloque marcado «0128».
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.trasladar_mesa_tx(
  p_business_id uuid,
  p_from_table_id uuid,
  p_to_table_id uuid,
  p_expected_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order          orders%rowtype;
  v_from_biz       uuid;
  v_to_biz         uuid;
  v_from_opened_at timestamptz;
  v_from_mozo      uuid;
  v_new_status     text;
  v_to_status      text;
begin
  if p_from_table_id = p_to_table_id then
    raise exception 'SAME_TABLE' using errcode = 'P0001';
  end if;

  select fp.business_id into v_from_biz
    from tables t join floor_plans fp on fp.id = t.floor_plan_id
    where t.id = p_from_table_id;
  if v_from_biz is null or v_from_biz <> p_business_id then
    raise exception 'CROSS_TENANT' using errcode = 'P0001';
  end if;

  select fp.business_id into v_to_biz
    from tables t join floor_plans fp on fp.id = t.floor_plan_id
    where t.id = p_to_table_id;
  if v_to_biz is null or v_to_biz <> p_business_id then
    raise exception 'CROSS_TENANT' using errcode = 'P0001';
  end if;

  select * into v_order
    from orders
    where table_id = p_from_table_id
      and business_id = p_business_id
      and lifecycle_status = 'open'
    for update;
  if not found then
    raise exception 'NO_OPEN_ORDER' using errcode = 'P0002';
  end if;

  if v_order.id <> p_expected_order_id then
    raise exception 'STALE_STATE' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from orders
    where table_id = p_to_table_id
      and business_id = p_business_id
      and lifecycle_status = 'open'
  ) then
    raise exception 'DESTINATION_OCCUPIED' using errcode = 'P0001';
  end if;

  -- 0128: el destino tiene que estar libre, no sólo sin orden abierta.
  select operational_status into v_to_status
    from tables where id = p_to_table_id
    for update;
  if v_to_status is distinct from 'libre' then
    raise exception 'DESTINATION_OCCUPIED' using errcode = 'P0001';
  end if;

  select operational_status, opened_at, mozo_id
    into v_new_status, v_from_opened_at, v_from_mozo
    from tables where id = p_from_table_id;

  begin
    update orders set table_id = p_to_table_id where id = v_order.id;
  exception when unique_violation then
    raise exception 'DESTINATION_OCCUPIED' using errcode = 'P0001';
  end;

  v_new_status := case
    when v_order.bill_requested_at is not null then 'pidio_cuenta'
    else 'ocupada'
  end;

  update tables
    set operational_status = 'libre',
        current_order_id = null,
        opened_at = null,
        mozo_id = null
    where id = p_from_table_id;

  update tables
    set operational_status = v_new_status,
        current_order_id = v_order.id,
        opened_at = v_from_opened_at,
        mozo_id = v_from_mozo
    where id = p_to_table_id;

  update reservations
    set table_id = p_to_table_id
    where table_id = p_from_table_id
      and business_id = p_business_id
      and status = 'seated';

  insert into tables_audit_log
    (table_id, business_id, kind, from_value, to_value, by_user_id, reason)
  values
    (p_from_table_id, p_business_id, 'move', p_from_table_id::text, p_to_table_id::text, p_actor_user_id, p_reason),
    (p_to_table_id,   p_business_id, 'move', p_from_table_id::text, p_to_table_id::text, p_actor_user_id, p_reason);

  return v_order.id;
end;
$function$;

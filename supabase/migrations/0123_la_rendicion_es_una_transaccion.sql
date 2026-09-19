-- ────────────────────────────────────────────────────────────────────────
-- 0123 — la rendición es una transacción (issue #359, epic #361)
--
-- `registrarRendicionMozo` insertaba la rendición y después el movimiento que
-- le paga la propina (spec 177 · Parte B), con un `delete` a mano si el
-- segundo fallaba. Y nada impedía dos rendiciones del mismo mozo a la vez:
-- las dos leían el mismo pendiente y las dos pagaban la propina del cajón.
--
-- `registrar_rendicion_tx` hace las dos escrituras juntas, con un lock por
-- mozo, y verifica que la última rendición del mozo siga siendo la que la
-- action leyó como piso del período: si alguien rindió en el medio, rechaza
-- con RENDICION_CONCURRENTE.
--
-- La aritmética (qué se esperaba, qué propina toca) sigue en TS — no se
-- duplica en SQL (ver el #253) —; acá se garantiza que se escriba una vez.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_rendicion_tx(
  p_business_id uuid,
  p_mozo_id uuid,
  p_registered_by uuid,
  p_desde_rendicion_id uuid,
  p_created_at timestamptz,
  p_expected_cash_cents bigint,
  p_delivered_cash_cents bigint,
  p_difference_cents bigint,
  p_notes text,
  p_por_metodo jsonb,
  p_por_canal jsonb,
  p_estado text,
  p_propina_pagada_cents bigint,
  p_caja_id uuid,
  p_propina_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ultima    uuid;
  v_rendicion mozo_rendiciones%rowtype;
begin
  -- Una rendición por mozo a la vez.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_mozo_id::text, 0));

  select id into v_ultima
    from mozo_rendiciones
   where business_id = p_business_id and mozo_id = p_mozo_id
   order by created_at desc
   limit 1;
  if v_ultima is distinct from p_desde_rendicion_id then
    raise exception 'RENDICION_CONCURRENTE' using errcode = 'P0001';
  end if;

  insert into mozo_rendiciones (
    business_id, mozo_id, registered_by, expected_cash_cents,
    delivered_cash_cents, difference_cents, notes, por_metodo, por_canal,
    estado, propina_pagada_cents, created_at
  ) values (
    p_business_id, p_mozo_id, p_registered_by, p_expected_cash_cents,
    p_delivered_cash_cents, p_difference_cents, p_notes, p_por_metodo, p_por_canal,
    p_estado, coalesce(p_propina_pagada_cents, 0), p_created_at
  )
  returning * into v_rendicion;

  if coalesce(p_propina_pagada_cents, 0) > 0 then
    perform 1 from cajas
     where id = p_caja_id and business_id = p_business_id
       and is_active and not is_administrative;
    if not found then
      raise exception 'CAJA_INVALID' using errcode = 'P0001';
    end if;
    insert into caja_movimientos (
      business_id, caja_id, kind, mozo_id, amount_cents, reason, created_by, created_at
    ) values (
      p_business_id, p_caja_id, 'propina', p_mozo_id, p_propina_pagada_cents,
      p_propina_reason, p_registered_by, p_created_at
    );
  end if;

  return to_jsonb(v_rendicion);
end;
$function$;

revoke all on function public.registrar_rendicion_tx(uuid, uuid, uuid, uuid, timestamptz, bigint, bigint, bigint, text, jsonb, jsonb, text, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_rendicion_tx(uuid, uuid, uuid, uuid, timestamptz, bigint, bigint, bigint, text, jsonb, jsonb, text, bigint, uuid, text) to service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 0142 — el primer turno arranca con lo que pasó (spec 210 v2 · R8)
--
-- Verificación en vivo (2026-10-06): con 0140 el primer turno abría en el
-- instante del pasaje, así que todo lo que el mozo cobró ese día antes del
-- deploy le aparecía como «Traías de antes». La cuenta daba, pero se leía
-- como una deuda vieja.
--
--   · `pasar_al_modelo_nuevo` abre el turno justo antes (1 µs) del primer
--     cobro que pasa a nombre de un mozo — la ventana del turno es exclusiva
--     (`created_at > abierto_at`) —, o en el instante del pasaje si no pasó
--     ninguno.
--   · Los turnos que ya abrió 0140 y siguen abiertos (el primero del negocio)
--     se corren al primer cobro pasado de ese negocio.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.pasar_al_modelo_nuevo(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ts      timestamptz := clock_timestamp();
  v_pasados integer := 0;
  v_primero timestamptz;
begin
  perform 1 from businesses where id = p_business_id for update;
  if (select caja_modelo_v2_desde from businesses where id = p_business_id) is not null then
    return 0;
  end if;

  -- El trigger `quien_rinde` (0139) no deja tocar rinde_mozo_id a mano salvo
  -- en el pasaje.
  perform set_config('app.caja_pasaje', 'on', true);

  with ultima_rendicion as (
    select mozo_id, max(created_at) as at
      from mozo_rendiciones
     where business_id = p_business_id
     group by mozo_id
  ), ultimo_corte as (
    select c.id as caja_id, coalesce(max(k.created_at), c.created_at) as at
      from cajas c
      left join caja_cortes k on k.caja_id = c.id
     where c.business_id = p_business_id
     group by c.id, c.created_at
  ), pasados as (
    update payments p
       set rinde_mozo_id = public.mozo_que_rinde(p.business_id, p.caja_id, p.attributed_mozo_id, p.order_id)
      from ultimo_corte uc
     where p.business_id = p_business_id
       and p.caja_id = uc.caja_id
       and p.payment_status = 'paid'
       and p.attributed_mozo_id is not null
       and p.rinde_mozo_id is null
       -- sólo lo que está en el período abierto de su caja…
       and p.created_at > uc.at
       -- …y que el mozo todavía no rindió (modelo viejo: rendición por período).
       and p.created_at > coalesce(
             (select ur.at from ultima_rendicion ur where ur.mozo_id = p.attributed_mozo_id),
             '-infinity'::timestamptz)
    returning p.id, p.created_at
  )
  select count(*), min(created_at) into v_pasados, v_primero from pasados;

  perform set_config('app.caja_pasaje', 'off', true);

  update businesses set caja_modelo_v2_desde = v_ts where id = p_business_id;

  if not exists (select 1 from turnos where business_id = p_business_id and cerrado_at is null) then
    -- El turno arranca con el primer cobro que pasa: lo de hoy es «de este
    -- turno», no «de antes».
    insert into turnos (business_id, abierto_at)
    values (p_business_id, least(v_ts, coalesce(v_primero - interval '1 microsecond', v_ts)));
  end if;

  return v_pasados;
end;
$function$;

revoke all on function public.pasar_al_modelo_nuevo(uuid) from public, anon, authenticated;
grant execute on function public.pasar_al_modelo_nuevo(uuid) to service_role;

update turnos t
   set abierto_at = x.primero - interval '1 microsecond'
  from (
    select b.id as business_id, min(p.created_at) as primero
      from businesses b
      join payments p on p.business_id = b.id
     where p.rinde_mozo_id is not null
       and p.created_at < b.caja_modelo_v2_desde
     group by b.id
  ) x
 where t.business_id = x.business_id
   and t.cerrado_at is null
   and x.primero - interval '1 microsecond' < t.abierto_at
   and not exists (select 1 from turnos t2 where t2.business_id = t.business_id and t2.cerrado_at is not null);

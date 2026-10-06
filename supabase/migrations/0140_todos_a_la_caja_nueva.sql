-- ────────────────────────────────────────────────────────────────────────
-- 0140 — todos a la caja nueva (spec 210 v2 · R8)
--
-- Decisión de Juan (2026-10-06): «tiene que ser para todos igual con este
-- modelo nuevo». No hay modelo opcional por negocio. Esta migración se aplica
-- JUNTO con el deploy de la app nueva:
--
--   · `pasar_al_modelo_nuevo(negocio)` — el negocio entra al modelo nuevo en
--     este instante. El efectivo que cada mozo cobró y todavía no rindió en el
--     PERÍODO ABIERTO de cada caja pasa a su nombre (`rinde_mozo_id`): el cajón
--     deja de esperarlo y aparece en su saldo. Nadie pierde ni gana un peso.
--     Los períodos ya cerrados y las deudas viejas no se tocan: el arqueo que
--     los firmó ya registró el faltante; pasarlos lo contaría dos veces.
--     Abre el primer turno.
--   · Se corre para todos los negocios que todavía no pasaron.
--   · Los negocios nuevos nacen en el modelo nuevo (`default now()`).
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
    returning p.id
  )
  select count(*) into v_pasados from pasados;

  perform set_config('app.caja_pasaje', 'off', true);

  update businesses set caja_modelo_v2_desde = v_ts where id = p_business_id;

  if not exists (select 1 from turnos where business_id = p_business_id and cerrado_at is null) then
    insert into turnos (business_id, abierto_at) values (p_business_id, v_ts);
  end if;

  return v_pasados;
end;
$function$;

revoke all on function public.pasar_al_modelo_nuevo(uuid) from public, anon, authenticated;
grant execute on function public.pasar_al_modelo_nuevo(uuid) to service_role;

-- Los negocios nuevos nacen en el modelo nuevo, con su turno abierto.
alter table public.businesses alter column caja_modelo_v2_desde set default now();

create or replace function public.trg_negocio_nuevo_abre_turno()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.caja_modelo_v2_desde is not null then
    insert into turnos (business_id, abierto_at) values (new.id, new.caja_modelo_v2_desde);
  end if;
  return new;
end;
$function$;

drop trigger if exists negocio_nuevo_abre_turno on public.businesses;
create trigger negocio_nuevo_abre_turno
  after insert on public.businesses
  for each row execute function public.trg_negocio_nuevo_abre_turno();

-- Todos los que todavía no pasaron.
do $$
declare
  r record;
begin
  for r in select id from businesses where caja_modelo_v2_desde is null loop
    perform public.pasar_al_modelo_nuevo(r.id);
  end loop;
end;
$$;

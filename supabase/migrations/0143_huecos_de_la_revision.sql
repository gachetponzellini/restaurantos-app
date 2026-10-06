-- ────────────────────────────────────────────────────────────────────────
-- 0143 — los huecos de la revisión fresca (spec 210 v2)
--
--   1. Una entrega del mozo (`rendicion`) o la propina que le pagó la caja
--      (`propina`) no se edita, no se mueve y no se anula por la corrección de
--      movimientos del libro (`corregir_movimiento_tx`) ni a mano: la
--      rendición quedaba «rendida» con su movimiento anulado y el saldo del
--      mozo cambiaba sin rastro en su rendición. Se anula sólo con
--      `anular_entrega_tx`, que deja la huella en las dos tablas.
--   2. Una entrega, una propina o una rendición a nombre de alguien que no es
--      del negocio no entra (MOZO_WRONG_BUSINESS). `caja_v2_valida` validaba la
--      caja, no al mozo.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.trg_guarda_movimiento_de_mozo()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.kind not in ('rendicion', 'propina') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    -- Borrar el negocio (o la caja) arrastra sus movimientos en cascada: eso
    -- sí. Un DELETE directo de una entrega, no.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'MOVIMIENTO_DE_MOZO' using errcode = 'P0001';
  end if;
  if new.amount_cents is distinct from old.amount_cents
     or new.caja_id is distinct from old.caja_id
     or new.mozo_id is distinct from old.mozo_id
     or new.kind is distinct from old.kind
     or new.business_id is distinct from old.business_id
     or new.corte_id is distinct from old.corte_id and old.corte_id is not null
     or (new.cancelled_at is distinct from old.cancelled_at
         and coalesce(current_setting('app.caja_anular_entrega', true), '') <> 'on') then
    raise exception 'MOVIMIENTO_DE_MOZO' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists guarda_movimiento_de_mozo on public.caja_movimientos;
create trigger guarda_movimiento_de_mozo
  before update or delete on public.caja_movimientos
  for each row execute function public.trg_guarda_movimiento_de_mozo();

create or replace function public.trg_mozo_del_negocio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.mozo_id is not null and not exists (
       select 1 from business_users bu
        where bu.business_id = new.business_id and bu.user_id = new.mozo_id) then
    raise exception 'MOZO_WRONG_BUSINESS' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists mozo_del_negocio on public.caja_movimientos;
create trigger mozo_del_negocio
  before insert or update of mozo_id, business_id on public.caja_movimientos
  for each row execute function public.trg_mozo_del_negocio();

drop trigger if exists mozo_del_negocio on public.mozo_rendiciones;
create trigger mozo_del_negocio
  before insert or update of mozo_id, business_id on public.mozo_rendiciones
  for each row execute function public.trg_mozo_del_negocio();

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
    select * into v_mov from caja_movimientos where id = v_r.movimiento_id;
    -- Exclusivo sobre la caja, como cerrar_caja_tx: o el cierre ya terminó
    -- (y lo vemos), o espera a que esto termine.
    perform 1 from cajas where id = v_mov.caja_id for update;
    if exists (select 1 from caja_cortes k
                where k.caja_id = v_mov.caja_id and k.created_at > v_mov.created_at) then
      raise exception 'ARQUEO_CERRADO' using errcode = 'P0001';
    end if;
    -- La guarda de 0143 deja anular la entrega sólo por acá.
    perform set_config('app.caja_anular_entrega', 'on', true);
    update caja_movimientos
       set cancelled_at = clock_timestamp(),
           cancelled_reason = v_motivo,
           cancelled_by = p_anulada_por
     where id = v_mov.id;
    perform set_config('app.caja_anular_entrega', 'off', true);
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

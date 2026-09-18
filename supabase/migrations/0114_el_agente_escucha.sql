-- 0114 · El agente escucha (spec 206 · D3)
--
-- Cuando aparece algo para imprimir, la base avisa por Realtime al canal
-- privado `print-agent:<business_id>`. El agente del local está escuchando y
-- hace el pull en el acto, en vez de enterarse en la próxima vuelta del
-- polling (la cola de 10–70 s que la encargada ve en kcc).
--
-- El aviso NO lleva datos: sólo dice «hay algo». El papel lo arma el pull, con
-- la key y el alcance del agente. Por eso el canal no puede filtrar nada.
--
-- Nunca tumba el insert: un aviso perdido lo levanta el latido de 30 s del
-- agente; una cuenta que no se guarda es un bug de caja.

create or replace function public.notify_print_agent(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_business_id is null then
    return;
  end if;
  perform realtime.send(
    jsonb_build_object('at', now()),
    'trabajo',
    'print-agent:' || p_business_id::text,
    true
  );
exception when others then
  raise warning 'notify_print_agent(%): %', p_business_id, sqlerrm;
end;
$$;

revoke all on function public.notify_print_agent(uuid) from public, anon, authenticated;

-- ── comanda_items: la comanda recién es imprimible cuando tiene ítems ───────
-- NO se avisa en el insert de `comandas`: `enviarComanda` crea la comanda y
-- sus ítems en dos viajes y el pull descarta la comanda sin ítems (golf,
-- 2026-08-04, mesa R4). Statement-level: un aviso por sentencia, no por fila.
create or replace function public.trg_comanda_items_avisa_agente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business uuid;
begin
  for v_business in
    select distinct o.business_id
      from nuevas n
      join public.comandas c on c.id = n.comanda_id
      join public.orders o on o.id = c.order_id
  loop
    perform public.notify_print_agent(v_business);
  end loop;
  return null;
exception when others then
  raise warning 'trg_comanda_items_avisa_agente: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists comanda_items_avisa_agente on public.comanda_items;
create trigger comanda_items_avisa_agente
  after insert on public.comanda_items
  referencing new table as nuevas
  for each statement
  execute function public.trg_comanda_items_avisa_agente();

-- ── comandas: reimpresión o vuelta a pendiente ──────────────────────────────
create or replace function public.trg_comandas_avisa_agente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_print_agent(
    (select o.business_id from public.orders o where o.id = new.order_id)
  );
  return null;
exception when others then
  raise warning 'trg_comandas_avisa_agente: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists comandas_avisa_agente on public.comandas;
create trigger comandas_avisa_agente
  after update of reprint_requested_at, status on public.comandas
  for each row
  when (
    (new.reprint_requested_at is not null
      and new.reprint_requested_at is distinct from old.reprint_requested_at)
    or (new.status = 'pendiente' and old.status is distinct from 'pendiente')
  )
  execute function public.trg_comandas_avisa_agente();

-- ── print_jobs: cuenta, control, cierre, rendición, factura, prueba ─────────
create or replace function public.trg_print_jobs_avisa_agente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_print_agent(new.business_id);
  return null;
exception when others then
  raise warning 'trg_print_jobs_avisa_agente: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists print_jobs_avisa_agente_insert on public.print_jobs;
create trigger print_jobs_avisa_agente_insert
  after insert on public.print_jobs
  for each row
  execute function public.trg_print_jobs_avisa_agente();

drop trigger if exists print_jobs_avisa_agente_update on public.print_jobs;
create trigger print_jobs_avisa_agente_update
  after update of reprint_requested_at, status on public.print_jobs
  for each row
  when (
    (new.reprint_requested_at is not null
      and new.reprint_requested_at is distinct from old.reprint_requested_at)
    or (new.status = 'pendiente' and old.status is distinct from 'pendiente')
  )
  execute function public.trg_print_jobs_avisa_agente();

-- ── Quién puede escuchar ─────────────────────────────────────────────────────
-- Sólo el usuario de Auth del agente (spec 206 · D3), y sólo el canal de SU
-- negocio: `app_metadata` lo escribe únicamente el service role. No hay policy
-- de insert: publicar lo hace la base.
drop policy if exists "print agent escucha su negocio" on realtime.messages;
create policy "print agent escucha su negocio"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'print-agent:' || (auth.jwt() -> 'app_metadata' ->> 'business_id')
  );

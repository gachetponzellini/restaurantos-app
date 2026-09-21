-- ────────────────────────────────────────────────────────────────────────
-- 0127 — el envío a cocina es todo o nada (issue #126)
--
-- `createComandasForItems` (src/lib/comandas/route-items.ts) creaba una
-- comanda por sector en un loop de TS, con dos inserts sueltos por sector y
-- sin transacción. Si fallaba el sector N, los sectores 1..N-1 ya estaban
-- creados — y el print-agent los imprimía: la parrilla arrancaba un bife que
-- salía con minutos de ventaja sobre el resto del plato, y el mozo, que vio el
-- error, reenviaba.
--
-- Esta función hace el mismo ruteo en una sola transacción: o se crean todas
-- las comandas con sus ítems, o ninguna. Además, como el aviso al agente
-- (trigger `comanda_items_avisa_agente`) recién se ve al commit, el agente no
-- puede encontrar una comanda a medio crear.
--
-- Semántica idéntica a la versión TS:
-- - `p_grupos` = [{ "station_id": uuid, "order_item_ids": [uuid, …] }, …],
--   en el orden en que se devuelven los ids. Un grupo sin ítems se saltea.
-- - Sin `p_primera_ruteada`, el batch es max(batch)+1 dentro de
--   (order, station). Un choque con el unique aborta todo el envío.
-- - Con `p_primera_ruteada` (confirmar un pedido online, issue #259) el batch
--   es 1 y el unique arbitra: si ese sector ya tiene su batch 1, se saltea
--   sin error (idempotencia), igual que el `continue` sobre 23505.
-- - `p_notes` se copia igual en todas las comandas del envío (spec 128).
-- - `emitted_at` = clock_timestamp(), NO el default now(): now() es el mismo
--   para toda la transacción y las comandas del envío empatarían. El agente y
--   los tableros ordenan por `emitted_at`, y antes salían en el orden del
--   envío (ms de diferencia): se conserva.
--
-- Sólo la llama el server con service_role (igual que antes los inserts).
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.crear_comandas_tx(
  p_order_id uuid,
  p_grupos jsonb,
  p_primera_ruteada boolean default false,
  p_notes text default null
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_grupo jsonb;
  v_station uuid;
  v_items uuid[];
  v_batch integer;
  v_comanda_id uuid;
  v_ids uuid[] := '{}';
begin
  for v_grupo in
    select g.value
      from jsonb_array_elements(coalesce(p_grupos, '[]'::jsonb)) with ordinality as g(value, ord)
     order by g.ord
  loop
    v_station := (v_grupo ->> 'station_id')::uuid;
    select coalesce(array_agg(x::uuid), '{}')
      into v_items
      from jsonb_array_elements_text(coalesce(v_grupo -> 'order_item_ids', '[]'::jsonb)) as x;

    if cardinality(v_items) = 0 then
      continue;
    end if;

    v_comanda_id := null;

    if p_primera_ruteada then
      insert into comandas (order_id, station_id, batch, status, notes, emitted_at)
      values (p_order_id, v_station, 1, 'pendiente', p_notes, clock_timestamp())
      on conflict (order_id, station_id, batch) do nothing
      returning id into v_comanda_id;

      if v_comanda_id is null then
        continue;
      end if;
    else
      select coalesce(max(batch), 0) + 1
        into v_batch
        from comandas
       where order_id = p_order_id
         and station_id = v_station;

      insert into comandas (order_id, station_id, batch, status, notes, emitted_at)
      values (p_order_id, v_station, v_batch, 'pendiente', p_notes, clock_timestamp())
      returning id into v_comanda_id;
    end if;

    insert into comanda_items (comanda_id, order_item_id)
    select v_comanda_id, unnest(v_items);

    v_ids := v_ids || v_comanda_id;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.crear_comandas_tx(uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.crear_comandas_tx(uuid, jsonb, boolean, text) to service_role;

comment on function public.crear_comandas_tx(uuid, jsonb, boolean, text) is
  'Ruteo de un envío a cocina en una sola transacción: una comanda por sector con sus comanda_items, o ninguna (issue #126).';

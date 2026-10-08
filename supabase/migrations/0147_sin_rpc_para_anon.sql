-- ────────────────────────────────────────────────────────────────────────
-- 0147 — nadie sin login llama funciones de `public` (SEC-04, restaurantos-brain#39)
--
-- La publishable key viaja en el bundle, así que `anon` es «cualquiera».
-- Postgres le da EXECUTE a PUBLIC sobre toda función nueva y el default de
-- Supabase además se lo da explícito a `anon`. Las RPCs de la app se fueron
-- cerrando una por una; quedaban 27 abiertas, y una con filo:
-- `fn_stock_reversion_item` es SECURITY DEFINER, no mira quién llama y
-- devuelve al inventario lo que consumió una línea de pedido. Con un
-- `order_item_id` cualquiera inflaba el stock (y bajaba el CMV, que resta
-- reversiones), y la anulación legítima posterior ya no devolvía nada por la
-- idempotencia.
--
-- authenticated conserva su grant explícito: las policies RLS usan
-- `is_business_*` y revocar de PUBLIC no lo toca.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1) Funciones comunes: fuera anon (y PUBLIC) ─────────────────────────
revoke execute on function
  public.fn_stock_reversion_item(uuid),
  public.is_platform_admin(),
  public.is_business_admin(uuid),
  public.is_business_manager(uuid),
  public.is_business_member(uuid),
  public.fn_explode_ingredient(uuid, numeric),
  public.fn_factor_merma(numeric),
  public.fn_ingredient_cost_per_unit(uuid),
  public.operating_day(timestamptz),
  public.normalizar_nombre_proveedor(text),
  public.normalizar_texto_insumo(text)
from public, anon;

-- La reversión sólo la disparan los triggers de `order_items`/`orders`, que son
-- SECURITY DEFINER: corren como dueño y no necesitan el grant del que dispara.
revoke execute on function public.fn_stock_reversion_item(uuid) from authenticated;

-- ── 2) Funciones de trigger: no se exponen en /rest/v1/rpc (igual que 0144) ──
-- Un trigger corre igual sin EXECUTE para el rol que lo dispara.
revoke execute on function
  public.caja_default_si_no_hay(),
  public.ensure_caja_administrativa(),
  public.ensure_default_expense_concepts(),
  public.fn_product_price_change_log(),
  public.fn_stock_delta_on_item_edit(),
  public.fn_stock_reversion_on_item_cancel(),
  public.trg_comanda_items_avisa_agente(),
  public.trg_comandas_avisa_agente(),
  public.trg_entra_a_la_caja(),
  public.trg_item_no_deja_total_bajo_lo_cobrado(),
  public.trg_print_jobs_avisa_agente(),
  public.trg_total_no_baja_de_lo_cobrado(),
  public.set_order_daily_number(),
  public.set_order_number(),
  public.set_supplier_payment_numero(),
  public.set_updated_at()
from public, anon, authenticated;

-- ── 3) Lo que venga, nace cerrado para anon ──────────────────────────────
-- Una RPC nueva que sí deba verla un anónimo necesita su `grant ... to anon`
-- explícito. authenticated y service_role siguen recibiéndolo por default.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ── 4) La reversión, con guarda propia ───────────────────────────────────
-- Defensa en profundidad por si un grant vuelve: llamada DIRECTA por la API
-- (pg_trigger_depth() = 0 y JWT de anon/authenticated) exige ser staff del
-- negocio del ítem. Desde un trigger, desde el service role o desde SQL de
-- mantenimiento (reintento manual) no cambia nada.
-- Cuerpo = versión vigente de 0087 + la guarda.
create or replace function public.fn_stock_reversion_item(p_order_item_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'pg_catalog', 'public'
as $$
declare
  v_item record;
  v_stock_item_id uuid;
  v_stock_business_id uuid;
  r record;
  leaf record;
begin
  select oi.id,
         oi.product_id,
         oi.quantity,
         oi.kitchen_status,
         oi.cancelled_reason,
         o.business_id
    into v_item
    from order_items oi
    join orders o on o.id = oi.order_id
   where oi.id = p_order_item_id;

  -- `found` y no `v_item is null`: sobre un record, `is null` sólo da true si
  -- **todos** los campos son null, que no es la pregunta que queremos hacer.
  if not found or v_item.product_id is null then
    return;
  end if;

  -- SEC-04: por la API, sólo el staff del negocio del ítem.
  if pg_trigger_depth() = 0
     and coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not public.is_business_staff(v_item.business_id) then
    raise exception 'sin permiso para revertir stock de este negocio'
      using errcode = '42501';
  end if;

  -- La comida que ya salió no vuelve al inventario (ver 0039). Se deja tal cual
  -- estaba: la fila sigue siendo una `venta`.
  if v_item.kitchen_status = 'delivered' then
    return;
  end if;

  -- Lo que ya se mandó a la cocina tampoco vuelve — pero acá sí se marca por
  -- qué se fue. La fila de consumo que el descuento ya escribió cambia de
  -- `venta` a `merma`: misma cantidad, mismo costo, mismo lugar en el CMV, y
  -- ahora visible como pérdida en vez de como plato vendido.
  if v_item.kitchen_status <> 'pending' then
    update ingredient_consumptions
       set kind = 'merma',
           reason = coalesce(nullif(btrim(v_item.cancelled_reason), ''), 'Línea cancelada')
     where order_item_id = p_order_item_id
       and kind = 'venta';

    update stock_movimientos
       set kind = 'merma',
           reason = coalesce(nullif(btrim(v_item.cancelled_reason), ''), 'Línea cancelada')
     where order_item_id = p_order_item_id
       and kind = 'venta';

    return;
  end if;

  -- Idempotencia del camino que SÍ devuelve.
  if exists (
    select 1 from ingredient_consumptions
     where order_item_id = p_order_item_id and kind = 'reversion'
  ) or exists (
    select 1 from stock_movimientos
     where order_item_id = p_order_item_id and kind = 'reversion'
  ) then
    return;
  end if;

  -- ── Productos con stock propio (bebidas y demás `track_stock`) ──
  if exists (
    select 1 from products where id = v_item.product_id and track_stock = true
  ) then
    select si.id, si.business_id
      into v_stock_item_id, v_stock_business_id
      from stock_items si
     where si.product_id = v_item.product_id;

    if v_stock_item_id is null then
      return;
    end if;

    update stock_items
       set current_qty = current_qty + v_item.quantity,
           updated_at = now()
     where id = v_stock_item_id;

    insert into stock_movimientos
      (stock_item_id, business_id, kind, qty, order_item_id, reason)
    values
      (v_stock_item_id, v_stock_business_id, 'reversion', v_item.quantity,
       p_order_item_id, 'Línea cancelada');

    -- Spec 099: el reencendido automático se fue con el apagado automático.
    return;
  end if;

  -- ── Productos con receta ──
  for r in
    select rec.ingredient_id, rec.quantity
      from recipes rec
     where rec.product_id = v_item.product_id
  loop
    for leaf in
      select * from fn_explode_ingredient(r.ingredient_id, r.quantity * v_item.quantity)
    loop
      update ingredients
         set stock_quantity = stock_quantity + leaf.leaf_quantity,
             updated_at = now()
       where id = leaf.leaf_ingredient_id;

      insert into ingredient_consumptions
        (business_id, ingredient_id, order_item_id, quantity, cost_cents_snapshot, kind)
      values (
        v_item.business_id,
        leaf.leaf_ingredient_id,
        p_order_item_id,
        leaf.leaf_quantity,
        round(leaf.leaf_cost_per_unit * leaf.leaf_quantity)::integer,
        'reversion'
      );
    end loop;
  end loop;
end;
$$;

-- `create or replace` conserva los grants, pero se reafirma por si en algún
-- entorno la función se creó de cero con los defaults.
revoke execute on function public.fn_stock_reversion_item(uuid) from public, anon, authenticated;

-- ── 5) search_path fijo (advisor 0011) ───────────────────────────────────
-- Sólo usan built-ins y `public.normalizar_texto_insumo`, ya calificada.
alter function public.normalizar_texto_insumo(text) set search_path = pg_catalog, public;
alter function public.normalizar_nombre_proveedor(text) set search_path = pg_catalog, public;

-- ── 6) Backups del import fuera de `public` ──────────────────────────────
-- Copias a mano del import de MaxiRest y de dos cambios masivos de precios. Con
-- RLS y sin policies no se leían por la API, pero `_mxemp` tiene datos de
-- empleados y nada del producto las usa. Se archivan (no se borran) en un
-- schema que PostgREST no expone y donde anon/authenticated no tienen acceso.
-- `if exists`: no viven en ninguna migración, sólo en el cloud.
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

alter table if exists public._price_backup_20260728 set schema archive;
alter table if exists public._mx_precios_20260528 set schema archive;
alter table if exists public._menufacil set schema archive;
alter table if exists public._mxemp set schema archive;

comment on schema archive is
  'Backups manuales fuera de la API (0147, SEC-04). Sin acceso para anon/authenticated.';

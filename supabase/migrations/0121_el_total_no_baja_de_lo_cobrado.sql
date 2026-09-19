-- ────────────────────────────────────────────────────────────────────────
-- 0121 — el total de una cuenta no baja de lo cobrado (issue #357, #361)
--
-- Sacar un ítem, cambiar la propina o aplicar un descuento después de un
-- cobro parcial podía dejar `total_cents` por debajo de lo ya pagado. La
-- cuenta quedaba abierta para siempre —cobrar respondía «ya está pagada» y
-- nada la cerraba— y la mesa abierta trababa el cierre de caja.
--
-- Hay al menos cinco caminos que tocan ítems o totales (cuenta, kanban,
-- edición de ítem, recompute, propina/descuento). Una guarda en cada action
-- se olvida en la sexta; ésta vive en la base:
--
--   · `orders`: un UPDATE que baje `total_cents` por debajo de lo cobrado
--     (en base, 0117) se rechaza con TOTAL_BELOW_PAID.
--   · `order_items`: cancelar, borrar o abaratar un ítem se rechaza ANTES de
--     escribir si el total resultante quedaría por debajo — así el ítem no
--     queda cancelado con el total viejo.
--
-- Una cuenta que se cancela entera (`status = 'cancelled'`) no pasa por acá:
-- su plata la resuelven las guardas de la cancelación.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.cobrado_en_base(p_order_id uuid)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(sum(amount_cents - coalesce(adjustment_cents, 0)), 0)::bigint
    from payments
   where order_id = p_order_id and payment_status = 'paid';
$function$;

revoke all on function public.cobrado_en_base(uuid) from public, anon, authenticated;
grant execute on function public.cobrado_en_base(uuid) to service_role;

-- ── orders ──────────────────────────────────────────────────────────────────

create or replace function public.trg_total_no_baja_de_lo_cobrado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cobrado bigint;
begin
  if new.status = 'cancelled' or new.lifecycle_status = 'cancelled' then
    return new;
  end if;
  if new.total_cents >= old.total_cents then
    return new;
  end if;
  v_cobrado := public.cobrado_en_base(new.id);
  if v_cobrado > 0 and new.total_cents < v_cobrado then
    raise exception 'TOTAL_BELOW_PAID:%', v_cobrado using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists total_no_baja_de_lo_cobrado on public.orders;
create trigger total_no_baja_de_lo_cobrado
  before update of total_cents on public.orders
  for each row execute function public.trg_total_no_baja_de_lo_cobrado();

-- ── order_items ─────────────────────────────────────────────────────────────

create or replace function public.trg_item_no_deja_total_bajo_lo_cobrado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_order    orders%rowtype;
  v_cobrado  bigint;
  v_sub      bigint;
  v_total    bigint;
begin
  select * into v_order from orders where id = v_order_id;
  if not found or v_order.status = 'cancelled' or v_order.lifecycle_status = 'cancelled' then
    return coalesce(new, old);
  end if;
  v_cobrado := public.cobrado_en_base(v_order_id);
  if v_cobrado = 0 then
    return coalesce(new, old);
  end if;

  -- El subtotal como quedaría: los otros ítems vivos + éste si sigue vivo.
  select coalesce(sum(subtotal_cents), 0) into v_sub
    from order_items
   where order_id = v_order_id and cancelled_at is null and id <> old.id;
  if tg_op = 'UPDATE' and new.cancelled_at is null then
    v_sub := v_sub + new.subtotal_cents;
  end if;

  v_total := greatest(
    v_sub + v_order.tip_cents + coalesce(v_order.delivery_fee_cents, 0)
          - coalesce(v_order.discount_cents, 0),
    0);
  if v_total < v_cobrado and v_total < v_order.total_cents then
    raise exception 'TOTAL_BELOW_PAID:%', v_cobrado using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists item_no_deja_total_bajo_lo_cobrado on public.order_items;
create trigger item_no_deja_total_bajo_lo_cobrado
  before update of cancelled_at, subtotal_cents or delete on public.order_items
  for each row execute function public.trg_item_no_deja_total_bajo_lo_cobrado();

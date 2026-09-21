-- ────────────────────────────────────────────────────────────────────────
-- 0130 — el cupón vuelve cuando se cancela el pedido (auditoría de pedidos · media)
--
-- `promo_codes.uses_count` sube al crear el pedido (`increment_promo_use`) y no
-- bajaba nunca: un pedido de MP que nadie pagó, uno que venció o uno que el
-- cliente canceló consumía el cupón. Un cupón de un solo uso quedaba gastado
-- sin compra, y se podía agotar `max_uses` sin pagar nada.
--
-- `devolver_uso_promo(order_id)` marca la orden y resta el uso en la MISMA
-- transacción, y sólo la primera vez (`promo_use_returned_at is null`): la
-- cascada de cancelación puede correr más de una vez sin restar de más.
-- ────────────────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists promo_use_returned_at timestamptz;

comment on column public.orders.promo_use_returned_at is
  'Cuándo se le devolvió el uso al cupón (promo_code_id) por cancelar el pedido. Null = no se devolvió (o no tenía cupón).';

create or replace function public.devolver_uso_promo(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_promo uuid;
  v_business uuid;
begin
  update orders
     set promo_use_returned_at = now()
   where id = p_order_id
     and promo_code_id is not null
     and promo_use_returned_at is null
  returning promo_code_id, business_id into v_promo, v_business;

  if v_promo is null then
    return false;
  end if;

  update promo_codes
     set uses_count = greatest(0, uses_count - 1)
   where id = v_promo
     and business_id = v_business;

  return true;
end;
$$;

revoke all on function public.devolver_uso_promo(uuid) from public, anon, authenticated;
grant execute on function public.devolver_uso_promo(uuid) to service_role;

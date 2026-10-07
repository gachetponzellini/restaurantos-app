-- ────────────────────────────────────────────────────────────────────────
-- 0146 — lo cobrado y entregado no se anula (spec 212 · R1, #385)
--
-- Decisión de Juan (2026-10-07): «el sistema no debería dejar anular el pago y
-- recibir el pedido… tiene que ser rígido». El pago de un pedido cerrado
-- (entregado y cobrado) no se anula —ni una línea (anular_pago_tx), ni el cobro
-- entero (anular_cobro_tx, que reabría el pedido), ni con un UPDATE a mano—:
-- se CORRIGE (método, caja, mozo, monto), que no deja el pedido sin cobrar.
--
-- Va en triggers para que valga por cualquier camino. Excepción: los cobros de
-- Mercado Pago que devuelve la pasarela (devolución o contracargo, R3): ésos no
-- se pueden frenar, y el pedido queda anulado.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.trg_cobro_cerrado_no_se_anula()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.payment_status = 'paid'
     and new.payment_status = 'refunded'
     and old.method not in ('mp_link', 'mp_qr')
     and exists (select 1 from orders o where o.id = old.order_id and o.lifecycle_status = 'closed') then
    raise exception 'COBRO_CERRADO_NO_SE_ANULA' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists cobro_cerrado_no_se_anula on public.payments;
create trigger cobro_cerrado_no_se_anula
  before update of payment_status on public.payments
  for each row execute function public.trg_cobro_cerrado_no_se_anula();

create or replace function public.trg_pedido_cerrado_no_se_reabre()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.lifecycle_status = 'closed' and new.lifecycle_status = 'open' then
    raise exception 'COBRO_CERRADO_NO_SE_ANULA' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists pedido_cerrado_no_se_reabre on public.orders;
create trigger pedido_cerrado_no_se_reabre
  before update of lifecycle_status on public.orders
  for each row execute function public.trg_pedido_cerrado_no_se_reabre();

revoke execute on function public.trg_cobro_cerrado_no_se_anula() from public, anon, authenticated;
revoke execute on function public.trg_pedido_cerrado_no_se_reabre() from public, anon, authenticated;

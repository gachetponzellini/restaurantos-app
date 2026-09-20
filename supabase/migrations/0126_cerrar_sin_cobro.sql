-- ────────────────────────────────────────────────────────────────────────
-- 0126 — cerrar sin cobro: la mesa de $0 (decisión de Juan, 2026-09-20 · #362)
--
-- Una cortesía total —100 % de descuento del admin, o platos cargados a $0—
-- deja la cuenta en $0. Una cuenta en $0 no se cobra (no hay pago de $0) y
-- nunca se daba por saldada, así que la mesa quedaba abierta y trababa el
-- cierre de caja. La única salida era «Anular mesa», que CANCELA la orden: la
-- venta desaparecía del día, el stock volvía a la heladera aunque la comida se
-- hubiera servido, y no quedaba registrado que se invitó ni quién lo decidió.
--
-- «Cerrar sin cobro» cierra la orden como entregada, sin pago ni comprobante
-- (la base facturable es $0: no hay nada que declarar), con el stock
-- descontado, y deja escrito por qué, quién y cuánto valía de carta.
-- ────────────────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists cortesia_reason text,
  add column if not exists cortesia_by uuid references auth.users(id) on delete set null,
  add column if not exists cortesia_valor_cents bigint;

alter table public.orders drop constraint if exists orders_cortesia_valor_check;
alter table public.orders add constraint orders_cortesia_valor_check
  check (cortesia_valor_cents is null or cortesia_valor_cents >= 0);

comment on column public.orders.cortesia_reason is
  'Cuenta cerrada SIN cobro por ser una invitación total ($0). Motivo obligatorio. Null en toda orden que se cobró.';
comment on column public.orders.cortesia_valor_cents is
  'Lo que valía de carta lo que se invitó (precio original × cantidad de los ítems vivos), congelado al cerrar: es lo que el dueño mira en el resumen del día.';

create index if not exists orders_cortesia_idx
  on public.orders (business_id, closed_at desc)
  where cortesia_reason is not null;

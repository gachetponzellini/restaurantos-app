-- ────────────────────────────────────────────────────────────────────────
-- 0129 — las facturas viejas pendientes rotan en la conciliación (#148 · H-43)
--
-- El cron de conciliación consulta un lote de facturas `pending` viejas por
-- tick (limit 5). Estaba ordenado FIFO por `created_at`: cinco facturas cuyo
-- job el gateway contesta 404 para siempre (quedan `pending` a propósito —sin
-- respuesta no se sabe si tienen CAE) ocupaban los cinco cupos en cada tick, y
-- ninguna otra vieja se volvía a consultar: el cliente nunca recibía su
-- comprobante y «Pendientes» subía sin explicación.
--
-- `last_polled_at` es el sello de la última consulta. El lote se ordena por él
-- (las nunca consultadas primero) y así rota. Aditiva: no toca datos.
-- ────────────────────────────────────────────────────────────────────────

alter table public.invoices
  add column if not exists last_polled_at timestamptz;

comment on column public.invoices.last_polled_at is
  'Última vez que el cron de conciliación le preguntó al gateway por esta factura. Ordena el lote de pendientes viejas para que roten (#148 · H-43). Null = nunca consultada.';

create index if not exists invoices_pending_gateway_poll_idx
  on public.invoices (last_polled_at asc nulls first, created_at asc)
  where status = 'pending' and provider = 'gateway';

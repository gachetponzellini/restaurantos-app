-- ────────────────────────────────────────────────────────────────────────
-- 0146 — la liquidación del mozo sale al tocar «Rendir» (spec 213, #386)
--
-- Es un papel nuevo en la cola de la comandera: `kind = 'liquidacion'`. A
-- diferencia del papel de una rendición (que sale de `mozo_rendiciones`), éste
-- se imprime ANTES de que exista la rendición, así que guarda la foto de los
-- números en `payload` y, para no imprimirlo dos veces con el mismo saldo
-- (D2), el mozo, la caja y la `huella` de su saldo (huella_mozo, 0139).
-- ────────────────────────────────────────────────────────────────────────

alter table public.print_jobs
  add column if not exists mozo_id uuid references public.users(id) on delete set null,
  add column if not exists caja_id uuid references public.cajas(id) on delete cascade,
  add column if not exists huella text,
  add column if not exists payload jsonb;

alter table public.print_jobs drop constraint if exists print_jobs_kind_check;
alter table public.print_jobs
  add constraint print_jobs_kind_check
  check (kind = any (array['control', 'cuenta', 'factura', 'cierre', 'prueba', 'rendicion', 'liquidacion']));

alter table public.print_jobs drop constraint if exists print_jobs_target_check;
alter table public.print_jobs
  add constraint print_jobs_target_check
  check (
    (kind = any (array['control', 'cuenta']) and order_id is not null)
    or (kind = 'factura' and invoice_id is not null)
    or (kind = 'cierre' and corte_id is not null)
    or (kind = 'prueba' and test_printer_ip is not null)
    or (kind = 'rendicion' and rendicion_id is not null)
    or (kind = 'liquidacion' and payload is not null and mozo_id is not null and caja_id is not null)
  );

create index if not exists print_jobs_liquidacion_idx
  on public.print_jobs (business_id, mozo_id, caja_id, huella)
  where kind = 'liquidacion';

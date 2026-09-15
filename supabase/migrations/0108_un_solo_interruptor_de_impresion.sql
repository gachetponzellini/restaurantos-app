-- ────────────────────────────────────────────────────────────────────────
-- 0108 — un solo interruptor para apagar toda la impresión (spec 185)
--
-- Hoy apagar la impresión de un negocio son cuatro switches distintos:
-- `stations.printer_enabled` (por sector), `businesses.control_printer_enabled`,
-- `businesses`/`floor_plans.cuenta_printer_enabled` (por salón) y
-- `cajas.fiscal_printer_enabled` (por caja). Útil para un local que todavía no
-- tiene comanderas instaladas (onboarding) o un corte de emergencia.
--
-- Este flag es un OR maestro por encima, no un reemplazo: en `false`, el
-- `GET /api/print-agent` devuelve `comandas: []` sin importar lo que haya
-- pendiente. No toca ninguno de los switches existentes — al reactivarlo,
-- cada impresora vuelve exactamente a su config de antes.
-- ────────────────────────────────────────────────────────────────────────

alter table "public"."businesses"
  add column if not exists "printing_enabled" boolean not null default true;

comment on column "public"."businesses"."printing_enabled" is
  'Spec 185: interruptor único que apaga TODA la impresión del negocio (comandas + control + cuenta + factura) sin tocar la config de cada impresora.';

-- Spec 203 · D4 — la rendición guarda esperado / entregado / diferencia por canal
-- (salon, takeaway, delivery). Las columnas de siempre siguen con el total, así
-- el reparto del arqueo y el cierre no cambian. Las filas viejas quedan en '{}'.
alter table public.mozo_rendiciones
  add column if not exists por_canal jsonb not null default '{}'::jsonb;

comment on column public.mozo_rendiciones.por_canal is
  'Spec 203: {canal: {esperado_cents, entregado_cents, diferencia_cents}} por salon/takeaway/delivery.';

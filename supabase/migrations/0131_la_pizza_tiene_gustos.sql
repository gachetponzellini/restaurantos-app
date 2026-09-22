-- ────────────────────────────────────────────────────────────────────────
-- 0131 — la pizza tiene gustos (spec 207 · #373)
--
-- Un grupo de adicionales marcado como variante ya no suma «+$X»: cada opción
-- es una versión del producto con su precio final (base + delta). Así kcc tiene
-- un solo ítem «Pizza» con sus gustos, y apagarlo corta todas las pizzas juntas.
--
-- Opt-in: default false, los grupos existentes no cambian. La forma del grupo
-- (obligatorio, 1-1, uno por producto) la valida Zod en el borde. RLS no
-- cambia: la columna vive en una tabla que ya está scopeada por business_id.
-- ────────────────────────────────────────────────────────────────────────

alter table public.modifier_groups
  add column if not exists is_variant boolean not null default false;

comment on column public.modifier_groups.is_variant is
  'Spec 207: las opciones son variantes del producto (precio final = base + delta), no adicionales.';

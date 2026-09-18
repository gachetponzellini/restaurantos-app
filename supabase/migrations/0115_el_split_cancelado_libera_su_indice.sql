-- ============================================================================
-- 0115 — La sub-cuenta cancelada libera su número
--
-- `deleteSplitsAndItems` no borra las sub-cuentas que tuvieron pagos: las deja
-- `cancelled` como rastro de a qué se imputó la plata. Pero seguían ocupando su
-- `split_index`, y la nueva división (que numera desde 1) chocaba con
-- `UNIQUE (order_id, split_index)` → "duplicate key" al re-dividir.
--
-- La unicidad sólo importa entre sub-cuentas vivas: índice único parcial.
-- ============================================================================

alter table "public"."order_splits"
  drop constraint if exists "order_splits_order_id_split_index_key";

create unique index if not exists "order_splits_order_id_split_index_activo_key"
  on "public"."order_splits" ("order_id", "split_index")
  where "status" <> 'cancelled';

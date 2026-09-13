-- ────────────────────────────────────────────────────────────────────────
-- 0105 — varias comanderas por producto (spec 180)
--
-- Lo que KCC llamaba «comandera maestra» es configuración de MaxiRest: hasta
-- tres comanderas por artículo. Cocina «sale con todo» porque es la 2ª de cada
-- plato; a la Heineken no le pusieron ninguna. El relevamiento de KCC ya lo
-- tenía como gap #1: 96 artículos (29%) imprimen en 2 o 3 comanderas.
--
-- `station_id` sigue siendo la 1ª: el sector principal, el que cocina, el
-- único que mueve el estado del ítem. Las extras reciben su propia comanda.
--
-- Arrays y no una tabla aparte: son dos valores como máximo, se leen en cada
-- ruteo junto a `station_id`, y heredan las policies que las tablas ya tienen.
-- El costo —sin FK— lo paga `eliminarSector`, que los limpia con array_remove.
-- ────────────────────────────────────────────────────────────────────────

alter table "public"."categories"
  add column if not exists "extra_station_ids" uuid[] not null default '{}';

comment on column "public"."categories"."extra_station_ids" is
  'Spec 180: 2ª y 3ª comandera por default para los productos del rubro. El principal sigue en station_id.';

alter table "public"."products"
  add column if not exists "extra_station_ids" uuid[],
  add column if not exists "sin_comanda" boolean not null default false;

comment on column "public"."products"."extra_station_ids" is
  'Spec 180: 2ª y 3ª comandera. null = hereda de la categoría; {} = ninguna extra. El principal sigue en station_id.';
comment on column "public"."products"."sin_comanda" is
  'Spec 180: no imprime comanda en ningún sector, aunque la categoría tenga. La Heineken, y los postres que la categoría mandaba a cocina sin querer.';

-- Hasta tres comanderas en total, como MaxiRest: dos extras.
alter table "public"."categories"
  drop constraint if exists "categories_extra_station_ids_check";
alter table "public"."categories"
  add constraint "categories_extra_station_ids_check"
  check (coalesce(array_length("extra_station_ids", 1), 0) <= 2);

alter table "public"."products"
  drop constraint if exists "products_extra_station_ids_check";
alter table "public"."products"
  add constraint "products_extra_station_ids_check"
  check ("extra_station_ids" is null or coalesce(array_length("extra_station_ids", 1), 0) <= 2);

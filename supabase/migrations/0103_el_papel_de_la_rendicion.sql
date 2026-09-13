-- ────────────────────────────────────────────────────────────────────────
-- 0103 — el papel de la rendición (spec 178)
--
-- La 139 dejó UN papel por noche —el del corte, que va al sobre—. Cuando el
-- mozo entrega su efectivo no se lleva nada: lo que entregó, lo que le faltó,
-- lo que se le pagó de propina (177) queda en `mozo_rendiciones` y en ninguna
-- mano. Pedido de KCC (2026-09-09): *"un ticket chiquito por cada empleado,
-- opcional tocando un btn"*.
--
-- Sexto `kind` de `print_jobs`, colgado de la rendición. Uno por rendición y
-- reimprimir re-sella la misma fila (139 · D8): apretar dos veces no imprime
-- dos veces.
--
-- ## `propina_pagada_cents`
--
-- Desde la 177 la rendición paga la propina con un movimiento de caja. Ese
-- monto no está en la fila de la rendición: para el papel habría que buscarlo
-- en el libro por `(mozo_id, created_at)`, un join por coincidencia de
-- timestamp. Se guarda acá, escrito por la misma action en la misma pasada.
-- Duplica un número a propósito, por el mismo motivo que `por_metodo` duplica
-- `payments`: el papel se firma, y lo que se firma no se recalcula.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1) La propina pagada, en el snapshot ────────────────────────────────────

alter table "public"."mozo_rendiciones"
  add column if not exists "propina_pagada_cents" bigint not null default 0;

alter table "public"."mozo_rendiciones"
  drop constraint if exists "mozo_rendiciones_propina_pagada_check";
alter table "public"."mozo_rendiciones"
  add constraint "mozo_rendiciones_propina_pagada_check"
  check ("propina_pagada_cents" >= 0);

comment on column "public"."mozo_rendiciones"."propina_pagada_cents" is
  'Spec 178: lo que se le pagó de propina en esta rendición (spec 177), congelado para el papel. El movimiento de caja es la verdad contable; esto es lo que se firmó.';

-- Backfill best-effort: las rendiciones registradas desde la 177 tienen su
-- movimiento con el MISMO `created_at` (la action usa un solo `corteIso` para
-- las dos filas). Las anteriores no pagaron nada y quedan en 0.
update "public"."mozo_rendiciones" r
   set "propina_pagada_cents" = m."amount_cents"
  from "public"."caja_movimientos" m
 where m."kind" = 'propina'
   and m."mozo_id" = r."mozo_id"
   and m."business_id" = r."business_id"
   and m."created_at" = r."created_at"
   and m."cancelled_at" is null
   and r."propina_pagada_cents" = 0;

-- ── 2) El papel ─────────────────────────────────────────────────────────────

alter table "public"."print_jobs"
  add column if not exists "rendicion_id" uuid
    references "public"."mozo_rendiciones"("id") on delete cascade;

alter table "public"."print_jobs"
  drop constraint if exists "print_jobs_kind_check";
alter table "public"."print_jobs"
  add constraint "print_jobs_kind_check"
  check ("kind" in ('control', 'cuenta', 'factura', 'cierre', 'prueba', 'rendicion'));

alter table "public"."print_jobs"
  drop constraint if exists "print_jobs_target_check";
alter table "public"."print_jobs"
  add constraint "print_jobs_target_check"
  check (
    ("kind" = any (array['control'::text, 'cuenta'::text]) and "order_id" is not null)
    or ("kind" = 'factura'::text   and "invoice_id"      is not null)
    or ("kind" = 'cierre'::text    and "corte_id"        is not null)
    or ("kind" = 'prueba'::text    and "test_printer_ip" is not null)
    or ("kind" = 'rendicion'::text and "rendicion_id"    is not null)
  );

-- UN papel por rendición: la reimpresión re-sella, no inserta (139 · D8).
create unique index if not exists "print_jobs_rendicion_uniq"
  on "public"."print_jobs" ("rendicion_id")
  where "kind" = 'rendicion';

comment on column "public"."print_jobs"."kind" is
  'control = uno por orden, lo emite la marcha a cocina. cuenta = las veces que la mesa la pida. factura = copia impresa de un comprobante autorizado. cierre = el papel del corte de caja. prueba = papel de prueba de una comandera (spec 176). rendicion = el papel del mozo al rendir, a pedido (spec 178).';

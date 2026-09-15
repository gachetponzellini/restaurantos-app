-- ────────────────────────────────────────────────────────────────────────
-- 0109 — el interruptor es sólo de cocina (spec 185, corrección)
--
-- La `0108` apagaba las SEIS familias de papel de un saque (comandas +
-- control + cuenta + factura + cierre + rendición). Juan lo acotó: lo que
-- molesta son las comandas de cocina —eso es lo que se quiere poder apagar de
-- un tirón, sin tocar control/cuenta/factura, que siguen su propio switch.
--
-- Sólo el nombre cambia (mismo default `true`, misma columna): de
-- `printing_enabled` a `comandas_printer_enabled`, para que el nombre no
-- prometa más de lo que hace. La columna se agregó hace minutos, sin uso real
-- todavía (todo negocio en `true`) — un rename es seguro, no hace falta
-- backfill.
-- ────────────────────────────────────────────────────────────────────────

alter table "public"."businesses"
  rename column "printing_enabled" to "comandas_printer_enabled";

comment on column "public"."businesses"."comandas_printer_enabled" is
  'Spec 185: apaga las comandas de cocina de TODOS los sectores de una (stations.printer_enabled no importa si esto está en false). No toca control/cuenta/factura — esas tienen sus propios switches.';

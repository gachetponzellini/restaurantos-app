-- ────────────────────────────────────────────────────────────────────────
-- 0101 — la propina se paga, y se ve (spec 177 · Parte B)
--
-- El sistema **reportaba** las propinas (`Propinas (del mozo)` en el ticket de
-- cierre, `total_propinas_cents` en la liquidación) pero no tenía forma de
-- pagarlas. En KCC la plata sale del cajón —«yo sacaría efectivo de la caja
-- para darle a los mozos», Juan 2026-09-10— y eso dejaba el arqueo con
-- **faltante todas las noches** por la propina de tarjeta: `calculateExpectedCash`
-- descontaba propina sólo de los pagos en efectivo, así que la de tarjeta nunca
-- salía del esperado aunque el billete sí saliera del cajón.
--
-- Ahora es un movimiento de caja como cualquier otro: sale del cajón, entra al
-- libro, se puede anular (spec 070) y lo absorbe la fórmula del esperado.
--
-- ## Por qué un `kind` nuevo y no una sangría con motivo
--
-- El reparto del cierre, el libro y los reportes necesitan separar «plata que
-- se llevó el dueño» de «plata que se le pagó al personal». Una sangría con
-- `reason` libre no lo permite, y el `mozo_id` estructurado es lo que hace que
-- la pregunta «¿le pagamos a Pedro lo de anoche?» tenga respuesta.
-- ────────────────────────────────────────────────────────────────────────

alter table "public"."caja_movimientos"
  add column if not exists "mozo_id" uuid references "public"."users"("id") on delete set null;

alter table "public"."caja_movimientos"
  drop constraint if exists "caja_movimientos_kind_check";
alter table "public"."caja_movimientos"
  add constraint "caja_movimientos_kind_check"
  check ("kind" in ('sangria', 'ingreso', 'propina'));

-- Una propina sin dueño no es una propina: es una sangría con otro nombre. Y al
-- revés, un `mozo_id` colgado de una sangría haría que el reporte por mozo
-- contara plata que no es suya.
alter table "public"."caja_movimientos"
  drop constraint if exists "caja_movimientos_mozo_check";
alter table "public"."caja_movimientos"
  add constraint "caja_movimientos_mozo_check"
  check (("kind" = 'propina') = ("mozo_id" is not null));

comment on column "public"."caja_movimientos"."mozo_id" is
  'Spec 177 · Parte B: a quién se le pagó la propina. Obligatorio sii kind = propina, y prohibido en el resto.';

comment on column "public"."caja_movimientos"."kind" is
  'sangria = retiro del dueño. ingreso = plata que entra al cajón fuera de una venta. propina = lo que se le paga a un mozo (spec 177), con mozo_id obligatorio.';

-- Sirve «cuánta propina se le pagó a este mozo en el período».
create index if not exists "caja_movimientos_propina_mozo_idx"
  on "public"."caja_movimientos" ("business_id", "mozo_id", "created_at")
  where "kind" = 'propina';

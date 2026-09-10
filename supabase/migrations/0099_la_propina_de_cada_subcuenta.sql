-- ────────────────────────────────────────────────────────────────────────
-- 0099 — la propina de cada sub-cuenta (spec 177 · Parte 0)
--
-- Las dos pantallas de cobro le pasaban `orders.tip_cents` **entero** a cada
-- tarjeta de split, y cada una lo mandaba como su `payments.tip_cents`. Una
-- cuenta de $10.000 con $1.000 de propina dividida en 3 dejaba $3.000 de
-- propina asentados: la venta bajaba $2.000 en el arqueo (spec 098 — la venta
-- es `amount − tip`) y el mozo aparecía con el triple en la liquidación.
--
-- La porción se guarda al crear la división y NO se re-deriva al cobrar. Es la
-- parte que importa: con la Parte A de la misma spec, un excedente tomado como
-- propina sube `orders.tip_cents`, y un cálculo en vivo le esparciría esa
-- propina a las sub-cuentas que todavía no pagaron.
--
-- El reparto lo hace `prorratearPropina` (src/lib/billing/totals.ts):
-- proporcional a `expected_amount_cents`, con el último absorbiendo el residuo.
-- ────────────────────────────────────────────────────────────────────────

alter table "public"."order_splits"
  add column if not exists "tip_cents" bigint not null default 0;

alter table "public"."order_splits"
  drop constraint if exists "order_splits_tip_cents_check";
alter table "public"."order_splits"
  add constraint "order_splits_tip_cents_check" check ("tip_cents" >= 0);

comment on column "public"."order_splits"."tip_cents" is
  'Spec 177 · Parte 0: cuánto de expected_amount_cents es propina. Se congela al crear la división y no se re-deriva: un excedente tomado como propina sube orders.tip_cents, y recalcular se la esparciría a las sub-cuentas sin cobrar.';

-- ── Backfill de las divisiones vivas ────────────────────────────────────────
--
-- Sólo las `pending` de órdenes abiertas: una división ya cobrada tiene sus
-- `payments` escritos con el número viejo y este backfill no los corrige (el
-- criterio de la 098 con el stock — de acá en adelante ajusta solo).
--
-- Mismo reparto que la función de TS, pero sin el residuo al último: acá no hay
-- orden garantizado y un centavo de diferencia en una cuenta abierta se corrige
-- solo en el próximo `dividir*`. Lo que importa es no arrancar en 0 con propina
-- cargada.
update "public"."order_splits" s
set "tip_cents" = greatest(
  0,
  round(
    (s."expected_amount_cents"::numeric * o."tip_cents"::numeric)
    / nullif(
        (select sum(s2."expected_amount_cents") from "public"."order_splits" s2
          where s2."order_id" = s."order_id" and s2."status" <> 'cancelled'),
        0
      )
  )
)::bigint
from "public"."orders" o
where o."id" = s."order_id"
  and s."status" = 'pending'
  and o."lifecycle_status" = 'open'
  and o."tip_cents" > 0;

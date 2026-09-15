-- 0110 · El IVA del comprobante de compra (issue #312, spec 188)
--
-- «¿Cuando se suba la foto el sistema discrimina los artículos y le pone iva a
-- cada uno para dejarlos con el precio final?» — Rocío, encargada del Golf,
-- 2026-09-15. Hoy no: `supplier_invoices` guarda SÓLO `total_cents`.
--
-- ── Por qué importa, medido ───────────────────────────────────────────────
--
-- **El libro de IVA está hecho a la mitad.** `invoices` (las ventas) ya tiene
-- `neto_cents`, `iva_cents` e `iva_rate`, y hay un `libro-iva.ts` puro con
-- tests. Compras no tiene nada, así que el subdiario de IVA compras —una de las
-- cinco cosas que MaxiRest dispara al procesar un comprobante— no se puede
-- armar. Ya estaba anotado como gap en el relevamiento del backup del Golf.
--
-- **La base del precio del renglón es invisible.** En una factura A el renglón
-- está SIN IVA y el total del pie CON IVA; en un ticket o una B el renglón ya
-- viene con el IVA adentro. Los dos van a la misma columna `unit_cost_cents`,
-- que es la que pisa `ingredient_presentations.cost_cents` y re-costea las
-- recetas. Mirando un costo guardado, nadie puede decir en qué base está.
--
-- **El costo NO cambia** (188·D1). El negocio es responsable inscripto —emite
-- factura A con IVA discriminado— así que el IVA de compras es crédito fiscal y
-- el costo de la receta es el neto; y lo que no discrimina IVA (ticket, B, C,
-- interno) no da crédito, así que ahí el costo es el precio final. En los dos
-- casos el costo es el número que dice el papel, que es lo que el sistema ya
-- hace copiándolo. Esta migración lo vuelve explícito, no lo cambia.
--
-- Nota de numeración: la 0109 se la llevó la spec 185/186 en paralelo.

-- ── 1 · el pie fiscal del comprobante ─────────────────────────────────────
--
-- Los tres son NULLABLES y eso es la decisión (188·D3, heredada de la 172·D2):
-- lo que no se leyó llega vacío, nunca en cero. Un `iva_cents = 0` en una
-- factura A no es un dato faltante, es la declaración de que la compra fue
-- exenta — y sobre el subdiario eso es crédito fiscal que se pierde. Plata.
--
-- Van en `bigint` aunque `total_cents` sea `integer`: esa columna topa en
-- $21.474.836 y no se arregla acá, pero no se repite. Sin CHECK de signo: el
-- signo lo manda el `document_type` igual que el total (158·D4), y la nota de
-- crédito los lleva los tres en negativo.
alter table public.supplier_invoices
  add column if not exists neto_cents         bigint,
  add column if not exists iva_cents          bigint,
  add column if not exists percepciones_cents bigint;

comment on column public.supplier_invoices.neto_cents is
  'Spec 188 · neto gravado del pie, verbatim del papel. NULL = no se leyó (nunca 0).';
comment on column public.supplier_invoices.iva_cents is
  'Spec 188 · IVA del pie. Para un responsable inscripto es crédito fiscal, no costo.';
comment on column public.supplier_invoices.percepciones_cents is
  'Spec 188 · percepciones sumadas (IIBB, IVA, Ganancias). Una columna: lo que hace falta es que el pie cierre.';

-- ── 2 · la base del precio del renglón ────────────────────────────────────
--
-- `price_base` se GUARDA, no se deriva después (188·D2): un renglón sabe en qué
-- base está su precio el día que se carga y nunca más. La 163 deja editar el
-- `document_type` mientras no haya pagos, así que un cálculo derivado
-- reescribiría en silencio la base de un costo que ya se propagó a las recetas.
--
-- Las tasas del CHECK son las de ARCA: 0, 2,5, 5, 10,5, 21 y 27.
alter table public.supplier_invoice_items
  add column if not exists tasa_iva   numeric(5,2),
  add column if not exists price_base text;

alter table public.supplier_invoice_items
  drop constraint if exists supplier_invoice_items_tasa_iva_check;
alter table public.supplier_invoice_items
  add constraint supplier_invoice_items_tasa_iva_check
  check (tasa_iva is null or tasa_iva in (0, 2.5, 5, 10.5, 21, 27));

alter table public.supplier_invoice_items
  drop constraint if exists supplier_invoice_items_price_base_check;
alter table public.supplier_invoice_items
  add constraint supplier_invoice_items_price_base_check
  check (price_base is null or price_base in ('neto', 'final'));

comment on column public.supplier_invoice_items.tasa_iva is
  'Spec 188 · alícuota del renglón: la impresa si estaba, si no la del comprobante. Sólo para mostrar el precio final — NO escribe el costo.';
comment on column public.supplier_invoice_items.price_base is
  'Spec 188 · en qué base está `unit_cost_cents`: neto (factura A) o final (todo lo demás). Inmutable.';

-- ── 3 · la RPC escribe las columnas que nadie llenaba ─────────────────────
--
-- Cuatro columnas nuevas en el mismo `insert`, y **la firma no cambia**: los
-- campos viajan adentro del `jsonb`, así que el `revoke`/`grant` de la 0094
-- queda como está.
--
-- Dos de las cuatro son de la 172·D6, que se declaró y nunca se implementó:
-- `source_text` y `match_source` existen desde la 0092 y el `insert` de la 0085
-- no las nombra, así que la RPC ignoraba esas claves del JSON. Medido en el
-- cloud el 2026-09-15: 0 filas con `source_text`, sobre 0 renglones totales.
-- Sin `match_source` no hay forma de responder «la máquina propuso X y la
-- persona lo corrigió a Y», y un umbral que no se puede medir (el 0,62 del
-- matcher) no se puede defender.
--
-- **`price_base` la decide la RPC, no el caller.** Mismo argumento que el signo
-- de la nota de crédito en la 0085: el `document_type` se lee de la fila del
-- comprobante, así que la pantalla no puede mentir sobre en qué base está el
-- precio que está escribiendo sobre el costo de un insumo.
create or replace function public.registrar_items_comprobante_tx(
  p_business_id uuid,
  p_invoice_id  uuid,
  p_created_by  uuid,
  p_items       jsonb   -- [{ingredient_id, presentation_id, units, unit_cost_cents,
                        --   tasa_iva?, source_text?, match_source?}]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_it        jsonb;
  v_ing       uuid;
  v_pres      uuid;
  v_units     numeric;
  v_costo     bigint;
  v_neto      numeric;
  v_base      numeric;
  v_n         integer := 0;
  v_tipo      text;
  v_devuelve  boolean;
  v_base_precio text;
begin
  -- El comprobante tiene que ser de este negocio y estar vivo. El `document_type`
  -- sale de acá y no de un parámetro: el caller no puede mentir sobre el signo
  -- ni sobre la base del precio.
  select document_type into v_tipo
    from supplier_invoices
   where id = p_invoice_id and business_id = p_business_id and cancelled_at is null;
  if not found then
    raise exception 'COMPROBANTE_NO_DISPONIBLE';
  end if;

  v_devuelve := v_tipo = 'nota_credito';

  -- Spec 188·D2 · sólo la factura A discrimina IVA en el renglón. La C del
  -- monotributista no es una excepción olvidada: no discrimina, es final.
  v_base_precio := case when v_tipo = 'factura_a' then 'neto' else 'final' end;

  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_ing   := (v_it ->> 'ingredient_id')::uuid;
    v_pres  := nullif(v_it ->> 'presentation_id', '')::uuid;
    v_units := (v_it ->> 'units')::numeric;
    v_costo := (v_it ->> 'unit_cost_cents')::bigint;

    -- Tenant del insumo: el service client bypassa RLS y el FK sólo chequea
    -- existencia, no negocio.
    perform 1 from ingredients
     where id = v_ing and business_id = p_business_id for update;
    if not found then
      raise exception 'INSUMO_DE_OTRO_NEGOCIO' using detail = v_ing::text;
    end if;

    -- Cuántas unidades base entran. Sin presentación, `units` ya viene en base.
    v_neto := 1;
    if v_pres is not null then
      select net_quantity into v_neto
        from ingredient_presentations
       where id = v_pres and ingredient_id = v_ing;
      if v_neto is null then
        raise exception 'PRESENTACION_INVALIDA' using detail = v_pres::text;
      end if;
    end if;
    v_base := v_units * v_neto;
    if v_devuelve then
      v_base := -v_base;
    end if;

    insert into supplier_invoice_items (
      business_id, invoice_id, ingredient_id, presentation_id,
      units, quantity_base, unit_cost_cents, created_by,
      source_text, match_source, tasa_iva, price_base
    ) values (
      p_business_id, p_invoice_id, v_ing, v_pres,
      v_units, v_base, v_costo, p_created_by,
      nullif(v_it ->> 'source_text', ''),
      nullif(v_it ->> 'match_source', ''),
      (nullif(v_it ->> 'tasa_iva', ''))::numeric,
      v_base_precio
    );

    -- Alta (o baja) de stock. `v_base` ya trae el signo del comprobante.
    update ingredients
       set stock_quantity = stock_quantity + v_base,
           updated_at = now()
     where id = v_ing;

    -- El consumo, con el costo REAL. `cost_cents_snapshot` es la plata del
    -- MOVIMIENTO entero (units × precio del envase), que es la convención de
    -- todos los otros escritores y la columna que suma el CMV.
    --
    -- Sigue siendo el costo del PAPEL, en la base del papel (188·D1): para un
    -- responsable inscripto el IVA de compras es crédito fiscal y no es costo,
    -- y lo que no discrimina IVA no da crédito, así que su precio final SÍ lo
    -- es. Sumarle el IVA acá fabricaría un 21% de costo que el negocio no paga.
    insert into ingredient_consumptions (
      business_id, ingredient_id, quantity, cost_cents_snapshot, kind
    ) values (
      p_business_id, v_ing, v_base,
      round(v_costo * v_units),
      case when v_devuelve then 'reversion' else 'compra' end
    );

    -- La compra reescribe el costo del envase. El trigger
    -- `trg_ingredient_price_change` llena el histórico solo. La NC no: devolver
    -- mercadería no es un precio de compra.
    if v_pres is not null and v_costo > 0 and not v_devuelve then
      update ingredient_presentations
         set cost_cents = v_costo
       where id = v_pres and cost_cents <> v_costo;
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.registrar_items_comprobante_tx is
  'Spec 165 · carga los renglones de un comprobante: línea + movimiento de stock + consumo con costo real + precio del insumo, en UNA transacción. El signo y la base del precio los manda el document_type, leído de la fila (0085, 0110). Guarda además source_text/match_source (172·D6) y la tasa de IVA del renglón (188).';

-- PostgREST cachea el esquema: sin esto, el primer insert después de la
-- migración devuelve PGRST204 «Could not find the 'iva_cents' column». Mismo
-- recurso que la `reload_schema_cache_175`.
notify pgrst, 'reload schema';

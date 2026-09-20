-- ────────────────────────────────────────────────────────────────────────
-- 0125 — la merma es rendimiento (decisión de Juan, 2026-09-20 · #362)
--
-- La merma se pierde sobre lo que se COMPRA, no sobre lo que se sirve. Con 20 %
-- de merma, de cada kilo quedan 800 g: para servir 200 g limpios salen del
-- depósito 200 ÷ 0,8 = 250 g. El factor es 1 ÷ (1 − merma).
--
-- Hasta acá había tres números distintos para el mismo plato:
--
--   · el costeo usaba 1 + merma (1,20 en vez de 1,25): subestima 4 % con 20 %
--     de merma y 25 % con 50 % — el pescado entero, el corte con hueso;
--   · el stock no aplicaba NADA: descontaba los 200 g de la receta cuando del
--     depósito salían 250, así que el stock teórico quedaba siempre por encima
--     del real y la diferencia aparecía recién en el conteo;
--   · el costo de mercadería de cada venta (`cost_cents_snapshot`) salía de esa
--     cantidad sin merma: ni el costeo ni la realidad.
--
-- Ahora es una sola cuenta, en los tres lados. La receta se carga en cantidad
-- LIMPIA (lo que va al plato); la merma de preparación queda adentro del
-- descuento de stock, y el conteo de depósito pasa a mostrar sólo la pérdida
-- que nadie esperaba.
--
-- Todo lo que descuenta o revierte stock por receta pasa por
-- `fn_explode_ingredient`, así que cambia en un solo lugar. La versión en TS es
-- `factorDeMerma` (src/lib/ingredients/factor-de-merma.ts): si cambia una,
-- cambia la otra.
--
-- Nota de transición: una línea vendida ANTES de esta migración y cancelada
-- DESPUÉS devuelve al stock la cantidad con merma (un poco más de lo que se le
-- había descontado). Es un desvío de gramos sobre las mesas abiertas en el
-- momento del deploy, y va para el lado de lo que físicamente pasó.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.fn_factor_merma(p_waste numeric)
returns numeric
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  -- El CHECK de `ingredients.waste_percent` ya garantiza [0, 100); el tope de
  -- 99 es sólo para que un dato roto no divida por cero.
  select 1 / (1 - least(greatest(coalesce(p_waste, 0), 0), 99) / 100);
$$;

create or replace function public.fn_ingredient_cost_per_unit(p_ingredient_id uuid)
returns numeric
language plpgsql
stable
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_composite boolean;
  v_cost numeric;
  r record;
begin
  select is_composite into v_composite
    from ingredients where id = p_ingredient_id;

  if not v_composite then
    -- Ingrediente simple: costo de presentación default
    select case when ip.net_quantity > 0
                then ip.cost_cents::numeric / ip.net_quantity
                else 0 end
      into v_cost
      from ingredient_presentations ip
      where ip.ingredient_id = p_ingredient_id
        and ip.is_default = true
      limit 1;
    return coalesce(v_cost, 0);
  end if;

  -- Compuesto: Σ costo del hijo × cantidad × factor de merma del hijo. Las
  -- cantidades de la sub-receta son por 1 unidad del compuesto.
  v_cost := 0;
  for r in
    select ir.child_ingredient_id, ir.quantity,
           i.waste_percent as child_waste
    from ingredient_recipes ir
    join ingredients i on i.id = ir.child_ingredient_id
    where ir.parent_ingredient_id = p_ingredient_id
  loop
    v_cost := v_cost + (
      fn_ingredient_cost_per_unit(r.child_ingredient_id)
      * r.quantity
      * fn_factor_merma(r.child_waste)
    );
  end loop;

  return v_cost;
end;
$$;

create or replace function public.fn_explode_ingredient(p_ingredient_id uuid, p_quantity numeric)
returns table(leaf_ingredient_id uuid, leaf_quantity numeric, leaf_cost_per_unit numeric)
language plpgsql
stable
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_composite boolean;
  v_waste numeric;
  v_bruto numeric;
  r record;
begin
  select is_composite, waste_percent into v_composite, v_waste
    from ingredients where id = p_ingredient_id;

  -- `p_quantity` es cantidad LIMPIA; lo que sale del depósito es el bruto.
  v_bruto := p_quantity * fn_factor_merma(v_waste);

  if not v_composite then
    leaf_ingredient_id := p_ingredient_id;
    leaf_quantity := v_bruto;
    leaf_cost_per_unit := fn_ingredient_cost_per_unit(p_ingredient_id);
    return next;
    return;
  end if;

  -- Compuesto: cada hijo aplica su propia merma al explotarse.
  for r in
    select ir.child_ingredient_id, ir.quantity
    from ingredient_recipes ir
    where ir.parent_ingredient_id = p_ingredient_id
  loop
    return query
      select * from fn_explode_ingredient(r.child_ingredient_id, v_bruto * r.quantity);
  end loop;

  return;
end;
$$;

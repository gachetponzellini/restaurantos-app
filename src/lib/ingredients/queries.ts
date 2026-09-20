import "server-only";

import { fromZonedTime } from "date-fns-tz";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { fetchAll } from "@/lib/proveedores/unwrap";

import { computeMermaReport, type MermaConsumptionRow, type MermaReportItem } from "./merma";

function db() {
  return createSupabaseServiceClient();
}

import type {
  ConsumptionKind,
  FoodCostResult,
  Ingredient,
  IngredientConsumption,
  IngredientOverview,
  IngredientRecipeLine,
  IngredientUnit,
  IngredientWithPresentations,
  PriceLogEntry,
  ProductCosteo,
  RecipeLine,
} from "./types";
import { factorDeMerma } from "@/lib/ingredients/factor-de-merma";

// ── getIngredients (list for admin table) ────────────────────────

export async function getIngredients(
  businessId: string,
): Promise<IngredientOverview[]> {
  const service = db();

  const { data: ingredients } = await service
    .from("ingredients")
    .select(
      "id, business_id, name, unit, waste_percent, stock_quantity, stock_min_alert, is_active, is_composite, created_at, updated_at, ingredient_presentations(id, name, net_quantity, cost_cents, is_default)",
    )
    .eq("business_id", businessId)
    .order("name");

  // Count recipes per ingredient in one query
  const { data: recipeCounts } = await service
    .from("recipes")
    .select("ingredient_id")
    .in(
      "ingredient_id",
      (ingredients ?? []).map((i: any) => i.id),
    );

  const recipeCountMap = new Map<string, number>();
  for (const r of recipeCounts ?? []) {
    recipeCountMap.set(r.ingredient_id, (recipeCountMap.get(r.ingredient_id) ?? 0) + 1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ingredients ?? []).map((row: any) => {
    const presentations = row.ingredient_presentations ?? [];
    const defaultPres = presentations.find((p: any) => p.is_default) ?? null;
    const stockQty = Number(row.stock_quantity);
    const minAlert = row.stock_min_alert != null ? Number(row.stock_min_alert) : null;

    let stockStatus: "ok" | "low" | "out" = "ok";
    if (stockQty <= 0) stockStatus = "out";
    else if (minAlert != null && stockQty <= minAlert) stockStatus = "low";

    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      unit: row.unit as IngredientUnit,
      wastePercent: Number(row.waste_percent),
      stockQuantity: stockQty,
      stockMinAlert: minAlert,
      isActive: row.is_active,
      isComposite: row.is_composite ?? false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      defaultPresentation: defaultPres
        ? {
            name: defaultPres.name,
            costCents: defaultPres.cost_cents,
            netQuantity: Number(defaultPres.net_quantity),
          }
        : null,
      presentationCount: presentations.length,
      recipeCount: recipeCountMap.get(row.id) ?? 0,
      stockStatus,
    };
  });
}

// ── getIngredientById (detail with presentations) ────────────────

export async function getIngredientById(
  ingredientId: string,
): Promise<IngredientWithPresentations | null> {
  const service = db();

  const { data } = await service
    .from("ingredients")
    .select(
      "id, business_id, name, unit, waste_percent, stock_quantity, stock_min_alert, is_active, is_composite, created_at, updated_at, ingredient_presentations(id, ingredient_id, name, net_quantity, cost_cents, is_default, created_at)",
    )
    .eq("id", ingredientId)
    .maybeSingle();

  if (!data) return null;

  // Load sub-recipe if composite
  let subRecipe: IngredientRecipeLine[] = [];
  if (data.is_composite) {
    const { data: subLines } = await service
      .from("ingredient_recipes")
      .select(
        "id, parent_ingredient_id, child_ingredient_id, quantity, notes, ingredients!ingredient_recipes_child_ingredient_id_fkey(name, unit, waste_percent, ingredient_presentations(cost_cents, net_quantity, is_default))",
      )
      .eq("parent_ingredient_id", ingredientId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subRecipe = (subLines ?? []).map((row: any) => {
      const child = row.ingredients;
      const defaultPres = (child?.ingredient_presentations ?? []).find(
        (p: any) => p.is_default,
      );
      const costPerUnit =
        defaultPres && Number(defaultPres.net_quantity) > 0
          ? defaultPres.cost_cents / Number(defaultPres.net_quantity)
          : null;

      return {
        id: row.id,
        parentIngredientId: row.parent_ingredient_id,
        childIngredientId: row.child_ingredient_id,
        childIngredientName: child?.name ?? "—",
        childIngredientUnit: (child?.unit ?? "un") as IngredientUnit,
        quantity: Number(row.quantity),
        notes: row.notes,
        costPerUnit,
        wastePercent: Number(child?.waste_percent ?? 0),
      };
    });
  }

  return {
    id: data.id,
    businessId: data.business_id,
    name: data.name,
    unit: data.unit as IngredientUnit,
    wastePercent: Number(data.waste_percent),
    stockQuantity: Number(data.stock_quantity),
    stockMinAlert: data.stock_min_alert != null ? Number(data.stock_min_alert) : null,
    isActive: data.is_active,
    isComposite: data.is_composite ?? false,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    presentations: (data.ingredient_presentations ?? []).map((p: any) => ({
      id: p.id,
      ingredientId: p.ingredient_id,
      name: p.name,
      netQuantity: Number(p.net_quantity),
      costCents: p.cost_cents,
      isDefault: p.is_default,
      createdAt: p.created_at,
    })),
    subRecipe,
  };
}

// ── getRecipeForProduct ──────────────────────────────────────────

export async function getRecipeForProduct(
  productId: string,
): Promise<RecipeLine[]> {
  const service = db();

  const { data } = await service
    .from("recipes")
    .select(
      "id, product_id, ingredient_id, quantity, notes, ingredients(name, unit, waste_percent, is_composite, ingredient_presentations(cost_cents, net_quantity, is_default))",
    )
    .eq("product_id", productId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => {
    const ing = row.ingredients;
    let costPerUnit: number | null = null;

    if (ing?.is_composite) {
      // For composite ingredients, costPerUnit is calculated recursively
      // in calculateFoodCost(). Here we set null as placeholder — the
      // detailed view resolves it via getIngredientById().subRecipe.
      costPerUnit = null;
    } else {
      const defaultPres = (ing?.ingredient_presentations ?? []).find(
        (p: any) => p.is_default,
      );
      costPerUnit =
        defaultPres && Number(defaultPres.net_quantity) > 0
          ? defaultPres.cost_cents / Number(defaultPres.net_quantity)
          : null;
    }

    return {
      id: row.id,
      productId: row.product_id,
      ingredientId: row.ingredient_id,
      ingredientName: ing?.name ?? "—",
      ingredientUnit: (ing?.unit ?? "un") as IngredientUnit,
      quantity: Number(row.quantity),
      notes: row.notes,
      costPerUnit,
      wastePercent: Number(ing?.waste_percent ?? 0),
    };
  });
}

// ── resolveIngredientCost (recursive, for composite ingredients) ─

async function resolveIngredientCost(
  service: ReturnType<typeof db>,
  ingredientId: string,
  visited: Set<string> = new Set(),
): Promise<number> {
  // Cycle protection
  if (visited.has(ingredientId)) return 0;
  visited.add(ingredientId);

  const { data: ing } = await service
    .from("ingredients")
    .select("is_composite, waste_percent, ingredient_presentations(cost_cents, net_quantity, is_default)")
    .eq("id", ingredientId)
    .maybeSingle();

  if (!ing) return 0;

  if (!ing.is_composite) {
    // Simple ingredient: cost from default presentation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaultPres = (ing.ingredient_presentations ?? []).find((p: any) => p.is_default);
    if (!defaultPres || Number(defaultPres.net_quantity) <= 0) return 0;
    return defaultPres.cost_cents / Number(defaultPres.net_quantity);
  }

  // Composite: sum child costs × quantities × factorDeMerma(child_waste)
  const { data: subLines } = await service
    .from("ingredient_recipes")
    .select("child_ingredient_id, quantity, ingredients!ingredient_recipes_child_ingredient_id_fkey(waste_percent)")
    .eq("parent_ingredient_id", ingredientId);

  let total = 0;
  for (const line of subLines ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childWaste = Number((line as any).ingredients?.waste_percent ?? 0);
    const childCostPerUnit = await resolveIngredientCost(service, line.child_ingredient_id, new Set(visited));
    total += childCostPerUnit * Number(line.quantity) * factorDeMerma(childWaste);
  }
  return total;
}

// ── calculateFoodCost ────────────────────────────────────────────

export async function calculateFoodCost(
  productId: string,
  priceCents?: number,
): Promise<FoodCostResult> {
  const service = db();
  const recipeLines = await getRecipeForProduct(productId);

  const lines = await Promise.all(
    recipeLines.map(async (line) => {
      // For composite ingredients, resolve recursively
      let costPerUnit = line.costPerUnit;
      if (costPerUnit === null) {
        costPerUnit = await resolveIngredientCost(service, line.ingredientId);
      }
      const lineCost = line.quantity * costPerUnit * factorDeMerma(line.wastePercent);
      return {
        ingredientId: line.ingredientId,
        ingredientName: line.ingredientName,
        quantity: line.quantity,
        unit: line.ingredientUnit,
        costPerUnit,
        wastePercent: line.wastePercent,
        lineCostCents: Math.round(lineCost),
      };
    }),
  );

  const totalCents = lines.reduce((sum, l) => sum + l.lineCostCents, 0);
  const marginPercent =
    priceCents && priceCents > 0
      ? ((priceCents - totalCents) / priceCents) * 100
      : null;

  return { totalCents, marginPercent, lines };
}

// ── getIngredientsForSearch (lightweight, for recipe ingredient picker) ──

export async function getIngredientsForSearch(
  businessId: string,
): Promise<Pick<Ingredient, "id" | "name" | "unit" | "isComposite">[]> {
  const service = db();

  const { data } = await service
    .from("ingredients")
    .select("id, name, unit, is_composite")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name");

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    unit: row.unit as IngredientUnit,
    isComposite: row.is_composite ?? false,
  }));
}

// ── getPriceLog ──────────────────────────────────────────────────

export async function getPriceLog(
  ingredientId: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: PriceLogEntry[]; total: number }> {
  const service = db();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count } = await service
    .from("ingredient_price_log")
    .select(
      "id, ingredient_id, presentation_id, old_cost_cents, new_cost_cents, recorded_at, recorded_by, ingredient_presentations(name)",
      { count: "exact" },
    )
    .eq("ingredient_id", ingredientId)
    .order("recorded_at", { ascending: false })
    .range(from, to);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: PriceLogEntry[] = (data ?? []).map((row: any) => ({
    id: row.id,
    ingredientId: row.ingredient_id,
    presentationId: row.presentation_id,
    presentationName: row.ingredient_presentations?.name ?? null,
    oldCostCents: row.old_cost_cents,
    newCostCents: row.new_cost_cents,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  }));

  return { items, total: count ?? 0 };
}

// ── getCosteoOverview (rentability report) ───────────────────────

export async function getCosteoOverview(
  businessId: string,
): Promise<ProductCosteo[]> {
  const service = db();

  // Single query: products with their recipes + ingredient cost data
  const { data: products } = await service
    .from("products")
    .select(
      "id, name, price_cents, category_id, categories(name), recipes(product_id, quantity, ingredient_id, ingredients(waste_percent, is_composite, ingredient_presentations(cost_cents, net_quantity, is_default)))",
    )
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name");

  // Pre-resolve costs for any composite ingredients used in recipes
  const compositeIds = new Set<string>();
  for (const p of products ?? []) {
    for (const rec of (p as any).recipes ?? []) {
      if ((rec as any).ingredients?.is_composite) {
        compositeIds.add(rec.ingredient_id);
      }
    }
  }

  // Cache resolved costs for composite ingredients
  const compositeCostCache = new Map<string, number>();
  for (const id of compositeIds) {
    compositeCostCache.set(id, await resolveIngredientCost(service, id));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (products ?? []).map((p: any) => {
    const priceCents = Number(p.price_cents);
    const recipeLines = p.recipes ?? [];
    const hasRecipe = recipeLines.length > 0;

    let totalCost = 0;
    let lineasSinCosto = 0;
    for (const rec of recipeLines) {
      const ing = rec.ingredients as any;
      const wastePercent = Number(ing?.waste_percent ?? 0);
      let costPerUnit: number;

      if (ing?.is_composite) {
        // Use pre-resolved cost for composite ingredients
        costPerUnit = compositeCostCache.get(rec.ingredient_id) ?? 0;
      } else {
        const defaultPres = (ing?.ingredient_presentations ?? []).find(
          (pr: any) => pr.is_default,
        );
        if (!defaultPres || Number(defaultPres.net_quantity) <= 0) {
          lineasSinCosto += 1;
          continue;
        }
        costPerUnit = defaultPres.cost_cents / Number(defaultPres.net_quantity);
      }
      // Un insumo a $0 (o un compuesto sin sub-receta) suma $0 en silencio.
      if (!(costPerUnit > 0)) lineasSinCosto += 1;

      totalCost += Number(rec.quantity) * costPerUnit * factorDeMerma(wastePercent);
    }

    const foodCostCents = Math.round(totalCost);
    const marginCents = priceCents - foodCostCents;
    const marginPercent =
      priceCents > 0 ? (marginCents / priceCents) * 100 : 0;

    return {
      productId: p.id,
      productName: p.name,
      categoryName: p.categories?.name ?? null,
      priceCents,
      foodCostCents,
      marginPercent: Math.round(marginPercent * 100) / 100,
      marginCents,
      hasRecipe,
      lineasSinCosto,
    };
  });
}

// ── getKitchenStockOverview (stock de cocina) ────────────────────

export type KitchenStockItem = {
  id: string;
  name: string;
  unit: IngredientUnit;
  stockQuantity: number;
  stockMinAlert: number | null;
  stockStatus: "ok" | "low" | "out";
  wastePercent: number;
  isActive: boolean;
  updatedAt: string;
};

export async function getKitchenStockOverview(
  businessId: string,
): Promise<KitchenStockItem[]> {
  const service = db();

  const { data } = await service
    .from("ingredients")
    .select("id, name, unit, stock_quantity, stock_min_alert, waste_percent, is_active, updated_at")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name");

  return (data ?? []).map((row: any) => {
    const stockQty = Number(row.stock_quantity);
    const minAlert = row.stock_min_alert != null ? Number(row.stock_min_alert) : null;

    let stockStatus: "ok" | "low" | "out" = "ok";
    if (stockQty <= 0) stockStatus = "out";
    else if (minAlert != null && stockQty <= minAlert) stockStatus = "low";

    return {
      id: row.id,
      name: row.name,
      unit: row.unit as IngredientUnit,
      stockQuantity: stockQty,
      stockMinAlert: minAlert,
      stockStatus,
      wastePercent: Number(row.waste_percent),
      isActive: row.is_active,
      updatedAt: row.updated_at,
    };
  });
}

// ── getKitchenStockFull (with presentations for ingreso modal) ──

export type KitchenStockPresentation = {
  id: string;
  name: string;
  netQuantity: number;
};

export type KitchenStockFull = KitchenStockItem & {
  presentations: KitchenStockPresentation[];
};

export async function getKitchenStockFull(
  businessId: string,
): Promise<KitchenStockFull[]> {
  const service = db();

  const { data } = await service
    .from("ingredients")
    .select(
      "id, name, unit, stock_quantity, stock_min_alert, waste_percent, is_active, updated_at, ingredient_presentations(id, name, net_quantity, is_default)",
    )
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("name");

  return (data ?? []).map((row: any) => {
    const stockQty = Number(row.stock_quantity);
    const minAlert = row.stock_min_alert != null ? Number(row.stock_min_alert) : null;

    let stockStatus: "ok" | "low" | "out" = "ok";
    if (stockQty <= 0) stockStatus = "out";
    else if (minAlert != null && stockQty <= minAlert) stockStatus = "low";

    // Sort presentations: default first, then by name
    const presentations = (row.ingredient_presentations ?? [])
      .sort((a: any, b: any) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return (a.name as string).localeCompare(b.name as string);
      })
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        netQuantity: Number(p.net_quantity),
      }));

    return {
      id: row.id,
      name: row.name,
      unit: row.unit as IngredientUnit,
      stockQuantity: stockQty,
      stockMinAlert: minAlert,
      stockStatus,
      wastePercent: Number(row.waste_percent),
      isActive: row.is_active,
      updatedAt: row.updated_at,
      presentations,
    };
  });
}

// ── getLowKitchenStockCount ──────────────────────────────────────

export async function getLowKitchenStockCount(
  businessId: string,
): Promise<number> {
  const service = db();

  const { data } = await service
    .from("ingredients")
    .select("id, stock_quantity, stock_min_alert")
    .eq("business_id", businessId)
    .eq("is_active", true);

  return (data ?? []).filter((row: any) => {
    const qty = Number(row.stock_quantity);
    const min = row.stock_min_alert != null ? Number(row.stock_min_alert) : null;
    return qty <= 0 || (min != null && qty <= min);
  }).length;
}

// ── getIngredientConsumptions (historial de consumo por ingrediente) ──

export async function getIngredientConsumptions(
  ingredientId: string,
  page = 1,
  pageSize = 20,
): Promise<{ items: IngredientConsumption[]; total: number }> {
  const service = db();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count } = await service
    .from("ingredient_consumptions")
    .select(
      "id, business_id, ingredient_id, order_item_id, quantity, cost_cents_snapshot, kind, created_at, ingredients(name, unit)",
      { count: "exact" },
    )
    .eq("ingredient_id", ingredientId)
    .order("created_at", { ascending: false })
    .range(from, to);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: IngredientConsumption[] = (data ?? []).map((row: any) => ({
    id: row.id,
    businessId: row.business_id,
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredients?.name ?? "—",
    ingredientUnit: (row.ingredients?.unit ?? "un") as IngredientUnit,
    orderItemId: row.order_item_id,
    quantity: Number(row.quantity),
    costCentsSnapshot: row.cost_cents_snapshot,
    kind: row.kind as ConsumptionKind,
    createdAt: row.created_at,
  }));

  return { items, total: count ?? 0 };
}

// ── getConsumptionSummary (resumen de consumo por período) ──────

export type ConsumptionSummaryItem = {
  ingredientId: string;
  ingredientName: string;
  ingredientUnit: IngredientUnit;
  totalQuantity: number;
  totalCostCents: number;
  entryCount: number;
};

export async function getConsumptionSummary(
  businessId: string,
  fromDate?: string,
  toDate?: string,
): Promise<ConsumptionSummaryItem[]> {
  const service = db();

  // Mismo techo de 1.000 filas que `getMermaReport`: este resumen alimenta
  // «cuánto se consumió de cada insumo» y se truncaba igual de callado.
  const data = await fetchAll(() => {
    let query = service
      .from("ingredient_consumptions")
      .select(
        "id, ingredient_id, quantity, cost_cents_snapshot, kind, created_at, ingredients(name, unit)",
      )
      .eq("business_id", businessId)
      .eq("kind", "venta");

    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);

    return query.order("id");
  }, "ingredient_consumptions");

  // Aggregate by ingredient
  const map = new Map<string, ConsumptionSummaryItem>();
  for (const row of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any;
    const id = r.ingredient_id;
    const existing = map.get(id);
    if (existing) {
      existing.totalQuantity += Math.abs(Number(r.quantity));
      existing.totalCostCents += Math.abs(r.cost_cents_snapshot);
      existing.entryCount++;
    } else {
      map.set(id, {
        ingredientId: id,
        ingredientName: r.ingredients?.name ?? "—",
        ingredientUnit: (r.ingredients?.unit ?? "un") as IngredientUnit,
        totalQuantity: Math.abs(Number(r.quantity)),
        totalCostCents: Math.abs(r.cost_cents_snapshot),
        entryCount: 1,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.totalCostCents - a.totalCostCents);
}

// ── getMermaReport (merma estimativa por período, spec 10) ───────
// `fromDate`/`toDate` son fechas locales 'yyyy-MM-dd' en timezone del negocio.
// Se convierten a límites UTC con date-fns-tz para filtrar created_at.

export async function getMermaReport(
  businessId: string,
  fromDate: string,
  toDate: string,
  timezone = "America/Argentina/Buenos_Aires",
): Promise<MermaReportItem[]> {
  const service = db();

  const startUtc = fromZonedTime(`${fromDate}T00:00:00`, timezone).toISOString();
  const endUtc = fromZonedTime(`${toDate}T23:59:59.999`, timezone).toISOString();

  // Issue #270 · 7 — `fetchAll` y no una lectura suelta.
  //
  // PostgREST corta en `max_rows = 1000` y devuelve 200 con un array corto: sin
  // error, sin bandera, y con la agregación hecha en JS sobre el recorte. El
  // reporte quedaba subestimado siempre para abajo — el modo de falla más caro,
  // porque el número da lindo. Con recetas completas son ~200 platos × ~5
  // insumos hoja = mil filas por servicio, así que el techo se cruza en una
  // noche. El helper ya existía en el repo (spec 161) para exactamente esto;
  // estas lecturas simplemente no lo usaban. Ordena por `id` porque es lo único
  // único: sin un orden estable, entre página y página se repiten o se saltean
  // filas.
  const data = await fetchAll(
    () =>
      service
        .from("ingredient_consumptions")
        .select(
          "id, ingredient_id, order_item_id, quantity, kind, created_at, ingredients(name, unit, waste_percent)",
        )
        .eq("business_id", businessId)
        .gte("created_at", startUtc)
        .lte("created_at", endUtc)
        .order("id"),
    "ingredient_consumptions",
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: MermaConsumptionRow[] = (data ?? []).map((r: any) => ({
    ingredientId: r.ingredient_id,
    ingredientName: r.ingredients?.name ?? "—",
    ingredientUnit: (r.ingredients?.unit ?? "un") as IngredientUnit,
    wastePercent: Number(r.ingredients?.waste_percent ?? 0),
    kind: r.kind as ConsumptionKind,
    quantity: Number(r.quantity),
    // Lo que distingue la reversión de una línea cancelada (lo tiene) de la de
    // un comprobante anulado o una nota de crédito (no lo tiene).
    orderItemId: r.order_item_id ?? null,
  }));

  return computeMermaReport(rows);
}

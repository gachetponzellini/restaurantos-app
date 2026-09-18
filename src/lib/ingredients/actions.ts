"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { calculateFoodCost, getMermaReport, getRecipeForProduct } from "./queries";
import type { MermaReportItem } from "./merma";

import {
  IngredientImportRow,
  IngredientInput,
  IngredientRecipeLineInput,
  PresentationInput,
  RecipeLineInput,
  StockAjusteInput,
  StockIngresoInput,
} from "./schema";
import type {
  FoodCostResult,
  IngredientRecipeLine,
  IngredientUnit,
  RecipeLine,
} from "./types";

// ── Helpers ──────────────────────────────────────────────────────

async function getBusinessIdBySlug(slug: string): Promise<string | null> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("businesses")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return data?.id ?? null;
}

function db() {
  return createSupabaseServiceClient();
}

/**
 * La RPC `adjust_ingredient_stock` (0086) y las columnas `reason`/`created_by`
 * de `ingredient_consumptions` todavía no están en `database.types.ts`: el
 * `pnpm db:types` de este repo necesita el CLI linkeado. Mismo escape hatch que
 * usan `proveedores/actions.ts` (spec 158) y `caja/cuenta-corriente-actions.ts`
 * (spec 141) — se apaga el tipado de UNA llamada, no del cliente entero.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RpcCaller = { rpc: (fn: string, args: Record<string, unknown>) => Promise<any> };

async function authDb() {
  return createSupabaseServerClient();
}

/**
 * Gate estándar del catálogo/back-office: resuelve el negocio por slug, exige
 * sesión con membership activa (via requireMozoActionContext, que ya corta
 * disabled_at) y rol admin/encargado. Espejo del patrón de `stock/actions.ts`.
 * Las mutaciones de recetas/insumos/stock-cocina usan el service client
 * (bypassa RLS), así que este gate es la única barrera de permisos/tenant.
 */
async function requireCatalogAdmin(
  businessSlug: string,
): Promise<ActionResult<{ businessId: string; userId: string }>> {
  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");
  const ctxResult = await requireMozoActionContext(businessId);
  if (!ctxResult.ok) return ctxResult;
  if (ctxResult.data.role !== "admin" && ctxResult.data.role !== "encargado") {
    return actionError("Solo admin o encargado pueden gestionar el catálogo.");
  }
  // Issue #270 · el `userId` viaja desde acá porque el ajuste de inventario
  // tiene que decir QUIÉN lo hizo. Antes este gate devolvía sólo el negocio, así
  // que el autor ni siquiera estaba disponible en la action: bajar 5 kg de
  // entraña era anónimo por construcción.
  return actionOk({ businessId, userId: ctxResult.data.userId });
}

/**
 * Verifica que el `ingredientId` pertenezca a un negocio del que el usuario
 * autenticado es miembro admin/encargado. Barrera de tenant para los reads
 * "callable from client" que sólo reciben el id (evita IDOR cross-tenant de
 * recetas/costos).
 */
async function callerOwnsIngredient(
  service: ReturnType<typeof db>,
  ingredientId: string,
): Promise<boolean> {
  const { data: ing } = await service
    .from("ingredients")
    .select("business_id")
    .eq("id", ingredientId)
    .maybeSingle();
  if (!ing) return false;
  const ctxResult = await requireMozoActionContext(ing.business_id as string);
  if (!ctxResult.ok) return false;
  return ctxResult.data.role === "admin" || ctxResult.data.role === "encargado";
}

// ═══════════════════════════════════════════════════════════════════
// INGREDIENTS (INSUMOS)
// ═══════════════════════════════════════════════════════════════════

export async function createIngredient(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = IngredientInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;
  const businessId = auth.data.businessId;

  const supabase = await authDb();
  const { data, error } = await supabase
    .from("ingredients")
    .insert({ ...parsed.data, business_id: businessId })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createIngredient", error);
    return actionError(
      error?.code === "23505"
        ? "Ya existe un ingrediente con ese nombre."
        : "No pudimos crear el ingrediente.",
    );
  }
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk({ id: data.id });
}

export async function updateIngredient(
  businessSlug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = IngredientInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;

  const supabase = await authDb();
  const { error } = await supabase
    .from("ingredients")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    console.error("updateIngredient", error);
    return actionError(
      error.code === "23505"
        ? "Ya existe un ingrediente con ese nombre."
        : "No pudimos actualizar.",
    );
  }
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk({ id });
}

export async function deleteIngredient(
  businessSlug: string,
  id: string,
): Promise<ActionResult<null>> {
  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;

  const supabase = await authDb();
  const { error } = await supabase.from("ingredients").delete().eq("id", id);
  if (error) {
    console.error("deleteIngredient", error);
    return actionError(
      error.code === "23503"
        ? "No se puede borrar: el ingrediente está usado en recetas."
        : "No pudimos borrar el ingrediente.",
    );
  }
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

// ═══════════════════════════════════════════════════════════════════
// PRESENTATIONS (ENVASES)
// ═══════════════════════════════════════════════════════════════════

export async function upsertPresentations(
  businessSlug: string,
  ingredientId: string,
  inputs: unknown[],
): Promise<ActionResult<null>> {
  const parsed = inputs.map((i) => PresentationInput.safeParse(i));
  if (parsed.some((p) => !p.success)) return actionError("Datos inválidos.");
  const items = parsed.map((p) => p.data!);

  // Validate: exactly one default
  const defaults = items.filter((i) => i.is_default);
  if (items.length > 0 && defaults.length !== 1) {
    return actionError("Debe haber exactamente una presentación por defecto.");
  }

  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;
  const businessId = auth.data.businessId;

  const service = db();

  // Verify ingredient belongs to this business
  const { data: ing } = await service
    .from("ingredients")
    .select("id")
    .eq("id", ingredientId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!ing) return actionError("Ingrediente no encontrado.");

  // Get existing presentations
  const { data: existing } = await service
    .from("ingredient_presentations")
    .select("id")
    .eq("ingredient_id", ingredientId);
  const existingIds = new Set<string>((existing ?? []).map((e: any) => e.id as string));

  // Split into updates vs inserts
  const toUpdate = items.filter((i) => i.id && existingIds.has(i.id));
  const toInsert = items.filter((i) => !i.id || !existingIds.has(i.id));
  const incomingIds = new Set<string>(items.filter((i) => i.id).map((i) => i.id!));
  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));

  // Execute all operations
  for (const item of toDelete) {
    await service.from("ingredient_presentations").delete().eq("id", item);
  }
  for (const item of toUpdate) {
    const { id, ...rest } = item;
    await service
      .from("ingredient_presentations")
      .update(rest)
      .eq("id", id!);
  }
  if (toInsert.length > 0) {
    await service.from("ingredient_presentations").insert(
      toInsert.map(({ id: _id, ...rest }) => ({
        ...rest,
        ingredient_id: ingredientId,
      })),
    );
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

// ═══════════════════════════════════════════════════════════════════
// RECIPES (RECETAS)
// ═══════════════════════════════════════════════════════════════════

export async function saveRecipe(
  businessSlug: string,
  productId: string,
  lines: unknown[],
): Promise<ActionResult<null>> {
  const parsed = lines.map((l) => RecipeLineInput.safeParse(l));
  if (parsed.some((p) => !p.success)) return actionError("Datos inválidos.");
  const items = parsed.map((p) => p.data!);

  // Check for duplicate ingredients
  const ingredientIds = items.map((i) => i.ingredient_id);
  if (new Set(ingredientIds).size !== ingredientIds.length) {
    return actionError("No se puede repetir un ingrediente en la misma receta.");
  }

  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;
  const businessId = auth.data.businessId;

  const service = db();

  // Verify product belongs to business

  const { data: product } = await service
    .from("products")
    .select("id, business_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product || product.business_id !== businessId) {
    return actionError("Producto no encontrado.");
  }

  // Replace all recipe lines atomically: delete old + insert new
  await service.from("recipes").delete().eq("product_id", productId);

  if (items.length > 0) {
    const { error } = await service.from("recipes").insert(
      items.map((item: any) => ({
        product_id: productId,
        ingredient_id: item.ingredient_id,
        quantity: item.quantity,
        notes: item.notes?.trim() || null,
      })),
    );
    if (error) {
      console.error("saveRecipe", error);
      return actionError("No pudimos guardar la receta.");
    }
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

export async function removeRecipeLine(
  businessSlug: string,
  recipeLineId: string,
): Promise<ActionResult<null>> {
  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;

  const supabase = await authDb();
  const { error } = await supabase.from("recipes").delete().eq("id", recipeLineId);
  if (error) {
    console.error("removeRecipeLine", error);
    return actionError("No pudimos borrar la línea de receta.");
  }
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

// ═══════════════════════════════════════════════════════════════════
// SUB-RECIPES (INGREDIENTES COMPUESTOS)
// ═══════════════════════════════════════════════════════════════════

/** Save (replace) the sub-recipe for a composite ingredient. */
export async function saveIngredientRecipe(
  businessSlug: string,
  ingredientId: string,
  lines: unknown[],
): Promise<ActionResult<null>> {
  const parsed = lines.map((l) => IngredientRecipeLineInput.safeParse(l));
  if (parsed.some((p) => !p.success)) return actionError("Datos inválidos.");
  const items = parsed.map((p) => p.data!);

  // Check for duplicate child ingredients
  const childIds = items.map((i) => i.child_ingredient_id);
  if (new Set(childIds).size !== childIds.length) {
    return actionError("No se puede repetir un ingrediente en la misma sub-receta.");
  }

  // Check no self-reference
  if (childIds.includes(ingredientId)) {
    return actionError("Un ingrediente no puede incluirse a sí mismo.");
  }

  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;
  const businessId = auth.data.businessId;

  const service = db();

  // Verify ingredient belongs to business and is composite
  const { data: ing } = await service
    .from("ingredients")
    .select("id, business_id, is_composite")
    .eq("id", ingredientId)
    .maybeSingle();
  if (!ing || ing.business_id !== businessId) {
    return actionError("Ingrediente no encontrado.");
  }
  if (!ing.is_composite) {
    return actionError("El ingrediente no está marcado como compuesto.");
  }

  // Basic cycle detection: check that none of the children (if composite)
  // eventually reference this ingredient as a descendant.
  for (const item of items) {
    const hasCycle = await detectCycle(service, item.child_ingredient_id, ingredientId);
    if (hasCycle) {
      return actionError(
        "Referencia circular detectada: un sub-ingrediente ya contiene a este ingrediente.",
      );
    }
  }

  // Replace all sub-recipe lines atomically: delete old + insert new
  await service
    .from("ingredient_recipes")
    .delete()
    .eq("parent_ingredient_id", ingredientId);

  if (items.length > 0) {
    const { error } = await service.from("ingredient_recipes").insert(
      items.map((item) => ({
        parent_ingredient_id: ingredientId,
        child_ingredient_id: item.child_ingredient_id,
        quantity: item.quantity,
        notes: item.notes?.trim() || null,
      })),
    );
    if (error) {
      console.error("saveIngredientRecipe", error);
      return actionError("No pudimos guardar la sub-receta.");
    }
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

export async function removeIngredientRecipeLine(
  businessSlug: string,
  lineId: string,
): Promise<ActionResult<null>> {
  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;

  const supabase = await authDb();
  const { error } = await supabase
    .from("ingredient_recipes")
    .delete()
    .eq("id", lineId);
  if (error) {
    console.error("removeIngredientRecipeLine", error);
    return actionError("No pudimos borrar la línea de sub-receta.");
  }
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

/**
 * Walk the sub-recipe tree from `startId` looking for `targetId`.
 * Returns true if adding targetId as a parent of startId would create a cycle.
 */
async function detectCycle(
  service: ReturnType<typeof db>,
  startId: string,
  targetId: string,
  visited: Set<string> = new Set(),
): Promise<boolean> {
  if (startId === targetId) return true;
  if (visited.has(startId)) return false;
  visited.add(startId);

  const { data: children } = await service
    .from("ingredient_recipes")
    .select("child_ingredient_id")
    .eq("parent_ingredient_id", startId);

  if (!children || children.length === 0) return false;

  for (const child of children) {
    if (await detectCycle(service, child.child_ingredient_id, targetId, visited)) {
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// STOCK DE COCINA
// ═══════════════════════════════════════════════════════════════════

export async function ingresarStockCocina(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = StockIngresoInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;
  const businessId = auth.data.businessId;

  const service = db();

  // Get the presentation to know the net_quantity
  const { data: pres } = await service
    .from("ingredient_presentations")
    .select("id, net_quantity, cost_cents, ingredient_id")
    .eq("id", parsed.data.presentation_id)
    .maybeSingle();
  if (!pres || pres.ingredient_id !== parsed.data.ingredient_id) {
    return actionError("Presentación no encontrada.");
  }

  // Verify ingredient belongs to business
  const { data: ing } = await service
    .from("ingredients")
    .select("id, business_id")
    .eq("id", parsed.data.ingredient_id)
    .maybeSingle();
  if (!ing || ing.business_id !== businessId) {
    return actionError("Ingrediente no encontrado.");
  }

  // Cuántas unidades base entran: envases × neto de la presentación.
  const totalBaseUnits = parsed.data.units * Number(pres.net_quantity);

  // Issue #268 · un solo `stock_quantity = stock_quantity + delta` en la base.
  //
  // Antes esto era leer el stock, sumar en JS y escribir el ABSOLUTO. Entre la
  // lectura y la escritura hay dos round-trips a Supabase: la comanda que
  // descargaba receta ahí en el medio se perdía, y los kilos vendidos
  // reaparecían solos en el inventario. El bar ya usaba `adjust_stock_item`
  // desde la spec 36 y la compra por renglón la RPC de la 0073; este camino
  // —el más a mano en hora pico— fue el único que quedó afuera.
  //
  // Y el costo: la fila `kind='compra'` se escribía con `cost_cents_snapshot: 0`
  // aunque el precio del envase estaba a la vista dos consultas más arriba. La
  // 0073 lo denuncia por su nombre en su propia cabecera.
  const { error } = await (service as unknown as RpcCaller).rpc("adjust_ingredient_stock", {
    p_business_id: businessId,
    p_ingredient_id: parsed.data.ingredient_id,
    p_delta: totalBaseUnits,
    p_kind: "compra",
    p_cost_cents: Math.round(Number(pres.cost_cents ?? 0) * parsed.data.units),
    p_reason: parsed.data.reason ?? null,
    p_created_by: auth.data.userId,
  });

  if (error) {
    console.error("ingresarStockCocina", error);
    return actionError("No pudimos ingresar el stock.");
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

export async function ajustarStockCocina(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = StockAjusteInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return auth;
  const businessId = auth.data.businessId;

  const service = db();

  // Issue #270 · lo que baja a mano es MERMA, no un ajuste mudo.
  //
  // Decisión de producto: el tile «Merma · 30 días» del dashboard suma
  // `kind='merma'` y venía diciendo $0,00 desde siempre porque ningún camino de
  // la app escribía nunca esa fila — el único productor era el seed. La
  // pantalla de este ajuste ya dice de qué se trata: el placeholder del motivo
  // es «Ej: Merma por vencimiento». Lo que SUBE sigue siendo 'ajuste': un
  // conteo que aparece de más no es una pérdida.
  //
  // Se pierde precisión en un caso: el conteo físico que da de menos («había 8
  // y no 10») queda contado como merma. Es el trade-off correcto — en los dos
  // casos la mercadería no está y el costo se fue igual — y evita meter un
  // selector de tipo en una pantalla que ya tiene demasiada fricción.
  const kind = parsed.data.quantity < 0 ? "merma" : "ajuste";

  // Issue #270 · un solo `stock_quantity = stock_quantity + delta`, con el
  // motivo, el autor y el SIGNO. El read-modify-write anterior se comía las
  // ventas que cayeran entre su lectura y su escritura; y guardaba
  // `abs(quantity)` con `cost_cents_snapshot: 0`, así que en el log una baja de
  // 5 kg y un alta de 5 kg eran la misma fila anónima, sin plata y sin autor.
  // El motivo que la pantalla exige con asterisco rojo no tenía siquiera
  // columna dónde guardarse (0086).
  //
  // El costo lo valoriza la RPC con `fn_ingredient_cost_per_unit`, el mismo
  // costo vivo que usa el costeo del plato.
  const { error } = await (service as unknown as RpcCaller).rpc("adjust_ingredient_stock", {
    p_business_id: businessId,
    p_ingredient_id: parsed.data.ingredient_id,
    p_delta: parsed.data.quantity,
    p_kind: kind,
    p_cost_cents: null,
    p_reason: parsed.data.reason,
    p_created_by: auth.data.userId,
  });

  if (error) {
    if ((error.message ?? "").includes("INSUMO_NO_ENCONTRADO")) {
      return actionError("Ingrediente no encontrado.");
    }
    console.error("ajustarStockCocina", error);
    return actionError("No pudimos ajustar el stock.");
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

// ═══════════════════════════════════════════════════════════════════
// IMPORT MASIVO DE INSUMOS (spec 10)
// ═══════════════════════════════════════════════════════════════════

export type ImportError = { row: number; name: string; reason: string };
export type ImportResult = { imported: number; errors: ImportError[] };

/**
 * Importa un lote de insumos (ya parseados del Excel/CSV de MaxiRest en el
 * cliente). Valida cada fila con Zod, hace upsert por (business_id, name) y
 * reporta filas OK y filas con error SIN abortar el lote completo.
 */
export async function importIngredients(
  businessSlug: string,
  rows: unknown[],
): Promise<ActionResult<ImportResult>> {
  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(businessId);
  if (!ctxResult.ok) return ctxResult;
  if (ctxResult.data.role !== "admin" && ctxResult.data.role !== "encargado") {
    return actionError("Solo admin o encargado pueden importar insumos.");
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return actionError("El lote está vacío.");
  }

  const service = db();
  const errors: ImportError[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const parsed = IngredientImportRow.safeParse(rows[i]);
    if (!parsed.success) {
      const raw = rows[i] as { name?: unknown };
      const name = typeof raw?.name === "string" ? raw.name : `Fila ${i + 1}`;
      errors.push({
        row: i + 1,
        name,
        reason: parsed.error.issues[0]?.message ?? "Datos inválidos.",
      });
      continue;
    }

    const r = parsed.data;
    try {
      // Upsert del insumo por (business_id, name)
      const { data: ing, error: ingErr } = await service
        .from("ingredients")
        .upsert(
          {
            business_id: businessId,
            name: r.name,
            unit: r.unit,
            waste_percent: r.waste_percent,
            stock_quantity: r.stock_initial,
            is_active: true,
          },
          { onConflict: "business_id,name" },
        )
        .select("id")
        .single();

      if (ingErr || !ing) {
        errors.push({ row: i + 1, name: r.name, reason: "No se pudo guardar el insumo." });
        continue;
      }

      // Upsert de la presentación default (una sola por insumo).
      const { data: existingDefault } = await service
        .from("ingredient_presentations")
        .select("id")
        .eq("ingredient_id", ing.id)
        .eq("is_default", true)
        .maybeSingle();

      if (existingDefault) {
        await service
          .from("ingredient_presentations")
          .update({
            name: r.presentation_name,
            net_quantity: r.net_quantity,
            cost_cents: r.cost_cents,
          })
          .eq("id", existingDefault.id);
      } else {
        await service.from("ingredient_presentations").insert({
          ingredient_id: ing.id,
          name: r.presentation_name,
          net_quantity: r.net_quantity,
          cost_cents: r.cost_cents,
          is_default: true,
        });
      }

      imported++;
    } catch (e) {
      console.error("importIngredients row", i + 1, e);
      errors.push({ row: i + 1, name: r.name, reason: "Error al importar la fila." });
    }
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk({ imported, errors });
}

// ── fetchMermaReport (reporte de merma por rango, callable desde cliente) ──

export async function fetchMermaReport(
  slug: string,
  fromDate: string,
  toDate: string,
): Promise<ActionResult<MermaReportItem[]>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (ctxResult.data.role !== "admin" && ctxResult.data.role !== "encargado") {
    return actionError("Solo admin o encargado pueden ver el reporte de merma.");
  }

  const report = await getMermaReport(
    business.id,
    fromDate,
    toDate,
    business.timezone,
  );
  return actionOk(report);
}

// ═══════════════════════════════════════════════════════════════════
// FETCH SUB-RECIPE (for client component loading)
// ═══════════════════════════════════════════════════════════════════

/** Load sub-recipe lines for a composite ingredient. Callable from client components. */
export async function fetchSubRecipeLines(
  ingredientId: string,
): Promise<IngredientRecipeLine[]> {
  const service = db();

  // Scope tenant: el ingrediente debe pertenecer a un negocio del caller.
  if (!(await callerOwnsIngredient(service, ingredientId))) return [];

  const { data: subLines } = await service
    .from("ingredient_recipes")
    .select(
      "id, parent_ingredient_id, child_ingredient_id, quantity, notes, ingredients!ingredient_recipes_child_ingredient_id_fkey(name, unit, waste_percent, ingredient_presentations(cost_cents, net_quantity, is_default))",
    )
    .eq("parent_ingredient_id", ingredientId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (subLines ?? []).map((row: any) => {
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

/** Load presentations for an ingredient. Callable from client components. */
export async function fetchPresentations(ingredientId: string) {
  const service = db();

  // Scope tenant: el ingrediente debe pertenecer a un negocio del caller.
  if (!(await callerOwnsIngredient(service, ingredientId))) return [];

  const { data } = await service
    .from("ingredient_presentations")
    .select("id, ingredient_id, name, net_quantity, cost_cents, is_default, created_at")
    .eq("ingredient_id", ingredientId)
    .order("is_default", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((p: any) => ({
    id: p.id as string,
    name: p.name as string,
    net_quantity: Number(p.net_quantity),
    cost_cents: p.cost_cents as number,
    is_default: p.is_default as boolean,
  }));
}

/**
 * Receta + food cost de un producto — lo único que el modal de edición del
 * catálogo no tiene ya en memoria.
 *
 * La lista de productos del admin viene entera del server (incluidos los grupos
 * de adicionales), así que el modal abre y se edita sin esperar nada. La receta
 * es el pedazo caro (resuelve costos de insumos compuestos recursivamente) y
 * sólo la mira quien costea: se trae recién al abrir el modal.
 */
/**
 * Spec 205 · D10 — los productos cuya receta usa este insumo, para la sección
 * «Usado en» del editor: si cambia el costo del insumo, cambia el food cost de
 * estos. Sólo lectura. Devuelve ids; los nombres y precios ya están en el
 * catálogo que tiene la página.
 */
export async function fetchIngredientUsage(
  businessSlug: string,
  ingredientId: string,
): Promise<string[] | null> {
  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return null;

  const service = db();
  const { data: ingredient } = await service
    .from("ingredients")
    .select("id, business_id")
    .eq("id", ingredientId)
    .maybeSingle();
  // Scope de tenant: el id viaja desde el browser.
  if (!ingredient || ingredient.business_id !== auth.data.businessId)
    return null;

  const { data } = await service
    .from("recipes")
    .select("product_id")
    .eq("ingredient_id", ingredientId);
  return [...new Set((data ?? []).map((r) => r.product_id as string))];
}

export async function fetchProductRecipe(
  businessSlug: string,
  productId: string,
): Promise<{ lines: RecipeLine[]; foodCost: FoodCostResult } | null> {
  const auth = await requireCatalogAdmin(businessSlug);
  if (!auth.ok) return null;

  const service = db();
  const { data: product } = await service
    .from("products")
    .select("id, price_cents, business_id")
    .eq("id", productId)
    .maybeSingle();
  // Scope de tenant: el id viaja desde el browser.
  if (!product || product.business_id !== auth.data.businessId) return null;

  const [lines, foodCost] = await Promise.all([
    getRecipeForProduct(productId),
    calculateFoodCost(productId, Number(product.price_cents)),
  ]);
  return { lines, foodCost };
}

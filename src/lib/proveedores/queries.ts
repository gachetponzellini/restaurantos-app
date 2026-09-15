import "server-only";


import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { enLotes, fetchAll, unwrap } from "./unwrap";

import type {
  SupplierIngredientLink,
  SupplierInvoice,
  SupplierInvoiceItem,
  SupplierOutflowItem,
  SupplierStats,
  SupplierWithStats,
} from "./types";

function db() {
  return createSupabaseServiceClient();
}

/**
 * ¿El concepto de gasto es de este negocio? — issue #268.
 *
 * `null` pasa (el comprobante sin clasificar es válido). Vive acá y no en el
 * schema Zod porque es una pregunta a la base, no una forma del dato; y vive en
 * un helper porque `createSupplierInvoice` y `editarComprobante` son gemelos y
 * arreglar uno solo dejaba la otra puerta abierta — que es justo la más
 * expuesta: el concepto es el único campo editable con pagos vivos.
 */
export async function conceptoEsDelNegocio(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  businessId: string,
  conceptId: string | null | undefined,
): Promise<boolean> {
  if (!conceptId) return true;
  const { data, error } = await service
    .from("expense_concepts")
    .select("id")
    .eq("id", conceptId)
    .eq("business_id", businessId)
    .maybeSingle();
  // Falla cerrada: si no se puede verificar, no se clasifica (spec 161 · D3).
  if (error) return false;
  return data != null;
}

/**
 * Las columnas de la spec 158 llegan en el `select("*")` pero todavía no están
 * en `database.types.ts` (el `pnpm db:types` del repo necesita el CLI linkeado).
 * Estos accesos las leen sin apagar el tipado del resto de la fila.
 */
type ColumnasSpec158 = {
  default_expense_concept_id?: string | null;
  payment_terms_days?: number | null;
  document_type?: string | null;
  expense_concept_id?: string | null;
  due_date?: string | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
  /** spec 173 · las páginas del comprobante. Misma historia: columna nueva que
   *  todavía no está en `database.types.ts`. */
  photo_urls?: string[] | null;
};

function extra(row: unknown): ColumnasSpec158 {
  return row as ColumnasSpec158;
}

// ── Fotos del comprobante ───────────────────────────────────────

/** El bucket es privado: sin firma no se ve nada. Una hora alcanza para revisar
 *  una compra y es lo que ya se usaba. */
const FIRMA_SEGUNDOS = 3600;

/**
 * Las páginas de un comprobante, en orden — spec 173.
 *
 * `photo_urls` es la columna nueva y `photo_url` la vieja, que NO se dropeó: los
 * comprobantes cargados antes de la migración tienen la foto sólo en la vieja y
 * tienen que seguir viéndose. Si están las dos, manda el array — el alta escribe
 * `photo_url` con la primera página, así que la vieja no agrega nada.
 */
function pathsDeFoto(row: { photo_url?: string | null }): string[] {
  const páginas = extra(row).photo_urls;
  if (páginas && páginas.length > 0) return páginas.filter(Boolean);
  return row.photo_url ? [row.photo_url] : [];
}

/**
 * Firma todas las fotos de una tanda en UNA sola llamada.
 *
 * Antes se firmaba de a una adentro del `for` de los comprobantes: con la ficha
 * de un proveedor del Golf (cientos de compras) eso ya era un round-trip por
 * fila, y con varias páginas por comprobante pasa a ser N×M. `createSignedUrls`
 * hace todas de una.
 *
 * Devuelve un mapa path → URL firmada y **no lanza**: que no se pueda firmar una
 * foto no puede tumbar la ficha entera del proveedor, donde lo que importa es la
 * plata. Lo que no se firmó queda sin foto, y el error se ve en el log.
 */
async function firmarFotos(
  service: ReturnType<typeof db>,
  paths: string[],
): Promise<Map<string, string>> {
  const firmadas = new Map<string, string>();
  const únicos = [...new Set(paths)];
  if (únicos.length === 0) return firmadas;

  const { data, error } = await service.storage
    .from("supplier-invoices")
    .createSignedUrls(únicos, FIRMA_SEGUNDOS);

  if (error || !data) {
    console.error("firmarFotos", error);
    return firmadas;
  }

  // Se mapea por `path`, no por posición. El orden que devuelve coincide con el
  // que se pidió, pero acá se está armando de qué comprobante es cada foto: si
  // algún día no coincidiera, la compra mostraría el papel de otra.
  for (const fila of data) {
    if (fila.path && fila.signedUrl) firmadas.set(fila.path, fila.signedUrl);
  }
  return firmadas;
}

// ── Suppliers list (with aggregated stats) ──────────────────────

export async function getSuppliers(
  businessId: string,
): Promise<SupplierWithStats[]> {
  const service = db();

  const suppliers = await fetchAll(
    () => service.from("suppliers").select("*").eq("business_id", businessId).order("id"),
    "suppliers",
  );

  if (!suppliers.length) return [];

  // Por lotes: con 111 proveedores hoy entra de sobra, pero el límite del
  // `.in()` es el largo de la URL y no avisa — devuelve `Bad Request`.
  const invoiceAgg = await enLotes(
    suppliers.map((s) => s.id),
    async (lote) =>
      unwrap(
        await service
          .from("supplier_invoices")
          .select("supplier_id, total_cents, invoice_date")
          .eq("business_id", businessId)
          // Spec 163 — «Total comprado» contaba los anulados. La Cta. Cte. sí los
          // filtra, así que la misma plata daba dos números distintos a doce
          // líneas de distancia, en tres superficies.
          .is("cancelled_at", null)
          .in("supplier_id", lote),
        "supplier_invoices",
      ),
  );

  const statsMap = new Map<
    string,
    { total: number; count: number; last: string | null }
  >();

  for (const inv of invoiceAgg) {
    const entry = statsMap.get(inv.supplier_id) ?? {
      total: 0,
      count: 0,
      last: null,
    };
    entry.total += inv.total_cents;
    entry.count += 1;
    if (!entry.last || inv.invoice_date > entry.last) {
      entry.last = inv.invoice_date;
    }
    statsMap.set(inv.supplier_id, entry);
  }

  return suppliers.map((row) => {
    const stats = statsMap.get(row.id);
    return {
      id: row.id,
      businessId: row.business_id,
      name: row.name,
      cuit: row.cuit,
      contact: row.contact,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      defaultExpenseConceptId: extra(row).default_expense_concept_id ?? null,
      paymentTermsDays: extra(row).payment_terms_days ?? 0,
      totalSpentCents: stats?.total ?? 0,
      invoiceCount: stats?.count ?? 0,
      lastInvoiceDate: stats?.last ?? null,
    };
  });
}

// ── Supplier invoices ───────────────────────────────────────────

export async function getSupplierInvoices(
  supplierId: string,
  businessId: string,
): Promise<SupplierInvoice[]> {
  const service = db();

  const invoices = await fetchAll(
    () =>
      service
        .from("supplier_invoices")
        .select("*")
        .eq("supplier_id", supplierId)
        .eq("business_id", businessId)
        .order("invoice_date", { ascending: false })
        .order("id"),
    "supplier_invoices",
  );

  if (!invoices.length) return [];

  // Todas las fotos de todos los comprobantes, en una sola firma.
  const firmadas = await firmarFotos(
    service,
    invoices.flatMap((row) => pathsDeFoto(row)),
  );

  return invoices.map((row) => {
    // Lo que no se pudo firmar se cae del array. Pasa cuando el objeto ya no
    // está en el bucket (una foto borrada a mano, un huérfano de una subida a
    // medias): pintar el cuadrito de imagen rota es peor que mostrar una página
    // menos.
    const photoUrls = pathsDeFoto(row)
      .map((p) => firmadas.get(p))
      .filter((u): u is string => Boolean(u));

    return {
      id: row.id,
      businessId: row.business_id,
      supplierId: row.supplier_id,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      totalCents: row.total_cents,
      photoUrl: row.photo_url,
      photoSignedUrl: photoUrls[0] ?? null,
      photoUrls,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at,
      documentType: extra(row).document_type ?? "interno",
      expenseConceptId: extra(row).expense_concept_id ?? null,
      dueDate: extra(row).due_date ?? null,
      cancelledAt: extra(row).cancelled_at ?? null,
      cancelledReason: extra(row).cancelled_reason ?? null,
    };
  });
}

// ── Supplier stats by date range ────────────────────────────────

export async function getSupplierStats(
  businessId: string,
  from?: string,
  to?: string,
): Promise<SupplierStats[]> {
  const service = db();

  let query = service
    .from("supplier_invoices")
    .select("supplier_id, total_cents, invoice_date, suppliers!inner(name)")
    .eq("business_id", businessId)
    .is("cancelled_at", null);

  if (from) query = query.gte("invoice_date", from);
  if (to) query = query.lte("invoice_date", to);

  const data = unwrap(await query, "supplier_invoices");
  if (!data.length) return [];

  const map = new Map<
    string,
    { name: string; total: number; count: number; last: string | null }
  >();

  for (const row of data) {
    const supplierName =
      (row.suppliers as unknown as { name: string })?.name ?? "—";
    const entry = map.get(row.supplier_id) ?? {
      name: supplierName,
      total: 0,
      count: 0,
      last: null,
    };
    entry.total += row.total_cents;
    entry.count += 1;
    if (!entry.last || row.invoice_date > entry.last) {
      entry.last = row.invoice_date;
    }
    map.set(row.supplier_id, entry);
  }

  return Array.from(map.entries()).map(([id, v]) => ({
    supplierId: id,
    supplierName: v.name,
    totalSpentCents: v.total,
    invoiceCount: v.count,
    lastInvoiceDate: v.last,
  }));
}

// ── Supplier ↔ ingredients links ────────────────────────────────

export async function getSupplierIngredients(
  supplierId: string,
  businessId: string,
): Promise<SupplierIngredientLink[]> {
  const service = db();

  const data = unwrap(
    await service
      .from("supplier_ingredients")
      .select("supplier_id, ingredient_id, created_at, ingredients!inner(name, unit)")
      .eq("supplier_id", supplierId)
      .eq("business_id", businessId),
    "supplier_ingredients",
  );

  if (!data.length) return [];

  return data.map((row) => {
    const ingredient = row.ingredients as unknown as { name: string; unit: string };
    return {
      supplierId: row.supplier_id,
      ingredientId: row.ingredient_id,
      ingredientName: ingredient.name,
      ingredientUnit: ingredient.unit,
      createdAt: row.created_at,
    };
  });
}

// ── Supplier product outflow (proveedor ↔ salida) ─────────────

export async function getSupplierProductOutflow(
  businessId: string,
  startIso: string,
  endIso: string,
): Promise<SupplierOutflowItem[]> {
  const service = db();

  const [consumptions, links, suppliers] = await Promise.all([
    fetchAll(
      () =>
        service
          .from("ingredient_consumptions")
          .select("ingredient_id, cost_cents_snapshot")
          .eq("business_id", businessId)
          .eq("kind", "venta")
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .order("id"),
      "ingredient_consumptions",
    ),
    fetchAll(
      () =>
        service
          .from("supplier_ingredients")
          .select("supplier_id, ingredient_id")
          .eq("business_id", businessId)
          .order("ingredient_id"),
      "supplier_ingredients",
    ),
    fetchAll(
      () => service.from("suppliers").select("id, name").eq("business_id", businessId).order("id"),
      "suppliers",
    ),
  ]);

  if (!consumptions.length || !links.length) return [];

  const ingredientToSuppliers = new Map<string, Set<string>>();
  for (const link of links) {
    const set = ingredientToSuppliers.get(link.ingredient_id) ?? new Set();
    set.add(link.supplier_id);
    ingredientToSuppliers.set(link.ingredient_id, set);
  }

  const supplierNames = new Map<string, string>();
  for (const s of suppliers) supplierNames.set(s.id, s.name);

  const agg = new Map<string, { costCents: number; count: number }>();
  for (const c of consumptions) {
    const row = c as { ingredient_id: string; cost_cents_snapshot: number };
    const sids = ingredientToSuppliers.get(row.ingredient_id);
    if (!sids) continue;
    for (const sid of sids) {
      const entry = agg.get(sid) ?? { costCents: 0, count: 0 };
      entry.costCents += Math.abs(Number(row.cost_cents_snapshot) || 0);
      entry.count += 1;
      agg.set(sid, entry);
    }
  }

  return Array.from(agg.entries())
    .map(([supplierId, v]) => ({
      supplierId,
      supplierName: supplierNames.get(supplierId) ?? "—",
      totalCostCents: v.costCents,
      consumptionCount: v.count,
    }))
    .sort((a, b) => b.totalCostCents - a.totalCostCents);
}

// ── Ingredients for search (used by link dialog) ────────────────

export type IngredientOption = {
  id: string;
  name: string;
  unit: string;
  /**
   * spec 165 · la presentación default del insumo. Sin ella no se puede
   * convertir «2 bolsas» a «100 kg», que es lo que el renglón necesita para dar
   * de alta stock.
   */
  presentationId?: string | null;
  /** spec 172 · «8,26» no significa nada sin «× Compra 10kg» al lado. */
  presentationName?: string | null;
  netQuantity?: number;
  costCents?: number;
};

export async function getIngredientsForLinking(
  businessId: string,
): Promise<IngredientOption[]> {
  const service = db();
  const filas = await fetchAll(
    () =>
      service
        .from("ingredients")
        .select(
          "id, name, unit, ingredient_presentations!left(id, name, net_quantity, cost_cents, is_default)",
        )
        .eq("business_id", businessId)
        .eq("is_active", true)
        .order("name")
        .order("id"),
    "ingredients",
  );

  return (filas as unknown as Array<{
    id: string;
    name: string;
    unit: string;
    ingredient_presentations?: Array<{
      id: string;
      name: string;
      net_quantity: number | string;
      cost_cents: number;
      is_default: boolean;
    }> | null;
  }>).map((f) => {
    // El embed viene como array; la default es la que importa, y si no hay
    // ninguna marcada se toma la primera antes que dejar el insumo sin envase.
    const pres =
      f.ingredient_presentations?.find((p) => p.is_default) ??
      f.ingredient_presentations?.[0];
    return {
      id: f.id,
      name: f.name,
      unit: f.unit,
      presentationId: pres?.id ?? null,
      presentationName: pres?.name ?? null,
      netQuantity: pres ? Number(pres.net_quantity) : undefined,
      costCents: pres?.cost_cents,
    };
  });
}

/**
 * Los renglones de una tanda de comprobantes, agrupados por comprobante — spec 172.
 *
 * La 165 dejó `supplier_invoice_items` de sólo escritura: la RPC insertaba, la
 * reversión borraba, y no había una sola lectura en toda la app. Ésta es la
 * primera.
 *
 * Se traen todos los del proveedor de una, y no de a uno al seleccionar, porque
 * el mismo dato alimenta las dos cosas: el panel de detalle y el contador de la
 * fila («5 insumos»), que es lo que deja ver **sin abrir** qué comprobantes
 * movieron stock.
 *
 * `presentation_id` puede ser NULL —la línea se cargó sin envase, o la
 * presentación se borró después (`on delete set null`)— y ahí `units` ya venía en
 * unidad base. El nombre se muestra como venga; no se inventa uno.
 */
export async function getRenglonesPorComprobante(
  businessId: string,
  invoiceIds: string[],
): Promise<Record<string, SupplierInvoiceItem[]>> {
  // `supplier_invoice_items` es de la 0073 y todavía no está en
  // `database.types.ts` (el `pnpm db:types` necesita el CLI linkeado). Mismo
  // escape hatch que `actions.ts` para las columnas de la 158.
  const service = db() as unknown as SupabaseClient;

  const filas = await enLotes(invoiceIds, async (lote) =>
    unwrap(
      await service
        .from("supplier_invoice_items")
        .select(
          "id, invoice_id, ingredient_id, units, quantity_base, unit_cost_cents, " +
            "price_base, tasa_iva, ingredients(name, unit), ingredient_presentations(name)",
        )
        .eq("business_id", businessId)
        .in("invoice_id", lote)
        .order("created_at"),
      "supplier_invoice_items",
    ),
  );

  const porComprobante: Record<string, SupplierInvoiceItem[]> = {};
  for (const f of filas as unknown as RenglonRow[]) {
    // PostgREST devuelve el embed como objeto o como array de uno según la
    // cardinalidad que infiera; las dos formas llegan en la práctica.
    const ing = Array.isArray(f.ingredients) ? f.ingredients[0] : f.ingredients;
    const pres = Array.isArray(f.ingredient_presentations)
      ? f.ingredient_presentations[0]
      : f.ingredient_presentations;

    (porComprobante[f.invoice_id] ??= []).push({
      id: f.id,
      invoiceId: f.invoice_id,
      ingredientId: f.ingredient_id,
      ingredientName: ing?.name ?? "Insumo borrado",
      ingredientUnit: ing?.unit ?? "",
      presentationName: pres?.name ?? null,
      // numeric llega como string por PostgREST.
      units: Number(f.units),
      quantityBase: Number(f.quantity_base),
      unitCostCents: Number(f.unit_cost_cents),
      priceBase: f.price_base ?? null,
      // numeric llega como string, igual que `units`.
      tasaIva: f.tasa_iva === null || f.tasa_iva === undefined ? null : Number(f.tasa_iva),
    });
  }
  return porComprobante;
}

type RenglonRow = {
  id: string;
  invoice_id: string;
  ingredient_id: string;
  units: string | number;
  quantity_base: string | number;
  unit_cost_cents: string | number;
  price_base: "neto" | "final" | null;
  tasa_iva: string | number | null;
  ingredients: { name: string; unit: string } | { name: string; unit: string }[] | null;
  ingredient_presentations: { name: string } | { name: string }[] | null;
};

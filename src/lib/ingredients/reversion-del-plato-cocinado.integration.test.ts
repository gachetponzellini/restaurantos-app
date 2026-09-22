// @vitest-environment node
//
// Issue #270 · hallazgo 1 — se te cae el plato que ya estaba hecho, lo anulás,
// y el sistema devuelve la carne a la heladera.
//
// La guarda de la spec 089 sólo excluía `kitchen_status='delivered'`. El ítem
// que ya se mandó a la parrilla —el ticket impreso, la entraña sobre la brasa—
// pasaba derecho: el trigger devolvía 0,400 kg al inventario y escribía una
// `reversion` con el costo real, que `getProfitMetrics` RESTA del food cost.
// Resultado doble: stock fantasma (carne que no existe) y CMV subvaluado, o sea
// margen mejor que el real. Aparece meses después como faltante de inventario y
// se lee como robo del personal.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hoyEnZona } from "@/lib/reservations/horizonte";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-rev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { getMermaReport } = await import("./queries");

describe.skipIf(!dbAvailable)("reversión del plato ya cocinado (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let productId: string;
  let ingredientId: string;
  let orderId: string;

  const stock = async () => {
    const { data } = await supabase
      .from("ingredients")
      .select("stock_quantity")
      .eq("id", ingredientId)
      .single();
    return Number(data!.stock_quantity);
  };

  const consumos = async (orderItemId: string) => {
    const { data } = await supabase
      .from("ingredient_consumptions")
      .select("kind, quantity, cost_cents_snapshot")
      .eq("order_item_id", orderItemId);
    return (data ?? []) as unknown as Array<{
      kind: string;
      quantity: string;
      cost_cents_snapshot: number;
    }>;
  };

  /** Carga una línea (dispara el descuento de receta) y devuelve su id. */
  const cargarLinea = async (kitchenStatus: string) => {
    const { data: item, error } = await supabase
      .from("order_items")
      .insert({
        order_id: orderId,
        product_id: productId,
        product_name: "Entraña",
        unit_price_cents: 1_500_000,
        quantity: 1,
        subtotal_cents: 1_500_000,
        kitchen_status: kitchenStatus,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return item!.id as string;
  };

  const anular = async (itemId: string, motivo: string) => {
    const { error } = await supabase
      .from("order_items")
      .update({ cancelled_at: new Date().toISOString(), cancelled_reason: motivo })
      .eq("id", itemId);
    if (error) throw new Error(error.message);
  };

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Reversión Test", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;

    const { data: ing } = await supabase
      .from("ingredients")
      .insert({
        business_id: businessId,
        name: `Entraña ${TEST_TAG}`,
        unit: "kg",
        stock_quantity: 6,
        waste_percent: 0,
      })
      .select("id")
      .single();
    ingredientId = ing!.id;

    await supabase.from("ingredient_presentations").insert({
      ingredient_id: ingredientId,
      name: "Vacío 1 kg",
      net_quantity: 1,
      cost_cents: 700_000,
      is_default: true,
    });

    const { data: cat } = await supabase
      .from("categories")
      .insert({ business_id: businessId, name: `Parrilla ${TEST_TAG}`, slug: `par-${TEST_TAG}` })
      .select("id")
      .single();

    const { data: prod } = await supabase
      .from("products")
      .insert({
        business_id: businessId,
        category_id: cat!.id,
        name: `Entraña ${TEST_TAG}`,
        slug: `entrana-${TEST_TAG}`,
        price_cents: 1_500_000,
      })
      .select("id")
      .single();
    productId = prod!.id;

    // 400 g de entraña por plato.
    await supabase
      .from("recipes")
      .insert({ product_id: productId, ingredient_id: ingredientId, quantity: 0.4 });

    const { data: ord } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        order_number: 1,
        customer_name: "Mesa 12",
        customer_phone: "-",
        delivery_type: "dine_in",
        subtotal_cents: 0,
        total_cents: 0,
      })
      .select("id")
      .single();
    orderId = ord!.id;
  }, 30_000);

  beforeEach(async () => {
    await supabase.from("ingredients").update({ stock_quantity: 6 }).eq("id", ingredientId);
  });

  afterAll(async () => {
    await supabase.from("ingredient_consumptions").delete().eq("business_id", businessId);
    await supabase.from("order_items").delete().eq("order_id", orderId);
    await supabase.from("orders").delete().eq("business_id", businessId);
    await supabase.from("recipes").delete().eq("product_id", productId);
    await supabase.from("products").delete().eq("business_id", businessId);
    await supabase.from("categories").delete().eq("business_id", businessId);
    await supabase.from("ingredient_presentations").delete().eq("ingredient_id", ingredientId);
    await supabase.from("ingredients").delete().eq("business_id", businessId);
    await supabase.from("businesses").delete().eq("id", businessId);
  }, 30_000);

  // ── lo que ya fue a la parrilla no vuelve a la heladera ────────────────

  it("anular una línea que ya se mandó a cocina NO devuelve el insumo", async () => {
    const itemId = await cargarLinea("preparing");
    expect(await stock()).toBeCloseTo(5.6, 3);

    await anular(itemId, "se cayó al piso");

    // La carne se cocinó de verdad y está en la basura.
    expect(await stock()).toBeCloseTo(5.6, 3);
  });

  it("y la deja registrada como merma, con su costo real", async () => {
    const itemId = await cargarLinea("preparing");
    await anular(itemId, "se cayó al piso");

    const filas = await consumos(itemId);
    expect(filas.filter((f) => f.kind === "reversion")).toHaveLength(0);

    const merma = filas.filter((f) => f.kind === "merma");
    expect(merma).toHaveLength(1);
    expect(Number(merma[0].quantity)).toBeCloseTo(0.4, 3);
    // 0,4 kg × $7.000/kg = $2.800. El costo se queda en el CMV: la fila
    // simplemente deja de ser una venta y pasa a ser una pérdida.
    expect(merma[0].cost_cents_snapshot).toBe(280_000);
  });

  it("el reporte de merma la ve como salida, y «Salió» no cambia", async () => {
    const itemId = await cargarLinea("preparing");
    const hoy = hoyEnZona(new Date(), "America/Argentina/Buenos_Aires");

    const antes = (await getMermaReport(businessId, hoy, hoy)).find(
      (r) => r.ingredientId === ingredientId,
    );
    const salidaAntes = antes?.exitedQty ?? 0;

    await anular(itemId, "se cayó al piso");

    const despues = (await getMermaReport(businessId, hoy, hoy)).find(
      (r) => r.ingredientId === ingredientId,
    );
    // La mercadería salió igual: lo que cambia es el motivo, no la cantidad.
    expect(despues!.exitedQty).toBeCloseTo(salidaAntes, 3);
    expect(despues!.mermaRegistradaQty).toBeGreaterThan(0);
  });

  // ── lo que todavía no salió del sistema sí vuelve ──────────────────────

  it("anular una línea que nunca se mandó a cocina SÍ devuelve el insumo", async () => {
    const itemId = await cargarLinea("pending");
    expect(await stock()).toBeCloseTo(5.6, 3);

    await anular(itemId, "el cliente cambió de idea");

    expect(await stock()).toBeCloseTo(6, 3);

    const filas = await consumos(itemId);
    expect(filas.some((f) => f.kind === "reversion")).toBe(true);
  });

  // ── el espejo del reporte: la venta revertida deja de contar como salida ─

  it("la reversión de una línea cancelada descuenta de lo que se vendió", async () => {
    const itemId = await cargarLinea("pending");
    const hoy = hoyEnZona(new Date(), "America/Argentina/Buenos_Aires");

    await anular(itemId, "el cliente cambió de idea");

    const fila = (await getMermaReport(businessId, hoy, hoy)).find(
      (r) => r.ingredientId === ingredientId,
    )!;
    const filas = await consumos(itemId);
    const venta = filas.find((f) => f.kind === "venta")!;
    const rev = filas.find((f) => f.kind === "reversion")!;

    // Las dos filas existen y se cancelan entre sí: el insumo volvió a la
    // heladera, así que no puede seguir contando como salida.
    expect(Number(venta.quantity)).toBeCloseTo(0.4, 3);
    expect(Number(rev.quantity)).toBeCloseTo(0.4, 3);
    expect(fila.ventaQty).toBeCloseTo(0, 3);
  });
});

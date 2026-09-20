// @vitest-environment node
//
// 0125 — la merma es rendimiento: una sola cuenta en el costeo, en el descuento
// de stock y en el costo de mercadería de la venta.
//
// Lomo a $10.000 el kilo con 20 % de merma; el plato lleva 200 g LIMPIOS. Del
// depósito salen 250 g y el plato cuesta $2.500. Antes: el costeo decía $2.400,
// el stock bajaba 200 g y la venta guardaba $2.000 — tres números.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(url && key);

const { getCosteoOverview } = await import("./queries");

const TAG = `test-merma-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!dbAvailable)("la merma es rendimiento (integration · 0125)", () => {
  const db = createClient(url!, key!, { auth: { autoRefreshToken: false, persistSession: false } });
  let businessId = "";
  let lomoId = "";
  let productId = "";

  beforeAll(async () => {
    const { data: biz, error } = await db
      .from("businesses")
      .insert({ slug: TAG, name: "Merma Test", is_active: true })
      .select("id")
      .single();
    if (error) throw error;
    businessId = biz!.id;

    const { data: lomo } = await db
      .from("ingredients")
      .insert({ business_id: businessId, name: "Lomo", unit: "kg", waste_percent: 20, stock_quantity: 10 })
      .select("id")
      .single();
    lomoId = lomo!.id;
    await db.from("ingredient_presentations").insert({
      ingredient_id: lomoId, name: "Kilo", net_quantity: 1, cost_cents: 10_000_00, is_default: true,
    });

    const { data: cat } = await db
      .from("categories")
      .insert({ business_id: businessId, name: "Platos", slug: `platos-${TAG}` })
      .select("id")
      .single();
    const { data: prod, error: pErr } = await db
      .from("products")
      .insert({
        business_id: businessId, category_id: cat!.id, name: "Lomo al plato",
        slug: `lomo-${TAG}`, price_cents: 10_000_00, is_active: true,
      })
      .select("id")
      .single();
    if (pErr) throw pErr;
    productId = prod!.id;
    const { error: rErr } = await db
      .from("recipes")
      .insert({ product_id: productId, ingredient_id: lomoId, quantity: 0.2 });
    if (rErr) throw rErr;
  }, 60_000);

  afterAll(async () => {
    if (businessId) await db.from("businesses").delete().eq("id", businessId);
  }, 60_000);

  it("el costeo cuesta el plato con el insumo bruto: $2.500, no $2.400", async () => {
    const costeo = await getCosteoOverview(businessId);
    expect(costeo.find((c) => c.productId === productId)?.foodCostCents).toBe(2_500_00);
  });

  it("vender el plato saca del depósito 250 g y guarda $2.500 de costo", async () => {
    const { data: order, error } = await db
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "M", customer_phone: "0",
        delivery_type: "dine_in", subtotal_cents: 10_000_00, total_cents: 10_000_00,
        lifecycle_status: "open",
      })
      .select("id")
      .single();
    if (error) throw error;
    const { data: item, error: iErr } = await db
      .from("order_items")
      .insert({
        order_id: order!.id, product_id: productId, product_name: "Lomo al plato",
        unit_price_cents: 10_000_00, quantity: 1, subtotal_cents: 10_000_00,
      })
      .select("id")
      .single();
    if (iErr) throw iErr;

    const { data: ing } = await db.from("ingredients").select("stock_quantity").eq("id", lomoId).single();
    expect(Number(ing!.stock_quantity)).toBeCloseTo(9.75, 4);

    const { data: consumo } = await db
      .from("ingredient_consumptions")
      .select("quantity, cost_cents_snapshot")
      .eq("order_item_id", item!.id)
      .eq("kind", "venta")
      .single();
    expect(Number(consumo!.quantity)).toBeCloseTo(0.25, 4);
    expect(Number(consumo!.cost_cents_snapshot)).toBe(2_500_00);

    // Y cancelar la línea devuelve exactamente lo mismo.
    await db.from("order_items").update({ cancelled_at: new Date().toISOString(), cancelled_reason: "test" }).eq("id", item!.id);
    const { data: despues } = await db.from("ingredients").select("stock_quantity").eq("id", lomoId).single();
    expect(Number(despues!.stock_quantity)).toBeCloseTo(10, 4);
  });
});

// @vitest-environment node
//
// El reporte de merma leído de punta a punta — issue #270 · hallazgos 6 y 7.
//
//   6. Se anulaba un comprobante cargado por error y «Entró» seguía contando la
//      mercadería que nunca entró.
//   7. Las lecturas no paginaban: PostgREST corta en 1.000 filas
//      (`max_rows = 1000` en supabase/config.toml, `PGRST_DB_MAX_ROWS=1000` en
//      el contenedor) y devuelve 200 con un array corto, sin error ni bandera.
//      A partir de ahí el reporte se calcula sobre un recorte arbitrario —
//      siempre para abajo, o sea el número da lindo. Con recetas completas son
//      ~200 platos × ~5 insumos hoja = mil filas por servicio.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hoyEnZona } from "@/lib/reservations/horizonte";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-merma-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { getMermaReport } = await import("./queries");

describe.skipIf(!dbAvailable)("reporte de merma (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let ingredientId: string;

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Merma Test", is_active: true })
      .select("id")
      .single();
    businessId = biz!.id;

    const { data: ing } = await supabase
      .from("ingredients")
      .insert({
        business_id: businessId,
        name: `Entraña ${TEST_TAG}`,
        unit: "kg",
        stock_quantity: 0,
        waste_percent: 10,
      })
      .select("id")
      .single();
    ingredientId = ing!.id;
  }, 30_000);

  afterAll(async () => {
    await supabase.from("ingredient_consumptions").delete().eq("business_id", businessId);
    await supabase.from("ingredients").delete().eq("business_id", businessId);
    await supabase.from("businesses").delete().eq("id", businessId);
  }, 60_000);

  const limpiar = async () => {
    await supabase.from("ingredient_consumptions").delete().eq("business_id", businessId);
  };

  const hoy = () => hoyEnZona(new Date(), "America/Argentina/Buenos_Aires");

  it("la mercadería de un comprobante anulado deja de contar como que entró", async () => {
    await limpiar();
    await supabase.from("ingredient_consumptions").insert([
      {
        business_id: businessId,
        ingredient_id: ingredientId,
        quantity: 20,
        cost_cents_snapshot: 1_400_000,
        kind: "compra",
      },
      // Lo que escribe `revertir_items_comprobante_tx`: sin order_item_id y en
      // negativo.
      {
        business_id: businessId,
        ingredient_id: ingredientId,
        quantity: -20,
        cost_cents_snapshot: 0,
        kind: "reversion",
      },
    ]);

    const [item] = await getMermaReport(businessId, hoy(), hoy());

    expect(item.enteredQty).toBe(0);
    // Sin el fix: entró 20, salió 0, y «Diferencia» acusaba 20 kg de faltante.
    expect(item.diffQty).toBe(0);
    expect(item.mermaEstimadaQty).toBe(0);
  });

  // La otra mitad del espejo —el plato cancelado que deja de contar como
  // vendido— necesita una línea de pedido real y se verifica en
  // `reversion-del-plato-cocinado.integration.test.ts`, junto al trigger que la
  // escribe. La regla pura está cubierta en `merma.test.ts`.

  // ── #270 · 7 — el techo de 1.000 filas ────────────────────────────────
  //
  // 1.200 consumos de 1 kg cada uno. Sin paginar, PostgREST devuelve 1.000 y el
  // total sale 1.000: un 17% menos, sin ruido. La afirmación es sobre la SUMA,
  // que es determinista.
  it("suma todas las filas del período, también arriba de las mil", async () => {
    await limpiar();

    const filas = Array.from({ length: 1_200 }, () => ({
      business_id: businessId,
      ingredient_id: ingredientId,
      quantity: 1,
      cost_cents_snapshot: 100,
      kind: "compra",
    }));
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await supabase
        .from("ingredient_consumptions")
        .insert(filas.slice(i, i + 500));
      expect(error).toBeNull();
    }

    const [item] = await getMermaReport(businessId, hoy(), hoy());

    expect(item.enteredQty).toBe(1_200);
  }, 60_000);
});

// @vitest-environment node
//
// Issue #126 — el envío a cocina es todo o nada.
//
// `createComandasForItems` creaba una comanda por sector en un loop, con
// inserts sueltos. Si fallaba el sector N, los sectores 1..N-1 ya estaban
// creados (y el print-agent los imprimía): la parrilla arrancaba un bife que
// salía con minutos de ventaja sobre el resto del plato, y el mozo, que vio
// el error, reenviaba.
//
// Ahora el ruteo entero es una RPC (`crear_comandas_tx`): o se crean todas las
// comandas con sus ítems, o ninguna.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-ruteo-tx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const { createComandasForItems } = await import("./route-items");

describe.skipIf(!dbAvailable)("comandas · ruteo transaccional (integration · #126)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let parrilla: string;
  let cocina: string;

  async function nuevaOrden() {
    const { data: order } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, customer_name: "C", customer_phone: "0",
        delivery_type: "delivery", subtotal_cents: 10_000, total_cents: 10_000,
        lifecycle_status: "open",
      })
      .select("id").single();
    const orderId = order!.id as string;
    const { data: items } = await supabase
      .from("order_items")
      .insert([
        { order_id: orderId, product_name: "Bife", unit_price_cents: 5_000, quantity: 1, subtotal_cents: 5_000 },
        { order_id: orderId, product_name: "Flan", unit_price_cents: 5_000, quantity: 1, subtotal_cents: 5_000 },
      ])
      .select("id, product_name");
    const byName = new Map((items ?? []).map((i) => [i.product_name as string, i.id as string]));
    return { orderId, bife: byName.get("Bife")!, flan: byName.get("Flan")! };
  }

  async function comandasDe(orderId: string) {
    const { data } = await supabase
      .from("comandas")
      .select("id, station_id, batch, notes, comanda_items(order_item_id)")
      .eq("order_id", orderId)
      .order("batch");
    return (data ?? []) as {
      id: string; station_id: string; batch: number; notes: string | null;
      comanda_items: { order_item_id: string }[];
    }[];
  }

  beforeAll(async () => {
    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Ruteo TX Test", is_active: true })
      .select("id").single();
    businessId = biz!.id;

    const { data: sts } = await supabase
      .from("stations")
      .insert([
        { business_id: businessId, name: "Parrilla" },
        { business_id: businessId, name: "Cocina" },
      ])
      .select("id, name");
    const byName = new Map((sts ?? []).map((s) => [s.name as string, s.id as string]));
    parrilla = byName.get("Parrilla")!;
    cocina = byName.get("Cocina")!;
  });

  afterAll(async () => {
    if (businessId) await supabase.from("businesses").delete().eq("id", businessId);
  });

  it("si falla un sector, no queda creada la comanda de ningún otro", async () => {
    const { orderId, bife } = await nuevaOrden();
    // El segundo sector trae un ítem que no existe: su link viola la FK.
    const inexistente = "00000000-0000-4000-8000-000000000126";
    const res = await createComandasForItems(
      supabase as never,
      orderId,
      new Map([
        [parrilla, [bife]],
        [cocina, [inexistente]],
      ]),
    );

    expect(res.ok).toBe(false);
    expect(await comandasDe(orderId)).toEqual([]);
  });

  it("un envío sano crea una comanda por sector, con sus ítems y la observación", async () => {
    const { orderId, bife, flan } = await nuevaOrden();
    const res = await createComandasForItems(
      supabase as never,
      orderId,
      new Map([
        [parrilla, [bife]],
        [cocina, [flan]],
      ]),
      { notes: "va todo junto" },
    );

    expect(res.ok).toBe(true);
    const comandas = await comandasDe(orderId);
    expect(comandas).toHaveLength(2);
    // Los ids vuelven en el orden del Map.
    expect(res.ok && res.comanda_ids).toEqual([
      comandas.find((c) => c.station_id === parrilla)!.id,
      comandas.find((c) => c.station_id === cocina)!.id,
    ]);
    for (const c of comandas) {
      expect(c.batch).toBe(1);
      expect(c.notes).toBe("va todo junto");
    }
    expect(comandas.find((c) => c.station_id === parrilla)!.comanda_items).toEqual([
      { order_item_id: bife },
    ]);
    expect(comandas.find((c) => c.station_id === cocina)!.comanda_items).toEqual([
      { order_item_id: flan },
    ]);

    // Orden de emisión = orden del envío, sin empates: el agente y los
    // tableros ordenan por `emitted_at`.
    const { data: emitidas } = await supabase
      .from("comandas")
      .select("id, emitted_at")
      .eq("order_id", orderId)
      .order("emitted_at", { ascending: true });
    expect((emitidas ?? []).map((c) => c.id)).toEqual(res.ok ? res.comanda_ids : []);
    expect(new Set((emitidas ?? []).map((c) => c.emitted_at)).size).toBe(2);
  });

  it("la segunda tanda de un sector numera el batch siguiente; un sector vacío no crea nada", async () => {
    const { orderId, bife, flan } = await nuevaOrden();
    await createComandasForItems(supabase as never, orderId, new Map([[parrilla, [bife]]]));
    const res = await createComandasForItems(
      supabase as never,
      orderId,
      new Map([
        [parrilla, [flan]],
        [cocina, []],
      ]),
    );

    expect(res.ok).toBe(true);
    expect(res.ok && res.comanda_ids).toHaveLength(1);
    const comandas = await comandasDe(orderId);
    expect(comandas.map((c) => [c.station_id, c.batch])).toEqual([
      [parrilla, 1],
      [parrilla, 2],
    ]);
  });

  it("primera ruteada: el sector que ya tenía su batch 1 se saltea y el resto se crea", async () => {
    const { orderId, bife, flan } = await nuevaOrden();
    await createComandasForItems(supabase as never, orderId, new Map([[parrilla, [bife]]]), {
      primeraRuteada: true,
    });
    const res = await createComandasForItems(
      supabase as never,
      orderId,
      new Map([
        [parrilla, [bife]],
        [cocina, [flan]],
      ]),
      { primeraRuteada: true },
    );

    expect(res.ok).toBe(true);
    expect(res.ok && res.comanda_ids).toHaveLength(1);
    const comandas = await comandasDe(orderId);
    expect(comandas.map((c) => [c.station_id, c.batch]).sort()).toEqual(
      [
        [parrilla, 1],
        [cocina, 1],
      ].sort(),
    );
  });
});

// @vitest-environment node
//
// #360 — las lecturas de caja traen TODAS las filas.
//
// PostgREST corta en 1.000 filas sin avisar. Los cobros del período de una caja
// y los pendientes de un mozo que nunca rindió (toda su historia) se leían sin
// paginar: con más de mil, el esperado del arqueo salía más chico en silencio.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const { getCajaLiveStats, getRendicionPendienteMozo } = await import("./queries");

const s = crearSalon(`test-sin-tope-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
const N = 1_100;

describe.skipIf(!dbAvailable)("caja sin tope de 1.000 filas (integration · #360)", () => {
  beforeAll(async () => {
    await s.setup();
    const { data: order } = await s.sb
      .from("orders")
      .insert({
        business_id: s.ctx.businessId,
        customer_name: "Mil",
        customer_phone: "0",
        delivery_type: "pickup",
        subtotal_cents: 100 * N,
        total_cents: 100 * N,
        lifecycle_status: "closed",
      })
      .select("id")
      .single();
    const filas = Array.from({ length: N }, () => ({
      order_id: order!.id,
      business_id: s.ctx.businessId,
      caja_id: s.ctx.cajaId,
      attributed_mozo_id: s.ctx.mozoId,
      method: "cash",
      amount_cents: 100,
      tip_cents: 0,
      payment_status: "paid",
    }));
    const { error } = await s.sb.from("payments").insert(filas);
    if (error) throw error;
  }, 120_000);
  afterAll(s.teardown, 60_000);

  it("el esperado de la caja suma los 1.100 cobros", async () => {
    const stats = await getCajaLiveStats(s.ctx.cajaId, s.ctx.businessId);
    expect(stats!.cobros_count).toBe(N);
    expect(stats!.expected_cash_cents).toBe(100 * N);
  });

  it("lo pendiente de rendir de un mozo suma los 1.100 cobros", async () => {
    const p = await getRendicionPendienteMozo(s.ctx.mozoId, s.ctx.businessId, "Mozo");
    expect(p.pagos_count).toBe(N);
    expect(p.efectivo_cents).toBe(100 * N);
  });
});

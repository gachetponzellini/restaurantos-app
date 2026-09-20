// @vitest-environment node
//
// #359 — la rendición y el pago de su propina son UNA transacción, y dos
// rendiciones del mismo mozo a la vez no pagan la propina dos veces.
//
// Antes: insert de la rendición, después insert del movimiento de propina, con
// un `delete` a mano si el segundo fallaba. Dos rendiciones simultáneas (doble
// tap, dos pestañas) leían el mismo pendiente y las dos pagaban la propina.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: CURRENT_USER_ID } }, error: null }),
      getUser: async () => ({ data: { user: { id: CURRENT_USER_ID } }, error: null }),
    },
  }),
}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { registrarRendicionMozo } = await import("./actions");

const s = crearSalon(`test-rend-atomica-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

async function cobroDelMozo(amount: number, tip: number, method = "card_manual") {
  const m = await s.mesa([amount - tip], { tip });
  await s.sb.from("payments").insert({
    order_id: m.orderId,
    business_id: s.ctx.businessId,
    caja_id: s.ctx.cajaId,
    operated_by: s.ctx.mozoId,
    attributed_mozo_id: s.ctx.mozoId,
    method,
    amount_cents: amount,
    tip_cents: tip,
    payment_status: "paid",
  });
  await s.sb
    .from("orders")
    .update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: amount })
    .eq("id", m.orderId);
}

const propinasPagadas = async () => {
  const { data } = await s.sb
    .from("caja_movimientos")
    .select("amount_cents")
    .eq("business_id", s.ctx.businessId)
    .eq("kind", "propina");
  return ((data ?? []) as { amount_cents: number }[]).reduce((n, m) => n + m.amount_cents, 0);
};

describe.skipIf(!dbAvailable)("rendición atómica (integration · #359)", () => {
  beforeAll(async () => {
    await s.setup();
    CURRENT_USER_ID = s.ctx.encargadoId;
  }, 60_000);
  afterAll(s.teardown, 60_000);

  it("dos rendiciones simultáneas del mismo mozo pagan la propina una vez", async () => {
    await cobroDelMozo(1_100_000, 100_000);
    const [a, b] = await Promise.all([
      registrarRendicionMozo(s.ctx.mozoId, 0, null, s.ctx.slug),
      registrarRendicionMozo(s.ctx.mozoId, 0, null, s.ctx.slug),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await propinasPagadas()).toBe(100_000);
    const { count } = await s.sb
      .from("mozo_rendiciones")
      .select("id", { count: "exact", head: true })
      .eq("mozo_id", s.ctx.mozoId);
    expect(count).toBe(1);
  });

  it("la propina se sella con el reloj de la base, nunca antes que su rendición", async () => {
    // El movimiento llevaba la hora de Node. Si un cierre del bar se firmaba
    // entre la lectura y la escritura, la propina quedaba con una hora ANTERIOR
    // al corte pero fuera de su esperado: no la contaba ni ese cierre ni el
    // siguiente. Con el reloj de la base (y el lock de la caja) no puede pasar.
    await cobroDelMozo(550_000, 50_000);
    const antes = Date.now();
    const r = await registrarRendicionMozo(s.ctx.mozoId, 0, null, s.ctx.slug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.propina_pagada_cents).toBe(50_000);
    const { data: mov } = await s.sb
      .from("caja_movimientos")
      .select("created_at")
      .eq("business_id", s.ctx.businessId)
      .eq("kind", "propina")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(new Date(mov!.created_at).getTime()).toBeGreaterThanOrEqual(
      new Date(r.data.rendicion.created_at).getTime(),
    );
    expect(new Date(mov!.created_at).getTime()).toBeGreaterThanOrEqual(antes - 2_000);
  });

  it("un cobro que entra entre la lectura y la escritura no queda huérfano", async () => {
    // El residual que el #264 dejó escrito: la rendición lee los cobros, y uno
    // que entre antes de que se guarde queda con una hora anterior al piso del
    // próximo período — no lo rinde nadie nunca, pero el cajón lo sigue
    // esperando. La RPC cuenta de nuevo bajo su lock y, si no coincide con lo
    // que se leyó, rechaza para que se vuelva a leer.
    await cobroDelMozo(300_000, 0, "cash");
    const { data: ultima } = await s.sb
      .from("mozo_rendiciones")
      .select("id")
      .eq("mozo_id", s.ctx.mozoId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // La action leyó 0 cobros… y mientras tanto entró el de arriba.
    const r = await s.sb.rpc("registrar_rendicion_tx", {
      p_business_id: s.ctx.businessId,
      p_mozo_id: s.ctx.mozoId,
      p_registered_by: s.ctx.encargadoId,
      p_desde_rendicion_id: (ultima as { id: string } | null)?.id ?? null,
      p_created_at: new Date().toISOString(),
      p_expected_cash_cents: 0,
      p_delivered_cash_cents: 0,
      p_difference_cents: 0,
      p_notes: null,
      p_por_metodo: {},
      p_por_canal: {},
      p_estado: "rendida",
      p_propina_pagada_cents: 0,
      p_caja_id: null,
      p_propina_reason: "x",
      p_pagos_leidos: 0,
    });
    expect(r.error?.message ?? "").toContain("RENDICION_CONCURRENTE");

    // Por la action, que lee y escribe seguido, entra bien y rinde los $3.000.
    const ok = await registrarRendicionMozo(s.ctx.mozoId, 300_000, null, s.ctx.slug);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.rendicion.expected_cash_cents).toBe(300_000);
  });
});

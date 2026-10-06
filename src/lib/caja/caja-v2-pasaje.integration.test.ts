// @vitest-environment node
//
// Spec 210 v2 · R8 (migración 0140) — todos a la caja nueva. El pasaje de un
// negocio que venía con el modelo viejo: sólo el efectivo no rendido del
// período abierto pasa a nombre del mozo; nada se pierde ni se cuenta dos veces.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const s = crearSalon(`test-pasaje-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => {
  const { data, error } = await s.sb.rpc(fn, args);
  if (error) throw error;
  return data as T;
};
const esperado = async () =>
  Number(await rpc("efectivo_esperado_caja", { p_caja_id: s.ctx.cajaId, p_hasta: new Date(Date.now() + 1000).toISOString() }));

async function cobro(amount: number) {
  const m = await s.mesa([amount]);
  const { data, error } = await s.sb.from("payments").insert({
    order_id: m.orderId, business_id: s.ctx.businessId, caja_id: s.ctx.cajaId,
    operated_by: s.ctx.encargadoId, attributed_mozo_id: s.ctx.mozoId,
    method: "cash", amount_cents: amount, tip_cents: 0, payment_status: "paid",
  }).select("id").single();
  if (error) throw error;
  await s.sb.from("orders").update({ lifecycle_status: "closed", payment_status: "paid", total_paid_cents: amount }).eq("id", m.orderId);
  return data!.id as string;
}
const espera = () => new Promise((r) => setTimeout(r, 20));

describe.skipIf(!dbAvailable)("caja v2 · pasaje (0140)", () => {
  beforeAll(async () => {
    await s.setup();
  });
  afterAll(async () => {
    await s.teardown();
  });

  it("un negocio nuevo nace en el modelo nuevo, con su turno abierto", async () => {
    const { data: biz } = await s.sb.from("businesses").select("caja_modelo_v2_desde").eq("id", s.ctx.businessId).single();
    expect(biz!.caja_modelo_v2_desde).not.toBeNull();
    const { data: t } = await s.sb.from("turnos").select("id").eq("business_id", s.ctx.businessId).is("cerrado_at", null);
    expect(t).toHaveLength(1);
  });

  it("el pasaje: sólo lo no rendido del período abierto pasa a nombre del mozo", async () => {
    // Simula un negocio del modelo viejo.
    await s.sb.from("turnos").delete().eq("business_id", s.ctx.businessId);
    await s.sb.from("businesses").update({ caja_modelo_v2_desde: null }).eq("id", s.ctx.businessId);

    const cerrado = await cobro(11_000);                 // queda en un período ya cerrado
    await espera();
    await s.sb.from("caja_cortes").insert({
      caja_id: s.ctx.cajaId, business_id: s.ctx.businessId, encargado_id: s.ctx.encargadoId,
      expected_cash_cents: 11_000, closing_cash_cents: 0, difference_cents: -11_000,
      closing_notes: "faltó lo del mozo",
    });
    await espera();
    const rendido = await cobro(22_000);                 // ya rendido con el modelo viejo
    await espera();
    await s.sb.from("mozo_rendiciones").insert({
      business_id: s.ctx.businessId, mozo_id: s.ctx.mozoId, registered_by: s.ctx.encargadoId,
      expected_cash_cents: 22_000, delivered_cash_cents: 22_000, difference_cents: 0,
      por_metodo: {}, por_canal: {}, estado: "rendida",
    });
    await espera();
    const pendiente = await cobro(33_000);               // lo que tiene encima ahora
    const cajaAntes = await esperado();

    const pasados = await rpc<number>("pasar_al_modelo_nuevo", { p_business_id: s.ctx.businessId });
    expect(pasados).toBe(1);

    const { data: pagos } = await s.sb.from("payments").select("id, rinde_mozo_id").in("id", [cerrado, rendido, pendiente]);
    const rinde = Object.fromEntries((pagos ?? []).map((p) => [p.id, p.rinde_mozo_id]));
    expect(rinde[pendiente]).toBe(s.ctx.mozoId);
    expect(rinde[rendido]).toBeNull();
    expect(rinde[cerrado]).toBeNull();

    // El cajón deja de esperar lo que tiene el mozo, y su saldo lo muestra: nada se pierde.
    expect(await esperado()).toBe(cajaAntes - 33_000);
    expect(Number(await rpc("saldo_mozo", { p_mozo_id: s.ctx.mozoId, p_caja_id: s.ctx.cajaId }))).toBe(33_000);

    const { data: t } = await s.sb.from("turnos").select("id, abierto_at").eq("business_id", s.ctx.businessId).is("cerrado_at", null);
    expect(t).toHaveLength(1);
    // 0142 — el turno arranca con el primer cobro pasado: lo de hoy no es «de antes».
    const { data: pp } = await s.sb.from("payments").select("created_at").eq("id", pendiente).single();
    expect(new Date(t![0].abierto_at).getTime()).toBeLessThanOrEqual(new Date(pp!.created_at).getTime());
    const [saldo] = (await rpc<{ anterior_cents: number; efectivo_cents: number }[]>("saldos_mozos", {
      p_business_id: s.ctx.businessId, p_desde: t![0].abierto_at,
    })) ?? [];
    expect(saldo.anterior_cents).toBe(0);
    expect(saldo.efectivo_cents).toBe(33_000);
    // Correrlo de nuevo no hace nada.
    expect(await rpc<number>("pasar_al_modelo_nuevo", { p_business_id: s.ctx.businessId })).toBe(0);
  });
});

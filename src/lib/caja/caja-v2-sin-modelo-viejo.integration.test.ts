// @vitest-environment node
//
// Spec 210 v2 (migración 0145) — el modelo viejo ya no existe. Todos los
// negocios pasaron (0140) y los nuevos nacen en el modelo nuevo: no hay vuelta
// atrás posible ni RPCs de la rendición por período dando vueltas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearSalon, dbAvailable } from "@/lib/billing/test-helpers/salon-fixture";

const s = crearSalon(`test-sin-v1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);

describe.skipIf(!dbAvailable)("caja v2 · sin modelo viejo (0145)", () => {
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

  it("no se puede volver al modelo viejo", async () => {
    const { error } = await s.sb.from("businesses").update({ caja_modelo_v2_desde: null }).eq("id", s.ctx.businessId);
    expect(error?.message ?? "").toMatch(/null value|not-null/);
  });

  it("la rendición por período y el pasaje ya no existen", async () => {
    for (const fn of ["registrar_rendicion_tx", "pasar_al_modelo_nuevo"]) {
      const { error } = await s.sb.rpc(fn, { p_business_id: s.ctx.businessId });
      expect(error, fn).not.toBeNull();
      expect(error!.message).toMatch(/Could not find the function|does not exist/);
    }
  });

  it("el pedido de pasaje por negocio ya no existe", async () => {
    const { error } = await s.sb.from("businesses").select("caja_modelo_v2_pedido").eq("id", s.ctx.businessId);
    expect(error?.message ?? "").toMatch(/caja_modelo_v2_pedido/);
  });
});

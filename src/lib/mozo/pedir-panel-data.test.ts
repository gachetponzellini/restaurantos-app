import { beforeEach, describe, expect, it, vi } from "vitest";

// #294 — el gate de `loadTableComandas`. Es el loader del panel de UNA mesa en
// el salón, y tenía una lista de roles escrita a mano (admin o encargado) que
// dejaba afuera a la `terminal` de la spec 140: el plano se abría, la mesa
// decía «todavía no tiene nada cargado» con tres comandas en cocina. El gate
// es la matriz de secciones —quien ve Operación, ve sus mesas— y el mozo, que
// no ve el plano, sigue afuera. Los bordes van mockeados para no tocar la DB.

let gateOk: boolean;
let rol: string;

vi.mock("@/lib/tenant", () => ({
  getBusiness: async (slug: string) =>
    slug === "nope"
      ? null
      : { id: "biz1", slug, timezone: "America/Argentina/Buenos_Aires" },
}));

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () =>
    gateOk
      ? {
          ok: true as const,
          data: { userId: "u1", role: rol, isPlatformAdmin: false },
        }
      : { ok: false as const, error: "No tenés acceso a este negocio." },
}));

const getActiveOrderByTable = vi.fn(async () => ({ id: "o1" }));
const getComandasByOrder = vi.fn(async () => [
  { id: "c1", status: "pendiente" },
]);
vi.mock("@/lib/comandas/queries", () => ({
  getActiveOrderByTable: (...a: unknown[]) =>
    getActiveOrderByTable(...(a as [])),
  getComandasByOrder: (...a: unknown[]) => getComandasByOrder(...(a as [])),
  getStationsByBusiness: async () => [],
}));

const getLoPedido = vi.fn(async () => ({ order_id: "o1", items: [{}] }));
vi.mock("@/lib/mozo/lo-pedido-query", () => ({
  getLoPedido: (...a: unknown[]) => getLoPedido(...(a as [])),
}));

vi.mock("@/lib/mozo/catalog-query", () => ({
  getCatalogForMozo: async () => ({}),
}));
vi.mock("@/lib/mozo/daily-menus-query", () => ({
  getDailyMenusForToday: async () => [],
}));
vi.mock("@/lib/mozo/top-products", () => ({
  getTopProductIds: async () => [],
}));

// La mesa cuelga de un plano de `biz1` (guard cross-tenant intacto).
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "t1", floor_plans: { business_id: "biz1" } },
          }),
        }),
      }),
    }),
  }),
}));

import { loadTableComandas } from "./pedir-panel-data";

beforeEach(() => {
  gateOk = true;
  rol = "encargado";
  vi.clearAllMocks();
});

describe("loadTableComandas · el gate es la matriz de secciones (#294)", () => {
  it("no-miembro → error y NO se lee la orden (sin fuga cross-tenant)", async () => {
    gateOk = false;
    const res = await loadTableComandas("golf", "t1");
    expect(res.ok).toBe(false);
    expect(getActiveOrderByTable).not.toHaveBeenCalled();
  });

  it("la terminal ve lo que la mesa tiene enviado: no es una mesa vacía", async () => {
    rol = "terminal";
    const res = await loadTableComandas("golf", "t1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.comandas).toHaveLength(1);
      expect(res.data.loPedido?.order_id).toBe("o1");
    }
  });

  it("el encargado sigue entrando", async () => {
    const res = await loadTableComandas("golf", "t1");
    expect(res.ok).toBe(true);
  });

  it("el mozo no ve el plano, así que tampoco su panel", async () => {
    rol = "mozo";
    const res = await loadTableComandas("golf", "t1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/permisos/i);
    expect(getActiveOrderByTable).not.toHaveBeenCalled();
  });

  it("negocio inexistente → error, sin tocar la orden", async () => {
    const res = await loadTableComandas("nope", "t1");
    expect(res.ok).toBe(false);
    expect(getActiveOrderByTable).not.toHaveBeenCalled();
  });
});

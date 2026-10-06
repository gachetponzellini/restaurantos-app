// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// QA #382 · H-12 — `createOrder` devolvía siempre «Datos inválidos. Revisá los
// campos del formulario.» ante un error de Zod. Ahora devuelve el mensaje
// concreto del primer error de validación.

const persistOrder = vi.fn(async (..._a: unknown[]) => ({
  ok: true as const,
  data: { order_id: "o1", order_number: 1 },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  limitCreateOrder: async () => ({ success: true }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}));
vi.mock("./persist-order", () => ({
  persistOrder: (...a: unknown[]) => persistOrder(...a),
}));

import { createOrder } from "./create-order";

const UUID = "00000000-0000-4000-8000-000000000000";
const base = {
  business_slug: "golf",
  delivery_type: "pickup",
  customer_name: "Juan",
  customer_phone: "1155551234",
  items: [{ product_id: UUID, quantity: 1, modifier_ids: [] }],
};

beforeEach(() => persistOrder.mockClear());

describe("createOrder · mensaje de validación (H-12)", () => {
  it("101 unidades → «La cantidad máxima por producto es 99.»", async () => {
    const res = await createOrder({
      ...base,
      items: [{ ...base.items[0], quantity: 101 }],
    });
    expect(res).toEqual({
      ok: false,
      error: "La cantidad máxima por producto es 99.",
    });
    expect(persistOrder).not.toHaveBeenCalled();
  });

  it("un input válido sigue delegando en persistOrder", async () => {
    const res = await createOrder(base);
    expect(res.ok).toBe(true);
    expect(persistOrder).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// QA #382 · H-09 — `cancelOrderByCustomer` recibe un `business_slug` que antes
// sólo servía para revalidar rutas. Mandando `business_slug: "golf-jcr"` con el
// pedido de otro local, la cancelación pasaba. Ahora el slug se resuelve a un
// negocio y se rechaza si `order.business_id` no coincide.

const USER = "user-1";
const BIZ_HOUSE = { id: "biz-house", slug: "house" };
const BIZ_GOLF = { id: "biz-golf", slug: "golf-jcr" };

const ORDER = {
  id: "00000000-0000-4000-8000-000000000001",
  business_id: BIZ_HOUSE.id,
  order_number: 86,
  status: "pending",
  payment_status: "pending",
  mp_payment_id: null,
  customer_id: "c1",
  customers: { user_id: USER },
};

let updates: Record<string, unknown>[];

function fakeService() {
  return {
    from: (table: string) => {
      let slugFiltro: string | null = null;
      const self: Record<string, unknown> = {
        select: () => self,
        eq: (col: string, val: string) => {
          if (table === "businesses" && col === "slug") slugFiltro = val;
          return self;
        },
        in: () => self,
        update: (row: Record<string, unknown>) => {
          updates.push({ table, ...row });
          return {
            eq: () => ({
              in: () => ({
                select: async () => ({
                  data: [{ id: ORDER.id, payment_status: "pending", mp_payment_id: null }],
                  error: null,
                }),
              }),
            }),
          };
        },
        maybeSingle: async () => {
          if (table === "orders") return { data: ORDER };
          if (table === "businesses") {
            const hit = [BIZ_HOUSE, BIZ_GOLF].find((b) => b.slug === slugFiltro);
            return { data: hit ?? null };
          }
          return { data: null };
        },
      };
      return self;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => fakeService(),
}));
vi.mock("@/lib/payments/mercadopago", () => ({ refundPayment: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/billing/refund-payments", () => ({ marcarPagosReembolsados: vi.fn() }));
vi.mock("./cancel-order", () => ({ cancelDownstream: vi.fn(async () => {}) }));

import { cancelOrderByCustomer } from "./customer-cancel-actions";

beforeEach(() => {
  updates = [];
});

describe("cancelOrderByCustomer · negocio del slug (H-09)", () => {
  it("rechaza si el slug es de otro negocio que el del pedido", async () => {
    const res = await cancelOrderByCustomer({
      order_id: ORDER.id,
      business_slug: "golf-jcr",
    });
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("rechaza un slug que no existe", async () => {
    const res = await cancelOrderByCustomer({
      order_id: ORDER.id,
      business_slug: "no-existe",
    });
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("cancela cuando el slug es el del negocio del pedido", async () => {
    const res = await cancelOrderByCustomer({
      order_id: ORDER.id,
      business_slug: "house",
    });
    expect(res.ok).toBe(true);
    expect(updates[0]).toMatchObject({ table: "orders", status: "cancelled" });
  });
});

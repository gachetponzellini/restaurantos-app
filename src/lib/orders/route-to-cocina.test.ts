import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 093 — las guardas de `routeOrderToCocina`.
 *
 * Este es el único camino real por el que un pedido entra a cocina: los cuatro
 * callers (confirmar a mano, cron de programados, webhook de MP, venta de
 * mostrador) desembocan acá. Hasta ahora no validaba **nada**: el avance a
 * `preparing` era un `.eq("id", orderId)` pelado y todo el control de "a quién
 * marchar" vivía en el SELECT de cada caller — que en el caso del webhook no
 * existía. Lo que se protege acá:
 *
 *  1. Un pedido cancelado no se cocina, ni siquiera si el pago llega después.
 *  2. La carrera entre el chequeo y el avance se cierra en el propio UPDATE.
 *  3. Marchar sin que salga un solo papel avisa, pero no bloquea (el pedido de
 *     sólo kiosco es legítimo).
 *  4. El fallo del control de pedido deja de ser mudo.
 */

type OrderRow = { status: string; delivery_type: string } | null;

let orderRow: OrderRow;
let existingComandas: number;
let advancedRows: { id: string }[];
let capturedUpdate: { payload: unknown; inStatuses?: string[] } | null;
let comandaIds: string[];
let controlResult: { emitted: boolean; failed: boolean };

const notifications: { type: string; payload: unknown }[] = [];
const deliveryNotices: { orderId: string; toStatus: string }[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => fakeService(),
}));

vi.mock("@/lib/comandas/route-items", () => ({
  createComandasForItems: async () => ({
    ok: true as const,
    comanda_ids: comandaIds,
  }),
}));

vi.mock("@/lib/comandas/routing", () => ({
  // Todo ítem resuelve sector salvo que el test pida lo contrario vía
  // `comandaIds = []` + un product sin station (ver `stationless`).
  resolveStation: () => (stationless ? null : "station-1"),
  // Spec 180: la lista, principal primero. Acá siempre una sola.
  resolveStations: () => (stationless ? [] : ["station-1"]),
}));

vi.mock("@/lib/print/control-ticket-emit", () => ({
  emitControlTicket: async () => controlResult,
}));

vi.mock("@/lib/notifications/create", () => ({
  createNotification: async (p: { type: string; payload: unknown }) => {
    notifications.push({ type: p.type, payload: p.payload });
  },
}));

vi.mock("@/lib/notifications/delivery-notify", () => ({
  notifyDeliveryStatusChange: async (p: {
    orderId: string;
    toStatus: string;
  }) => {
    deliveryNotices.push(p);
  },
}));

let stationless = false;

function fakeService() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;

      Object.assign(builder, {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (table === "comandas" && opts?.head) {
            return {
              eq: async () => ({ count: existingComandas }),
            };
          }
          if (table === "orders") {
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: orderRow }),
                }),
              }),
            };
          }
          if (table === "order_items") {
            return {
              eq: () => ({
                is: async () => ({
                  data: [{ id: "item-1", product_id: "prod-1" }],
                }),
              }),
            };
          }
          // products
          return { in: async () => ({ data: [{ id: "prod-1", station_id: null, category: null }] }) };
        },
        update(payload: unknown) {
          if (table === "orders") {
            capturedUpdate = { payload };
            return {
              eq: () => ({
                in: (_col: string, statuses: string[]) => {
                  capturedUpdate!.inStatuses = statuses;
                  return {
                    select: async () => ({ data: advancedRows, error: null }),
                  };
                },
              }),
            };
          }
          // order_items: el update de station_id/kitchen_status
          return { eq: async () => ({ error: null }) };
        },
        eq: chain,
        in: chain,
        is: chain,
      });
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const { routeOrderToCocina } = await import("./route-to-cocina");

beforeEach(() => {
  orderRow = { status: "pending", delivery_type: "delivery" };
  existingComandas = 0;
  advancedRows = [{ id: "o1" }];
  capturedUpdate = null;
  comandaIds = ["comanda-1"];
  controlResult = { emitted: true, failed: false };
  stationless = false;
  notifications.length = 0;
  deliveryNotices.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("routeOrderToCocina · guarda de estado (spec 093)", () => {
  it("marcha un pedido pending y avanza a preparing", async () => {
    const res = await routeOrderToCocina("o1", "biz1");
    expect(res.ok).toBe(true);
    expect(capturedUpdate?.payload).toEqual({ status: "preparing" });
  });

  it("NO marcha un pedido cancelado — y corta ANTES de crear comandas", async () => {
    // El camino de H-21: el cliente cancela mientras el pago sigue `pending`
    // (efectivo/Rapipago de MP, se aprueban horas después). Cuando llega la
    // aprobación, el webhook mandaba el pedido cancelado a cocina.
    orderRow = { status: "cancelled", delivery_type: "delivery" };
    const res = await routeOrderToCocina("o1", "biz1");
    expect(res.ok).toBe(false);
    // Lo decisivo: no se llegó a tocar `orders`.
    expect(capturedUpdate).toBeNull();
  });

  it("NO marcha un pedido ya entregado", async () => {
    orderRow = { status: "delivered", delivery_type: "delivery" };
    expect((await routeOrderToCocina("o1", "biz1")).ok).toBe(false);
    expect(capturedUpdate).toBeNull();
  });

  it("el UPDATE lleva la guarda optimista de estado", async () => {
    await routeOrderToCocina("o1", "biz1");
    expect(capturedUpdate?.inStatuses).toEqual([
      "pending",
      "confirmed",
      "preparing",
    ]);
  });

  it("si el pedido cambió de estado entre el chequeo y el UPDATE, falla", async () => {
    // La carrera: el SELECT lo vio `pending`, pero para cuando corre el UPDATE
    // ya lo cancelaron. El `.in(status)` no matchea ninguna fila.
    advancedRows = [];
    const res = await routeOrderToCocina("o1", "biz1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cambió de estado/);
  });

  it("rescata un preparing SIN comandas (H-18 / H-22)", async () => {
    // Un pedido que quedó roto sin papel en cocina tiene que poder re-marcharse.
    // El filtro fino es la idempotencia: si tuviera comandas, no llega acá.
    orderRow = { status: "preparing", delivery_type: "pickup" };
    expect((await routeOrderToCocina("o1", "biz1")).ok).toBe(true);
  });
});

describe("routeOrderToCocina · marcha sin comandas (spec 093 · H-22)", () => {
  it("avisa al encargado cuando no salió un solo papel", async () => {
    stationless = true;
    comandaIds = [];
    const res = await routeOrderToCocina("o1", "biz1");

    expect(res.ok).toBe(true); // no bloquea: el pedido de sólo kiosco es legítimo
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("pedido.sin_comanda");
    expect(notifications[0].payload).toMatchObject({ itemsWithoutStation: 1 });
  });

  it("no avisa cuando sí salieron comandas", async () => {
    await routeOrderToCocina("o1", "biz1");
    expect(notifications).toEqual([]);
  });
});

describe("routeOrderToCocina · control de pedido (spec 093 · H-12)", () => {
  it("propaga el fallo del control en control_failed", async () => {
    controlResult = { emitted: false, failed: true };
    const res = await routeOrderToCocina("o1", "biz1");
    expect(res.ok).toBe(true); // best-effort: la comida entra a cocina igual
    if (res.ok) expect(res.data.control_failed).toBe(true);
  });

  it("un control duplicado NO cuenta como fallo", async () => {
    controlResult = { emitted: false, failed: false };
    const res = await routeOrderToCocina("o1", "biz1");
    if (res.ok) expect(res.data.control_failed).toBe(false);
  });

  it("re-marchar un pedido que ya tiene comandas igual intenta el control", async () => {
    // El rescate de los pedidos que quedaron con comandas y sin papel entre la
    // 0034 y este fix: el camino idempotente no puede saltearse el control.
    existingComandas = 2;
    controlResult = { emitted: true, failed: false };
    const res = await routeOrderToCocina("o1", "biz1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.comanda_ids).toEqual([]);
  });
});

describe("routeOrderToCocina · aviso al cliente (spec 093 · H-39)", () => {
  it("avisa «estamos preparando» al marchar", async () => {
    await routeOrderToCocina("o1", "biz1");
    expect(deliveryNotices).toEqual([
      { orderId: "o1", toStatus: "preparing" },
    ]);
  });

  it("no avisa si el pedido no se marchó", async () => {
    orderRow = { status: "cancelled", delivery_type: "delivery" };
    await routeOrderToCocina("o1", "biz1");
    expect(deliveryNotices).toEqual([]);
  });

  it("no avisa dos veces en el camino idempotente", async () => {
    existingComandas = 1;
    await routeOrderToCocina("o1", "biz1");
    expect(deliveryNotices).toEqual([]);
  });
});

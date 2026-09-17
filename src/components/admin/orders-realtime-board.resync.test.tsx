import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// El board vivía SÓLO del stream de realtime: se seedeaba con el SSR y ya. Un
// evento perdido lo dejaba congelado —tarjetas en la columna vieja, con el botón
// de un estado que el pedido ya pasó— y al tocarlo el server contestaba «No se
// puede pasar de "delivered" a "ready"». Peor: el rollback devolvía la tarjeta a
// ese mismo estado viejo, así que el error se repetía para siempre.

const getPedidosTabOrders = vi.fn();
const updateOrderStatus = vi.fn();

vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getPedidosTabOrders: (...a: unknown[]) => getPedidosTabOrders(...a),
}));
vi.mock("@/lib/orders/update-status", () => ({
  updateOrderStatus: (...a: unknown[]) => updateOrderStatus(...a),
}));
vi.mock("@/lib/orders/confirm-order", () => ({
  confirmarPedido: vi.fn(),
  aceptarPedidoProgramado: vi.fn(),
}));
vi.mock("./cargar-pedido-sheet", () => ({ CargarPedidoSheet: () => null }));
vi.mock("./order-detail-sheet", () => ({ OrderDetailSheet: () => null }));

/** Lo que devuelve el refetch puntual de una orden (`fetchOrder`). */
let filaDelServer: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
    realtime: { setAuth: async () => {} },
    channel: () => {
      const ch = {
        on: () => ch,
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {},
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: filaDelServer }) }),
      }),
    }),
  }),
}));

import { OrdersRealtimeBoard } from "./orders-realtime-board";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { OrderStatus } from "@/lib/orders/status";

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "o1",
    order_number: 42,
    daily_number: 7,
    created_at: new Date().toISOString(),
    customer_name: "Juan",
    customer_phone: "3415551234",
    delivery_type: "delivery",
    total_cents: 25_000,
    status: "preparing" as OrderStatus,
    payment_method: "cash",
    payment_status: "pending",
    cancelled_reason: null,
    scheduled_at: null,
    kitchen_at: null,
    kitchen_notes: null,
    items: [{ product_name: "Milanesa", quantity: 1 }],
    ...overrides,
  };
}

function renderBoard(orders: AdminOrder[], active = true) {
  return render(
    <OrdersRealtimeBoard
      businessId="b1"
      slug="golf"
      timezone="America/Argentina/Buenos_Aires"
      initialOrders={orders}
      marchLeadKitchenMin={40}
      active={active}
    />,
  );
}

beforeEach(() => {
  getPedidosTabOrders.mockReset();
  updateOrderStatus.mockReset();
  filaDelServer = null;
});

describe("OrdersRealtimeBoard · resincronización", () => {
  it("un rechazo de transición trae la fila real, no vuelve a la vieja", async () => {
    // La pantalla cree que está en «preparing»; en la base ya está entregado.
    updateOrderStatus.mockResolvedValue({
      ok: false,
      error: 'No se puede pasar de "delivered" a "ready".',
    });
    filaDelServer = {
      id: "o1",
      order_number: 42,
      daily_number: 7,
      created_at: new Date().toISOString(),
      customer_name: "Juan",
      customer_phone: "3415551234",
      delivery_type: "delivery",
      total_cents: 25_000,
      status: "delivered",
      payment_method: "cash",
      payment_status: "pending",
      cancelled_reason: null,
      scheduled_at: null,
      kitchen_notes: null,
      order_items: [{ product_name: "Milanesa", quantity: 1 }],
    };

    renderBoard([order()]);
    await userEvent.click(screen.getByRole("button", { name: "Entregar" }));

    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalled());
    // La tarjeta ya no ofrece «Entregar»: quedó en su estado real (entregado).
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Entregar" })).toBeNull(),
    );
  });

  it("al volver a la tab revalida contra el server", async () => {
    getPedidosTabOrders.mockResolvedValue({
      ok: true,
      data: [order({ id: "o2", daily_number: 9, customer_name: "Nueva" })],
    });

    const { rerender } = renderBoard([order()], false);
    expect(getPedidosTabOrders).not.toHaveBeenCalled();

    rerender(
      <OrdersRealtimeBoard
        businessId="b1"
        slug="golf"
        timezone="America/Argentina/Buenos_Aires"
        initialOrders={[order()]}
        marchLeadKitchenMin={40}
        active
      />,
    );

    await waitFor(() => expect(getPedidosTabOrders).toHaveBeenCalledWith("golf"));
    await waitFor(() => expect(screen.getByText("Nueva")).toBeTruthy());
  });
});

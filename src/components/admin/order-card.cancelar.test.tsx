import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Issue #377 — un pedido que ya marchó y el cliente cancela. La tarjeta sólo
// ofrecía «Entregar»: cancelar vivía adentro del detalle, al fondo del pie, y
// en la PC ni siquiera se veía. La tarjeta lo ofrece y abre el detalle directo
// en el motivo (que sigue siendo obligatorio).

const sheetProps = vi.fn();
vi.mock("./order-detail-sheet", () => ({
  OrderDetailSheet: (props: { open: boolean; abrirCancelar?: boolean }) => {
    sheetProps(props);
    return null;
  },
}));

import { OrderCard } from "./order-card";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { OrderStatus } from "@/lib/orders/status";

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "o1",
    order_number: 42,
    daily_number: 4,
    created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    customer_name: "Ariel",
    customer_phone: "3416414013",
    delivery_type: "delivery",
    total_cents: 2_100_000,
    status: "preparing" as OrderStatus,
    payment_method: "cash",
    payment_status: "pending",
    cancelled_reason: null,
    scheduled_at: null,
    kitchen_at: null,
    kitchen_notes: null,
    items: [{ product_name: "Entraña", quantity: 1 }],
    ...overrides,
  };
}

function renderCard(o: AdminOrder) {
  return render(
    <OrderCard
      order={o}
      slug="kcc"
      timezone="America/Argentina/Buenos_Aires"
      onAdvance={() => {}}
    />,
  );
}

describe("OrderCard · cancelar desde la tarjeta", () => {
  it("en cocina: ofrece Cancelar además de Entregar", () => {
    renderCard(order());
    expect(screen.getByRole("button", { name: /^entregar$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^cancelar$/i })).toBeTruthy();
  });

  it("Cancelar abre el detalle directo en el motivo", () => {
    sheetProps.mockClear();
    renderCard(order());
    fireEvent.click(screen.getByRole("button", { name: /^cancelar$/i }));
    const last = sheetProps.mock.calls.at(-1)![0];
    expect(last.open).toBe(true);
    expect(last.abrirCancelar).toBe(true);
  });

  it("abrir la tarjeta normal no entra en modo cancelar", () => {
    sheetProps.mockClear();
    renderCard(order());
    fireEvent.click(screen.getByText("Ariel"));
    const last = sheetProps.mock.calls.at(-1)![0];
    expect(last.open).toBe(true);
    expect(last.abrirCancelar).toBe(false);
  });

  it("entregado o cancelado: no ofrece Cancelar", () => {
    const { unmount } = renderCard(order({ status: "delivered" as OrderStatus }));
    expect(screen.queryByRole("button", { name: /^cancelar$/i })).toBeNull();
    unmount();
    renderCard(
      order({ status: "cancelled" as OrderStatus, cancelled_reason: "se arrepintió" }),
    );
    expect(screen.queryByRole("button", { name: /^cancelar$/i })).toBeNull();
  });
});

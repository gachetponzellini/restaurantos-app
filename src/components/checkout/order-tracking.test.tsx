import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// QA #382 · H-21 — un pedido cancelado mostraba el ítem a $16.000 y
// Subtotal/Total en $0 a la vez (la cancelación recalcula los totales de la
// orden pero deja el subtotal de cada ítem). Ahora se muestra el total
// original tachado, calculado de los ítems, con «Cancelado · no se cobra».

vi.mock("@/components/checkout/customer-cancel-button", () => ({
  CustomerCancelButton: () => null,
}));

import { OrderTracking } from "./order-tracking";

const base = {
  slug: "kcc",
  orderId: "o1",
  businessName: "KCC",
  tagline: null,
  orderNumber: 86,
  deliveryType: "pickup" as const,
  items: [
    {
      product_name: "Tallarines",
      quantity: 1,
      subtotal_cents: 1_600_000,
      modifiers: [],
    },
  ],
};

describe("OrderTracking · pedido cancelado (H-21)", () => {
  const cancelado = (
    <OrderTracking
      {...base}
      status="cancelled"
      subtotalCents={0}
      deliveryFeeCents={0}
      totalCents={0}
    />
  );

  it("dice «Cancelado · no se cobra» y no muestra un total de $0", () => {
    render(cancelado);
    expect(screen.getByText("Cancelado · no se cobra")).toBeInTheDocument();
    const filaTotal = screen.getByText("Total").parentElement!;
    expect(within(filaTotal).queryByText(/^\$\s?0([,.]00)?$/)).toBeNull();
  });

  it("muestra el total original tachado, calculado de los ítems", () => {
    render(cancelado);
    const filaTotal = screen.getByText("Total").parentElement!;
    const tachado = filaTotal.querySelector("s, del, [style*='line-through']");
    expect(tachado).not.toBeNull();
    expect(tachado!.textContent).toMatch(/16\.000/);
  });

  it("un pedido vigente no cambia: totales de la orden, sin leyenda", () => {
    render(
      <OrderTracking
        {...base}
        status="confirmed"
        subtotalCents={1_600_000}
        deliveryFeeCents={0}
        totalCents={1_600_000}
      />,
    );
    expect(screen.queryByText("Cancelado · no se cobra")).toBeNull();
    const filaTotal = screen.getByText("Total").parentElement!;
    expect(filaTotal.querySelector("s, del, [style*='line-through']")).toBeNull();
    expect(filaTotal.textContent).toMatch(/16\.000/);
  });
});

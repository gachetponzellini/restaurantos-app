// #368 — el cliente que cerró Mercado Pago sin pagar ve cómo pagar.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const reintentarPagoMp = vi.fn(async () => ({
  ok: true as const,
  data: { initPoint: "https://mp/checkout/nueva" },
}));
vi.mock("@/lib/orders/reintentar-pago-actions", () => ({
  reintentarPagoMp: (...a: unknown[]) => reintentarPagoMp(...(a as [])),
}));

import { PaymentBanner } from "./payment-banner";

const base = { slug: "kcc", orderId: "8b0c4a8e-7f1a-4a53-9b7a-2f0d3b1c5e11", paymentMethod: "mp" };

describe("PaymentBanner · reintentar el pago (#368)", () => {
  it("impago y a tiempo: ofrece pagar, sin prometer que «está procesando»", () => {
    render(<PaymentBanner {...base} paymentStatus="pending" reintento="puede" />);
    expect(screen.getByRole("button", { name: /pagar con mercado pago/i })).toBeInTheDocument();
    expect(screen.getByText(/si cerraste mercado pago sin pagar/i)).toBeInTheDocument();
  });

  it("el pago falló: reintentar o volver al menú", () => {
    render(<PaymentBanner {...base} paymentStatus="failed" reintento="puede" />);
    expect(screen.getByRole("button", { name: /reintentar el pago/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver al menú/i })).toBeInTheDocument();
  });

  it("vencido: no ofrece pagar, sólo hacer uno nuevo", () => {
    render(<PaymentBanner {...base} paymentStatus="pending" reintento="vencido" />);
    expect(screen.getByText(/venció/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pagar|reintentar/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /volver al menú/i })).toBeInTheDocument();
  });

  it("el botón pide el link nuevo para ESTE pedido y manda a Mercado Pago", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
    render(<PaymentBanner {...base} paymentStatus="pending" reintento="puede" />);
    await userEvent.click(screen.getByRole("button", { name: /pagar con mercado pago/i }));
    expect(reintentarPagoMp).toHaveBeenCalledWith({ business_slug: "kcc", order_id: base.orderId });
    expect(assign).toHaveBeenCalledWith("https://mp/checkout/nueva");
  });

  it("pagado o en efectivo: nada", () => {
    const { container } = render(
      <PaymentBanner {...base} paymentStatus="paid" reintento="no" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

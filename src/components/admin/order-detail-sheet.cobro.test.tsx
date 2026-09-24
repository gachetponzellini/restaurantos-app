import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Un pedido ENTREGADO puede seguir impago (el delivery que se marcó entregado
// antes de que volviera el repartidor con la plata, el retiro que se cobra al
// mostrador). El pie del detalle se escondía entero para todo estado terminal,
// así que esos pedidos no se podían cobrar ni facturar desde ningún lado —
// aunque el server los acepta: `registrarPago` rechaza sólo el cancelado y la
// orden ya cerrada.

// El detalle carga ítems e historial de Supabase al abrirse; acá sólo importa
// qué botones muestra el pie.
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/orders/update-status", () => ({
  updateOrderStatus: async () => ({ ok: true, data: {} }),
}));
vi.mock("./cargar-pedido-sheet", () => ({ CargarPedidoSheet: () => null }));
vi.mock("./cobrar-pedido-sheet", () => ({
  CobrarPedidoSheet: () => null,
}));
vi.mock("@/components/shared/editar-items-modal", () => ({
  EditarItemsModal: () => null,
}));

import { OrderDetailSheet } from "./order-detail-sheet";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { OrderStatus } from "@/lib/orders/status";

function order(overrides: Partial<AdminOrder> = {}): AdminOrder {
  return {
    id: "o1",
    order_number: 42,
    daily_number: 8,
    created_at: "2026-08-11T20:00:00-03:00",
    customer_name: "Juan",
    customer_phone: "3415551234",
    delivery_type: "delivery",
    total_cents: 25_000,
    status: "delivered" as OrderStatus,
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

function renderSheet(o: AdminOrder) {
  return render(
    <OrderDetailSheet
      open
      onOpenChange={() => {}}
      order={o}
      slug="golf"
      timezone="America/Argentina/Buenos_Aires"
      onAdvance={() => {}}
    />,
  );
}

describe("OrderDetailSheet · cobrar un pedido entregado", () => {
  it("entregado e impago: deja cobrar / facturar", () => {
    renderSheet(order());
    expect(screen.getByRole("button", { name: /cobrar \/ facturar/i })).toBeTruthy();
  });

  it("entregado y ya cobrado: no lo vuelve a ofrecer", () => {
    renderSheet(order({ payment_status: "paid" }));
    expect(screen.queryByRole("button", { name: /cobrar \/ facturar/i })).toBeNull();
    expect(screen.getByText(/pedido cobrado/i)).toBeTruthy();
  });

  it("entregado: ya no ofrece cancelar — sólo queda cobrarlo", () => {
    renderSheet(order());
    expect(screen.queryByRole("button", { name: /cancelar pedido/i })).toBeNull();
  });

  it("cancelado: no se cobra ni se cancela, es final", () => {
    renderSheet(
      order({ status: "cancelled" as OrderStatus, cancelled_reason: "se arrepintió" }),
    );
    expect(screen.queryByRole("button", { name: /cobrar \/ facturar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancelar pedido/i })).toBeNull();
  });

  it("en curso: sigue pudiendo cobrarse y cancelarse, como siempre", () => {
    renderSheet(order({ status: "preparing" as OrderStatus }));
    expect(screen.getByRole("button", { name: /cobrar \/ facturar/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancelar pedido/i })).toBeTruthy();
  });

  // Issue #377 — jsdom no hace layout, así que «está en el DOM» no alcanza:
  // `ModalFooter` trae `sm:flex-row` de base y en la PC los botones quedaban en
  // fila, cada uno a lo ancho del panel, y sólo se veía «Cobrar / Facturar».
  it("en escritorio el pie apila los botones (no los pone en fila)", () => {
    renderSheet(order({ status: "preparing" as OrderStatus }));
    const pie = screen
      .getByRole("button", { name: /cancelar pedido/i })
      .closest('[data-slot="modal-footer"]')!;
    expect(pie.className).toContain("sm:flex-col");
    expect(pie.className).not.toContain("sm:flex-row");
  });

  it("abrirCancelar: abre directo en el motivo de cancelación", () => {
    render(
      <OrderDetailSheet
        open
        onOpenChange={() => {}}
        order={order({ status: "preparing" as OrderStatus })}
        slug="kcc"
        timezone="America/Argentina/Buenos_Aires"
        onAdvance={() => {}}
        abrirCancelar
      />,
    );
    expect(screen.getByLabelText(/motivo de cancelación/i)).toBeTruthy();
    const pie = screen
      .getByLabelText(/motivo de cancelación/i)
      .closest('[data-slot="modal-footer"]')!;
    expect(pie.className).not.toContain("sm:flex-row");
  });
});

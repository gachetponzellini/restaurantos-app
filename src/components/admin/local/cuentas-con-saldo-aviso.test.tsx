import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getCajaTabData: vi.fn(),
}));
vi.mock("@/lib/caja/actions", () => ({
  registrarIngreso: vi.fn(),
  registrarSangria: vi.fn(),
}));

import { CuentasConSaldoAviso } from "./caja-admin-board";
import type { CuentaConSaldo } from "@/lib/caja/types";

const cuenta = (over: Partial<CuentaConSaldo> = {}): CuentaConSaldo => ({
  orderId: "o1",
  orderNumber: 26,
  dailyNumber: 3,
  tableId: "t4",
  tableLabel: "4",
  totalCents: 1_850_000,
  paidCents: 0,
  saldoCents: 1_850_000,
  cerrada: true,
  ...over,
});

describe("CuentasConSaldoAviso (#339)", () => {
  it("sin cuentas con saldo no ocupa lugar", () => {
    const { container } = render(<CuentasConSaldoAviso slug="kcc" cuentas={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("una cuenta cerrada con saldo se nombra por su mesa y lleva al pedido", () => {
    render(<CuentasConSaldoAviso slug="kcc" cuentas={[cuenta()]} />);
    expect(screen.getByText("Hay una cuenta con saldo pendiente")).toBeInTheDocument();
    expect(screen.getByText(/Mesa 4/)).toBeInTheDocument();
    expect(screen.getByText("Cerrada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver pedido" })).toHaveAttribute(
      "href",
      "/kcc/admin/pedidos/historial?q=26",
    );
  });

  it("una mesa abierta con cobro parcial lleva al cobro de la mesa", () => {
    render(
      <CuentasConSaldoAviso
        slug="kcc"
        cuentas={[
          cuenta({ cerrada: false, paidCents: 1_800_000, saldoCents: 50_000 }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Cobrar" })).toHaveAttribute(
      "href",
      "/kcc/admin/mesa/t4/cobrar",
    );
    expect(screen.queryByText("Cerrada")).not.toBeInTheDocument();
  });

  it("varias: cuenta cuántas y suma lo que falta", () => {
    render(
      <CuentasConSaldoAviso
        slug="kcc"
        cuentas={[
          cuenta(),
          cuenta({ orderId: "o2", tableLabel: null, tableId: null, saldoCents: 50_000, dailyNumber: 7 }),
        ]}
      />,
    );
    expect(screen.getByText("Hay 2 cuentas con saldo pendiente")).toBeInTheDocument();
    expect(screen.getByText("Pedido #7")).toBeInTheDocument();
  });
});

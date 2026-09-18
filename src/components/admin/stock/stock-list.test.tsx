// Spec 205 · D12 — la lista de una sub-tab de Stock: orden por lo que falta
// primero y el filtro «Bajo mínimo» del segmentado.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/lib/stock/actions", () => ({
  ingresarStock: vi.fn(),
  ajustarStock: vi.fn(),
}));
vi.mock("@/lib/ingredients/actions", () => ({
  ingresarStockCocina: vi.fn(),
  ajustarStockCocina: vi.fn(),
}));

import { StockList } from "./stock-list";
import type { StockRow } from "@/lib/stock/stock-rows";

const rows: StockRow[] = [
  {
    kind: "product",
    id: "si1",
    productId: "p1",
    name: "Sobra de largo",
    sub: "Gaseosas",
    qty: 9,
    min: 10, // ratio .9 → casi OK, último de los "bajo"
    unit: "u.",
  },
  {
    kind: "product",
    id: "si2",
    productId: "p2",
    name: "Casi vacío",
    sub: "Cervezas",
    qty: 1,
    min: 12, // ratio .08 → el que más falta
    unit: "u.",
  },
  {
    kind: "product",
    id: "si3",
    productId: "p3",
    name: "Sobrado",
    sub: "Vinos",
    qty: 40,
    min: 5, // ratio 8 → OK, sobra
    unit: "u.",
  },
];

function setup() {
  render(
    <StockList
      rows={rows}
      slug="demo"
      noun="producto"
      searchPlaceholder="Buscar…"
    />,
  );
  return { user: userEvent.setup() };
}

describe("StockList (spec 205 · D12)", () => {
  it("ordena por lo que falta primero (ratio stock/mínimo ascendente)", () => {
    setup();
    const dataRows = screen
      .getAllByRole("row")
      .filter((r) => r.getAttribute("data-row-index") != null);
    const order = dataRows.map((r) => r.getAttribute("aria-label"));
    // "Casi vacío" (ratio .08) antes que "Sobra de largo" (.9), y ambos antes
    // que "Sobrado" (8, sobra) — que ni entra bajo el filtro por defecto.
    expect(order).toEqual(["Casi vacío", "Sobra de largo", "Sobrado"]);
  });

  it("el segmentado «Bajo mínimo» deja sólo lo que no está OK", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Bajo mínimo/ }));
    expect(screen.getByText("Casi vacío")).toBeInTheDocument();
    expect(screen.getByText("Sobra de largo")).toBeInTheDocument();
    expect(screen.queryByText("Sobrado")).not.toBeInTheDocument();
  });

  it("la búsqueda filtra por nombre", async () => {
    const { user } = setup();
    await user.type(screen.getByPlaceholderText("Buscar…"), "vacío");
    expect(screen.getByText("Casi vacío")).toBeInTheDocument();
    expect(screen.queryByText("Sobrado")).not.toBeInTheDocument();
  });
});

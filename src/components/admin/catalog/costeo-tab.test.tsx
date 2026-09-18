// spec 205 · D11 — los KPIs de Costeo filtran la tabla, orden de peor a mejor
// food cost, y la fila abre el producto directo en «Precio y costo».
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProductCosteo } from "@/lib/ingredients/types";

const open = vi.fn();

vi.mock("@/components/admin/catalog/ui/catalog-data", () => ({
  useCatalogData: () => ({ costeo: ITEMS }),
}));
vi.mock("@/components/admin/catalog/ui/editor-host", () => ({
  useCatalogEditor: () => ({
    open,
    create: vi.fn(),
    openLinked: vi.fn(),
    current: null,
  }),
}));

import { CosteoTab } from "./costeo-tab";

const ITEMS: ProductCosteo[] = [
  {
    productId: "p1",
    productName: "Milanesa",
    categoryName: "Platos",
    priceCents: 10_000,
    foodCostCents: 3_000, // 30% food cost, margen positivo
    marginPercent: 70,
    marginCents: 7_000,
    hasRecipe: true,
  },
  {
    productId: "p2",
    productName: "Trago caro",
    categoryName: "Bebidas",
    priceCents: 10_000,
    foodCostCents: 12_000, // pierde plata
    marginPercent: -20,
    marginCents: -2_000,
    hasRecipe: true,
  },
  {
    productId: "p3",
    productName: "Ensalada premium",
    categoryName: "Platos",
    priceCents: 10_000,
    foodCostCents: 6_000, // 60% food cost, no pierde plata pero food cost alto
    marginPercent: 40,
    marginCents: 4_000,
    hasRecipe: true,
  },
  {
    productId: "p4",
    productName: "Postre sin cargar",
    categoryName: "Postres",
    priceCents: 5_000,
    foodCostCents: 0,
    marginPercent: 0,
    marginCents: 0,
    hasRecipe: false,
  },
];

describe("CosteoTab (spec 205 · D11)", () => {
  beforeEach(() => open.mockClear());

  it("ordena de peor a mejor food cost (los que tienen receta)", () => {
    render(<CosteoTab />);
    const nombres = screen
      .getAllByRole("row")
      .map((r) => r.textContent ?? "")
      .filter((t) => ITEMS.some((i) => t.includes(i.productName)));
    // Trago caro (120%) > Ensalada premium (60%) > Milanesa (30%); sin receta
    // no entra en «Todos» porque no tiene % para ordenar, pero sí en la lista.
    const idxTrago = nombres.findIndex((t) => t.includes("Trago caro"));
    const idxEnsalada = nombres.findIndex((t) =>
      t.includes("Ensalada premium"),
    );
    const idxMilanesa = nombres.findIndex((t) => t.includes("Milanesa"));
    expect(idxTrago).toBeLessThan(idxEnsalada);
    expect(idxEnsalada).toBeLessThan(idxMilanesa);
  });

  it("KPI «Pierden plata» filtra a margen negativo", async () => {
    const user = userEvent.setup();
    render(<CosteoTab />);
    await user.click(screen.getByRole("button", { name: /Pierden plata/ }));
    expect(screen.getByText("Trago caro")).toBeInTheDocument();
    expect(screen.queryByText("Milanesa")).not.toBeInTheDocument();
    expect(screen.queryByText("Ensalada premium")).not.toBeInTheDocument();
  });

  it("KPI «Food cost > 50%» usa el mismo corte que foodCostTone=bad", async () => {
    const user = userEvent.setup();
    render(<CosteoTab />);
    await user.click(screen.getByRole("button", { name: /Food cost > 50%/ }));
    // Ensalada premium (60%) y Trago caro (120%) están sobre 50%; Milanesa
    // (30%) no.
    expect(screen.getByText("Ensalada premium")).toBeInTheDocument();
    expect(screen.getByText("Trago caro")).toBeInTheDocument();
    expect(screen.queryByText("Milanesa")).not.toBeInTheDocument();
  });

  it("KPI «Sin receta» filtra hasRecipe=false", async () => {
    const user = userEvent.setup();
    render(<CosteoTab />);
    await user.click(screen.getByRole("button", { name: /Sin receta/ }));
    expect(screen.getByText("Postre sin cargar")).toBeInTheDocument();
    expect(screen.queryByText("Milanesa")).not.toBeInTheDocument();
  });

  it("click en una fila abre el producto en «precio», con la lista filtrada", async () => {
    const user = userEvent.setup();
    render(<CosteoTab />);
    await user.click(screen.getByText("Milanesa"));
    // «Todos» trae las 4 filas, ordenadas de peor a mejor food cost (sin
    // receta, sin % que ordenar, va al final).
    expect(open).toHaveBeenCalledWith(
      { kind: "product", id: "p1", section: "precio" },
      ["p2", "p3", "p1", "p4"],
    );
  });
});

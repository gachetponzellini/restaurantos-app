// spec 205 · D10 — filtros de la tab Insumos y apertura del editor.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { IngredientOverview } from "@/lib/ingredients/types";

const open = vi.fn();
const create = vi.fn();

vi.mock("@/components/admin/catalog/ui/catalog-data", () => ({
  useCatalogData: () => ({ slug: "demo", ingredients: INGREDIENTS }),
}));
vi.mock("@/components/admin/catalog/ui/editor-host", () => ({
  useCatalogEditor: () => ({
    open,
    create,
    openLinked: vi.fn(),
    current: null,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}));

import { IngredientsTab } from "./ingredients-tab";

const base: IngredientOverview = {
  id: "i1",
  businessId: "b1",
  name: "Harina 000",
  unit: "kg",
  wastePercent: 0,
  stockQuantity: 50,
  stockMinAlert: 10,
  isActive: true,
  isComposite: false,
  createdAt: "",
  updatedAt: "",
  defaultPresentation: {
    name: "Bolsa 25kg",
    costCents: 500000,
    netQuantity: 25,
  },
  presentationCount: 1,
  recipeCount: 3,
  stockStatus: "ok",
};

const INGREDIENTS: IngredientOverview[] = [
  base,
  {
    ...base,
    id: "i2",
    name: "Sal fina",
    stockQuantity: 2,
    stockMinAlert: 5,
    stockStatus: "low",
    recipeCount: 1,
  },
  {
    ...base,
    id: "i3",
    name: "Colorante raro",
    stockQuantity: 0,
    stockStatus: "out",
    recipeCount: 0,
    defaultPresentation: null,
    presentationCount: 0,
  },
];

describe("IngredientsTab (spec 205 · D10)", () => {
  beforeEach(() => {
    open.mockClear();
    create.mockClear();
  });

  it("«Todos» lista los tres insumos", () => {
    render(<IngredientsTab />);
    expect(screen.getByText("Harina 000")).toBeInTheDocument();
    expect(screen.getByText("Sal fina")).toBeInTheDocument();
    expect(screen.getByText("Colorante raro")).toBeInTheDocument();
  });

  it("«Bajo mínimo» junta low y out, no ok", async () => {
    const user = userEvent.setup();
    render(<IngredientsTab />);
    await user.click(screen.getByRole("button", { name: /Bajo mínimo/ }));
    expect(screen.queryByText("Harina 000")).not.toBeInTheDocument();
    expect(screen.getByText("Sal fina")).toBeInTheDocument();
    expect(screen.getByText("Colorante raro")).toBeInTheDocument();
  });

  it("«Sin usar» es recipeCount === 0", async () => {
    const user = userEvent.setup();
    render(<IngredientsTab />);
    await user.click(screen.getByRole("button", { name: /Sin usar/ }));
    expect(screen.getByText("Colorante raro")).toBeInTheDocument();
    expect(screen.queryByText("Harina 000")).not.toBeInTheDocument();
    expect(screen.queryByText("Sal fina")).not.toBeInTheDocument();
  });

  it("buscar filtra por nombre", async () => {
    const user = userEvent.setup();
    render(<IngredientsTab />);
    await user.type(screen.getByPlaceholderText("Buscar insumo…"), "sal");
    expect(screen.getByText("Sal fina")).toBeInTheDocument();
    expect(screen.queryByText("Harina 000")).not.toBeInTheDocument();
  });

  it("click en una fila abre el editor con la lista filtrada", async () => {
    const user = userEvent.setup();
    render(<IngredientsTab />);
    await user.click(screen.getByText("Sal fina"));
    // Orden alfabético (es): Colorante raro, Harina 000, Sal fina.
    expect(open).toHaveBeenCalledWith({ kind: "ingredient", id: "i2" }, [
      "i3",
      "i1",
      "i2",
    ]);
  });

  it("«Nuevo insumo» crea sin id", async () => {
    const user = userEvent.setup();
    render(<IngredientsTab />);
    await user.click(screen.getByRole("button", { name: /Nuevo insumo/ }));
    expect(create).toHaveBeenCalledWith("ingredient");
  });
});

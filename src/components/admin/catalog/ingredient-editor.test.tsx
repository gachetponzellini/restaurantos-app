// spec 205 · D10 — guardar el editor de insumo llama a la action con el
// payload correcto (mismo schema/actions de siempre, D5).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { IngredientOverview } from "@/lib/ingredients/types";

const updateIngredient = vi.fn(async () => ({
  ok: true as const,
  data: { id: "i1" },
}));
const createIngredient = vi.fn(async () => ({
  ok: true as const,
  data: { id: "i9" },
}));
const upsertPresentations = vi.fn(async () => ({
  ok: true as const,
  data: null,
}));
const fetchIngredientUsage = vi.fn(async () => ["p1"]);
const fetchPresentations = vi.fn(async () => [
  {
    id: "pr1",
    name: "Bolsa 25kg",
    net_quantity: 25,
    cost_cents: 500_000,
    is_default: true,
  },
]);

vi.mock("@/lib/ingredients/actions", () => ({
  updateIngredient: (...args: unknown[]) => updateIngredient(...(args as [])),
  createIngredient: (...args: unknown[]) => createIngredient(...(args as [])),
  upsertPresentations: (...args: unknown[]) =>
    upsertPresentations(...(args as [])),
  fetchPresentations: (...args: unknown[]) =>
    fetchPresentations(...(args as [])),
  fetchIngredientUsage: (...args: unknown[]) =>
    fetchIngredientUsage(...(args as [])),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}));
vi.mock("@/components/admin/catalog/historial-precio", () => ({
  HistorialPrecio: () => null,
}));
vi.mock("@/components/admin/catalog/ingredient-recipe-section", () => ({
  IngredientRecipeSection: () => null,
}));
vi.mock("@/components/admin/catalog/ui/catalog-data", () => ({
  useCatalogData: () => ({
    slug: "demo",
    ingredients: [ingrediente],
    products: [
      { id: "p1", name: "Ñoquis de papa", price_cents: 1_000_000 },
      { id: "p2", name: "Soda", price_cents: 300_000 },
    ],
    costeo: [{ productId: "p1", hasRecipe: true, foodCostCents: 200_000 }],
  }),
}));

import { IngredientEditor } from "./ingredient-editor";

const ingrediente: IngredientOverview = {
  id: "i1",
  businessId: "b1",
  name: "Harina 000",
  unit: "kg",
  wastePercent: 2,
  stockQuantity: 30,
  stockMinAlert: 10,
  isActive: true,
  isComposite: false,
  createdAt: "",
  updatedAt: "",
  defaultPresentation: {
    name: "Bolsa 25kg",
    costCents: 500_000,
    netQuantity: 25,
  },
  presentationCount: 1,
  recipeCount: 2,
  stockStatus: "ok",
};

function montar(id: string | null, openLinked = vi.fn()) {
  return render(
    <IngredientEditor
      id={id}
      nav={null}
      back={null}
      onClose={vi.fn()}
      openLinked={openLinked}
      onCreated={vi.fn()}
    />,
  );
}

describe("IngredientEditor (spec 205 · D10)", () => {
  beforeEach(() => {
    updateIngredient.mockClear();
    createIngredient.mockClear();
    upsertPresentations.mockClear();
    fetchPresentations.mockClear();
  });

  it("guardar un insumo existente llama a updateIngredient con el payload del form", async () => {
    const user = userEvent.setup();
    montar("i1");

    await waitFor(() => expect(fetchPresentations).toHaveBeenCalledWith("i1"));

    const nombre = await screen.findByLabelText("Nombre");
    await user.clear(nombre);
    await user.type(nombre, "Harina 0000");
    await user.click(screen.getByRole("button", { name: /^Guardar/ }));

    await waitFor(() => expect(updateIngredient).toHaveBeenCalled());
    const [slug, id, payload] = updateIngredient.mock.calls.at(
      -1,
    ) as unknown as [
      string,
      string,
      { name: string; unit: string; waste_percent: number },
    ];
    expect(slug).toBe("demo");
    expect(id).toBe("i1");
    expect(payload.name).toBe("Harina 0000");
    expect(payload.unit).toBe("kg");
    expect(payload.waste_percent).toBe(2);

    await waitFor(() => expect(upsertPresentations).toHaveBeenCalled());
    const [, , presPayload] = upsertPresentations.mock.calls.at(
      -1,
    ) as unknown as [string, string, { name: string; is_default: boolean }[]];
    expect(presPayload).toEqual([
      {
        id: "pr1",
        name: "Bolsa 25kg",
        net_quantity: 25,
        cost_cents: 500_000,
        is_default: true,
      },
    ]);
  });

  it("crear un insumo nuevo llama a createIngredient y avisa el id creado", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(
      <IngredientEditor
        id={null}
        nav={null}
        back={null}
        onClose={vi.fn()}
        openLinked={vi.fn()}
        onCreated={onCreated}
      />,
    );

    await user.type(screen.getByLabelText("Nombre"), "Sal fina");
    await user.click(screen.getByRole("button", { name: /^Crear/ }));

    await waitFor(() => expect(createIngredient).toHaveBeenCalled());
    const [slug, payload] = createIngredient.mock.calls.at(-1) as unknown as [
      string,
      { name: string },
    ];
    expect(slug).toBe("demo");
    expect(payload.name).toBe("Sal fina");
    expect(onCreated).toHaveBeenCalledWith("i9");
  });

  it("«Usado en» lista los productos que lo usan y abre su precio y costo", async () => {
    const user = userEvent.setup();
    const openLinked = vi.fn();
    montar("i1", openLinked);

    const link = await screen.findByRole("button", { name: /Ñoquis de papa/ });
    expect(link).toHaveTextContent("20% food cost");
    expect(
      screen.queryByRole("button", { name: /Soda/ }),
    ).not.toBeInTheDocument();

    await user.click(link);
    expect(openLinked).toHaveBeenCalledWith({
      kind: "product",
      id: "p1",
      section: "precio",
    });
  });
});

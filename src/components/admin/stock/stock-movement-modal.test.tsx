// Spec 205 · D12 — el ingreso/ajuste de stock, ahora en un `ModalContent
// size="sm"` único para producto e insumo. Lo que importa comprobar: el
// preview «hoy hay X → quedaría Y» reacciona a lo que se tipea, y un ajuste
// sin motivo NO llama a la action (la regla dura de siempre, ahora en la
// pantalla nueva).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const ingresarStock = vi.fn(async () => ({
  ok: true as const,
  data: undefined,
}));
const ajustarStock = vi.fn(async () => ({
  ok: true as const,
  data: undefined,
}));
const ingresarStockCocina = vi.fn(async () => ({
  ok: true as const,
  data: null,
}));
const ajustarStockCocina = vi.fn(async () => ({
  ok: true as const,
  data: null,
}));

vi.mock("@/lib/stock/actions", () => ({
  ingresarStock: (...args: unknown[]) => ingresarStock(...(args as [])),
  ajustarStock: (...args: unknown[]) => ajustarStock(...(args as [])),
}));
vi.mock("@/lib/ingredients/actions", () => ({
  ingresarStockCocina: (...args: unknown[]) =>
    ingresarStockCocina(...(args as [])),
  ajustarStockCocina: (...args: unknown[]) =>
    ajustarStockCocina(...(args as [])),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { StockMovementModal } from "./stock-movement-modal";
import type { StockRow } from "@/lib/stock/stock-rows";

const productRow: StockRow = {
  kind: "product",
  id: "si1",
  productId: "p1",
  name: "Coca-Cola",
  sub: "Gaseosas",
  qty: 10,
  min: 5,
  unit: "u.",
};

const ingredientRow: StockRow = {
  kind: "ingredient",
  id: "i1",
  name: "Harina 000",
  sub: "Bolsa 25 kg",
  qty: 8,
  min: 10,
  unit: "kg",
  ingredient: {
    id: "i1",
    name: "Harina 000",
    unit: "kg",
    stockQuantity: 8,
    stockMinAlert: 10,
    stockStatus: "low",
    wastePercent: 0,
    isActive: true,
    updatedAt: "2026-09-18T00:00:00Z",
    presentations: [{ id: "pr1", name: "Bolsa 25 kg", netQuantity: 25 }],
  },
};

beforeEach(() => {
  ingresarStock.mockClear();
  ajustarStock.mockClear();
  ingresarStockCocina.mockClear();
  ajustarStockCocina.mockClear();
});

describe("StockMovementModal — producto (bebidas/bar)", () => {
  it("el preview muestra «hoy hay X → quedaría Y» al tipear la cantidad", async () => {
    const user = userEvent.setup();
    render(
      <StockMovementModal
        open
        onOpenChange={() => {}}
        row={productRow}
        mode="ingreso"
        slug="demo"
      />,
    );
    expect(screen.getByText("10 u.")).toBeInTheDocument();
    expect(screen.getByTestId("mov-preview")).toHaveTextContent("—");

    await user.type(screen.getByLabelText("Cantidad que entra"), "6");
    expect(screen.getByTestId("mov-preview")).toHaveTextContent("16 u.");
  });

  it("ingreso llama a ingresarStock con la cantidad tipeada", async () => {
    const user = userEvent.setup();
    render(
      <StockMovementModal
        open
        onOpenChange={() => {}}
        row={productRow}
        mode="ingreso"
        slug="demo"
      />,
    );
    await user.type(screen.getByLabelText("Cantidad que entra"), "24");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(ingresarStock).toHaveBeenCalledWith("p1", 24, "demo", undefined);
  });

  it("ajuste sin motivo NO llama a la action (motivo obligatorio)", async () => {
    const user = userEvent.setup();
    render(
      <StockMovementModal
        open
        onOpenChange={() => {}}
        row={productRow}
        mode="ajuste"
        slug="demo"
      />,
    );
    await user.type(screen.getByLabelText("Diferencia (+ o −)"), "-2");
    // Sin cargar motivo, el botón de guardar tiene que estar deshabilitado.
    expect(screen.getByRole("button", { name: "Ajustar" })).toBeDisabled();
    expect(ajustarStock).not.toHaveBeenCalled();
  });

  it("ajuste con motivo llama a ajustarStock", async () => {
    const user = userEvent.setup();
    render(
      <StockMovementModal
        open
        onOpenChange={() => {}}
        row={productRow}
        mode="ajuste"
        slug="demo"
      />,
    );
    await user.type(screen.getByLabelText("Diferencia (+ o −)"), "-2");
    await user.type(screen.getByLabelText(/Motivo/), "Botella rota");
    await user.click(screen.getByRole("button", { name: "Ajustar" }));
    expect(ajustarStock).toHaveBeenCalledWith("p1", -2, "Botella rota", "demo");
  });
});

describe("StockMovementModal — insumo (cocina)", () => {
  it("ingreso arma la cantidad por envases × presentación", async () => {
    const user = userEvent.setup();
    render(
      <StockMovementModal
        open
        onOpenChange={() => {}}
        row={ingredientRow}
        mode="ingreso"
        slug="demo"
      />,
    );
    await user.type(screen.getByLabelText("Cantidad de envases"), "2");
    // 2 bolsas de 25 kg = 50 kg → preview 8 + 50 = 58 kg.
    expect(screen.getByTestId("mov-preview")).toHaveTextContent("58.00 kg");

    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(ingresarStockCocina).toHaveBeenCalledWith("demo", {
      ingredient_id: "i1",
      presentation_id: "pr1",
      units: 2,
    });
  });

  it("ajuste de insumo sin motivo tampoco guarda", async () => {
    const user = userEvent.setup();
    render(
      <StockMovementModal
        open
        onOpenChange={() => {}}
        row={ingredientRow}
        mode="ajuste"
        slug="demo"
      />,
    );
    await user.type(screen.getByLabelText("Diferencia (+ o −)"), "-1.5");
    expect(screen.getByRole("button", { name: "Ajustar" })).toBeDisabled();
    expect(ajustarStockCocina).not.toHaveBeenCalled();
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { MenuProduct } from "@/lib/menu";

import { ProductSheet } from "./product-sheet";

// QA #382 · H-27 — el sheet de producto es un modal: tiene que anunciarse como
// diálogo, con el nombre del producto, para que un lector de pantalla no siga
// leyendo la carta de atrás.

const product: MenuProduct = {
  id: "prod-1",
  category_id: "cat-1",
  name: "Tallarines",
  slug: "tallarines",
  description: "Con salsa a elección.",
  price_cents: 1_000_000,
  image_url: null,
  is_available: true,
  sort_order: 0,
  modifier_groups: [],
};

beforeAll(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  });
});
afterAll(() => vi.unstubAllGlobals());

describe("<ProductSheet /> · accesibilidad (H-27)", () => {
  it("abierto: role=dialog, aria-modal y aria-label con el nombre del producto", () => {
    render(
      <ProductSheet slug="kcc" product={product} open onOpenChange={() => {}} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Tallarines" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // El contenido del producto vive adentro del diálogo.
    expect(dialog).toContainElement(screen.getByText("Con salsa a elección."));
    expect(dialog).toContainElement(screen.getByRole("button", { name: /^agregar/i }));
  });

  it("cerrado: no hay diálogo en el DOM", () => {
    render(
      <ProductSheet
        slug="kcc"
        product={product}
        open={false}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

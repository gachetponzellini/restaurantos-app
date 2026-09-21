// Issue #365 — los tres toggles de «Visibilidad» se tienen que entender solos.
//
// A los encargados no les quedaba claro qué hacía cada uno, y el de
// disponibilidad mentía («el mozo lo ve tachado»: en realidad el mozo deja de
// verlo — `mozo/catalog-query.ts` filtra `is_available = true`). Cada toggle
// dice ahora, debajo, qué pasa en este momento, y la línea cambia al tocarlo.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/catalog/product-actions", () => ({
  updateProduct: vi.fn(),
  createProduct: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}));
vi.mock("@/components/admin/catalog/image-uploader", () => ({
  ImageUploader: () => null,
}));

import { ProductForm } from "./product-form";
import type { AdminProduct } from "@/lib/admin/catalog-query";

const producto = (over: Partial<AdminProduct> = {}) =>
  ({
    id: "p1",
    name: "Salmón",
    slug: "salmon",
    description: null,
    price_cents: 1_000_000,
    image_url: null,
    category_id: null,
    station_id: null,
    is_available: true,
    is_active: true,
    show_online: true,
    sort_order: 0,
    prep_time_minutes: null,
    modifier_groups: [],
    ...over,
  }) as unknown as AdminProduct;

const montar = (p: AdminProduct) =>
  render(
    <ProductForm slug="demo" businessId="biz1" categories={[]} stations={[]} product={p} />,
  );

describe("ProductForm · visibilidad (#365)", () => {
  it("prendidos, cada toggle dice qué pasa ahora", () => {
    montar(producto());
    expect(screen.getByText(/ahora: el mozo lo carga y la carta lo ofrece/i)).toBeInTheDocument();
    expect(screen.getByText(/ahora: los clientes lo ven en la carta online/i)).toBeInTheDocument();
    expect(screen.getByText(/ahora: está en uso/i)).toBeInTheDocument();
  });

  it("sin stock hoy: el mozo NO lo ve y online sale agotado (no «tachado»)", () => {
    montar(producto({ is_available: false }));
    expect(screen.getByText(/ahora: el mozo no lo ve/i)).toBeInTheDocument();
    expect(screen.getByText(/agotado/i)).toBeInTheDocument();
    expect(screen.queryByText(/tachado/i)).not.toBeInTheDocument();
  });

  it("la línea cambia al tocar el toggle, antes de guardar", async () => {
    const user = userEvent.setup();
    montar(producto());
    await user.click(screen.getByRole("switch", { name: /se ve en la carta online/i }));
    expect(
      screen.getByText(/ahora: los clientes no lo ven; el mozo lo carga igual/i),
    ).toBeInTheDocument();
  });

  it("dado de baja: desaparece para el mozo y la carta, las ventas viejas quedan", () => {
    montar(producto({ is_active: false }));
    expect(
      screen.getByText(/ahora: no aparece para el mozo ni en la carta/i),
    ).toBeInTheDocument();
  });
});

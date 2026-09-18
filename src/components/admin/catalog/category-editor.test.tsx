// spec 205 · D7 — editor de categoría: productos enlazados, guardado y borrado.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AdminCategory, AdminProduct } from "@/lib/admin/catalog-query";

const open = vi.fn();
const create = vi.fn();
const openLinked = vi.fn();
const onCreated = vi.fn();
const onClose = vi.fn();
const refresh = vi.fn();

const updateCategory = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  data: { id: "c1" },
}));
const createCategory = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  data: { id: "new-id" },
}));
const deleteCategory = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  data: null,
}));

vi.mock("@/lib/catalog/category-actions", () => ({
  updateCategory: (...args: unknown[]) => updateCategory(...args),
  createCategory: (...args: unknown[]) => createCategory(...args),
  deleteCategory: (...args: unknown[]) => deleteCategory(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {}, back: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}));
vi.mock("@/components/admin/catalog/ui/editor-host", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/admin/catalog/ui/editor-host")
  >("@/components/admin/catalog/ui/editor-host");
  return {
    ...actual,
    useCatalogEditor: () => ({ open, create, openLinked, current: null }),
  };
});

const STATIONS = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Cocina",
    sort_order: 0,
    is_active: true,
    printer_ip: null,
    printer_port: 9100,
    printer_enabled: false,
  },
];
const SUPERS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Principales",
    slug: "principales",
    sort_order: 0,
    icon: "utensils-crossed",
    color: "emerald",
    is_active: true,
  },
];
const CATEGORY: AdminCategory = {
  id: "c1",
  name: "Pizzas",
  slug: "pizzas",
  sort_order: 0,
  is_active: true,
  super_category_id: "11111111-1111-4111-8111-111111111111",
  station_id: "22222222-2222-4222-8222-222222222222",
  extra_station_ids: [],
};
const PRODUCT: AdminProduct = {
  id: "p1",
  category_id: "c1",
  name: "Muzzarella",
  slug: "muzzarella",
  description: null,
  price_cents: 1000,
  image_url: null,
  is_available: true,
  is_active: true,
  show_online: true,
  sort_order: 0,
  station_id: null,
  extra_station_ids: null,
  sin_comanda: false,
  prep_time_minutes: null,
  modifier_groups: [],
};

vi.mock("@/components/admin/catalog/ui/catalog-data", () => ({
  useCatalogData: () => ({
    slug: "demo",
    superCategories: SUPERS,
    categories: [CATEGORY],
    stations: STATIONS,
    products: [PRODUCT],
  }),
}));

import { CategoryEditor } from "./category-editor";

function setup(id: string | null = "c1") {
  const user = userEvent.setup();
  render(
    <CategoryEditor
      id={id}
      nav={null}
      back={null}
      onClose={onClose}
      openLinked={openLinked}
      onCreated={onCreated}
    />,
  );
  return { user };
}

describe("CategoryEditor (spec 205 · D7)", () => {
  beforeEach(() => {
    open.mockClear();
    create.mockClear();
    openLinked.mockClear();
    onCreated.mockClear();
    onClose.mockClear();
    refresh.mockClear();
    updateCategory.mockClear();
    createCategory.mockClear();
    deleteCategory.mockClear();
  });

  it("lista los productos de la categoría y abre el producto al tocarlo", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /^Productos/ }));
    await user.click(screen.getByText("Muzzarella"));
    expect(openLinked).toHaveBeenCalledWith({ kind: "product", id: "p1" });
  });

  it("«Nuevo producto en X» crea con la categoría precargada", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /^Productos/ }));
    await user.click(
      screen.getByRole("button", { name: "Nuevo producto en Pizzas" }),
    );
    expect(create).toHaveBeenCalledWith("product", { category_id: "c1" });
  });

  it("guardar llama a updateCategory con los valores del form", async () => {
    const { user } = setup();
    const nameInput = screen.getByLabelText("Nombre");
    await user.clear(nameInput);
    await user.type(nameInput, "Pizzas al molde");
    await user.click(screen.getByRole("button", { name: /^Guardar/ }));
    expect(updateCategory).toHaveBeenCalledWith(
      "demo",
      "c1",
      expect.objectContaining({
        name: "Pizzas al molde",
        station_id: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("crear pasa a editar la categoría nueva (onCreated) sin cerrar", async () => {
    const { user } = setup(null);
    await user.type(screen.getByLabelText("Nombre"), "Postres");
    await user.click(screen.getByRole("button", { name: /^Crear/ }));
    expect(createCategory).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith("new-id");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("eliminar pide confirmación y después borra y cierra", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await user.click(screen.getByRole("button", { name: "Sí, borrar" }));
    expect(deleteCategory).toHaveBeenCalledWith("demo", "c1");
    expect(onClose).toHaveBeenCalled();
  });
});

// spec 205 · D7 — editor de supercategoría: ícono/color, categorías enlazadas,
// guardado y borrado.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  AdminCategory,
  AdminSuperCategory,
} from "@/lib/admin/catalog-query";

const openLinked = vi.fn();
const onCreated = vi.fn();
const onClose = vi.fn();
const refresh = vi.fn();

const updateSuperCategory = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  data: { id: "s1" },
}));
const createSuperCategory = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  data: { id: "new-super" },
}));
const deleteSuperCategory = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  data: null,
}));

vi.mock("@/lib/catalog/super-category-actions", () => ({
  updateSuperCategory: (...args: unknown[]) => updateSuperCategory(...args),
  createSuperCategory: (...args: unknown[]) => createSuperCategory(...args),
  deleteSuperCategory: (...args: unknown[]) => deleteSuperCategory(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => {}, back: () => {} }),
}));
vi.mock("sonner", () => ({
  toast: { success: () => {}, error: () => {}, warning: () => {} },
}));

const SUPER: AdminSuperCategory = {
  id: "s1",
  name: "Principales",
  slug: "principales",
  sort_order: 0,
  icon: "utensils-crossed",
  color: "emerald",
  is_active: true,
};
const CATEGORY: AdminCategory = {
  id: "c1",
  name: "Pizzas",
  slug: "pizzas",
  sort_order: 0,
  is_active: true,
  super_category_id: "s1",
  station_id: null,
  extra_station_ids: [],
};

vi.mock("@/components/admin/catalog/ui/catalog-data", () => ({
  useCatalogData: () => ({
    slug: "demo",
    superCategories: [SUPER],
    categories: [CATEGORY],
    stations: [],
    products: [],
  }),
}));

import { SuperCategoryEditor } from "./super-category-editor";

function setup(id: string | null = "s1") {
  const user = userEvent.setup();
  render(
    <SuperCategoryEditor
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

describe("SuperCategoryEditor (spec 205 · D7)", () => {
  beforeEach(() => {
    openLinked.mockClear();
    onCreated.mockClear();
    onClose.mockClear();
    refresh.mockClear();
    updateSuperCategory.mockClear();
    createSuperCategory.mockClear();
    deleteSuperCategory.mockClear();
  });

  it("lista las categorías de la supercategoría y abre la categoría al tocarla", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /^Categorías/ }));
    await user.click(screen.getByText("Pizzas"));
    expect(openLinked).toHaveBeenCalledWith({ kind: "category", id: "c1" });
  });

  it("elegir un ícono y guardar manda el ícono nuevo", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "wine" }));
    await user.click(screen.getByRole("button", { name: /^Guardar/ }));
    expect(updateSuperCategory).toHaveBeenCalledWith(
      "demo",
      "s1",
      expect.objectContaining({ icon: "wine" }),
    );
  });

  it("crear pasa a editar la supercategoría nueva (onCreated) sin cerrar", async () => {
    const { user } = setup(null);
    await user.type(screen.getByLabelText("Nombre"), "Postres");
    await user.click(screen.getByRole("button", { name: /^Crear/ }));
    expect(createSuperCategory).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith("new-super");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("eliminar pide confirmación y después borra y cierra", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await user.click(screen.getByRole("button", { name: "Sí, borrar" }));
    expect(deleteSuperCategory).toHaveBeenCalledWith("demo", "s1");
    expect(onClose).toHaveBeenCalled();
  });
});

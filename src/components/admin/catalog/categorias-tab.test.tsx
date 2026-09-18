// spec 205 · D7 — agrupado por supercategoría, apertura de editores y búsqueda
// de la tab Categorías.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  AdminCategory,
  AdminProduct,
  AdminStation,
  AdminSuperCategory,
} from "@/lib/admin/catalog-query";

const open = vi.fn();
const create = vi.fn();

const SUPERS: AdminSuperCategory[] = [
  {
    id: "s1",
    name: "Principales",
    slug: "principales",
    sort_order: 0,
    icon: "utensils-crossed",
    color: "emerald",
    is_active: true,
  },
  {
    id: "s2",
    name: "Bebidas",
    slug: "bebidas",
    sort_order: 1,
    icon: "wine",
    color: "sky",
    is_active: true,
  },
];

const STATIONS: AdminStation[] = [
  {
    id: "st1",
    name: "Cocina",
    sort_order: 0,
    is_active: true,
    printer_ip: null,
    printer_port: 9100,
    printer_enabled: false,
  },
];

const CATEGORIES: AdminCategory[] = [
  {
    id: "c1",
    name: "Pizzas",
    slug: "pizzas",
    sort_order: 0,
    is_active: true,
    super_category_id: "s1",
    station_id: "st1",
    extra_station_ids: [],
  },
  {
    id: "c2",
    name: "Tragos",
    slug: "tragos",
    sort_order: 0,
    is_active: true,
    super_category_id: "s2",
    station_id: null,
    extra_station_ids: [],
  },
  {
    id: "c3",
    name: "Promos",
    slug: "promos",
    sort_order: 0,
    is_active: true,
    super_category_id: null,
    station_id: null,
    extra_station_ids: [],
  },
];

const PRODUCTS: AdminProduct[] = [
  {
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
  },
];

vi.mock("@/components/admin/catalog/ui/catalog-data", () => ({
  useCatalogData: () => ({
    slug: "demo",
    superCategories: SUPERS,
    categories: CATEGORIES,
    stations: STATIONS,
    products: PRODUCTS,
  }),
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

import { CategoriasTab, groupAndSort } from "./categorias-tab";

describe("groupAndSort", () => {
  it("agrupa por supercategoría y manda las huérfanas a __orphan__", () => {
    const grouped = groupAndSort(CATEGORIES);
    expect(grouped.s1?.map((c) => c.id)).toEqual(["c1"]);
    expect(grouped.s2?.map((c) => c.id)).toEqual(["c2"]);
    expect(grouped.__orphan__?.map((c) => c.id)).toEqual(["c3"]);
  });
});

describe("CategoriasTab (spec 205 · D7)", () => {
  beforeEach(() => {
    open.mockClear();
    create.mockClear();
  });

  it("agrupa las categorías bajo su supercategoría con el conteo", () => {
    render(<CategoriasTab />);
    expect(screen.getByText("Principales")).toBeInTheDocument();
    expect(screen.getByText("Bebidas")).toBeInTheDocument();
    expect(screen.getByText("Pizzas")).toBeInTheDocument();
    expect(screen.getByText("Tragos")).toBeInTheDocument();
    // Huérfana: sin supercategoría, va a "Sin asignar".
    expect(screen.getByText("Sin asignar")).toBeInTheDocument();
    expect(screen.getByText("Promos")).toBeInTheDocument();
  });

  it("click en el header de supercategoría abre su editor, con ‹ › entre supercategorías", async () => {
    const user = userEvent.setup();
    render(<CategoriasTab />);
    await user.click(screen.getByRole("button", { name: /^Principales/ }));
    expect(open).toHaveBeenCalledWith({ kind: "superCategory", id: "s1" }, [
      "s1",
      "s2",
    ]);
  });

  it("click en una fila abre la categoría; ‹ › recorre todas las visibles, no sólo su grupo", async () => {
    const user = userEvent.setup();
    render(<CategoriasTab />);
    await user.click(screen.getByText("Pizzas"));
    expect(open).toHaveBeenCalledWith({ kind: "category", id: "c1" }, [
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("los botones del header crean categoría y supercategoría", async () => {
    const user = userEvent.setup();
    render(<CategoriasTab />);
    await user.click(screen.getByRole("button", { name: "Nueva categoría" }));
    expect(create).toHaveBeenCalledWith("category", { sort_order: 3 });
    await user.click(
      screen.getByRole("button", { name: "Nueva supercategoría" }),
    );
    expect(create).toHaveBeenCalledWith("superCategory", { sort_order: 2 });
  });

  it("la búsqueda esconde lo que no matchea, sin romper agrupado", async () => {
    const user = userEvent.setup();
    render(<CategoriasTab />);
    await user.type(screen.getByPlaceholderText("Buscar categoría…"), "trag");
    expect(screen.getByText("Tragos")).toBeInTheDocument();
    expect(screen.queryByText("Pizzas")).not.toBeInTheDocument();
    expect(screen.queryByText("Principales")).not.toBeInTheDocument();
  });
});

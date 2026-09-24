import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { ComandasKanban } from "./comandas-kanban";
import type { LocalComanda, LocalComandaItem } from "@/lib/admin/local-query";

/**
 * Spec 145 · el KDS pinta lo mismo que el papel.
 *
 * La cocina que mira la pantalla estaba tan a ciegas como la que mira el papel:
 * `local-query` calculaba un `is_combo` booleano que la tarjeta nunca dibujaba,
 * así que «Milanesa» del ejecutivo se veía igual que la milanesa de la carta.
 * Ahora el ítem trae el NOMBRE del menú y la tarjeta lo pinta arriba del plato.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// El refetch de montaje y el realtime son ruido para este test: lo que se
// prueba es lo que la tarjeta dibuja con los datos que ya tiene.
vi.mock("@/lib/comandas/actions", () => ({
  advanceComandaStatus: vi.fn(),
  getComandasTabData: vi.fn(async () => ({ ok: false as const })),
  marcarComandaEntregada: vi.fn(),
  solicitarReimpresion: vi.fn(),
  cancelarItem: vi.fn(),
  editarItemComanda: vi.fn(),
  getSwappableProducts: vi.fn(async () => ({ ok: false as const })),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
    channel: () => ({
      on: function () {
        return this;
      },
      subscribe: function () {
        return this;
      },
    }),
    removeChannel: vi.fn(),
    realtime: { setAuth: vi.fn() },
  }),
}));

const item = (over: Partial<LocalComandaItem> = {}): LocalComandaItem => ({
  order_item_id: "oi-1",
  product_id: "p-1",
  product_name: "Milanesa",
  quantity: 1,
  notes: null,
  cancelled_at: null,
  cancelled_reason: null,
  modifiers: [],
  kitchen_status: "pending",
  combo_name: null,
  unit_price_cents: 0,
  price_original_cents: null,
  price_override_reason: null,
  ...over,
});

const comanda = (items: LocalComandaItem[]): LocalComanda => ({
  id: "c-1",
  order_id: "o-1",
  order_number: 1,
  daily_number: 8,
  station_id: "st-fritera",
  station_name: "Fritera",
  station_color_hint: null,
  batch: 1,
  status: "pendiente",
  emitted_at: new Date().toISOString(),
  delivered_at: null,
  print_failed_at: null,
  reprint_requested_at: null,
  cancelled_at: null,
  delivery_type: "dine_in",
  table_label: "5",
  floor_plan_id: null,
  customer_name: "",
  mozo_id: null,
  notes: null,
  cancelled_reason: null,
  items,
});

function pintar(items: LocalComandaItem[]) {
  return render(
    <ComandasKanban
      slug="demo"
      businessId="biz-1"
      timezone="America/Argentina/Buenos_Aires"
      role="encargado"
      initialComandas={[comanda(items)]}
      stations={[{ id: "st-fritera", name: "Fritera", sort_order: 1 }]}
      mozos={[]}
      printAgentLastSeenAt={null}
    />,
  );
}

describe("ComandasKanban · de qué menú viene el plato (spec 145)", () => {
  it("marca el plato que viene de un menú del día", () => {
    pintar([item({ combo_name: "Menú Ejecutivo" })]);
    expect(screen.getByText("Menú Ejecutivo")).toBeInTheDocument();
  });

  it("la marca va ARRIBA del nombre del plato, como en el papel", () => {
    const { container } = pintar([item({ combo_name: "Menú Ejecutivo" })]);
    const li = container.querySelector("li");
    const textos = within(li as HTMLElement)
      .getAllByText(/Menú Ejecutivo|Milanesa/)
      .map((el) => el.textContent);
    expect(textos).toEqual(["Menú Ejecutivo", "Milanesa"]);
  });

  it("un producto suelto no lleva marca", () => {
    pintar([item()]);
    expect(screen.getByText("Milanesa")).toBeInTheDocument();
    expect(screen.queryByText("Menú Ejecutivo")).not.toBeInTheDocument();
  });

  it("un hijo de combo anulado también la lleva", () => {
    // La comanda necesita al menos un ítem vivo: si están todos cancelados la
    // card se oculta entera (fantasma), y no habría nada que mirar.
    pintar([
      item({ combo_name: "Menú Ejecutivo" }),
      item({
        order_item_id: "oi-2",
        product_name: "Puré",
        combo_name: "Menú Ejecutivo",
        cancelled_at: new Date().toISOString(),
        cancelled_reason: "se equivocó el mozo",
      }),
    ]);
    const pure = screen.getByText("Puré").closest("li") as HTMLElement;
    expect(within(pure).getByText("Menú Ejecutivo")).toBeInTheDocument();
  });
});

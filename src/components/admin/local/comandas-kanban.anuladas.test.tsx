import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { ComandasKanban } from "./comandas-kanban";
import type { LocalComanda, LocalComandaItem } from "@/lib/admin/local-query";

/**
 * Spec 208 · las anuladas del día se ven, pero fuera de lo operativo.
 *
 * Cancelar un pedido o anular una comanda la hacía desaparecer del KDS sin
 * rastro. Ahora queda en una sección plegable «Anuladas», como «Cancelados» en
 * Pedidos — y sigue sin entrar en columnas, saturación ni alertas (H-28).
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

const comanda = (
  items: LocalComandaItem[],
  over: Partial<LocalComanda> = {},
): LocalComanda => ({
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
  ...over,
});

const ANULADA = comanda(
  [
    item({
      product_name: "Entraña",
      cancelled_at: "2026-09-24T23:12:00.000Z",
      cancelled_reason: "el cliente canceló",
    }),
  ],
  {
    id: "c-anulada",
    daily_number: 4,
    delivery_type: "delivery",
    table_label: null,
    customer_name: "Ariel Solans",
    status: "en_preparacion",
    cancelled_at: "2026-09-24T23:12:00.000Z", // 20:12 en AR
    cancelled_reason: "el cliente canceló",
    print_failed_at: "2026-09-24T23:12:30.000Z",
  },
);

const VIVA = comanda([item({ product_name: "Milanesa" })], {
  id: "c-viva",
  daily_number: 8,
});

function pintar(comandas: LocalComanda[], salonIds: string[] = []) {
  return render(
    <ComandasKanban
      salonIds={salonIds}
      slug="demo"
      businessId="biz-1"
      role="encargado"
      timezone="America/Argentina/Buenos_Aires"
      initialComandas={comandas}
      stations={[{ id: "st-fritera", name: "Fritera", sort_order: 1 }]}
      mozos={[]}
      printAgentLastSeenAt={null}
    />,
  );
}

function seccionAnuladas() {
  return screen.getByText(/^anuladas$/i).closest("details") as HTMLElement;
}

describe("ComandasKanban · anuladas del día (spec 208)", () => {
  it("la anulada aparece en la sección «Anuladas» con su motivo, hora y origen", () => {
    pintar([VIVA, ANULADA]);
    const s = seccionAnuladas();
    expect(s).toBeTruthy();
    expect(within(s).getByText("1")).toBeInTheDocument();
    expect(within(s).getByText("#4")).toBeInTheDocument();
    expect(within(s).getByText(/Entraña/)).toBeInTheDocument();
    expect(within(s).getByText(/el cliente canceló/)).toBeInTheDocument();
    expect(within(s).getByText(/20:12/)).toBeInTheDocument();
    expect(within(s).getByText(/Ariel Solans/)).toBeInTheDocument();
    expect(within(s).getByText(/Fritera/)).toBeInTheDocument();
  });

  it("no entra en ninguna columna: sólo la viva está en el kanban", () => {
    pintar([VIVA, ANULADA]);
    const s = seccionAnuladas();
    // La única card con «#4» es la de la sección, no una del kanban.
    expect(screen.getAllByText("#4")).toHaveLength(1);
    expect(s.contains(screen.getByText("#4"))).toBe(true);
    // Y no tiene botones: es sólo registro.
    expect(within(s).queryAllByRole("button")).toHaveLength(0);
  });

  it("no suma a la saturación del sector ni a la alerta de impresión", () => {
    pintar([ANULADA]);
    expect(screen.queryByText(/no se imprimi/i)).toBeNull();
    const chip = screen.getByText("Saturación por sector").closest("div")!
      .parentElement!;
    expect(within(chip).getByText("0")).toBeInTheDocument();
  });

  it("respeta el filtro de salón: una anulada de otro salón no se lista", () => {
    const deOtroSalon = comanda([item({ cancelled_at: "2026-09-24T23:30:00.000Z" })], {
      id: "c-otro",
      daily_number: 9,
      table_label: "12",
      floor_plan_id: "salon-b",
      cancelled_at: "2026-09-24T23:30:00.000Z",
    });
    const deEsteSalon = comanda([item({ cancelled_at: "2026-09-24T23:31:00.000Z" })], {
      id: "c-este",
      daily_number: 10,
      table_label: "3",
      floor_plan_id: "salon-a",
      cancelled_at: "2026-09-24T23:31:00.000Z",
    });
    pintar([deOtroSalon, deEsteSalon], ["salon-a"]);
    const s = seccionAnuladas();
    expect(within(s).getByText("#10")).toBeInTheDocument();
    expect(within(s).queryByText("#9")).toBeNull();
  });

  it("sin anuladas, la sección no se muestra", () => {
    pintar([VIVA]);
    expect(screen.queryByText(/^anuladas$/i)).toBeNull();
  });
});

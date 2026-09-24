import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ComandasKanban } from "./comandas-kanban";
import type { LocalComanda } from "@/lib/admin/local-query";

/**
 * Spec 182 · D2 — qué botones ve cada rol en el kanban.
 *
 * El kanban no recibía el rol: a la `terminal` le pintaba «Reimprimir»,
 * «Editar» y «Anular», que el server le rechaza (`canReimprimirComanda`,
 * `canModifyPostEnvio`, `canCancelItem`), y «Empezar», que desde esta spec
 * también. Un botón que existe para fallar enseña a ignorar los errores.
 */

vi.mock("@/lib/comandas/actions", () => ({
  advanceComandaStatus: vi.fn(),
  marcarComandaEntregada: vi.fn(),
  solicitarReimpresion: vi.fn(),
}));
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getComandasTabData: vi.fn(async () => ({ ok: false as const, error: "x" })),
}));

const comanda = (status: "pendiente" | "en_preparacion"): LocalComanda =>
  ({
    id: `c-${status}`,
    order_id: "o1",
    station_id: "st-1",
    status,
    batch: 1,
    emitted_at: "2026-09-14T12:00:00.000Z",
    delivered_at: null,
    cancelled_at: null,
    print_failed_at: null,
    reprint_requested_at: null,
    table_label: "T1",
    order_type: "dine_in",
    mozo_id: null,
    notes: null,
    items: [
      {
        order_item_id: "oi1",
        product_name: "Milanesa",
        quantity: 1,
        notes: null,
        modifiers: [],
        daily_menu_name: null,
        seat_number: null,
        cancelled_at: null,
      },
    ],
  }) as unknown as LocalComanda;

function pintar(role: "encargado" | "terminal") {
  return render(
    <ComandasKanban
      slug="demo"
      businessId="biz-1"
      timezone="America/Argentina/Buenos_Aires"
      role={role}
      initialComandas={[comanda("pendiente"), comanda("en_preparacion")]}
      stations={[{ id: "st-1", name: "Cocina", sort_order: 1 }]}
      mozos={[]}
      printAgentLastSeenAt={null}
    />,
  );
}

describe("ComandasKanban · permisos por rol (spec 182)", () => {
  it("el encargado ve Empezar, Entregar y el menú ⋯", () => {
    pintar("encargado");
    expect(screen.getByRole("button", { name: /Empezar/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Entregar/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Opciones de la comanda/ }).length,
    ).toBeGreaterThan(0);
  });

  it("la terminal entrega, pero no empieza ni abre el ⋯", () => {
    pintar("terminal");
    expect(
      screen.getByRole("button", { name: /Entregar/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Empezar/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Opciones de la comanda/ }),
    ).not.toBeInTheDocument();
  });

  it("la terminal sigue viendo el tablero (no es una pantalla en blanco)", () => {
    pintar("terminal");
    expect(screen.getAllByText(/Milanesa/).length).toBeGreaterThan(0);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MozoClient } from "./mozo-client";

/**
 * #148 · H-46 — el mozo no tenía forma de sentar una reserva, sólo «Sentar
 * walk-in». La mesa de 8 con reserva se sentaba como walk-in desde acá, la
 * reserva se quedaba en `confirmed`, y a los 30 min el auto-`no_show` la
 * marcaba ausente con gente comiendo en la mesa.
 *
 * Mismo criterio que el salón del encargado (`salon-desktop.tsx`): con
 * reserva confirmada para esa mesa, el botón primario es «Sentar reserva»
 * —llama a `sentarReserva`, que abre la mesa Y marca la reserva `seated`—
 * en vez de «Sentar walk-in».
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/mozo/use-tables-realtime", () => ({ useTablesRealtime: () => {} }));
vi.mock("@/components/notifications/use-notifications-realtime", () => ({
  useNotificationsRealtime: () => ({
    notifications: [],
    unreadCount: 0,
    markReadLocally: vi.fn(),
    markAllReadLocally: vi.fn(),
  }),
}));

const sentarReserva = vi.fn(async () => ({ ok: true as const, data: { orderId: "o1" } }));
vi.mock("@/lib/reservations/booking-actions", () => ({
  sentarReserva: (...a: unknown[]) => sentarReserva(...(a as [])),
}));

const getMozoHomeData = vi.fn();
vi.mock("@/lib/mozo/home-actions", () => ({
  getMozoHomeData: () => getMozoHomeData(),
}));

const mesaLibre = {
  id: "t1",
  label: "8",
  seats: 8,
  x: 10,
  y: 10,
  width: 60,
  height: 60,
  shape: "rect",
  status: "active",
  operational_status: "libre",
  opened_at: null,
  mozo_id: null,
  floor_plan_id: "plan-1",
  is_bar: false,
};

const floorPlans = [
  {
    plan: {
      id: "plan-1",
      name: "Salón",
      width: 800,
      height: 600,
      background_image_url: null,
      background_opacity: 100,
      show_customer_name: false,
    },
    tables: [mesaLibre],
  },
] as never;

const reservaConfirmada = {
  id: "r1",
  table_id: "t1",
  customer_name: "Familia Pérez",
  customer_phone: "3511234567",
  party_size: 8,
  starts_at: "2026-08-08T20:00:00Z",
  status: "confirmed",
  notes: null,
};

function renderHome(reservations: unknown[] = []) {
  return render(
    <MozoClient
      businessSlug="golf"
      businessName="Golf"
      businessId="b1"
      floorPlans={floorPlans}
      reservations={reservations as never}
      activeOrders={[] as never}
      mozos={[{ user_id: "u1", full_name: "Ana", role: "mozo" }] as never}
      currentUserId="u1"
      role="mozo"
      initialNotifications={[]}
      initialUnreadCount={0}
      todayTipsCents={0}
      attendance={null as never}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getMozoHomeData.mockResolvedValue({
    ok: true,
    data: { floorPlans, reservations: [], activeOrders: [], mozos: [{ user_id: "u1", full_name: "Ana", role: "mozo" }] },
  });
});

describe("MozoClient · sentar una reserva (#148 · H-46)", () => {
  it("con reserva confirmada, el primario es «Sentar reserva» y llama a la action con el id correcto", async () => {
    const user = userEvent.setup();
    renderHome([reservaConfirmada]);

    // La salon-wide plan view es donde vive una mesa libre sin dueño; «Mis
    // mesas» sólo lista mesas ya asignadas a este mozo.
    await user.click(screen.getByRole("button", { name: "Salón" }));
    const fila = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim().startsWith("8"))!;
    await user.click(fila);

    expect(screen.queryByRole("button", { name: /Sentar walk-in/i })).toBeNull();
    const boton = await screen.findByRole("button", { name: /Sentar reserva/i });
    await act(async () => {
      await user.click(boton);
    });

    expect(sentarReserva).toHaveBeenCalledExactlyOnceWith({
      business_slug: "golf",
      reservation_id: "r1",
    });
  });

  it("sin reserva, sigue mostrando «Sentar walk-in» (sin regresión)", async () => {
    const user = userEvent.setup();
    renderHome([]);

    await user.click(screen.getByRole("button", { name: "Salón" }));
    const fila = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim().startsWith("8"))!;
    await user.click(fila);

    expect(await screen.findByRole("button", { name: /Sentar walk-in/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sentar reserva/i })).toBeNull();
  });

  it("una reserva ya sentada (`seated`) no ofrece sentarla de nuevo", async () => {
    const user = userEvent.setup();
    renderHome([{ ...reservaConfirmada, status: "seated" }]);

    await user.click(screen.getByRole("button", { name: "Salón" }));
    const fila = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.trim().startsWith("8"))!;
    await user.click(fila);

    // La mesa sigue `libre` en este fixture (no se simula el side-effect de
    // `openTable`), así que lo que importa es que no ofrezca re-sentarla.
    expect(screen.queryByRole("button", { name: /Sentar reserva/i })).toBeNull();
  });
});

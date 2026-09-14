import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LocalShell } from "./local-shell";

/**
 * Spec 101 — el cambio de tab no toca la red.
 *
 * Los invariantes que se prueban acá son los que hacen que la tab se sienta
 * instantánea; si alguno se rompe volvemos al round-trip de ~30 queries por
 * click aunque la pantalla siga "andando".
 *
 * Los paneles se mockean: lo que se testea es el shell (conmutación + montaje),
 * no lo que cada tab dibuja adentro.
 */

const replace = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, refresh }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/components/admin/local/salon-desktop", () => ({
  SalonDesktop: () => <div data-testid="panel-salon">MESAS</div>,
}));
vi.mock("@/components/admin/local/comandas-kanban", () => ({
  ComandasKanban: () => <div data-testid="panel-comandas">COMANDAS</div>,
}));
vi.mock("@/components/admin/local/caja-admin-board", () => ({
  CajaAdminBoard: () => <div data-testid="panel-caja">CAJA</div>,
}));
vi.mock("@/components/admin/local/rendicion-mozos-tab", () => ({
  RendicionMozosTab: () => <div data-testid="panel-rendicion">RENDICION</div>,
}));
vi.mock("@/components/admin/local/fichaje-tab", () => ({
  FichajeTab: () => <div data-testid="panel-fichaje">FICHAJE</div>,
}));
vi.mock("@/components/admin/orders-realtime-board", () => ({
  OrdersRealtimeBoard: () => <div data-testid="panel-pedidos">PEDIDOS</div>,
}));
vi.mock("@/components/reservations/admin-day-list", () => ({
  AdminDayList: () => <div data-testid="panel-reservas">RESERVAS</div>,
}));
vi.mock("@/components/reservations/solicitudes-inbox", () => ({
  SolicitudesInbox: () => (
    <div data-testid="panel-solicitudes">SOLICITUDES</div>
  ),
}));

// Las actions de tab: lo que se verifica es que al entrar a una tab se pida
// SÓLO lo suyo, en vez de re-correr la ruta entera.
const getReservasTabData = vi.fn(async () => ({
  ok: false as const,
  error: "x",
}));
const getFichajeTabData = vi.fn(async () => ({
  ok: false as const,
  error: "x",
}));
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getReservasTabData: () => getReservasTabData(),
  getFichajeTabData: () => getFichajeTabData(),
}));

/**
 * Props del shell con las 7 promesas ya resueltas. Se arman **una sola vez por
 * test**: si se recrearan en cada render, cada `use()` volvería a suspender y
 * el keep-alive se vería roto sin estarlo.
 */
function shellProps() {
  return {
    slug: "golf",
    businessId: "b1",
    timezone: "America/Argentina/Buenos_Aires",
    currentUserId: "u1",
    role: "encargado",
    salones: [],
    salon: Promise.resolve({
      floorPlans: [],
      dineInOrders: [],
      reservations: [],
      mozos: [],
    }),
    comandas: Promise.resolve({
      initialComandas: [],
      stations: [],
      mozos: [],
      printAgentLastSeenAt: null,
    }),
    pedidos: Promise.resolve({
      initialOrders: [],
      marchLeadKitchenMin: 40,
    }),
    caja: Promise.resolve({ cajas: [] }),
    rendicion: Promise.resolve({
      rendicionPendientes: [],
      rendicionHistorial: [],
      cajaAssignments: [],
      businessMembers: [],
    }),
    fichaje: Promise.resolve({ initialPresent: [], todaySummary: undefined }),
    reservas: Promise.resolve({
      date: "2026-08-06",
      rows: [],
      floorPlans: [],
      activeTables: [],
      mode: "estricto",
      services: [],
      solicitudes: [],
      ahoraIso: "2026-08-31T12:00:00.000Z",
    }),
  } as unknown as React.ComponentProps<typeof LocalShell>;
}

/**
 * El render va DENTRO de un `act` awaiteado: cada tab lee su dato con
 * `use(promise)` y, montada fuera de act, la suspensión no se reanuda en este
 * entorno — el árbol se queda en los skeletons y no se ve ningún panel.
 */
async function shell(
  url = "/golf/admin/operacion",
  overrides: Partial<React.ComponentProps<typeof LocalShell>> = {},
) {
  window.history.replaceState(null, "", url);
  const props = { ...shellProps(), ...overrides };
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<LocalShell {...props} />);
  });
  return utils;
}

/**
 * Click en una tab, DENTRO de un `act` awaiteado.
 *
 * Hace falta para Comandas, la única tab **sin pill**: su promesa no la consumió
 * nadie durante el page-load, así que React la descubre recién cuando el panel
 * monta y esa suspensión sólo se reanuda si el act que la provocó se awaitea.
 * Las demás ya venían resueltas por su pill.
 */
async function clickTab(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  const boton = screen.getByRole("button", { name });
  await act(async () => {
    await user.click(boton);
  });
}

beforeEach(() => {
  // Los mocks son de módulo: sin esto, un test arrastra los conteos del anterior.
  vi.clearAllMocks();
});

describe("LocalShell · tabs sin red (spec 101)", () => {
  it("cambiar de tab NO navega: la URL se escribe sin router.replace/push", async () => {
    const user = userEvent.setup();
    await shell();

    expect(screen.getByTestId("panel-salon")).toBeInTheDocument();
    await clickTab(user, /Caja/);

    expect(screen.getByTestId("panel-caja")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?tab=caja");
  });

  it("keep-alive: la tab que se deja NO se desmonta (el realtime sigue vivo)", async () => {
    const user = userEvent.setup();
    const { container } = await shell();

    const mesas = screen.getByTestId("panel-salon");
    await clickTab(user, /Comandas/);

    expect(screen.getByTestId("panel-comandas")).toBeInTheDocument();
    // Mesas sigue en el DOM y es el MISMO nodo (no se remontó), pero oculto.
    expect(screen.getByTestId("panel-salon")).toBe(mesas);
    expect(container.querySelector(".hidden")?.contains(mesas)).toBe(true);
  });

  it("una tab que nunca se visitó no se monta (montaje lazy)", async () => {
    const user = userEvent.setup();
    await shell();

    expect(screen.queryByTestId("panel-rendicion")).toBeNull();
    expect(screen.queryByTestId("panel-fichaje")).toBeNull();

    await clickTab(user, /Fichaje/);
    expect(screen.getByTestId("panel-fichaje")).toBeInTheDocument();
    // Entrar a Fichaje no arrastró a Rendición.
    expect(screen.queryByTestId("panel-rendicion")).toBeNull();
  });

  it("el deep-link ?tab=caja abre en Caja sin montar el resto", async () => {
    await shell("/golf/admin/operacion?tab=caja");

    expect(screen.getByTestId("panel-caja")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-salon")).toBeNull();
  });

  it("entrar a una tab pide SÓLO su tab, sin re-correr la ruta (spec 103)", async () => {
    const user = userEvent.setup();
    await shell();

    // Reservas revalida con su propia action al activarse…
    await clickTab(user, /Reservas/);
    expect(screen.getByTestId("panel-reservas")).toBeInTheDocument();
    expect(getReservasTabData).toHaveBeenCalledTimes(1);

    // …y otra vez en cada re-entrada, no sólo la primera.
    await clickTab(user, /Mesas/);
    await clickTab(user, /Reservas/);
    expect(getReservasTabData).toHaveBeenCalledTimes(2);

    // Fichaje, igual.
    await clickTab(user, /Fichaje/);
    expect(getFichajeTabData).toHaveBeenCalledTimes(1);

    // Y en todo el recorrido, ni un solo refresh de ruta: eso era el puente de
    // la spec 101, que re-corría las 7 promesas de tab.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("volver a la tab default deja la URL sin ?tab (canónica)", async () => {
    const user = userEvent.setup();
    await shell("/golf/admin/operacion?tab=caja");

    await clickTab(user, /Mesas/);
    expect(screen.getByTestId("panel-salon")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

/**
 * Spec 182 — la terminal es una PC compartida por todo el salón. El shell no le
 * muestra la tab, y la página no le manda el dato: las props de las tabs que no
 * ve llegan en `null` (D3). Los dos lados se prueban juntos porque el bug era
 * justamente que sólo existía el primero.
 */
describe("LocalShell · lo que ve la terminal (spec 182)", () => {
  const propsDeTerminal = {
    role: "terminal",
    reservas: null,
    caja: null,
    cuentas: null,
    rendicion: null,
    pedidos: null,
  } as unknown as Partial<React.ComponentProps<typeof LocalShell>>;

  it("no tiene la tab Reservas, ni su contador", async () => {
    await shell("/golf/admin/operacion", propsDeTerminal);

    expect(
      screen.queryByRole("button", { name: /Reservas/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-reservas")).not.toBeInTheDocument();
  });

  it("le quedan Mesas, Comandas y Fichaje", async () => {
    await shell("/golf/admin/operacion", propsDeTerminal);

    for (const tab of [/Mesas/, /Comandas/, /Fichaje/]) {
      expect(screen.getByRole("button", { name: tab })).toBeInTheDocument();
    }
    for (const tab of [/Caja/, /Rendición/, /Cuentas corrientes/, /Pedidos/]) {
      expect(
        screen.queryByRole("button", { name: tab }),
      ).not.toBeInTheDocument();
    }
  });

  it("un ?tab=reservas escrito a mano cae en Mesas, no en el libro del día", async () => {
    await shell("/golf/admin/operacion?tab=reservas", propsDeTerminal);

    expect(screen.getByTestId("panel-salon")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-reservas")).not.toBeInTheDocument();
  });
});

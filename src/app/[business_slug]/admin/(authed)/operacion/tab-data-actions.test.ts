import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 102 — `getSalonTabData` (refetch de la tab Mesas). Foco: el GATE de
// membresía. `loadSalon` corre con el cliente **service-role** (RLS bypass):
// órdenes abiertas, reservas del día con nombre y teléfono, el plano entero y
// la nómina de mozos. Sin el gate, cualquier autenticado leería todo eso de
// otro negocio pasando un slug foráneo. Mismo test que blindó la spec 052.
// Los bordes van mockeados para no tocar la DB.

let gateOk: boolean;
let rol: string;

vi.mock("@/lib/tenant", () => ({
  getBusiness: async (slug: string) =>
    slug === "nope"
      ? null
      : { id: "biz1", slug, timezone: "America/Argentina/Buenos_Aires" },
}));

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () =>
    gateOk
      ? {
          ok: true as const,
          data: { userId: "u1", role: rol, isPlatformAdmin: false },
        }
      : { ok: false as const, error: "No tenés acceso a este negocio." },
}));

const loadSalon = vi.fn(async () => ({
  floorPlans: [{ plan: { id: "fp1" }, tables: [] }],
  dineInOrders: [{ id: "o1" }],
  reservations: [{ id: "r1" }],
  mozos: [{ user_id: "u1", full_name: "Ana", role: "mozo" }],
}));
const loadCaja = vi.fn(async () => ({ cajas: [{ id: "caja1" }] }));
const loadRendicion = vi.fn(async () => ({
  rendicionPendientes: [{ mozo_id: "u1" }],
  rendicionHistorial: [],
  cajaAssignments: [],
  businessMembers: [],
}));
const loadReservas = vi.fn(async () => ({
  date: "2026-08-08",
  rows: [],
  floorPlans: [],
  activeTables: [],
  mode: "estricto",
  services: [],
}));
const loadFichaje = vi.fn(async () => ({
  initialPresent: [],
  todaySummary: undefined,
}));
vi.mock("./data", () => ({
  loadSalon: (...args: unknown[]) => loadSalon(...(args as [])),
  loadCaja: (...args: unknown[]) => loadCaja(...(args as [])),
  loadRendicion: (...args: unknown[]) => loadRendicion(...(args as [])),
  loadReservas: (...args: unknown[]) => loadReservas(...(args as [])),
  loadFichaje: (...args: unknown[]) => loadFichaje(...(args as [])),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({}),
}));

import {
  getCajaTabData,
  getFichajeTabData,
  getRendicionTabData,
  getReservasTabData,
  getSalonTabData,
} from "./actions";

beforeEach(() => {
  gateOk = true;
  rol = "encargado";
  vi.clearAllMocks();
});

describe("getSalonTabData", () => {
  it("negocio inexistente → error, sin tocar el loader", async () => {
    const res = await getSalonTabData("nope");
    expect(res.ok).toBe(false);
    expect(loadSalon).not.toHaveBeenCalled();
  });

  it("no-miembro → error y NO se lee el salón (sin fuga cross-tenant)", async () => {
    gateOk = false;
    const res = await getSalonTabData("golf");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/acceso/i);
    // La clave: el loader service-role no llega a correr.
    expect(loadSalon).not.toHaveBeenCalled();
  });

  it("miembro → devuelve las 4 partes de la tab", async () => {
    const res = await getSalonTabData("golf");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.floorPlans).toHaveLength(1);
      expect(res.data.dineInOrders).toHaveLength(1);
      expect(res.data.reservations).toHaveLength(1);
      expect(res.data.mozos).toHaveLength(1);
    }
  });

  it("la ventana de reservas se calcula en la TZ del negocio, no la del server", async () => {
    await getSalonTabData("golf");
    const [businessId, , window] = loadSalon.mock.calls[0] as unknown as [
      string,
      unknown,
      { todayStart: Date; tomorrowStart: Date },
    ];
    expect(businessId).toBe("biz1");
    // Medianoche de Buenos Aires = 03:00 UTC (UTC-3, sin DST).
    expect(window.todayStart.getUTCHours()).toBe(3);
    expect(window.tomorrowStart.getTime() - window.todayStart.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});

describe("gate de rol de las actions de operación (spec 103)", () => {
  // La página redirige al mozo a /mozo. Las actions tienen que aplicar lo
  // mismo, o serían una puerta de atrás a la caja y a lo que rindieron sus
  // compañeros — datos que la UI le niega.
  const actions = [
    ["salón", () => getSalonTabData("golf"), loadSalon],
    ["caja", () => getCajaTabData("golf"), loadCaja],
    ["rendición", () => getRendicionTabData("golf"), loadRendicion],
    ["reservas", () => getReservasTabData("golf", "2026-08-08"), loadReservas],
    ["fichaje", () => getFichajeTabData("golf"), loadFichaje],
  ] as const;

  for (const [nombre, call, loader] of actions) {
    it(`${nombre}: el mozo no puede leer la tab`, async () => {
      rol = "mozo";
      const res = await call();
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/permisos/i);
      expect(loader).not.toHaveBeenCalled();
    });

    it(`${nombre}: el encargado sí`, async () => {
      const res = await call();
      expect(res.ok).toBe(true);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it(`${nombre}: sin membresía no corre el loader`, async () => {
      gateOk = false;
      const res = await call();
      expect(res.ok).toBe(false);
      expect(loader).not.toHaveBeenCalled();
    });
  }
});

describe("la terminal del salón (spec 140 · D2)", () => {
  // El page-gate deja entrar a `terminal` a Operación en modo "limited": ve el
  // plano, las reservas, las comandas y el fichaje. Las actions tenían una
  // lista de roles a mano —admin o encargado— que no se enteró, así que todos
  // sus refetch volvían "No tenés permisos". Como `refetchSalon` se los traga,
  // el síntoma era un plano congelado: asignabas los mozos y no aparecían
  // hasta recargar la página.
  const suyas = [
    ["salón", () => getSalonTabData("golf"), loadSalon],
    ["fichaje", () => getFichajeTabData("golf"), loadFichaje],
  ] as const;

  for (const [nombre, call, loader] of suyas) {
    it(`${nombre}: la terminal refresca su tab`, async () => {
      rol = "terminal";
      const res = await call();
      expect(res.ok).toBe(true);
      expect(loader).toHaveBeenCalledTimes(1);
    });
  }

  const ajenas = [
    ["caja", () => getCajaTabData("golf"), loadCaja],
    ["rendición", () => getRendicionTabData("golf"), loadRendicion],
    // Spec 182 · D1 — el libro del día pasó a ser supervisión. La terminal ve
    // las reservas de HOY por la tab Mesas (viajan con el plano); navegar
    // fechas, editar y la bandeja «A confirmar» son del encargado.
    ["reservas", () => getReservasTabData("golf", "2026-08-08"), loadReservas],
  ] as const;

  for (const [nombre, call, loader] of ajenas) {
    it(`${nombre}: la plata de supervisión sigue fuera de su alcance`, async () => {
      rol = "terminal";
      const res = await call();
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/permisos/i);
      expect(loader).not.toHaveBeenCalled();
    });
  }
});

describe("getReservasTabData", () => {
  it("un date inválido cae en hoy, no en una ventana sin sentido", async () => {
    await getReservasTabData("golf", "no-es-fecha");
    const [, , window] = loadReservas.mock.calls[0] as unknown as [
      string,
      unknown,
      { date: string; dayStart: Date; dayEnd: Date },
    ];
    expect(window.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(window.dayEnd.getTime() - window.dayStart.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it("respeta el día pedido", async () => {
    await getReservasTabData("golf", "2026-12-25");
    const [, , window] = loadReservas.mock.calls[0] as unknown as [
      string,
      unknown,
      { date: string },
    ];
    expect(window.date).toBe("2026-12-25");
  });
});

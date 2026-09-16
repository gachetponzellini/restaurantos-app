import { describe, expect, it } from "vitest";

import {
  countCajas,
  countPedidosNuevos,
  countPresentes,
  countRendicionesPendientes,
  countReservasPorSentar,
  countSalonOcupadas,
} from "./counts";
import type { AdminOrder } from "@/lib/admin/orders-query";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import type { CajaConEstado, RendicionMozoPendiente } from "@/lib/caja/types";
import type { PresentEmployee } from "@/lib/rrhh/clock-actions";

// Fixtures mínimos: sólo los campos que el predicado mira, casteados al tipo.
const order = (status: AdminOrder["status"]) => ({ status }) as AdminOrder;
const table = (
  status: "active" | "inactive",
  operational_status: string | null,
) =>
  ({ status, operational_status: operational_status ?? undefined }) as unknown as
    FloorPlanWithTables["tables"][number];
const plan = (tables: FloorPlanWithTables["tables"]): FloorPlanWithTables =>
  ({ plan: {}, tables }) as unknown as FloorPlanWithTables;
const pendiente = (
  pagos_count: number,
  mozo_role = "mozo",
  mozo_name = "Alguien",
) =>
  ({
    pagos_count,
    mozo_role,
    mozo_name,
    mozo_id: `${mozo_name}-${mozo_role}`,
    efectivo_cents: 0,
  }) as RendicionMozoPendiente;

describe("operacion/counts — predicados de pills (FR-012)", () => {
  it("countPedidosNuevos: pending + confirmed cuentan; el resto no", () => {
    const orders = [
      order("pending"),
      order("confirmed"),
      order("preparing"),
      order("delivered"),
      order("cancelled"),
    ];
    expect(countPedidosNuevos(orders)).toBe(2);
  });

  it("countSalonOcupadas: mesas activas NO libres, aplanando floor plans", () => {
    const floorPlans = [
      plan([
        table("active", "ocupada"),
        table("active", "libre"),
        table("active", "pidio_cuenta"),
        table("inactive", "ocupada"), // inactiva → no cuenta aunque esté ocupada
      ]),
      plan([table("active", null)]), // sin operational_status = libre → no cuenta
    ];
    expect(countSalonOcupadas(floorPlans)).toBe(2);
  });

  it("countRendicionesPendientes: solo mozos con pagos_count > 0", () => {
    const pendientes = [
      pendiente(0, "mozo", "Ana"),
      pendiente(3, "mozo", "Beto"),
      pendiente(1, "mozo", "Cami"),
    ];
    expect(countRendicionesPendientes(pendientes)).toBe(2);
  });

  it("countRendicionesPendientes: el encargado cuenta si tiene takeaway o delivery (spec 203)", () => {
    // La pendiente del encargado ya viene sin el salón (#264): si trae cobros,
    // son de mostrador o delivery y los tiene que rendir.
    const pendientes = [
      pendiente(4, "mozo", "Pedro"),
      pendiente(9, "encargado", "Sofía"),
      pendiente(0, "admin", "Martín"),
    ];
    expect(countRendicionesPendientes(pendientes)).toBe(2);
  });

  it("countReservasPorSentar: solo las confirmadas (las sentadas ya están en mesa)", () => {
    const rows = [
      { status: "confirmed" as const },
      { status: "seated" as const },
      { status: "confirmed" as const },
      { status: "cancelled" as const },
      { status: "no_show" as const },
      { status: "completed" as const },
    ];
    expect(countReservasPorSentar(rows)).toBe(2);
  });

  it("countCajas y countPresentes son el largo de su lista", () => {
    expect(countCajas([{}, {}] as unknown as CajaConEstado[])).toBe(2);
    expect(countPresentes([{}] as unknown as PresentEmployee[])).toBe(1);
  });

  it("listas vacías → 0 (nunca undefined/NaN)", () => {
    expect(countPedidosNuevos([])).toBe(0);
    expect(countSalonOcupadas([])).toBe(0);
    expect(countRendicionesPendientes([])).toBe(0);
    expect(countReservasPorSentar([])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spec 065 — las pills cuentan sobre el MISMO dato filtrado que muestra la tab.
// ─────────────────────────────────────────────────────────────────────────────

const planDe = (
  id: string,
  tables: FloorPlanWithTables["tables"],
): FloorPlanWithTables =>
  ({ plan: { id }, tables }) as unknown as FloorPlanWithTables;
const reservaEn = (
  status: "confirmed" | "seated" | "cancelled",
  salon: string | null,
) => ({
  status,
  tables: salon ? { floor_plans: { id: salon } } : null,
  floor_plan_id: null,
});

describe("operacion/counts — filtro por salón (spec 065)", () => {
  it("countSalonOcupadas: con un salón puntual sólo mira ese plano", () => {
    const floorPlans = [
      planDe("terraza", [table("active", "ocupada"), table("active", "libre")]),
      planDe("comedor", [
        table("active", "ocupada"),
        table("active", "pidio_cuenta"),
      ]),
    ];
    expect(countSalonOcupadas(floorPlans, [])).toBe(3);
    expect(countSalonOcupadas(floorPlans, ["terraza"])).toBe(1);
    expect(countSalonOcupadas(floorPlans, ["comedor"])).toBe(2);
  });

  it("countReservasPorSentar: con un salón puntual, las de ese salón + las sin asignar", () => {
    const rows = [
      reservaEn("confirmed", "terraza"),
      reservaEn("confirmed", "comedor"),
      reservaEn("seated", "terraza"),
      reservaEn("confirmed", null), // sin mesa ni zona
    ];
    expect(countReservasPorSentar(rows, [])).toBe(3);
    // #155: la sin asignar se cuenta en cualquier salón — es la que hay que
    // sentar, y el contador tiene que coincidir con lo que muestra la lista.
    expect(countReservasPorSentar(rows, ["terraza"])).toBe(2);
  });

  it("un salón sin nada da 0, no el total sin filtrar", () => {
    expect(
      countReservasPorSentar([reservaEn("confirmed", "terraza")], ["quincho"]),
    ).toBe(0);
    expect(countSalonOcupadas([planDe("terraza", [table("active", "ocupada")])], ["quincho"])).toBe(0);
  });
});

describe("operacion/counts — dos salones a la vez (fast-follow 065)", () => {
  it("countSalonOcupadas mira los dos planos elegidos", () => {
    const floorPlans = [
      planDe("terraza", [table("active", "ocupada")]),
      planDe("comedor", [table("active", "pidio_cuenta")]),
      planDe("quincho", [table("active", "ocupada")]),
    ];
    expect(countSalonOcupadas(floorPlans, ["terraza", "comedor"])).toBe(2);
  });

  it("countReservasPorSentar cuenta las de los dos", () => {
    const rows = [
      reservaEn("confirmed", "terraza"),
      reservaEn("confirmed", "comedor"),
      reservaEn("confirmed", "quincho"),
    ];
    expect(countReservasPorSentar(rows, ["terraza", "comedor"])).toBe(2);
  });
});

describe("el contador no cuenta encargues que todavía no piden nada (issue #260)", () => {
  const ahora = new Date("2026-09-08T20:00:00.000Z");
  const base = { status: "confirmed" } as never as AdminOrder;

  it("un encargue para el sábado no suma hoy", () => {
    const sabado = new Date(ahora.getTime() + 3 * 86_400_000).toISOString();
    const orders = [
      { ...base, scheduled_at: sabado },
      { ...base, scheduled_at: sabado },
    ] as AdminOrder[];
    // Antes la pill quedaba en 2 toda la semana, apuntando a pedidos que viven
    // en «Próximos» y no piden nada.
    expect(countPedidosNuevos(orders, ahora)).toBe(0);
  });

  it("cuando el encargue entra en ventana, sí suma", () => {
    const yaFue = new Date(ahora.getTime() - 10 * 60_000).toISOString();
    const orders = [{ ...base, scheduled_at: yaFue }] as AdminOrder[];
    expect(countPedidosNuevos(orders, ahora)).toBe(1);
  });

  it("un pedido sin hora pedida suma siempre: es de ahora", () => {
    const orders = [{ ...base, scheduled_at: null }] as AdminOrder[];
    expect(countPedidosNuevos(orders, ahora)).toBe(1);
  });
});

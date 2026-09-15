import { describe, expect, it } from "vitest";

import {
  encuadreDeMesas,
  estadoDeMesasEn,
  horaInicial,
  horasDelDia,
  momentoDe,
  nombreEnMesa,
  renglonesDeMesa,
  sinMesa,
  type ReservaEnPlano,
} from "./plano-del-dia";
import type { FloorTable, ReservationService } from "./types";

const TZ = "America/Argentina/Buenos_Aires";
const DATE = "2026-09-05";

function mesa(id: string): FloorTable {
  return {
    id,
    floor_plan_id: "fp1",
    label: id,
    seats: 4,
    shape: "circle",
    x: 0,
    y: 0,
    width: 60,
    height: 60,
    rotation: 0,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
  };
}

function reserva(over: Partial<ReservaEnPlano> & { id: string }): ReservaEnPlano {
  return {
    table_id: "T1",
    starts_at: "2026-09-05T23:00:00Z", // 20:00 ART
    ends_at: "2026-09-06T00:30:00Z", // 21:30 ART
    status: "confirmed",
    party_size: 4,
    customer_name: "X",
    ...over,
  };
}

describe("estadoDeMesasEn", () => {
  const mesas = [mesa("T1"), mesa("T2")];

  it("la mesa está tomada dentro de su rango y libre fuera", () => {
    const rs = [reserva({ id: "r1" })];
    const dentro = estadoDeMesasEn(new Date("2026-09-05T23:30:00Z"), rs, mesas);
    expect(dentro.find((m) => m.mesa.id === "T1")?.estado).toBe("reservada");
    expect(dentro.find((m) => m.mesa.id === "T2")?.estado).toBe("libre");

    const antes = estadoDeMesasEn(new Date("2026-09-05T22:00:00Z"), rs, mesas);
    expect(antes.find((m) => m.mesa.id === "T1")?.estado).toBe("libre");
  });

  it("el rango es [inicio, fin): el borde de arranque toma, el de cierre suelta", () => {
    const rs = [reserva({ id: "r1" })];
    expect(
      estadoDeMesasEn(new Date("2026-09-05T23:00:00Z"), rs, mesas)[0].estado,
    ).toBe("reservada");
    expect(
      estadoDeMesasEn(new Date("2026-09-06T00:30:00Z"), rs, mesas)[0].estado,
    ).toBe("libre");
  });

  it("una solicitud sin responder se distingue de una confirmada", () => {
    const rs = [reserva({ id: "r1", status: "pending" })];
    expect(
      estadoDeMesasEn(new Date("2026-09-05T23:30:00Z"), rs, mesas)[0].estado,
    ).toBe("pendiente");
  });

  it("con dos encima, gana la pendiente: es la que hay que decidir", () => {
    const rs = [
      reserva({ id: "conf" }),
      reserva({ id: "pend", status: "pending" }),
    ];
    const m = estadoDeMesasEn(new Date("2026-09-05T23:30:00Z"), rs, mesas)[0];
    expect(m.estado).toBe("pendiente");
    expect(m.reserva?.id).toBe("pend");
  });

  it("lo cancelado, rechazado o vencido no ocupa nada", () => {
    for (const status of ["cancelled", "rejected", "expired", "no_show"] as const) {
      const rs = [reserva({ id: "r1", status })];
      expect(
        estadoDeMesasEn(new Date("2026-09-05T23:30:00Z"), rs, mesas)[0].estado,
      ).toBe("libre");
    }
  });
});

describe("horasDelDia", () => {
  const servicio = (over: Partial<ReservationService>): ReservationService => ({
    id: "s1",
    business_id: "b1",
    name: "Cena",
    day_of_week: null,
    opens_at: "20:00",
    closes_at: "21:00",
    soft_capacity: null,
    floor_plan_id: null,
    ...over,
  });

  it("estricto: los slots configurados de ese día", () => {
    // 2026-09-05 es sábado (6).
    const horas = horasDelDia({
      date: DATE,
      timezone: TZ,
      mode: "estricto",
      schedule: { "6": { open: true, slots: ["12:00", "20:30"] } },
      services: [],
      reservas: [],
    });
    expect(horas).toEqual(["12:00", "20:30"]);
  });

  it("estricto: un día cerrado no ofrece horas propias", () => {
    const horas = horasDelDia({
      date: DATE,
      timezone: TZ,
      mode: "estricto",
      schedule: { "6": { open: false, slots: [] } },
      services: [],
      reservas: [],
    });
    expect(horas).toEqual([]);
  });

  it("flexible: la ventana del servicio, cada 30 min", () => {
    const horas = horasDelDia({
      date: DATE,
      timezone: TZ,
      mode: "flexible",
      schedule: {},
      services: [servicio({})],
      reservas: [],
    });
    expect(horas).toEqual(["20:00", "20:30"]);
  });

  it("flexible: un servicio de otro día no aporta horas", () => {
    const horas = horasDelDia({
      date: DATE,
      timezone: TZ,
      mode: "flexible",
      schedule: {},
      services: [servicio({ day_of_week: 1 })],
      reservas: [],
    });
    expect(horas).toEqual([]);
  });

  it("sin config, las horas de lo que hay reservado", () => {
    const horas = horasDelDia({
      date: DATE,
      timezone: TZ,
      mode: "estricto",
      schedule: {},
      services: [],
      reservas: [reserva({ id: "r1" })],
    });
    expect(horas).toEqual(["20:00"]);
  });
});

describe("sinMesa", () => {
  it("cuenta las genéricas vivas del momento", () => {
    const rs = [
      reserva({ id: "g1", table_id: null, party_size: 4 }),
      reserva({ id: "g2", table_id: null, party_size: 7, status: "pending" }),
      reserva({ id: "g3", table_id: null, status: "cancelled" }),
      reserva({ id: "conmesa" }),
    ];
    const res = sinMesa(new Date("2026-09-05T23:30:00Z"), rs);
    expect(res.cantidad).toBe(2);
    expect(res.cubiertos).toBe(11);
  });

  // Spec 189 — con el plano de entrada, el contador tiene que poder abrirse:
  // devuelve las filas, ordenadas por hora.
  it("devuelve las genéricas ordenadas por hora de inicio", () => {
    const rs = [
      reserva({
        id: "g-tarde",
        table_id: null,
        starts_at: "2026-09-05T23:30:00Z",
        ends_at: "2026-09-06T01:00:00Z",
      }),
      reserva({ id: "g-temprano", table_id: null }), // 20:00 ART
      reserva({ id: "conmesa" }),
    ];
    const res = sinMesa(new Date("2026-09-05T23:40:00Z"), rs);
    expect(res.reservas.map((r) => r.id)).toEqual(["g-temprano", "g-tarde"]);
  });
});

describe("horaInicial", () => {
  it("abre en la primera hora con algo reservado", () => {
    const horas = ["12:00", "20:00", "20:30"];
    const rs = [reserva({ id: "r1" })]; // 20:00–21:30 ART
    expect(horaInicial(horas, rs, DATE, TZ)).toBe("20:00");
  });

  it("sin reservas, la primera hora del día", () => {
    expect(horaInicial(["12:00", "20:00"], [], DATE, TZ)).toBe("12:00");
  });

  it("sin horas, string vacío", () => {
    expect(horaInicial([], [], DATE, TZ)).toBe("");
  });
});

describe("momentoDe", () => {
  it("interpreta la hora en la TZ del negocio", () => {
    expect(momentoDe(DATE, "20:00", TZ).toISOString()).toBe(
      "2026-09-05T23:00:00.000Z",
    );
  });
});

describe("encuadreDeMesas (spec 144)", () => {
  it("encuadra el rectángulo que ocupan las mesas, con aire", () => {
    const mesas = [
      { x: 100, y: 50, width: 60, height: 60 },
      { x: 300, y: 200, width: 40, height: 40 },
    ];
    // minX 100-40=60, minY 50-40=10, maxX 340+40=380, maxY 240+40=280.
    expect(encuadreDeMesas(mesas)).toBe("60 10 320 270");
  });

  it("sin mesas devuelve un encuadre neutro en vez de NaN", () => {
    expect(encuadreDeMesas([])).toBe("0 0 100 100");
  });
});

describe("renglonesDeMesa", () => {
  // Spec 189 — la mesa dice de quién es sin que la toquen; el parque va de 35
  // a 160 unidades de ancho, así que el detalle se cae con orden.
  const r = reserva({ id: "r1", party_size: 4, customer_name: "Juan Pérez" });

  it("una mesa holgada muestra hora, cubiertos y nombre", () => {
    expect(renglonesDeMesa({ width: 70, height: 70 }, r, TZ)).toEqual([
      "20:00 · 4p",
      "Juan",
    ]);
  });

  it("una mesa angosta pierde la hora, nunca los cubiertos", () => {
    expect(renglonesDeMesa({ width: 35, height: 60 }, r, TZ)[0]).toBe("4p");
  });

  it("una mesa baja se queda con un solo renglón", () => {
    expect(renglonesDeMesa({ width: 70, height: 40 }, r, TZ)).toHaveLength(1);
  });

  it("la mesa libre no dice nada", () => {
    expect(renglonesDeMesa({ width: 70, height: 70 }, null, TZ)).toEqual([]);
  });
});

describe("nombreEnMesa", () => {
  it("usa el nombre de pila", () => {
    expect(nombreEnMesa("Juan Pérez", 70)).toBe("Juan");
  });

  it("corta con elipsis lo que no entra", () => {
    expect(nombreEnMesa("Maximiliano", 40)).toBe("Maxim…");
  });
});

import { describe, expect, it } from "vitest";

import {
  conteoPorTurno,
  encuadreDeMesas,
  nombreEnMesa,
  renglonesDeMesa,
  reservasDelDia,
  sinMesa,
  turnoDe,
  type ReservaEnPlano,
} from "./plano-del-dia";
import type { FloorTable } from "./types";

const TZ = "America/Argentina/Buenos_Aires";

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

/** 15:00 ART del mismo día. */
const MEDIODIA = "2026-09-05T18:00:00Z";
/** 18:30 ART. */
const TARDE = "2026-09-05T21:30:00Z";

describe("reservasDelDia", () => {
  const mesas = [mesa("T1"), mesa("T2")];

  it("pone cada reserva en su mesa y deja libre a la que no tiene", () => {
    const res = reservasDelDia([reserva({ id: "r1" })], mesas, { timezone: TZ });
    expect(res.find((m) => m.mesa.id === "T1")?.estado).toBe("reservada");
    expect(res.find((m) => m.mesa.id === "T2")?.estado).toBe("libre");
  });

  // Spec 190 — el día entero, sin slider: dos turnos en la misma mesa se ven
  // los dos, ordenados por hora.
  it("una mesa con dos turnos los lista ordenados por hora", () => {
    const res = reservasDelDia(
      [
        reserva({ id: "noche" }),
        reserva({ id: "mediodia", starts_at: MEDIODIA, ends_at: TARDE }),
      ],
      mesas,
      { timezone: TZ },
    );
    const t1 = res.find((m) => m.mesa.id === "T1");
    expect(t1?.reservas.map((r) => r.id)).toEqual(["mediodia", "noche"]);
  });

  it("lo cancelado, vencido y terminado no pinta el salón", () => {
    for (const status of ["cancelled", "expired", "rejected", "completed", "no_show"] as const) {
      const res = reservasDelDia([reserva({ id: "r1", status })], mesas, {
        timezone: TZ,
      });
      expect(res.find((m) => m.mesa.id === "T1")?.estado).toBe("libre");
    }
  });

  it("la pendiente gana sobre la confirmada en la misma mesa", () => {
    const res = reservasDelDia(
      [
        reserva({ id: "conf" }),
        reserva({ id: "pend", status: "pending", starts_at: MEDIODIA }),
      ],
      mesas,
      { timezone: TZ },
    );
    expect(res.find((m) => m.mesa.id === "T1")?.estado).toBe("pendiente");
  });

  it("el filtro de turno deja sólo las de ese turno", () => {
    const rs = [
      reserva({ id: "noche" }),
      reserva({ id: "mediodia", starts_at: MEDIODIA }),
    ];
    const soloNoche = reservasDelDia(rs, mesas, { turno: "noche", timezone: TZ });
    expect(soloNoche.find((m) => m.mesa.id === "T1")?.reservas.map((r) => r.id)).toEqual([
      "noche",
    ]);
  });
});

describe("turnoDe", () => {
  it("parte el día en mediodía, tarde y noche", () => {
    expect(turnoDe(reserva({ id: "a", starts_at: MEDIODIA }), TZ)).toBe("mediodia");
    expect(turnoDe(reserva({ id: "b", starts_at: TARDE }), TZ)).toBe("tarde");
    expect(turnoDe(reserva({ id: "c" }), TZ)).toBe("noche"); // 20:00 ART
  });
});

describe("conteoPorTurno", () => {
  it("cuenta sólo las vivas", () => {
    const rs = [
      reserva({ id: "a", starts_at: MEDIODIA }),
      reserva({ id: "b", starts_at: MEDIODIA, status: "pending" }),
      reserva({ id: "c" }),
      reserva({ id: "d", status: "cancelled" }),
    ];
    expect(conteoPorTurno(rs, TZ)).toEqual({ mediodia: 2, tarde: 0, noche: 1 });
  });
});

describe("sinMesa", () => {
  it("cuenta las genéricas vivas del día y devuelve las filas por hora", () => {
    const rs = [
      reserva({ id: "g-noche", table_id: null, party_size: 4 }),
      reserva({
        id: "g-mediodia",
        table_id: null,
        party_size: 7,
        status: "pending",
        starts_at: MEDIODIA,
      }),
      reserva({ id: "g-muerta", table_id: null, status: "cancelled" }),
      reserva({ id: "conmesa" }),
    ];
    const res = sinMesa(rs, { timezone: TZ });
    expect(res.cantidad).toBe(2);
    expect(res.cubiertos).toBe(11);
    expect(res.reservas.map((r) => r.id)).toEqual(["g-mediodia", "g-noche"]);
  });

  it("respeta el filtro de turno", () => {
    const rs = [
      reserva({ id: "g-noche", table_id: null }),
      reserva({ id: "g-mediodia", table_id: null, starts_at: MEDIODIA }),
    ];
    expect(sinMesa(rs, { turno: "mediodia", timezone: TZ }).reservas.map((r) => r.id)).toEqual([
      "g-mediodia",
    ]);
  });
});

describe("renglonesDeMesa", () => {
  // Spec 189/190 — la mesa dice de quién es sin que la toquen; el parque va de
  // 35 a 160 unidades de ancho, así que el detalle se cae con orden.
  const r = reserva({ id: "r1", party_size: 4, customer_name: "Juan Pérez" });

  it("una mesa holgada muestra hora, cubiertos y nombre", () => {
    expect(renglonesDeMesa({ width: 70, height: 70 }, [r], TZ)).toEqual([
      "20:00 · 4p",
      "Juan",
    ]);
  });

  it("una mesa angosta pierde los cubiertos, nunca la hora", () => {
    expect(renglonesDeMesa({ width: 45, height: 60 }, [r], TZ)[0]).toBe("20:00");
  });

  it("una mesa baja se queda con un solo renglón", () => {
    expect(renglonesDeMesa({ width: 70, height: 40 }, [r], TZ)).toHaveLength(1);
  });

  // Spec 190 — con dos turnos en la mesa, el segundo renglón deja de ser el
  // nombre y avisa que hay más: el plano no esconde la segunda reserva.
  it("con más de una reserva avisa cuántas faltan", () => {
    const segunda = reserva({ id: "r2", starts_at: MEDIODIA, party_size: 2 });
    expect(renglonesDeMesa({ width: 70, height: 70 }, [segunda, r], TZ)).toEqual([
      "15:00 · 2p",
      "+1 más",
    ]);
  });

  it("la mesa libre no dice nada", () => {
    expect(renglonesDeMesa({ width: 70, height: 70 }, [], TZ)).toEqual([]);
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

describe("encuadreDeMesas", () => {
  it("encuadra con aire alrededor", () => {
    expect(encuadreDeMesas([mesa("T1")], 10)).toBe("-10 -10 80 80");
  });

  it("sin mesas devuelve un cuadro cualquiera", () => {
    expect(encuadreDeMesas([])).toBe("0 0 100 100");
  });
});

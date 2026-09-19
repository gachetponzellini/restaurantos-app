import { describe, expect, it } from "vitest";

import {
  anclaDeHoy,
  desplazar,
  diaOperativoDe,
  esPresente,
  etiquetaDe,
  parseAncla,
  parseGranularidad,
  rangoDe,
} from "./rango-fechas";

const TZ = "America/Argentina/Buenos_Aires"; // UTC−3

describe("diaOperativoDe (spec 153 · D5)", () => {
  it("el cierre de la 1 de la mañana pertenece al día ANTERIOR", () => {
    // Es la razón entera de la decisión: el turno del miércoles a la noche
    // termina a las 01:14 del jueves y tiene que caer con sus propios cobros.
    expect(diaOperativoDe(new Date("2026-09-03T04:14:00Z"), TZ)).toBe(
      "2026-09-02",
    );
  });

  it("a las 05:59 todavía es el día anterior; a las 06:01 ya es el nuevo", () => {
    // 05:59 AR = 08:59 UTC · 06:01 AR = 09:01 UTC
    expect(diaOperativoDe(new Date("2026-09-03T08:59:00Z"), TZ)).toBe("2026-09-02");
    expect(diaOperativoDe(new Date("2026-09-03T09:01:00Z"), TZ)).toBe("2026-09-03");
  });

  it("a media tarde es el día de calendario", () => {
    expect(diaOperativoDe(new Date("2026-09-03T18:00:00Z"), TZ)).toBe("2026-09-03");
  });

  it("cruza el fin de mes hacia atrás", () => {
    // 01/09 03:00 AR → todavía es el 31/08 operativo.
    expect(diaOperativoDe(new Date("2026-09-01T06:00:00Z"), TZ)).toBe("2026-08-31");
  });
});

describe("rangoDe", () => {
  it("un día va de las 6 AM a las 6 AM del siguiente", () => {
    // 06:00 AR = 09:00 UTC
    expect(rangoDe("dia", "2026-09-02", TZ)).toEqual({
      from: "2026-09-02T09:00:00.000Z",
      to: "2026-09-03T09:00:00.000Z",
    });
  });

  it("el cierre de la 01:14 del jueves entra en el rango del miércoles", () => {
    const { from, to } = rangoDe("dia", "2026-09-02", TZ);
    const cierre = "2026-09-03T04:14:00.000Z";
    expect(cierre >= from && cierre < to).toBe(true);
  });

  it("dos días seguidos no comparten ni pierden un instante", () => {
    // El borde derecho es exclusivo y es exactamente el izquierdo del siguiente.
    expect(rangoDe("dia", "2026-09-02", TZ).to).toBe(
      rangoDe("dia", "2026-09-03", TZ).from,
    );
  });

  it("un mes arranca el día 1 a las 6 AM y termina el 1 del siguiente", () => {
    expect(rangoDe("mes", "2026-09", TZ)).toEqual({
      from: "2026-09-01T09:00:00.000Z",
      to: "2026-10-01T09:00:00.000Z",
    });
  });

  it("diciembre cierra contra enero del año siguiente", () => {
    expect(rangoDe("mes", "2026-12", TZ).to).toBe("2027-01-01T09:00:00.000Z");
  });

  it("un año va de enero a enero", () => {
    expect(rangoDe("anio", "2026", TZ)).toEqual({
      from: "2026-01-01T09:00:00.000Z",
      to: "2027-01-01T09:00:00.000Z",
    });
  });
});

describe("desplazar", () => {
  it("día: cruza el fin de mes", () => {
    expect(desplazar("dia", "2026-09-01", -1)).toBe("2026-08-31");
    expect(desplazar("dia", "2026-08-31", 1)).toBe("2026-09-01");
  });

  it("mes: cruza el fin de año", () => {
    expect(desplazar("mes", "2026-01", -1)).toBe("2025-12");
    expect(desplazar("mes", "2026-12", 1)).toBe("2027-01");
  });

  it("año", () => {
    expect(desplazar("anio", "2026", -1)).toBe("2025");
  });
});

describe("etiquetaDe", () => {
  // Jueves 3/9/2026, 10:00 AR (13:00 UTC) — el día operativo es el 3.
  const ahora = new Date("2026-09-03T13:00:00Z");

  it("nombra hoy y ayer en vez de mostrar la fecha", () => {
    expect(etiquetaDe("dia", "2026-09-03", TZ, ahora)).toBe("Hoy");
    expect(etiquetaDe("dia", "2026-09-02", TZ, ahora)).toBe("Ayer");
  });

  it("más atrás muestra la fecha, sin el año si es el corriente", () => {
    expect(etiquetaDe("dia", "2026-08-31", TZ, ahora)).toBe("lun 31/8");
  });

  it("agrega el año cuando el día es de otro", () => {
    expect(etiquetaDe("dia", "2025-12-24", TZ, ahora)).toBe("mié 24/12/25");
  });

  it("el mes corriente se nombra, los otros van con su nombre en mayúscula", () => {
    expect(etiquetaDe("mes", "2026-09", TZ, ahora)).toBe("Este mes");
    expect(etiquetaDe("mes", "2026-08", TZ, ahora)).toBe("Agosto");
  });

  it("el año del mes sólo aparece cuando no es el corriente", () => {
    expect(etiquetaDe("mes", "2025-12", TZ, ahora)).toBe("Diciembre 2025");
  });

  it("el año es el año", () => {
    expect(etiquetaDe("anio", "2026", TZ, ahora)).toBe("2026");
  });

  it("a las 2 de la mañana «Hoy» sigue siendo el turno que está corriendo", () => {
    // 02:00 AR del viernes 4 → el día operativo sigue siendo el jueves 3, que
    // es el turno que la encargada tiene delante. El viernes todavía no arrancó
    // (empieza a las 6 AM), así que su fecha de calendario NO es «Hoy».
    const madrugada = new Date("2026-09-04T05:00:00Z");
    expect(etiquetaDe("dia", "2026-09-03", TZ, madrugada)).toBe("Hoy");
    expect(etiquetaDe("dia", "2026-09-04", TZ, madrugada)).toBe("vie 4/9");
  });
});

describe("esPresente", () => {
  const ahora = new Date("2026-09-03T13:00:00Z");

  it("el período corriente no deja avanzar", () => {
    expect(esPresente("dia", "2026-09-03", TZ, ahora)).toBe(true);
    expect(esPresente("mes", "2026-09", TZ, ahora)).toBe(true);
    expect(esPresente("anio", "2026", TZ, ahora)).toBe(true);
  });

  it("hacia atrás sí se puede avanzar", () => {
    expect(esPresente("dia", "2026-09-02", TZ, ahora)).toBe(false);
    expect(esPresente("mes", "2026-08", TZ, ahora)).toBe(false);
  });
});

describe("lo que llega por la URL", () => {
  const ahora = new Date("2026-09-03T13:00:00Z");

  it("una granularidad desconocida cae en día", () => {
    expect(parseGranularidad("mes")).toBe("mes");
    expect(parseGranularidad("semana")).toBe("semana");
    expect(parseGranularidad("quincena")).toBe("dia");
    expect(parseGranularidad(undefined)).toBe("dia");
    expect(parseGranularidad(undefined, "semana")).toBe("semana");
  });

  it("la semana va de lunes 6 AM a lunes 6 AM y se ancla en el lunes", () => {
    const tz = "America/Argentina/Buenos_Aires";
    // sáb 19/9/2026 10:00 AR → semana del lun 14/9
    const ahora = new Date("2026-09-19T13:00:00Z");
    expect(anclaDeHoy("semana", tz, ahora)).toBe("2026-09-14");
    expect(parseAncla("semana", "2026-09-17", tz, ahora)).toBe("2026-09-14");
    expect(rangoDe("semana", "2026-09-14", tz)).toEqual({
      from: "2026-09-14T09:00:00.000Z",
      to: "2026-09-21T09:00:00.000Z",
    });
    expect(etiquetaDe("semana", "2026-09-14", tz, ahora)).toBe("Esta semana");
    expect(etiquetaDe("semana", "2026-09-07", tz, ahora)).toBe("Semana pasada");
    expect(etiquetaDe("semana", "2026-08-31", tz, ahora)).toBe("31/8 – 6/9");
  });

  it("un ancla con basura cae en el período corriente, no rompe", () => {
    expect(parseAncla("dia", "2026-09-01", TZ, ahora)).toBe("2026-09-01");
    expect(parseAncla("dia", "ayer", TZ, ahora)).toBe("2026-09-03");
    expect(parseAncla("mes", "2026-09-01", TZ, ahora)).toBe("2026-09");
    expect(parseAncla("anio", undefined, TZ, ahora)).toBe("2026");
  });
});

describe("anclaDeHoy", () => {
  it("a la 1 de la mañana devuelve el día que todavía está corriendo", () => {
    const madrugada = new Date("2026-09-03T04:14:00Z"); // 01:14 AR
    expect(anclaDeHoy("dia", TZ, madrugada)).toBe("2026-09-02");
    expect(anclaDeHoy("mes", TZ, madrugada)).toBe("2026-09");
  });

  it("el 1 del mes a las 3 AM el mes todavía es el anterior", () => {
    const madrugada = new Date("2026-09-01T06:00:00Z"); // 03:00 AR del 1/9
    expect(anclaDeHoy("mes", TZ, madrugada)).toBe("2026-08");
  });
});

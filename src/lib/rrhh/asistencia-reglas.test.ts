import { describe, expect, it } from "vitest";

import { fichadaSePisa, validarFichada } from "./asistencia-reglas";

const t = (h: string) => `2026-09-10T${h}:00-03:00`;

describe("validarFichada (spec 179)", () => {
  it("la salida tiene que ser después de la entrada", () => {
    expect(validarFichada({ clock_in: t("10:00"), clock_out: t("09:00") })).toEqual({
      ok: false,
      error: "La salida tiene que ser después de la entrada.",
    });
    expect(validarFichada({ clock_in: t("10:00"), clock_out: t("10:00") }).ok).toBe(false);
  });

  it("una fichada abierta (sin salida) es válida", () => {
    expect(validarFichada({ clock_in: t("10:00"), clock_out: null })).toEqual({ ok: true });
  });

  it("no se ficha en el futuro", () => {
    const manana = new Date(Date.now() + 86_400_000).toISOString();
    expect(validarFichada({ clock_in: manana, clock_out: null }).ok).toBe(false);
  });

  it("una jornada no puede durar más de 24 horas: es un error de tipeo, no un turno", () => {
    expect(
      validarFichada({ clock_in: t("10:00"), clock_out: "2026-09-11T11:00:00-03:00" }).ok,
    ).toBe(false);
    // Un turno largo de verdad —cena hasta las 3— sí entra.
    expect(
      validarFichada({ clock_in: "2026-09-10T18:00:00-03:00", clock_out: "2026-09-11T03:00:00-03:00" }).ok,
    ).toBe(true);
  });

  it("una fecha que no parsea no pasa", () => {
    expect(validarFichada({ clock_in: "ayer", clock_out: null }).ok).toBe(false);
  });
});

describe("fichadaSePisa (spec 179 · D3)", () => {
  const otras = [
    { id: "a", clock_in: t("09:00"), clock_out: t("13:00") },
    { id: "b", clock_in: t("18:00"), clock_out: null }, // abierta
  ];

  it("una fichada entre medio de dos no se pisa con ninguna", () => {
    expect(fichadaSePisa({ clock_in: t("14:00"), clock_out: t("17:00") }, otras)).toBeNull();
  });

  it("se pisa si arranca adentro de otra", () => {
    expect(fichadaSePisa({ clock_in: t("12:00"), clock_out: t("15:00") }, otras)?.id).toBe("a");
  });

  it("se pisa si termina adentro de otra", () => {
    expect(fichadaSePisa({ clock_in: t("08:00"), clock_out: t("10:00") }, otras)?.id).toBe("a");
  });

  it("se pisa si envuelve a otra", () => {
    expect(fichadaSePisa({ clock_in: t("08:00"), clock_out: t("14:00") }, otras)?.id).toBe("a");
  });

  it("una abierta ocupa desde su entrada en adelante", () => {
    expect(fichadaSePisa({ clock_in: t("19:00"), clock_out: t("20:00") }, otras)?.id).toBe("b");
    // Y una nueva abierta después de la abierta también se pisa.
    expect(fichadaSePisa({ clock_in: t("19:00"), clock_out: null }, otras)?.id).toBe("b");
  });

  it("tocarse en el borde no es pisarse: salió a las 13 y volvió a entrar a las 13", () => {
    expect(fichadaSePisa({ clock_in: t("13:00"), clock_out: t("14:00") }, otras)).toBeNull();
  });

  it("al corregir, la fichada no se pisa consigo misma", () => {
    expect(
      fichadaSePisa({ clock_in: t("09:30"), clock_out: t("12:00") }, otras, "a"),
    ).toBeNull();
  });
});

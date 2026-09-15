import { describe, expect, it } from "vitest";

import {
  ACTIVIDAD_RECIENTE_MS,
  HOLD_MS,
  OFFLINE_THRESHOLD_MS,
  PERIODOS_DE_GRACIA,
  POLL_CERRADO_MS,
  POLL_OCIOSO_MS,
  POLL_RAPIDO_MS,
  PROBE_MS,
  RTT_PISO_MS,
  cadenciaOciosaMaxMs,
  retencionMs,
} from "./cadence";

// La cadencia del print-agent (spec 183). Los tests fijan VALORES, no formas:
// que alguien devuelva la retención a cero o el umbral a 60 s tiene que romper
// CI, no aparecer en la factura —o en un «sin conexión» falso— tres semanas
// después. Es la lección de la D3: el 1000 de `pollMs` vivió un año porque
// nada lo miraba.

describe("retención del GET (D5)", () => {
  it("retiene 25 s cuando no hay nada para imprimir", () => {
    expect(HOLD_MS).toBe(25_000);
  });

  it("mira la cola cada 2 s mientras retiene — esa es la latencia real", () => {
    expect(PROBE_MS).toBe(2_000);
    // La sonda tiene que caber varias veces en la retención: si el intervalo
    // fuera del orden de la retención, retener no serviría de nada.
    expect(HOLD_MS / PROBE_MS).toBeGreaterThanOrEqual(5);
  });

  it("el período ocioso queda en el orden de los 30 s que pidió Juan", () => {
    // Agente ocioso: retención + su sleep + el RTT de un request (con D1).
    const periodo = HOLD_MS + POLL_OCIOSO_MS + RTT_PISO_MS;
    expect(periodo).toBeGreaterThanOrEqual(28_000);
    expect(periodo).toBeLessThanOrEqual(35_000);
  });

  it("un agente viejo (pollMs 1000 o 10000) también cae cerca de los 30 s", () => {
    // kcc y golf hoy. La retención los pacea igual: no leen `next_poll_ms`
    // pero sí esperan la respuesta HTTP.
    expect(HOLD_MS + 1_000 + RTT_PISO_MS).toBeGreaterThanOrEqual(25_000);
    expect(HOLD_MS + 10_000 + RTT_PISO_MS).toBeLessThanOrEqual(40_000);
  });
});

describe("retencionMs — el `wait_ms` del llamador", () => {
  it("sin parámetro retiene el default", () => {
    expect(retencionMs(undefined)).toBe(HOLD_MS);
    expect(retencionMs(null)).toBe(HOLD_MS);
    expect(retencionMs("")).toBe(HOLD_MS);
  });

  it("`wait_ms=0` desactiva la retención (es lo que usa `--once`)", () => {
    expect(retencionMs("0")).toBe(0);
    expect(retencionMs(0)).toBe(0);
  });

  it("acota al techo: nadie puede pedir que lo retengan más que HOLD_MS", () => {
    expect(retencionMs("999999")).toBe(HOLD_MS);
  });

  it("basura o negativo → el default, no un error", () => {
    expect(retencionMs("chau")).toBe(HOLD_MS);
    expect(retencionMs("-5000")).toBe(HOLD_MS);
  });

  it("un valor intermedio se respeta tal cual", () => {
    expect(retencionMs("5000")).toBe(5_000);
  });
});

describe("umbral de «sin conexión» derivado de la cadencia (D5, arreglo 1)", () => {
  it("el peor período ocioso es retención + sleep de cerrado + RTT", () => {
    expect(cadenciaOciosaMaxMs()).toBe(
      HOLD_MS + POLL_CERRADO_MS + RTT_PISO_MS,
    );
  });

  it("el umbral son 3 períodos del peor caso — ya no 60 s clavados", () => {
    expect(OFFLINE_THRESHOLD_MS).toBe(PERIODOS_DE_GRACIA * cadenciaOciosaMaxMs());
    expect(PERIODOS_DE_GRACIA).toBe(3);
  });

  it("dos latidos perdidos seguidos NO alarman (la falsa alarma de la D5)", () => {
    // El bug que arregla: con 60 s de umbral y 30,8 s de período entraban dos
    // latidos justos, así que un tick lento cantaba «sin conexión».
    expect(OFFLINE_THRESHOLD_MS).toBeGreaterThan(2 * cadenciaOciosaMaxMs());
  });

  it("pero el agente muerto se canta en minutos, no en horas", () => {
    expect(OFFLINE_THRESHOLD_MS).toBeLessThan(5 * 60_000);
  });
});

describe("los sleeps que manda el server (D2)", () => {
  it("el piso nunca baja de 1 s y el techo está acotado a 20 s", () => {
    expect(POLL_RAPIDO_MS).toBe(1_000);
    expect(POLL_CERRADO_MS).toBe(20_000);
    expect(POLL_OCIOSO_MS).toBeGreaterThan(POLL_RAPIDO_MS);
    expect(POLL_OCIOSO_MS).toBeLessThan(POLL_CERRADO_MS);
  });

  it("la ventana de «movimiento reciente» son 3 minutos", () => {
    expect(ACTIVIDAD_RECIENTE_MS).toBe(180_000);
  });
});

// #148 · H-20 + H-45 — los pedidos online que nadie resuelve se vencen.
//
// Plazos decididos por Juan (2026-09-21):
// - MP sin pagar → se cancela a las 2 h de creado («Pago no completado»). La
//   preferencia de MP vence a los 90 min, así que a las 2 h ya no se puede pagar.
// - Programado en efectivo que nadie aceptó → aviso al encargado 30 min después
//   de su horario, y se cancela a la hora («No confirmado»).
// - Nunca se toca un pedido con algún pago acreditado.
import { describe, expect, it } from "vitest";

import { decidirVencimiento, type CandidatoVencimiento } from "./vencer-pendientes";

const ahora = new Date("2026-09-21T15:00:00Z");
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();

const mp = (over: Partial<CandidatoVencimiento> = {}): CandidatoVencimiento => ({
  payment_method: "mp",
  status: "pending",
  payment_status: "pending",
  created_at: hace(121),
  scheduled_at: null,
  tienePagoAcreditado: false,
  ...over,
});

const programadoEfectivo = (over: Partial<CandidatoVencimiento> = {}): CandidatoVencimiento => ({
  payment_method: "cash",
  status: "pending",
  payment_status: "pending",
  created_at: hace(600),
  scheduled_at: hace(61),
  tienePagoAcreditado: false,
  ...over,
});

describe("decidirVencimiento · MP sin pagar", () => {
  it("a las 2 h de creado se cancela", () => {
    expect(decidirVencimiento(mp(), ahora)).toBe("cancelar_impago");
  });

  it("antes de las 2 h no se toca", () => {
    expect(decidirVencimiento(mp({ created_at: hace(119) }), ahora)).toBeNull();
  });

  it("con un pago acreditado nunca se toca, aunque el estado diga pending", () => {
    expect(decidirVencimiento(mp({ tienePagoAcreditado: true }), ahora)).toBeNull();
  });

  it("pagado no se toca", () => {
    expect(decidirVencimiento(mp({ payment_status: "paid" }), ahora)).toBeNull();
  });

  it("ya aceptado (confirmed) no se toca", () => {
    expect(decidirVencimiento(mp({ status: "confirmed" }), ahora)).toBeNull();
  });
});

describe("decidirVencimiento · programado en efectivo sin aceptar", () => {
  it("una hora después de su horario se cancela", () => {
    expect(decidirVencimiento(programadoEfectivo(), ahora)).toBe("cancelar_no_confirmado");
  });

  it("entre los 30 y los 60 min después de su horario, se avisa", () => {
    expect(decidirVencimiento(programadoEfectivo({ scheduled_at: hace(31) }), ahora)).toBe("avisar");
  });

  it("antes de los 30 min de su horario no se hace nada", () => {
    expect(decidirVencimiento(programadoEfectivo({ scheduled_at: hace(29) }), ahora)).toBeNull();
  });

  it("aceptado (confirmed) no se toca: ya lo marcha el cron", () => {
    expect(decidirVencimiento(programadoEfectivo({ status: "confirmed" }), ahora)).toBeNull();
  });

  it("un pedido en efectivo sin horario (inmediato) queda fuera de este barrido", () => {
    expect(decidirVencimiento(programadoEfectivo({ scheduled_at: null }), ahora)).toBeNull();
  });
});

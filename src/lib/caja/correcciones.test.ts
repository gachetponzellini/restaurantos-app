import { describe, expect, it } from "vitest";

import {
  diffPatch,
  evaluarGuardas,
  evaluarGuardasDeAnulacion,
  mapCorreccionError,
  validarCorreccion,
  veredictoDeMonto,
  type ContextoCorreccion,
  type PagoActual,
} from "./correcciones";

const PAGO: PagoActual = {
  method: "cash",
  amount_cents: 10_000,
  tip_cents: 0,
  attributed_mozo_id: "mozo-1",
  caja_id: "caja-1",
  last_four: null,
  card_brand: null,
  notes: null,
};

const MOTIVO = "lo pagó con débito";

describe("caja / diffPatch", () => {
  it("deja sólo lo que cambia", () => {
    expect(
      diffPatch(PAGO, { method: "card_manual", amount_cents: 10_000 }),
    ).toEqual({ method: "card_manual" });
  });

  it("ignora los campos ausentes", () => {
    expect(diffPatch(PAGO, {})).toEqual({});
  });

  it("distingue poner en null de no tocar", () => {
    expect(diffPatch(PAGO, { attributed_mozo_id: null })).toEqual({
      attributed_mozo_id: null,
    });
    expect(diffPatch(PAGO, { last_four: null })).toEqual({});
  });
});

describe("caja / validarCorreccion", () => {
  it("acepta un cambio de método con motivo", () => {
    expect(validarCorreccion(PAGO, { method: "card_manual" }, MOTIVO)).toEqual({
      ok: true,
    });
  });

  it("exige motivo", () => {
    const r = validarCorreccion(PAGO, { method: "card_manual" }, "   ");
    expect(r.ok).toBe(false);
  });

  it("rechaza una corrección que no cambia nada", () => {
    const r = validarCorreccion(PAGO, { method: "cash" }, MOTIVO);
    expect(r).toEqual({ ok: false, error: "No hay nada que corregir." });
  });

  it("no corrige un pago de Mercado Pago", () => {
    const mp: PagoActual = { ...PAGO, method: "mp_link" };
    const r = validarCorreccion(mp, { method: "cash" }, MOTIVO);
    expect(r.ok).toBe(false);
  });

  it("no convierte un pago manual en uno de MP", () => {
    const r = validarCorreccion(PAGO, { method: "mp_qr" }, MOTIVO);
    expect(r.ok).toBe(false);
  });

  it("rechaza monto cero o negativo", () => {
    expect(validarCorreccion(PAGO, { amount_cents: 0 }, MOTIVO).ok).toBe(false);
    expect(validarCorreccion(PAGO, { amount_cents: -100 }, MOTIVO).ok).toBe(
      false,
    );
  });

  it("rechaza montos no enteros", () => {
    expect(validarCorreccion(PAGO, { amount_cents: 1500.5 }, MOTIVO).ok).toBe(
      false,
    );
  });

  it("rechaza propina mayor que el monto", () => {
    const conPropina: PagoActual = { ...PAGO, tip_cents: 1_000 };
    const r = validarCorreccion(conPropina, { amount_cents: 500 }, MOTIVO);
    expect(r).toEqual({
      ok: false,
      error: "La propina no puede ser mayor que el monto cobrado.",
    });
  });

  it("acepta bajar monto y propina juntos", () => {
    const conPropina: PagoActual = { ...PAGO, tip_cents: 1_000 };
    expect(
      validarCorreccion(
        conPropina,
        { amount_cents: 500, tip_cents: 100 },
        MOTIVO,
      ),
    ).toEqual({ ok: true });
  });

  it("exige 4 dígitos en los últimos 4", () => {
    expect(validarCorreccion(PAGO, { last_four: "12" }, MOTIVO).ok).toBe(false);
    expect(
      validarCorreccion(
        PAGO,
        { method: "card_manual", last_four: "4242" },
        MOTIVO,
      ).ok,
    ).toBe(true);
  });

  it("exige nota en otro, no en transferencia (spec 126)", () => {
    // La corrección ya pide `motivo` obligatorio: el rastro de auditoría no
    // colgaba de este campo. Misma regla que el cobro.
    expect(validarCorreccion(PAGO, { method: "transfer" }, MOTIVO).ok).toBe(
      true,
    );
    expect(
      validarCorreccion(
        PAGO,
        { method: "transfer", notes: "alias juan.mp" },
        MOTIVO,
      ).ok,
    ).toBe(true);
    expect(validarCorreccion(PAGO, { method: "other" }, MOTIVO).ok).toBe(false);
  });
});

const CTX: ContextoCorreccion = {
  pago: {
    business_id: "biz-1",
    payment_status: "paid",
    mp_payment_id: null,
    created_at: "2026-07-30T20:00:00.000Z",
    caja_id: "caja-1",
    attributed_mozo_id: "mozo-1",
  },
  businessId: "biz-1",
  ultimoCorteOrigen: "2026-07-30T14:00:00.000Z",
  ultimoCorteDestino: null,
  rendicionesPosteriores: [],
};

describe("caja / evaluarGuardas", () => {
  it("deja pasar una corrección del período abierto", () => {
    expect(evaluarGuardas(CTX, { method: "card_manual" })).toEqual({ ok: true });
  });

  it("acepta una caja que nunca se arqueó", () => {
    expect(
      evaluarGuardas({ ...CTX, ultimoCorteOrigen: null }, { method: "transfer" }),
    ).toEqual({ ok: true });
  });

  it("rechaza un cobro de otro negocio", () => {
    const r = evaluarGuardas({ ...CTX, businessId: "biz-2" }, { method: "cash" });
    expect(r).toEqual({ ok: false, error: "Ese cobro no es de este negocio." });
  });

  it("rechaza un pago que no está paid", () => {
    const r = evaluarGuardas(
      { ...CTX, pago: { ...CTX.pago, payment_status: "refunded" } },
      { method: "cash" },
    );
    expect(r.ok).toBe(false);
  });

  it("rechaza un pago acreditado por Mercado Pago", () => {
    const r = evaluarGuardas(
      { ...CTX, pago: { ...CTX.pago, mp_payment_id: "mp-123" } },
      { method: "cash" },
    );
    expect(r.ok).toBe(false);
  });

  it("rechaza un cobro anterior al último corte", () => {
    const r = evaluarGuardas(
      { ...CTX, ultimoCorteOrigen: "2026-07-30T21:00:00.000Z" },
      { method: "card_manual" },
    );
    expect(r).toEqual({
      ok: false,
      error:
        // spec 098 · H-35 — el consejo cambió: mandar a «anulá el cobro» era
        // mandarlo por la única puerta que podía reescribir un arqueo firmado.
        "Ese cobro ya entró en un arqueo cerrado. Registrá la diferencia como un movimiento del período actual.",
    });
  });

  it("rechaza mover el cobro a una caja con arqueo posterior", () => {
    const r = evaluarGuardas(
      { ...CTX, ultimoCorteDestino: "2026-07-30T21:00:00.000Z" },
      { caja_id: "caja-2" },
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("caja destino");
  });

  // La factura se emite sobre la CUENTA, no sobre el pago: corregir cuánta
  // plata entró a la caja no cambia un peso de lo declarado a ARCA. Si lo que
  // está mal es el importe facturado, se anula y se re-factura en Facturación.
  it("una cuenta facturada no bloquea la corrección del cobro", () => {
    expect(evaluarGuardas(CTX, { amount_cents: 500 })).toEqual({ ok: true });
    expect(evaluarGuardas(CTX, { tip_cents: 100 })).toEqual({ ok: true });
  });

  it("rechaza reatribuir un cobro que ya entró en una rendición, con nombre", () => {
    const r = evaluarGuardas(
      { ...CTX, rendicionesPosteriores: [{ mozoId: "mozo-1", nombre: "Ana" }] },
      { attributed_mozo_id: "mozo-2" },
    );
    expect(r).toEqual({
      ok: false,
      error: "Ese cobro ya entró en la rendición de Ana.",
    });
  });

  // #356 — la plata de un cobro rendido no se toca: el mozo entregó contra
  // ESE método y ESE monto. Cambiarlo movía el esperado del cajón y no la
  // rendición → diferencia en el arqueo sin dueño.
  it.each([
    ["el método", { method: "card_manual" as const }],
    ["el monto", { amount_cents: 12_000 }],
    ["la propina", { tip_cents: 500 }],
  ])("con una rendición posterior no se corrige %s", (_, patch) => {
    const r = evaluarGuardas(
      { ...CTX, rendicionesPosteriores: [{ mozoId: "mozo-1", nombre: "Ana" }] },
      patch,
    );
    expect(r).toEqual({
      ok: false,
      error: "Ese cobro ya entró en la rendición de Ana: su plata no se corrige.",
    });
  });

  it("con una rendición posterior sí se corrige lo que no es plata", () => {
    expect(
      evaluarGuardas(
        { ...CTX, rendicionesPosteriores: [{ mozoId: "mozo-1", nombre: "Ana" }] },
        { notes: "era Visa", last_four: "1234", card_brand: "visa" },
      ),
    ).toEqual({ ok: true });
  });

  it("desatribuir también cuenta como cambio de mozo", () => {
    const r = evaluarGuardas(
      { ...CTX, rendicionesPosteriores: [{ mozoId: "mozo-1", nombre: "Ana" }] },
      { attributed_mozo_id: null },
    );
    expect(r.ok).toBe(false);
  });
});

describe("caja / evaluarGuardasDeAnulacion", () => {
  it("deja anular una línea del período abierto", () => {
    expect(evaluarGuardasDeAnulacion(CTX)).toEqual({ ok: true });
  });

  it("no anula un cobro de un arqueo cerrado", () => {
    expect(
      evaluarGuardasDeAnulacion({
        ...CTX,
        ultimoCorteOrigen: "2026-07-30T21:00:00.000Z",
      }).ok,
    ).toBe(false);
  });

  it("no anula un cobro de Mercado Pago", () => {
    expect(
      evaluarGuardasDeAnulacion({
        ...CTX,
        pago: { ...CTX.pago, mp_payment_id: "mp-1" },
      }).ok,
    ).toBe(false);
  });

  it("no anula un cobro ya anulado", () => {
    expect(
      evaluarGuardasDeAnulacion({
        ...CTX,
        pago: { ...CTX.pago, payment_status: "refunded" },
      }).ok,
    ).toBe(false);
  });

  // Anular baja la liquidación del mozo: si ya rindió, es la misma frontera
  // que reatribuir — pero acá aplica siempre, no sólo al cambiar el mozo.
  it("no anula un cobro que ya entró en una rendición, y lo dice con nombre", () => {
    const r = evaluarGuardasDeAnulacion({
      ...CTX,
      rendicionesPosteriores: [{ mozoId: "mozo-1", nombre: "Ana" }],
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("Ana");
  });
});

describe("caja / veredictoDeMonto", () => {
  it("una orden cerrada que sigue cubierta no cambia de estado", () => {
    expect(
      veredictoDeMonto({ lifecycle: "closed", cubiertaDespues: true }),
    ).toBe("sin_cambio_de_estado");
  });

  it("una orden cerrada que quedaría impaga se rechaza", () => {
    expect(
      veredictoDeMonto({ lifecycle: "closed", cubiertaDespues: false }),
    ).toBe("dejaria_descubierta");
  });

  it("una orden abierta que queda cubierta se cierra", () => {
    expect(veredictoDeMonto({ lifecycle: "open", cubiertaDespues: true })).toBe(
      "cierra_la_orden",
    );
  });

  it("una orden abierta que sigue impaga no cambia de estado", () => {
    expect(veredictoDeMonto({ lifecycle: "open", cubiertaDespues: false })).toBe(
      "sin_cambio_de_estado",
    );
  });
});

describe("caja / mapCorreccionError", () => {
  it("traduce el error de cobertura", () => {
    expect(
      mapCorreccionError('error: ORDER_WOULD_BE_UNCOVERED'),
    ).toContain("quedaría sin cubrir");
  });

  it("cae en un mensaje genérico si no lo conoce", () => {
    expect(mapCorreccionError("boom")).toBe("No se pudo corregir: boom");
  });
});

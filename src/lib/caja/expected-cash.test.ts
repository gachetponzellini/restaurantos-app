import { describe, expect, it } from "vitest";

import { calculateExpectedCash, separarRetiroDelCierre } from "./expected-cash";

describe("calculateExpectedCash", () => {
  it("sin movimientos ni payments: devuelve last_closing_cash", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 100_000,
        payments: [],
        movimientos: [],
      }),
    ).toBe(100_000);
  });

  it("primer período sin corte previo: last_closing = 0", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 50_000 }],
        movimientos: [],
      }),
    ).toBe(50_000);
  });

  it("suma cash payments e ignora otros métodos", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 50_000,
        payments: [
          { method: "cash", amount_cents: 10_000 },
          { method: "cash", amount_cents: 25_000 },
          { method: "card_manual", amount_cents: 70_000 },
          { method: "mp_link", amount_cents: 30_000 },
          { method: "other", amount_cents: 5_000 },
        ],
        movimientos: [],
      }),
    ).toBe(50_000 + 10_000 + 25_000);
  });

  it("suma ingresos y resta sangrías", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 100_000,
        payments: [],
        movimientos: [
          { kind: "ingreso", amount_cents: 20_000 },
          { kind: "sangria", amount_cents: 30_000 },
          { kind: "sangria", amount_cents: 5_000 },
        ],
      }),
    ).toBe(100_000 + 20_000 - 30_000 - 5_000);
  });

  it("escenario completo: cash + ingreso + sangría + métodos varios", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 200_000,
        payments: [
          { method: "cash", amount_cents: 150_000 },
          { method: "cash", amount_cents: 80_000 },
          { method: "card_manual", amount_cents: 100_000 },
        ],
        movimientos: [
          { kind: "ingreso", amount_cents: 50_000 },
          { kind: "sangria", amount_cents: 70_000 },
        ],
      }),
    ).toBe(200_000 + 150_000 + 80_000 + 50_000 - 70_000);
  });
  it("un movimiento anulado no mueve el efectivo esperado (spec 070)", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 100_000,
        payments: [],
        movimientos: [
          { kind: "sangria", amount_cents: 50_000, cancelled_at: "2026-07-30T21:00:00Z" },
          { kind: "ingreso", amount_cents: 20_000, cancelled_at: null },
        ],
      }),
    ).toBe(100_000 + 20_000);
  });

  // ── spec 098 · la propina no es plata del negocio ──────────────────
  //
  // Decisión de producto (Juan, 2026-08-05): la propina se cobra por el sistema
  // para poder liquidársela al mozo, pero **no es una venta**.
  //
  // ⚠️ Spec 177 · D5 — cómo se implementa eso CAMBIÓ. Hasta acá la fórmula
  // descontaba la propina de los pagos en efectivo, o sea asumía que el negocio
  // le pagaba al mozo por fuera del cajón. En KCC sale del cajón («yo sacaría
  // efectivo de la caja para darle a los mozos», Juan 2026-09-10), y con la
  // fórmula vieja eso dejaba **faltante todas las noches** por la propina de
  // tarjeta, que nunca se descontaba.
  //
  // Ahora el cajón espera **lo que entró**, y la propina sale por donde sale de
  // verdad: un movimiento `propina`. La misma cuenta sirve para los dos casos
  // físicos —la propina en efectivo que el mozo ya tiene encima y la de tarjeta
  // que se le paga del cajón— porque el pago se registra igual en los dos.

  it("el cajón espera lo que entró, propina incluida, hasta que se pague", () => {
    // El cliente paga $11.000 por una cuenta de $10.000. Los $11.000 están
    // adentro del cajón: los $1.000 del mozo todavía no salieron.
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 11_000, tip_cents: 1_000 }],
        movimientos: [],
      }),
    ).toBe(11_000);
  });

  it("pagarle la propina al mozo la saca del cajón", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 11_000, tip_cents: 1_000 }],
        movimientos: [{ kind: "propina", amount_cents: 1_000 }],
      }),
    ).toBe(10_000);
  });

  it("la propina de tarjeta también sale del cajón cuando se paga", () => {
    // El caso que la fórmula vieja no podía explicar: la venta con tarjeta no
    // suma al cajón, pero la propina se le paga al mozo en efectivo igual.
    // Antes eso era un faltante sin línea que lo justificara.
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 50_000,
        payments: [
          { method: "card_manual", amount_cents: 11_000, tip_cents: 1_000 },
        ],
        movimientos: [{ kind: "propina", amount_cents: 1_000 }],
      }),
    ).toBe(49_000);
  });

  it("un pago sin propina no cambia", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 10_000, tip_cents: 0 }],
        movimientos: [],
      }),
    ).toBe(10_000);
  });

  it("una venta con tarjeta sigue sin tocar el cajón", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [
          { method: "card_manual", amount_cents: 11_000, tip_cents: 1_000 },
        ],
        movimientos: [],
      }),
    ).toBe(0);
  });

  it("un pago de propina anulado (spec 070) devuelve la plata al cajón", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 11_000, tip_cents: 1_000 }],
        movimientos: [
          { kind: "propina", amount_cents: 1_000, cancelled_at: "2026-09-10" },
        ],
      }),
    ).toBe(11_000);
  });

  it("`tip_cents` ausente se trata como 0 (compat con filas viejas)", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 0,
        payments: [{ method: "cash", amount_cents: 10_000 }],
        movimientos: [],
      }),
    ).toBe(10_000);
  });

  // spec 130 · D3 — el retiro del cierre es una sangría insertada **después**
  // del corte, así que cae en el período nuevo: la apertura es lo contado y la
  // sangría se lo lleva entero. El día siguiente arranca con el cajón vacío sin
  // que nadie tipee un número.
  it("cerrar con retiro deja el período nuevo en $0", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 312_400,
        payments: [],
        movimientos: [{ kind: "sangria", amount_cents: 312_400 }],
      }),
    ).toBe(0);
  });

  // La casilla destildada es el arqueo de mitad de turno: se cuenta sin vaciar,
  // y la plata sigue ahí para el período que arranca.
  it("cerrar sin retiro deja el período nuevo en lo contado", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 312_400,
        payments: [],
        movimientos: [],
      }),
    ).toBe(312_400);
  });

  // Si el retiro se anula (spec 070), la plata vuelve a estar esperada: la
  // sangría sigue en el libro pero deja de mover la caja.
  it("retiro anulado: el esperado vuelve a lo contado", () => {
    expect(
      calculateExpectedCash({
        last_closing_cash_cents: 312_400,
        payments: [],
        movimientos: [
          {
            kind: "sangria",
            amount_cents: 312_400,
            cancelled_at: "2026-08-30T03:00:00Z",
          },
        ],
      }),
    ).toBe(312_400);
  });
});

describe("separarRetiroDelCierre", () => {
  const arrastre = 262_000_00;
  const retiro = {
    kind: "sangria" as const,
    amount_cents: arrastre,
    corte_id: "corte-1",
  };

  it("deja el turno nuevo arrancando en $0 y sin movimientos propios", () => {
    const r = separarRetiroDelCierre(arrastre, [retiro]);
    expect(r.apertura_cents).toBe(0);
    expect(r.retiro_cierre_cents).toBe(arrastre);
    expect(r.del_turno).toEqual([]);
  });

  it("no cambia el efectivo esperado: es el mismo sumando del otro lado", () => {
    const movimientos = [
      retiro,
      { kind: "sangria" as const, amount_cents: 5_000_00, corte_id: null },
      { kind: "ingreso" as const, amount_cents: 2_000_00, corte_id: null },
    ];
    const payments = [
      { method: "cash" as const, amount_cents: 30_000_00, tip_cents: 1_000_00 },
    ];

    const antes = calculateExpectedCash({
      last_closing_cash_cents: arrastre,
      payments,
      movimientos,
    });
    const r = separarRetiroDelCierre(arrastre, movimientos);
    const despues = calculateExpectedCash({
      last_closing_cash_cents: r.apertura_cents,
      payments,
      movimientos: r.del_turno,
    });

    expect(despues).toBe(antes);
  });

  it("un retiro anulado (spec 070) no mueve la caja: el arrastre vuelve", () => {
    const r = separarRetiroDelCierre(arrastre, [
      { ...retiro, cancelled_at: "2026-09-02T00:00:00Z" },
    ]);
    expect(r.apertura_cents).toBe(arrastre);
    expect(r.retiro_cierre_cents).toBe(0);
    expect(r.del_turno).toEqual([]);
  });

  it("sin cierre atado, el arrastre y los movimientos quedan como están", () => {
    const mov = { kind: "sangria" as const, amount_cents: 1_000_00 };
    const r = separarRetiroDelCierre(arrastre, [mov]);
    expect(r.apertura_cents).toBe(arrastre);
    expect(r.retiro_cierre_cents).toBe(0);
    expect(r.del_turno).toEqual([mov]);
  });
});

import { describe, expect, it } from "vitest";

import {
  calculateExpectedCash,
  separarRetiroDelCierre,
  type ExpectedCashInput,
} from "./expected-cash";

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

// ── issue #287 · el cruce del deploy de la spec 177 ──────────────────────
//
// La D5 cambió la fórmula, y `calculateExpectedCash` no congela nada: el
// resumen de un cierre se reconstruye de su ventana (spec 149 · D1). Así que
// una propina en efectivo cobrada **antes** del deploy deja de descontarse del
// esperado, pero tampoco existe el movimiento que la baje —cuando esa rendición
// se registró, el flujo no lo creaba—. Un corte que alguien contó y firmó se
// relee con un esperado más alto, y el primer cierre posterior muestra
// sobrante.
//
// La migración `0107` lo regulariza: por cada propina en efectivo que una
// rendición ya registrada cubrió, escribe el movimiento que esa rendición
// habría creado. Lo de acá abajo fija la propiedad que esa migración restituye,
// y de paso el porqué del monto que elige.

/** La fórmula anterior a la 177: el cajón esperaba el efectivo NETO de propina. */
function esperadoConFormulaVieja(input: ExpectedCashInput): number {
  const cash = input.payments
    .filter((p) => p.method === "cash")
    .reduce((acc, p) => acc + p.amount_cents - (p.tip_cents ?? 0), 0);
  const vivos = input.movimientos.filter((m) => !m.cancelled_at);
  const ingresos = vivos
    .filter((m) => m.kind === "ingreso")
    .reduce((acc, m) => acc + m.amount_cents, 0);
  const sangrias = vivos
    .filter((m) => m.kind === "sangria")
    .reduce((acc, m) => acc + m.amount_cents, 0);
  return input.last_closing_cash_cents + cash + ingresos - sangrias;
}

describe("issue #287 · regularizar la propina de antes del deploy", () => {
  // Una noche cualquiera pre-177: arrastre, dos cobros en efectivo con propina,
  // uno con tarjeta que también dejó propina, y la sangría del dueño.
  const apertura = 50_000_00;
  const payments: ExpectedCashInput["payments"] = [
    { method: "cash", amount_cents: 120_000_00, tip_cents: 8_000_00 },
    { method: "cash", amount_cents: 45_000_00, tip_cents: 2_500_00 },
    { method: "card_manual", amount_cents: 60_000_00, tip_cents: 5_050_00 },
  ];
  const sangria = { kind: "sangria" as const, amount_cents: 30_000_00 };
  const propinaEnEfectivo = 8_000_00 + 2_500_00;

  /** Lo que el encargado firmó esa noche, con la fórmula de entonces. */
  const firmado = esperadoConFormulaVieja({
    last_closing_cash_cents: apertura,
    payments,
    movimientos: [sangria],
  });

  it("sin regularizar, el corte firmado se relee con sobrante por la propina en efectivo", () => {
    const releidoHoy = calculateExpectedCash({
      last_closing_cash_cents: apertura,
      payments,
      movimientos: [sangria],
    });

    // Esto es exactamente el bug del issue: el cierre pide contar más plata de
    // la que pidió esa noche, y la diferencia es la propina en efectivo.
    expect(releidoHoy - firmado).toBe(propinaEnEfectivo);
  });

  it("con el movimiento backfilleado, el corte vuelve a dar lo que se firmó", () => {
    const releidoRegularizado = calculateExpectedCash({
      last_closing_cash_cents: apertura,
      payments,
      movimientos: [
        sangria,
        // Lo que escribe la 0107: un `propina` por cada cobro en efectivo con
        // propina, fechado en el cobro para que caiga en esta misma ventana.
        { kind: "propina", amount_cents: 8_000_00 },
        { kind: "propina", amount_cents: 2_500_00 },
      ],
    });

    expect(releidoRegularizado).toBe(firmado);
  });

  // El porqué de la decisión 1 de la migración. La propina de tarjeta nunca
  // estuvo descontada del esperado viejo *ni salió del cajón* en esa época:
  // pagarle al mozo la propina de tarjeta es justo lo que la 177 construyó.
  // Backfillearla inventaría una salida que no ocurrió.
  it("backfillear también la propina de tarjeta dejaría el corte POR DEBAJO de lo firmado", () => {
    const conPropinaDeTarjeta = calculateExpectedCash({
      last_closing_cash_cents: apertura,
      payments,
      movimientos: [
        sangria,
        { kind: "propina", amount_cents: 8_000_00 },
        { kind: "propina", amount_cents: 2_500_00 },
        { kind: "propina", amount_cents: 5_050_00 },
      ],
    });

    expect(conPropinaDeTarjeta).toBe(firmado - 5_050_00);
    expect(conPropinaDeTarjeta).toBeLessThan(firmado);
  });

  // El porqué de las decisiones 4 y 5, que son el mismo riesgo por los dos
  // lados: una propina que la rendición todavía no pagó (el flujo nuevo la va a
  // pagar cuando ocurra) y una que la rendición YA pagó (el movimiento existe,
  // fechado en la rendición). En los dos casos el backfill sería un segundo
  // movimiento por la misma plata, y el cajón la pierde dos veces.
  it("un segundo movimiento por la misma propina la descuenta dos veces", () => {
    const backfill = { kind: "propina" as const, amount_cents: 8_000_00 };
    const laRendicionFutura = {
      kind: "propina" as const,
      amount_cents: 8_000_00,
    };

    const unaVez = calculateExpectedCash({
      last_closing_cash_cents: apertura,
      payments,
      movimientos: [sangria, laRendicionFutura],
    });
    const dosVeces = calculateExpectedCash({
      last_closing_cash_cents: apertura,
      payments,
      movimientos: [sangria, backfill, laRendicionFutura],
    });

    expect(unaVez - dosVeces).toBe(8_000_00);
  });
});

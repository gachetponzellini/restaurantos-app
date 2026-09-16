import { describe, expect, it } from "vitest";

import { buildCuentaTicketLines, type CuentaTicketData } from "./cuenta-ticket";

// Spec 080 — la cuenta que se le da al cliente. Lo que se prueba es qué dice el
// papel: si el cliente no puede chequear que le cobraron bien, el ticket no
// sirve para nada.

function base(over: Partial<CuentaTicketData> = {}): CuentaTicketData {
  return {
    print_job_id: "pj1",
    business_name: "Restaurant del Golf",
    business_address: "Bv. Wilde y Eva Perón",
    business_phone: "0341-153276804",
    table_label: "12",
    floor_plan_name: "Terraza",
    daily_number: 456,
    emitted_at: "2026-07-28T21:40:00-03:00",
    subtotal_cents: 11050000,
    discount_cents: 0,
    discount_reason: null,
    tip_cents: 0,
    total_cents: 11050000,
    total_paid_cents: 0,
    items: [
      {
        product_name: "Brochette de lomo",
        quantity: 2,
        line_total_cents: 6600000,
      },
      { product_name: "Agua sin gas", quantity: 1, line_total_cents: 300000 },
    ],
    ...over,
  };
}

function text(data: CuentaTicketData): string {
  return buildCuentaTicketLines(data)
    .map((l) => l.text)
    .join("\n");
}

describe("buildCuentaTicketLines", () => {
  it("muestra la mesa, el salón y el detalle de lo consumido", () => {
    const t = text(base());
    expect(t).toContain("MESA 12");
    expect(t).toContain("Terraza");
    expect(t).toContain("2x Brochette de lomo");
    expect(t).toContain("66000.00");
    expect(t).toContain("1x Agua sin gas");
  });

  it("el TOTAL va destacado", () => {
    const total = buildCuentaTicketLines(base()).find((l) =>
      l.text.startsWith("TOTAL:"),
    );
    expect(total?.size).toBe("tall");
    expect(total?.bold).toBe(true);
    expect(total?.text).toContain("110500.00");
  });

  it("el descuento sale con su motivo (para poder explicarlo en la mesa)", () => {
    const t = text(
      base({
        discount_cents: 100000,
        discount_reason: "Cumpleaños del cliente",
        total_cents: 10950000,
      }),
    );
    expect(t).toContain("Descuento:");
    expect(t).toContain("-1000.00");
    expect(t).toContain("Cumpleanos del cliente");
  });

  it("con pago parcial muestra lo pagado y lo que RESTA", () => {
    const lines = buildCuentaTicketLines(base({ total_paid_cents: 5000000 }));
    const t = lines.map((l) => l.text).join("\n");
    expect(t).toContain("Pagado:");
    expect(t).toContain("50000.00");
    const resta = lines.find((l) => l.text.startsWith("RESTA:"));
    expect(resta?.size).toBe("tall");
    expect(resta?.text).toContain("60500.00");
  });

  it("sin pagos parciales no ensucia el ticket con «RESTA»", () => {
    expect(text(base())).not.toContain("RESTA:");
  });

  it("aclara que la propina no está incluida, o la muestra si ya se cargó", () => {
    expect(text(base())).toContain("La propina no esta incluida");
    const conPropina = text(
      base({ tip_cents: 1000000, total_cents: 12050000 }),
    );
    expect(conPropina).toContain("Propina:");
    expect(conPropina).toContain("10000.00");
    expect(conPropina).not.toContain("no esta incluida");
  });

  it("marca la reimpresión (que no queden dos tickets sin saber cuál vale)", () => {
    expect(text(base({ reprint: true }))).toContain("*** REIMPRESION ***");
    expect(text(base())).not.toContain("REIMPRESION");
  });

  it("aclara que no es factura — el comprobante fiscal es otro papel", () => {
    const t = text(base());
    expect(t).toContain("DOCUMENTO NO VALIDO");
    expect(t).toContain("COMO FACTURA");
  });

  it("sale 100% en ASCII imprimible", () => {
    const t = text(
      base({
        business_name: "Ñandú Café — «Sabor»",
        discount_cents: 5000,
        discount_reason: "cortesía 🙂 — «casa»",
        items: [
          {
            product_name: "Ñoquis con crema · 3° porción",
            quantity: 1,
            line_total_cents: 100000,
          },
        ],
      }),
    );
    // eslint-disable-next-line no-control-regex
    expect(t.replace(/\n/g, "")).toMatch(/^[\x20-\x7e]*$/);
    expect(t).toContain("Noquis con crema");
  });

  it("no imprime la aclaración que el mozo le dejó a la cocina", () => {
    // `order_items.notes` es «sin sal», «para la señora del fondo»: se escribe
    // para quien cocina, y este papel se lo lleva el cliente. El tipo ya no
    // acepta el campo; esto cubre el otro lado — que nada del ticket se parezca
    // a una observación. Pedido de la encargada de golf (2026-09-03).
    const t = text(base());
    expect(t).not.toContain("obs:");
  });

  it("aguanta una mesa sin consumo", () => {
    expect(text(base({ items: [] }))).toContain("(sin consumo)");
  });

  // Spec 200 — la foto de kcc: 7 ítems, cada uno en dos renglones, en 2/3 del rollo.
  it("importe al lado del ítem, a 36 col, compacto y sin subtotal repetido", () => {
    const lines = buildCuentaTicketLines(base());
    const agua = lines.find((l) => l.text.startsWith("1x Agua sin gas"));
    expect(agua?.text).toHaveLength(36);
    expect(agua?.text.endsWith("3000.00")).toBe(true);
    expect(agua?.spacing).toBe(32);
    expect(text(base())).not.toContain("Subtotal:");
    expect(text(base({ tip_cents: 100000 }))).toContain("Subtotal:");
  });
});

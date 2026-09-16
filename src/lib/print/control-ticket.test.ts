import { describe, expect, it } from "vitest";

import {
  buildControlTicketLines,
  type ControlTicketData,
} from "./control-ticket";

// Spec 063 — el control de pedido. Lo que se prueba acá es el contenido, no el
// estilo: qué dice el papel que se lleva el repartidor y, sobre todo, cuánta
// plata dice que tiene que cobrar.

function base(over: Partial<ControlTicketData> = {}): ControlTicketData {
  return {
    control_ticket_id: "ct1",
    business_name: "Restaurant del Golf",
    business_address: "Bv. Wilde y Eva Perón",
    business_phone: "0341-153276804",
    daily_number: 123,
    delivery_type: "delivery",
    emitted_at: "2026-07-28T19:16:00-03:00",
    scheduled_at: null,
    customer_name: "Juan Pérez",
    customer_phone: "341 555 1234",
    delivery_address: "Calle 123",
    delivery_notes: null,
    subtotal_cents: 11050000,
    delivery_fee_cents: 150000,
    discount_cents: 0,
    total_cents: 11200000,
    payment_method: "cash",
    payment_status: "pending",
    items: [
      {
        product_name: "Brochette de lomo",
        quantity: 2,
        line_total_cents: 6600000,
      },
    ],
    ...over,
  };
}

/** El ticket como texto plano, para asertar sobre el contenido. */
function text(data: ControlTicketData): string {
  return buildControlTicketLines(data)
    .map((l) => l.text)
    .join("\n");
}

describe("buildControlTicketLines", () => {
  it("dice cuánto cobrar cuando el pedido está impago", () => {
    const t = text(base());
    expect(t).toContain("A COBRAR:");
    expect(t).toContain("112000.00");
    expect(t).toContain("Metodo: Efectivo");
    expect(t).not.toContain("NO COBRAR");
  });

  it("dice PAGADO / NO COBRAR cuando ya está pagado", () => {
    const t = text(base({ payment_status: "paid", payment_method: "mp" }));
    expect(t).toContain("PAGADO");
    expect(t).toContain("NO COBRAR");
    expect(t).not.toContain("A COBRAR:");
  });

  it("el aviso de cobro va en el tamaño más grande del ticket", () => {
    // Si «A COBRAR» sale en cuerpo chico, el repartidor lo puede pasar por alto
    // y ahí se pierde plata. Es la razón de ser del papel.
    const lines = buildControlTicketLines(base());
    const cobro = lines.find((l) => l.text.startsWith("A COBRAR:"));
    expect(cobro?.size).toBe("xl");
    expect(cobro?.bold).toBe(true);
    // El monto va abajo, en el mismo tamaño (a doble ancho no entran juntos).
    expect(lines[lines.indexOf(cobro!) + 1]).toMatchObject({
      text: "112000.00",
      size: "xl",
    });
  });

  it("todo lo operativo sale en cuerpo grande; sólo la lista de ítems baja", () => {
    // Antes el ticket entero era doble alto y una mesa grande salía al doble de
    // largo por nada. La lista bajó a cuerpo normal (2026-09-03); el resto —lo
    // que el repartidor lee de parado— conserva su tamaño.
    const data = base();
    const deItems = (data.items ?? []).map(
      (it) => `${it.quantity}x ${it.product_name}`,
    );
    for (const l of buildControlTicketLines(data)) {
      if ((l.size ?? "sm") !== "sm") continue;
      const t = l.text.trim();
      expect(
        /^-*$/.test(t) ||
          deItems.some((d) => t.startsWith(d)) ||
          t.startsWith("+ "),
      ).toBe(true);
    }
  });

  it("la lista de ítems achica el PAPEL, no sólo la letra", () => {
    // El avance del papel lo fija `ESC 3`, no el `size` de la línea: el
    // documento se abre con 64 pt por renglón (elegido para que el doble alto
    // no se pise) y ése es el avance de una línea `sm` igual que de una `tall`.
    // O sea: bajar el tamaño sin bajar el interlineado ahorra CERO. Este test
    // existe para que no volvamos a creer que sí.
    const items = Array.from({ length: 12 }, (_, i) => ({
      product_name: `Producto ${i + 1}`,
      quantity: 1,
      line_total_cents: 850000,
    }));
    const lines = buildControlTicketLines(base({ items }));
    const avance = (l: (typeof lines)[number]) => l.spacing ?? 64;
    const papel = lines.reduce((n, l) => n + avance(l), 0);
    const papelSiTodoFueraNormal = lines.length * 64;

    // Los renglones de la lista avanzan la mitad; el resto del ticket no cambia.
    expect(lines.filter((l) => l.spacing === 32)).toHaveLength(items.length);
    expect(papel).toBeLessThan(papelSiTodoFueraNormal);
    // Spec 200: un renglón por ítem (importe al lado), a 32 en vez de 64.
    expect(papelSiTodoFueraNormal - papel).toBe(items.length * 32);
  });

  it("el destino, la hora y el cobro siguen en cuerpo grande", () => {
    const lines = buildControlTicketLines(
      base({ scheduled_at: "2026-07-20T21:30:00-03:00" }),
    );
    const grande = (frag: string) =>
      lines.find((l) => l.text.includes(frag) && (l.size ?? "sm") !== "sm");
    expect(grande("DELIVERY")).toBeTruthy();
    expect(grande("ENTREGAR")).toBeTruthy();
    expect(grande("A COBRAR")).toBeTruthy();
    expect(grande("TOTAL:")).toBeTruthy();
  });

  it("no imprime la aclaración que el mozo le dejó a la cocina", () => {
    // Ídem la cuenta: `order_items.notes` es para quien cocina, y este papel lo
    // ve el cliente que retira. La nota del CLIENTE (`delivery_notes`, «tocar
    // timbre») sí va: la escribió él y la necesita el repartidor.
    const t = text(base({ delivery_notes: "tocar timbre" }));
    expect(t).not.toContain("obs:");
    expect(t).toContain("Obs: tocar timbre");
  });

  it("desglosa subtotal, envío y descuento; omite los que son cero", () => {
    const t = text(base({ discount_cents: 100000 }));
    expect(t).toContain("Subtotal:");
    expect(t).toContain("110500.00");
    expect(t).toContain("Envio:");
    expect(t).toContain("-1000.00");

    const sinEnvio = text(base({ delivery_fee_cents: 0 }));
    expect(sinEnvio).not.toContain("Envio:");
    expect(sinEnvio).not.toContain("Descuento:");
  });

  it("un delivery lleva dirección y línea de repartidor; un retiro no", () => {
    const del = text(base());
    expect(del).toContain("DELIVERY #123"); // 80 mm: 17 col a doble ancho
    expect(del).toContain("Repartidor:");
    expect(del).toContain("Direccion: Calle 123");

    const ret = text(base({ delivery_type: "pickup" }));
    expect(ret).toContain("RETIRO #123");
    expect(ret).not.toContain("Repartidor:");
    expect(ret).not.toContain("Direccion:");
  });

  // Spec 127 — la hora DEL PEDIDO vuelve al papel del repartidor. Lo que la
  // había sacado era que la misma hora estuviera en los dos papeles; ahora cada
  // uno lleva la suya: la comanda dice para cuándo estar LISTO (`kitchen_at`) y
  // esto dice para cuándo se ENTREGA.
  it("lleva la hora del pedido cuando la tiene", () => {
    const prog = text(base({ scheduled_at: "2026-07-28T20:30:00-03:00" }));
    expect(prog).toContain("ENTREGAR: 28/07 20:30");
    // El sello de emisión sí se queda: es cuándo se imprimió el papel.
    expect(prog).toContain("Emitido:");
  });

  it("un pedido para ahora no inventa una hora", () => {
    expect(text(base())).not.toContain("ENTREGAR:");
  });

  it("sale 100% en ASCII imprimible (la térmica no recibe codepage)", () => {
    const t = text(
      base({
        business_name: "Ñandú Café — «Sabor»",
        customer_name: "Juan Pérez",
        delivery_address: "Güemes 1234 · 3° B",
        delivery_notes: "tocar timbre 🙂",
      }),
    );
    // eslint-disable-next-line no-control-regex
    expect(t.replace(/\n/g, "")).toMatch(/^[\x20-\x7e]*$/);
    expect(t).toContain("NANDU CAFE");
    expect(t).toContain("Juan Perez");
  });

  it("no imprime ítems anulados aguas arriba y aguanta un pedido sin ítems", () => {
    expect(text(base({ items: [] }))).toContain("(sin items)");
  });

  it("marca la reimpresión", () => {
    expect(text(base({ reprint: true }))).toContain("REIMPRESION");
  });

  it("cierra con el pie de no-factura (no es un comprobante fiscal)", () => {
    const t = text(base());
    expect(t).toContain("DOCUMENTO NO VALIDO");
    expect(t).toContain("COMO FACTURA");
  });

  // Spec 200 — el retiro de mostrador de kcc salía de 23 renglones para 2 ítems.
  describe("spec 200 · el control sale corto", () => {
    const retiro = (over: Partial<ControlTicketData> = {}) =>
      base({
        delivery_type: "pickup",
        business_address: null,
        business_phone: null,
        customer_name: "Mostrador",
        customer_phone: "-",
        delivery_fee_cents: 0,
        subtotal_cents: 8900000,
        total_cents: 8900000,
        payment_status: "paid",
        items: [
          { product_name: "Suprema", quantity: 4, line_total_cents: 6000000 },
          {
            product_name: "Ojo de Bife",
            quantity: 1,
            line_total_cents: 2900000,
          },
        ],
        ...over,
      });

    it("el importe va en el renglón del ítem, a 36 columnas", () => {
      const lines = buildControlTicketLines(retiro()).map((l) => l.text);
      const suprema = lines.find((l) => l.startsWith("4x Suprema"));
      expect(suprema).toBe("4x Suprema" + " ".repeat(18) + "60000.00");
      expect(suprema).toHaveLength(36);
      expect(lines).not.toContain(" ".repeat(28) + "60000.00");
    });

    it("un nombre largo sigue abajo sin pisar el importe", () => {
      const lines = buildControlTicketLines(
        retiro({
          items: [
            {
              product_name: "Milanesa de entrecot a la napolitana con fritas",
              quantity: 1,
              line_total_cents: 2900000,
            },
          ],
        }),
      ).map((l) => l.text);
      const i = lines.findIndex((l) => l.startsWith("1x Milanesa"));
      expect(lines[i].endsWith("29000.00")).toBe(true);
      expect(lines[i]).toHaveLength(36);
      expect(lines[i + 1]).toMatch(/fritas$/);
    });

    it("no imprime Mostrador, ni el tel «-», ni el subtotal repetido", () => {
      const t = text(retiro());
      expect(t).not.toContain("Cliente:");
      expect(t).not.toContain("Tel:");
      expect(t).not.toContain("Subtotal:");
      expect(t).toContain("TOTAL:");
    });

    it("pagado va en un solo renglón", () => {
      const t = text(retiro());
      expect(t).toContain("PAGADO NO COBRAR");
    });

    it("en un retiro la cabecera y el pie bajan a cuerpo normal", () => {
      const lines = buildControlTicketLines(retiro());
      const tam = (txt: string) =>
        lines.find((l) => l.text === txt)?.size ?? "sm";
      expect(tam("RESTAURANT DEL GOLF")).toBe("sm");
      expect(tam("DOCUMENTO NO VALIDO COMO FACTURA")).toBe("sm");
      expect(tam("RETIRO #123")).toBe("xl");
      // En delivery siguen grandes: el repartidor lo lee de parado.
      const del = buildControlTicketLines(base());
      expect(del.find((l) => l.text === "RESTAURANT DEL GOLF")?.size).toBe(
        "tall",
      );
    });

    it("el mismo retiro pasa de 23 renglones a 15", () => {
      expect(buildControlTicketLines(retiro()).length).toBe(15);
    });
  });
});

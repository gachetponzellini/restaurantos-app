import { describe, expect, it } from "vitest";

import {
  buildComandaContent,
  buildTicketLines,
  COLS,
  renderEscPos,
  TOP_MARGIN,
  type TicketComanda,
} from "./ticket";
import fixtures from "./__fixtures__/tickets.json";

// Fixtures congelados del output ACTUAL del agente (print-agent/agent.mjs) por
// tipo de ticket. El test asevera que el módulo del server produce EXACTAMENTE
// los mismos bytes → red de seguridad contra una regresión de formato sobre la
// impresión de golf al mover el render al server (spec 051, D3 · FR-006/SC-003).
//
// La comanda base coincide 1:1 con la del harness que genera
// `__fixtures__/tickets.json` (`scripts/freeze-ticket-fixtures.ts`). Si cambia
// el formato a propósito: actualizar el módulo del server Y el fallback de
// `print-agent/agent.mjs` en el mismo commit, regenerar los fixtures con el
// harness y verificar en golf — nunca editar el JSON a mano.
//
// 2026-07-28: los ítems pasaron a doble ancho + doble alto, con corte por
// palabra y un renglón en blanco entre ítems (comandas más largas y legibles).
// Fixtures regenerados en ese commit; el agente se actualizó en paralelo.

const base: TicketComanda = {
  comanda_id: "ab12cd34-0000-0000-0000-000000000000",
  daily_number: 123,
  station_name: "Cocina",
  table_label: "5",
  batch: 2,
  emitted_at: "2026-07-20T18:30:00-03:00",
  cancelled: false,
  cancelled_reason: null,
  reprint: false,
  items: [
    { quantity: 1, product_name: "Milanesa napolitana", modifiers: [], notes: null },
    { quantity: 2, product_name: "Ñoquis", modifiers: ["con crema"], notes: "bien calientes" },
    { quantity: 1, product_name: "Café con leche", modifiers: [], notes: null },
  ],
};

/** El separador; el encabezado va arriba, los ítems abajo. */
const RULE_TEXT = "------------------------";

const cases: Record<keyof typeof fixtures, TicketComanda> = {
  normal: base,
  anulada: { ...base, cancelled: true, cancelled_reason: "cliente se fue" },
  reimpresion: { ...base, reprint: true },
  sinItems: { ...base, items: [] },
  // Payload de un server anterior al número de pedido: el ticket cae al id de
  // la comanda, como imprimía antes.
  sinNumeroDePedido: { ...base, daily_number: null },
};

describe("buildComandaContent · paridad byte-a-byte con el agente", () => {
  for (const name of Object.keys(cases) as (keyof typeof fixtures)[]) {
    it(`ticket ${name}: escpos_b64 idéntico al fixture congelado`, () => {
      const { escpos_b64 } = buildComandaContent(cases[name]);
      expect(escpos_b64).toBe(fixtures[name].escpos_b64);
    });

    it(`ticket ${name}: plain idéntico al fixture congelado`, () => {
      const { plain } = buildComandaContent(cases[name]);
      expect(plain).toBe(fixtures[name].plain);
    });
  }
});

describe("buildTicketLines · ítems grandes y espaciados", () => {
  it("cada ítem va en doble ancho + doble alto (size xl)", () => {
    const lines = buildTicketLines(base);
    const item = lines.find((l) => l.text.startsWith("1x Milanesa"));
    expect(item).toMatchObject({ size: "xl", bold: true });
  });

  it("corta el nombre por palabra a 11 col en vez de desbordar", () => {
    const rule = buildTicketLines(base).findIndex((l) => l.text === RULE_TEXT);
    const lines = buildTicketLines(base)
      .slice(rule)
      .filter((l) => l.size === "xl");
    expect(lines.map((l) => l.text)).toEqual([
      "1x Milanesa",
      "napolitana",
      "2x Noquis",
      "1x Cafe con",
      "leche",
    ]);
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(11);
  });

  it("mete un renglón en blanco entre ítem e ítem (padding)", () => {
    const texts = buildTicketLines(base).map((l) => l.text);
    expect(texts[texts.indexOf("2x Noquis") - 1]).toBe("");
    expect(texts[texts.indexOf("2x Noquis") - 2]).not.toBe("");
  });

  it("deja 3 renglones entre la línea separadora y el primer ítem, y 3 al final", () => {
    const texts = buildTicketLines(base).map((l) => l.text);
    const rule = texts.lastIndexOf(RULE_TEXT);
    expect(texts.slice(rule + 1, rule + 4)).toEqual(["", "", ""]);
    expect(texts[rule + 4]).toBe("1x Milanesa");
    expect(texts.slice(-3)).toEqual(["", "", ""]);
    expect(texts.at(-4)).toBe("leche");
  });

  it("una palabra más larga que el ancho se corta duro, no se pierde", () => {
    const lines = buildTicketLines({
      ...base,
      items: [{ quantity: 1, product_name: "Supercalifragilistico", modifiers: [], notes: null }],
    }).filter((l) => l.size === "xl");
    expect(lines.map((l) => l.text).join("")).toContain("Supercalifragilistico");
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(11);
  });
});

describe("buildTicketLines · margen arriba para el porta-comandas (#289)", () => {
  // El riel de la cocina tapa los primeros ~3 cm del papel: lo primero que se
  // lee tiene que empezar más abajo, en TODAS las comandas.
  it("arranca con TOP_MARGIN renglones en blanco", () => {
    expect(TOP_MARGIN).toBeGreaterThanOrEqual(3);
    for (const c of Object.values(cases)) {
      const texts = buildTicketLines(c).map((l) => l.text);
      expect(texts.slice(0, TOP_MARGIN)).toEqual(Array(TOP_MARGIN).fill(""));
      expect(texts[TOP_MARGIN]).not.toBe("");
    }
  });

  it("el margen va ANTES del ENTREGAR: es justo lo que el riel tapaba", () => {
    const texts = buildTicketLines({ ...base, kitchen_time: "20:15" }).map((l) => l.text);
    expect(texts.slice(0, TOP_MARGIN)).toEqual(Array(TOP_MARGIN).fill(""));
    expect(texts.slice(TOP_MARGIN, TOP_MARGIN + 2)).toEqual(["ENTREGAR", "20:15"]);
  });

  it("los blancos del margen son renglones de verdad en el ESC/POS (avanzan papel)", () => {
    // Sin los comandos de estilo (init, interlineado, espaciado, alineación,
    // tamaño, énfasis), lo primero que sale son TOP_MARGIN LF — y recién
    // después el primer texto.
    const escpos = renderEscPos(buildTicketLines(base)).replace(
      /\x1b(?:@|[3 aEM].)|\x1d(?:!|V)./g,
      "",
    );
    expect(escpos.startsWith("\n".repeat(TOP_MARGIN))).toBe(true);
    expect(escpos[TOP_MARGIN]).not.toBe("\n");
  });
});

describe("buildTicketLines · todo en cuerpo grande", () => {
  it("el encabezado y los avisos van en el tamaño más grande (xl)", () => {
    const head = buildTicketLines(base).filter((l) => l.align === "center");
    expect(head.find((l) => l.text === "COCINA")).toMatchObject({ size: "xl", bold: true });
    expect(head.find((l) => l.text === "MESA 5")).toMatchObject({ size: "xl", bold: true });

    const anulada = buildTicketLines(cases.anulada).map((l) => `${l.size}:${l.text}`);
    expect(anulada).toContain("xl:ANULADA");
    expect(anulada).toContain("xl:NO PREPARAR");
    expect(buildTicketLines(cases.reimpresion).map((l) => `${l.size}:${l.text}`)).toContain(
      "xl:REIMPRESION",
    );
  });

  it("nada sale en cuerpo normal salvo las líneas separadoras y los blancos", () => {
    for (const c of Object.values(cases))
      for (const l of buildTicketLines(c))
        if ((l.size ?? "sm") === "sm") expect([RULE_TEXT, ""]).toContain(l.text);
  });

  it("un sector de nombre largo se corta por palabra, no lo parte la impresora", () => {
    const lines = buildTicketLines({ ...base, station_name: "Postres y cafe" });
    const head = lines.filter((l) => l.size === "xl" && l.align === "center");
    expect(head.slice(0, 2).map((l) => l.text)).toEqual(["POSTRES Y", "CAFE"]);
  });
});

describe("buildTicketLines · número de pedido (con qué arma la cocina)", () => {
  // El ticket identificaba la comanda con los primeros 8 caracteres de su UUID
  // («Comanda #ab12cd34»): un código alfanumérico que en cocina no sirve para
  // nada y, peor, es DISTINTO en cada sector del mismo pedido — así que no
  // había forma de juntar la parrilla con la fritera. `orders.daily_number` es
  // el correlativo por negocio que ya ven el mozo y el encargado en pantalla.
  it("imprime «PEDIDO n» en el cuerpo grande, no el hash de la comanda", () => {
    const lines = buildTicketLines({ ...base, daily_number: 123 });
    expect(lines.find((l) => l.text === "PEDIDO 123")).toMatchObject({
      size: "xl",
      bold: true,
      align: "center",
    });
    expect(lines.some((l) => l.text.startsWith("Comanda #"))).toBe(false);
  });

  it("el mismo pedido lleva el mismo número en todos sus sectores", () => {
    const parrilla = buildTicketLines({
      ...base,
      daily_number: 123,
      comanda_id: "ffffffff-1111-0000-0000-000000000000",
      station_name: "Parrilla",
    });
    const cocina = buildTicketLines({ ...base, daily_number: 123 });
    const numero = (ls: ReturnType<typeof buildTicketLines>) =>
      ls.find((l) => l.text.startsWith("PEDIDO"))?.text;
    expect(numero(parrilla)).toBe("PEDIDO 123");
    expect(numero(cocina)).toBe(numero(parrilla));
  });

  it("hasta 4 dígitos entra en un renglón de doble ancho (sin `#`, que sobraba)", () => {
    const linea = buildTicketLines({ ...base, daily_number: 9999 }).find((l) =>
      l.text.startsWith("PEDIDO"),
    );
    expect(linea?.text).toBe("PEDIDO 9999");
    expect(linea!.text.length).toBeLessThanOrEqual(COLS.xl);
  });

  it("el número va junto al destino, arriba de la tanda", () => {
    const texts = buildTicketLines({ ...base, daily_number: 123 }).map((l) => l.text);
    expect(texts.indexOf("PEDIDO 123")).toBeGreaterThan(texts.indexOf("MESA 5"));
    expect(texts.indexOf("PEDIDO 123")).toBeLessThan(texts.indexOf("Tanda 2"));
  });

  it("un delivery también lo lleva: sin mesa, es lo único que identifica al pedido", () => {
    const texts = buildTicketLines({
      ...base,
      table_label: "—",
      delivery_type: "delivery",
      daily_number: 77,
    }).map((l) => l.text);
    expect(texts).toContain("DELIVERY");
    expect(texts).toContain("PEDIDO 77");
  });

  it("sin `daily_number` (payload de un server viejo) cae al id de la comanda", () => {
    const texts = buildTicketLines({ ...base, daily_number: null }).map((l) => l.text);
    expect(texts.some((t) => t.startsWith("PEDIDO"))).toBe(false);
    expect(texts).toContain("Comanda #ab12cd34");
  });
});

describe("buildTicketLines · la hora de emisión", () => {
  it("va en reloj de 24h: las 18:30 no pueden salir como «06:30»", () => {
    const texts = buildTicketLines(base).map((l) => l.text);
    expect(texts.some((t) => t.includes("18:30"))).toBe(true);
    expect(texts.some((t) => t.includes("06:30"))).toBe(false);
  });

  it("en hora de Buenos Aires, aunque el server corra en UTC", () => {
    const texts = buildTicketLines({
      ...base,
      emitted_at: "2026-07-20T23:00:00Z", // 20:00 en AR
    }).map((l) => l.text);
    expect(texts.some((t) => t.includes("20:00"))).toBe(true);
  });
});

describe("buildTicketLines · destino del pedido", () => {
  it("delivery → DELIVERY + el repartidor, en vez de «MESA —»", () => {
    const texts = buildTicketLines({
      ...base,
      table_label: "—",
      delivery_type: "delivery",
    }).map((l) => l.text);
    expect(texts).toContain("DELIVERY");
    expect(texts.some((t) => t.includes("repartidor"))).toBe(true);
    expect(texts.some((t) => t.startsWith("MESA"))).toBe(false);
  });

  it("pickup → RETIRA", () => {
    const texts = buildTicketLines({
      ...base,
      table_label: "—",
      delivery_type: "pickup",
    }).map((l) => l.text);
    expect(texts).toContain("RETIRA");
    expect(texts.some((t) => t.startsWith("MESA"))).toBe(false);
  });

  it("los subtítulos entran en un renglón: nada se parte al ancho útil", () => {
    // «pasa a buscarlo el cliente» eran 26 col en un renglón de 24 y salía
    // partido, con un «te» suelto y centrado en doble alto.
    for (const tipo of ["delivery", "pickup"] as const) {
      const lines = buildTicketLines({ ...base, delivery_type: tipo });
      for (const l of lines.filter((x) => x.size === "tall"))
        expect(l.text.length).toBeLessThanOrEqual(24);
    }
  });

  it("venta de mostrador (dine_in sin mesa) → MOSTRADOR, no «MESA —»", () => {
    const texts = buildTicketLines({ ...base, table_label: "—" }).map((l) => l.text);
    expect(texts).toContain("MOSTRADOR");
    expect(texts.some((t) => t.startsWith("MESA"))).toBe(false);
  });

  it("dine_in o ausente → «MESA x», el encabezado de siempre", () => {
    expect(buildTicketLines(base).map((l) => l.text)).toContain("MESA 5");
    expect(
      buildTicketLines({ ...base, delivery_type: "dine_in" }).map((l) => l.text),
    ).toContain("MESA 5");
  });
});

describe("buildTicketLines · con qué combina (otros sectores)", () => {
  const conOtros = {
    ...base,
    otros_sectores: [
      {
        station_name: "Parrilla",
        items: [{ quantity: 1, product_name: "Entrecot" }],
      },
      { station_name: "Fritera", items: [] }, // sin items → no se imprime
    ],
  };

  it("lista bajo «COMBINA CON» lo que el mismo pedido lleva en otros sectores", () => {
    const texts = buildTicketLines(conOtros).map((l) => l.text);
    expect(texts).toContain("COMBINA CON");
    expect(texts).toContain("PARRILLA");
    expect(texts).toContain("- 1x Entrecot");
  });

  it("es referencia, no trabajo: va en tall, no en el xl de los ítems", () => {
    const lines = buildTicketLines(conOtros);
    const vaCon = lines.findIndex((l) => l.text === "COMBINA CON");
    expect(vaCon).toBeGreaterThan(0);
    for (const l of lines.slice(vaCon))
      if (l.text) expect(l.size).toBe("tall");
  });

  it("un sector sin items no aparece", () => {
    expect(buildTicketLines(conOtros).map((l) => l.text)).not.toContain("FRITERA");
  });

  it("una comanda anulada no lo imprime: no hay nada que coordinar", () => {
    const texts = buildTicketLines({ ...conOtros, cancelled: true }).map((l) => l.text);
    expect(texts).not.toContain("COMBINA CON");
  });

  it("sin el campo, el ticket sale igual que siempre (aditivo)", () => {
    expect(buildTicketLines(base).map((l) => l.text)).not.toContain("COMBINA CON");
  });
});

describe("buildTicketLines · nota de cocina («ENTREGAR x»)", () => {
  const conNota = { ...base, kitchen_notes: "21:30" };

  it("imprime la nota de cocina con el prefijo ENTREGAR", () => {
    // En doble ancho entran 11 col, así que «ENTREGAR 21:30» ocupa dos
    // renglones — cortado por palabra, no partido al medio.
    const texts = buildTicketLines(conNota).map((l) => l.text);
    expect(texts.slice(TOP_MARGIN, TOP_MARGIN + 2)).toEqual(["ENTREGAR", "21:30"]);
  });

  it("va arriba de todo: antes del sector y de los ítems", () => {
    const lines = buildTicketLines(conNota);
    const entregar = lines.findIndex((l) => l.text.startsWith("ENTREGAR"));
    const sector = lines.findIndex((l) => l.text === "COCINA");
    expect(entregar).toBe(TOP_MARGIN); // arriba de todo, después del margen (#289)
    expect(entregar).toBeLessThan(sector);
  });

  it("sale en el cuerpo más grande — se lee de lejos", () => {
    const lines = buildTicketLines(conNota);
    expect(lines[TOP_MARGIN]).toMatchObject({ size: "xl", bold: true });
  });

  it("una nota larga se parte por palabra, sin perder el prefijo", () => {
    const texts = buildTicketLines({
      ...conNota,
      kitchen_notes: "junto con la mesa 5",
    }).map((l) => l.text);
    expect(texts[TOP_MARGIN].startsWith("ENTREGAR")).toBe(true);
    expect(texts.join(" ")).toContain("mesa 5");
  });

  it("una comanda anulada no la imprime", () => {
    const texts = buildTicketLines({ ...conNota, cancelled: true }).map((l) => l.text);
    expect(texts.some((t) => t.startsWith("ENTREGAR"))).toBe(false);
  });

  it("sin el campo, el ticket sale igual que siempre (aditivo)", () => {
    const texts = buildTicketLines(base).map((l) => l.text);
    expect(texts.some((t) => t.startsWith("ENTREGAR"))).toBe(false);
  });

  it("la nota del CLIENTE no se cuela en la comanda: ésa va al control", () => {
    const texts = buildTicketLines({
      ...base,
      // @ts-expect-error — campo que ya no existe en TicketComanda; el test fija
      // que aunque el caller lo mande por error, no se imprime.
      order_notes: "tocar timbre",
    }).map((l) => l.text);
    expect(texts.join(" ")).not.toContain("tocar timbre");
  });
});

describe("buildTicketLines · la observación de la tanda (spec 128)", () => {
  // Lo que el mozo escribe UNA vez al enviar y sale igual en las comandas de
  // todos los sectores de esa tanda: «va todo junto», «la mesa tiene apuro».
  // Es de la tanda, así que viaja con la comanda y no con el pedido.
  const conObs = { ...base, comanda_notes: "va todo junto, la mesa tiene apuro" };

  it("la imprime con el prefijo OBS", () => {
    const texts = buildTicketLines(conObs).map((l) => l.text);
    expect(texts.join(" ")).toContain("OBS: va todo junto");
  });

  it("va entre el encabezado y los ítems", () => {
    // Después del sector (a esa altura la cocina ya sabe que el ticket es suyo)
    // y antes del primer plato: es la instrucción con la que se lee la lista.
    const texts = buildTicketLines(conObs).map((l) => l.text);
    const obs = texts.findIndex((t) => t.startsWith("OBS:"));
    const sector = texts.indexOf("COCINA");
    const primerPlato = texts.findIndex((t) => t.includes("Milanesa"));
    expect(sector).toBeLessThan(obs);
    expect(obs).toBeLessThan(primerPlato);
  });

  it("es contenido, no urgencia: doble alto, no el cuerpo de ENTREGAR", () => {
    // El `xl` está reservado para lo que cambia el MOMENTO de salida
    // (ENTREGAR / ANULADA / REIMPRESION). La observación se lee con el ticket
    // en la mano, no de lejos.
    const linea = buildTicketLines(conObs).find((l) => l.text.startsWith("OBS:"));
    expect(linea).toMatchObject({ size: "tall", bold: true });
  });

  it("una observación larga se parte por palabra, sin perder el prefijo", () => {
    const texts = buildTicketLines({
      ...conObs,
      comanda_notes:
        "la mesa esta apurada, sacar todo junto y avisar al mozo antes de emplatar",
    }).map((l) => l.text);
    expect(texts.some((t) => t.startsWith("OBS:"))).toBe(true);
    expect(texts.join(" ")).toContain("antes de emplatar");
    // Corte por palabra: el renglón del prefijo entra en el doble alto.
    expect(texts.find((t) => t.startsWith("OBS:"))!.length).toBeLessThanOrEqual(
      COLS.tall,
    );
  });

  it("una comanda anulada no la imprime: no hay nada que preparar", () => {
    const texts = buildTicketLines({ ...conObs, cancelled: true }).map((l) => l.text);
    expect(texts.some((t) => t.startsWith("OBS:"))).toBe(false);
  });

  it("sin el campo, el ticket sale igual que siempre (aditivo)", () => {
    const texts = buildTicketLines(base).map((l) => l.text);
    expect(texts.some((t) => t.startsWith("OBS:"))).toBe(false);
  });

  it("no se confunde con la nota del ítem: las dos pueden convivir", () => {
    const texts = buildTicketLines(conObs).map((l) => l.text);
    // «bien calientes» es la nota del ítem del fixture base.
    expect(texts.join(" ")).toContain("obs: bien calientes");
    expect(texts.join(" ")).toContain("OBS: va todo junto");
  });
});

describe("buildTicketLines · solo ASCII imprimible", () => {
  it("saca tildes y eñes: la térmica no las imprime", () => {
    const texts = buildTicketLines({
      ...base,
      items: [
        {
          quantity: 1,
          product_name: "Ñoquis a la püttanesca",
          modifiers: ["sin cebolla"],
          notes: "¡rápido!",
        },
      ],
    }).map((l) => l.text);
    expect(texts.join(" ")).toContain("1x Noquis a la puttanesca");
    expect(texts).toContain("obs: rapido!");
  });

  it("traduce los símbolos comunes y descarta el resto", () => {
    const texts = buildTicketLines({
      ...base,
      items: [{ quantity: 1, product_name: "Cafe", modifiers: [], notes: "50° — ok • 🔥 “ya”" }],
    }).map((l) => l.text);
    expect(texts.find((t) => t.startsWith("obs:"))).toBe('obs: 50o - ok * "ya"');
  });

  it("ninguna línea de ningún ticket sale fuera de 0x20–0x7e", () => {
    for (const c of Object.values(cases))
      for (const l of buildTicketLines(c)) expect(l.text).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe("renderEscPos · no le deja la impresora sucia al que sigue", () => {
  it("abre y cierra con ESC @ (init)", () => {
    const esc = renderEscPos(buildTicketLines(base));
    expect(esc.startsWith("\x1b@")).toBe(true);
    // Sin este init final, `ESC 3` (interlineado) y `ESC SP` (ancho) quedan
    // pegados en la comandera y el próximo job los hereda — en golf, los
    // tickets de MaxiRest, que comparte la misma impresora.
    expect(esc.endsWith("\x1d" + "V" + "\x00" + "\x1b@")).toBe(true);
  });
});

describe("buildComandaContent · base64", () => {
  it("escpos_b64 decodifica (latin1) exactamente a los bytes de renderEscPos", () => {
    const expected = renderEscPos(buildTicketLines(base));
    const { escpos_b64 } = buildComandaContent(base);
    const decoded = Buffer.from(escpos_b64, "base64").toString("latin1");
    expect(decoded).toBe(expected);
  });
});

// ── Spec 127 · las dos horas del pedido ─────────────────────────────────────

describe("buildTicketLines · la hora de cocina (spec 127)", () => {
  const conHora = (over: Partial<TicketComanda> = {}) =>
    buildTicketLines({ ...base, kitchen_time: "21:15", ...over });

  it("encabeza el ticket, en el cuerpo más grande", () => {
    const lines = conHora();
    // A doble ancho entra en dos renglones, como cualquier banner del ticket.
    expect(lines[TOP_MARGIN]).toMatchObject({ text: "ENTREGAR", size: "xl" });
    expect(lines[TOP_MARGIN + 1]).toMatchObject({ text: "21:15", size: "xl" });
  });

  it("la nota de cocina baja un renglón y deja de ser el banner", () => {
    const lines = conHora({ kitchen_notes: "junto con la mesa 5" });
    const hora = lines.findIndex((l) => l.text === "21:15");
    const nota = lines.findIndex((l) => l.text.includes("junto con la mesa"));
    expect(hora).toBeGreaterThanOrEqual(0);
    expect(nota).toBeGreaterThan(hora);
    // La nota se lee, pero no le gana a la hora.
    expect(lines[nota].size).toBe("tall");
  });

  it("sin hora, la nota vieja sigue ocupando el banner", () => {
    // El pedido de antes de la spec tiene su «21:30» adentro del texto libre y
    // sigue necesitando leerse de lejos.
    const lines = buildTicketLines({
      ...base,
      kitchen_notes: "21:30, junto con la mesa 5",
    });
    const banner = lines.find((l) => l.text.startsWith("ENTREGAR"));
    expect(banner?.size).toBe("xl");
  });

  it("una comanda anulada no lleva hora: no hay nada que entregar", () => {
    const lines = conHora({ cancelled: true });
    expect(lines.find((l) => l.text.startsWith("ENTREGAR"))).toBeUndefined();
  });
});

// ── Spec 145 · de qué menú viene el plato ───────────────────────────────────

describe("buildTicketLines · la marca del menú (spec 145)", () => {
  const conMenu: TicketComanda = {
    ...base,
    items: [
      {
        quantity: 1,
        product_name: "Milanesa",
        modifiers: ["Puré"],
        notes: null,
        combo_name: "Menu Ejecutivo",
      },
      { quantity: 1, product_name: "Flan", modifiers: [], notes: null },
    ],
  };

  it("dice de qué menú viene el plato, en mayúsculas", () => {
    expect(buildTicketLines(conMenu).map((l) => l.text)).toContain(
      "MENU EJECUTIVO",
    );
  });

  it("va ARRIBA del plato: cambia cómo se lee el nombre que sigue", () => {
    const texts = buildTicketLines(conMenu).map((l) => l.text);
    const marca = texts.indexOf("MENU EJECUTIVO");
    const plato = texts.indexOf("1x Milanesa");
    expect(marca).toBeGreaterThan(0);
    expect(plato).toBe(marca + 1);
  });

  it("en tall y negrita: no le compite al nombre del plato", () => {
    const lines = buildTicketLines(conMenu);
    const marca = lines.find((l) => l.text === "MENU EJECUTIVO");
    expect(marca).toMatchObject({ size: "tall", bold: true });
    // El plato sigue siendo lo más grande del renglón.
    expect(lines.find((l) => l.text === "1x Milanesa")?.size).toBe("xl");
  });

  it("sólo el plato del menú la lleva: el suelto sale como siempre", () => {
    const lines = buildTicketLines(conMenu);
    const flan = lines.findIndex((l) => l.text === "1x Flan");
    // El renglón de arriba del flan es el padding entre ítems, no una marca.
    expect(lines[flan - 1]?.text).toBe("");
  });

  it("un nombre de menú largo se corta por palabra, no lo parte la impresora", () => {
    const texts = buildTicketLines({
      ...base,
      items: [
        {
          quantity: 1,
          product_name: "Milanesa",
          combo_name: "Menu Ejecutivo del Mediodia con Postre",
        },
      ],
    }).map((l) => l.text);
    const marca = texts.filter((t) => t.startsWith("MENU EJECUTIVO"));
    expect(marca.length).toBeGreaterThan(0);
    for (const l of texts.slice(texts.indexOf(marca[0]), texts.indexOf("1x Milanesa")))
      expect(l.length).toBeLessThanOrEqual(COLS.tall);
  });

  it("saca las tildes como todo el resto del ticket", () => {
    expect(
      buildTicketLines({
        ...base,
        items: [{ quantity: 1, product_name: "Milanesa", combo_name: "Menú Niños" }],
      }).map((l) => l.text),
    ).toContain("MENU NINOS");
  });

  it("un hijo anulado sigue diciendo ANULADO, con la marca arriba", () => {
    const texts = buildTicketLines({ ...conMenu, cancelled: true }).map((l) => l.text);
    const marca = texts.indexOf("MENU EJECUTIVO");
    expect(marca).toBeGreaterThan(0);
    expect(texts[marca + 1]).toBe("ANULADO 1x");
    expect(texts[marca + 2]).toBe("Milanesa");
  });

  it("sin el campo, el ticket sale igual que siempre (aditivo)", () => {
    const conCampo = buildTicketLines({
      ...base,
      items: (base.items ?? []).map((it) => ({ ...it, combo_name: null })),
    });
    expect(conCampo).toEqual(buildTicketLines(base));
  });

  it("un payload viejo no imprime un renglón vacío en su lugar", () => {
    // `combo_name: ""` (o ausente) es «no viene de ningún menú», no una marca
    // en blanco que empuje el plato un renglón para abajo.
    const lines = buildTicketLines({
      ...base,
      items: [{ quantity: 1, product_name: "Milanesa", combo_name: "" }],
    });
    const plato = lines.findIndex((l) => l.text === "1x Milanesa");
    expect(lines[plato - 1]?.text).toBe("");
    expect(lines[plato - 2]?.text).toBe("");
  });
});

describe("buildTicketLines · el «COMBINA CON» también lo lleva (spec 145, D5)", () => {
  const conOtroDelMenu: TicketComanda = {
    ...base,
    items: [
      {
        quantity: 1,
        product_name: "Milanesa",
        combo_name: "Menu Ejecutivo",
      },
    ],
    otros_sectores: [
      {
        station_name: "Cocina",
        items: [
          { quantity: 1, product_name: "Puré", combo_name: "Menu Ejecutivo" },
          { quantity: 1, product_name: "Papas fritas" },
        ],
      },
    ],
  };

  it("la guarnición del menú no aparece como un plato suelto de otra mesa", () => {
    const lines = buildTicketLines(conOtroDelMenu);
    const vaCon = lines.findIndex((l) => l.text === "COMBINA CON");
    const bloque = lines.slice(vaCon).map((l) => l.text);
    // «- 1x Pure (Menu Ejecutivo)» son 26 col y el bloque va a 24: se corta por
    // palabra, como cualquier renglón del ticket. Lo que importa es que el
    // renglón del puré diga de dónde viene.
    expect(bloque.join(" ")).toContain("- 1x Pure (Menu Ejecutivo)");
    for (const t of bloque) expect(t.length).toBeLessThanOrEqual(COLS.tall);
  });

  it("lo que no viene de un menú sigue saliendo pelado", () => {
    const texts = buildTicketLines(conOtroDelMenu).map((l) => l.text);
    expect(texts).toContain("- 1x Papas fritas");
  });

  it("sigue siendo referencia: todo el bloque va en tall", () => {
    const lines = buildTicketLines(conOtroDelMenu);
    const vaCon = lines.findIndex((l) => l.text === "COMBINA CON");
    for (const l of lines.slice(vaCon)) if (l.text) expect(l.size).toBe("tall");
  });
});

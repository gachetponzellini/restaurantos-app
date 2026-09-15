import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El GET hace pull de comandas `pendiente` con su `printer_ip` por sector (spec
// 28). El POST confirma la impresión (`ok` → en_preparacion) o reporta un fallo
// (`failed` → setea print_failed_at + notifica, una sola vez — spec 33).
// Mockeamos el service client (query-builder + update) y `notifyPrintFailed`.

type Row = Record<string, unknown>;
let rows: Row[]; // filas del GET
let itemRows: Row[]; // `order_items` del pedido → bloque «COMBINA CON» del ticket
let postRow: Row | null; // fila del select del POST (maybeSingle)
let captured: { updates: Record<string, unknown>[]; orFilters: string[] };
let notifyCalls: { businessId: string; comandaId: string }[];
let scopeDelAgente: string[] | null; // `printer_scope` del agente de biz1 (spec 124)
// Sonda de la retención (spec 183 · D5): cuántas filas NUEVAS ve por tabla y
// si la query falla. `sondaCalls` deja ver cuántas veces se sondeó.
let sondaCounts: Record<string, number>;
let sondaError: { message: string } | null;
let sondaCalls: string[];
// Latidos que registró el GET (spec 183 · D1): el pull ES el latido.
let upserts: { table: string; vals: Record<string, unknown>; opts: unknown }[];

vi.mock("@/lib/notifications/events", () => ({
  notifyPrintFailed: async (p: { businessId: string; comandaId: string }) => {
    notifyCalls.push(p);
  },
}));

// Key por-agente (la global se retiró, security review #4): biz1 usa "test-key".
// El alcance sale de `scopeDelAgente` (mutable, como `rows`/`postRow`): default
// `null` = sin restricción (spec 124), que es el negocio de un solo agente y el
// comportamiento previo a esa spec.
vi.mock("@/lib/print-agent/credentials", () => ({
  listPrintAgentCredentials: async (businessId: string) => {
    const keys: Record<string, string> = { biz1: "test-key", biz2: "key-biz2" };
    const apiKey = keys[businessId];
    return apiKey
      ? [
          {
            id: `agente-${businessId}`,
            apiKey,
            label: null,
            printerScope: scopeDelAgente,
          },
        ]
      : [];
  },
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: (_cols?: string, opts?: { head?: boolean; count?: string }) => {
        // La sonda de la retención (spec 183 · D5) es la ÚNICA query con
        // `head: true`: no trae filas, sólo el count. Se responde aparte para
        // que su `.or()` no se mezcle con el del payload.
        if (opts?.head) {
          const sonda = {
            eq: () => sonda,
            or: () => sonda,
            limit: () => sonda,
            then: (
              resolve: (v: {
                count: number | null;
                error: { message: string } | null;
              }) => unknown,
            ) => {
              sondaCalls.push(table);
              return resolve({
                count: sondaCounts[table] ?? 0,
                error: sondaError,
              });
            },
          };
          return sonda;
        }
        const b = {
          eq: () => b,
          in: () => b,
          is: () => b,
          not: () => b,
          neq: () => b,
          limit: () => b,
          or: (filter: string) => {
            captured.orFilters.push(filter);
            return b;
          },
          order: () => b,
          maybeSingle: async () => ({ data: postRow }),
          then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
            resolve({
              data: table === "order_items" ? itemRows : rows,
              error: null,
            }),
        };
        return b;
      },
      upsert: (vals: Record<string, unknown>, opts: unknown) => {
        upserts.push({ table, vals, opts });
        return Promise.resolve({ error: null });
      },
      update: (vals: Record<string, unknown>) => ({
        eq: () => {
          captured.updates.push(vals);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

const { GET, POST } = await import("./route");

/**
 * Una comanda real SIEMPRE viaja con al menos un item (`createComandasForItems`
 * no crea comandas vacías). El fixture lo refleja; una fila con
 * `comanda_items: []` representa una comanda a medio crear — ver el test de la
 * ventana de carrera con el print-agent.
 */
const unItem = () => [
  {
    order_item_id: "oi-1",
    order_items: {
      id: "oi-1",
      quantity: 2,
      notes: null,
      unit_price_cents: 1000,
      products: { name: "Ensalada Queso Azul" },
      order_item_modifiers: [],
    },
  },
];

function makeRow(
  name: string,
  printerIp: string | null,
  extra: Partial<Row> = {},
): Row {
  return {
    id: `c-${name}`,
    station_id: `st-${name}`,
    batch: 1,
    status: "pendiente",
    emitted_at: "2026-01-01T00:00:00Z",
    cancelled_at: null,
    cancelled_reason: null,
    ...extra,
    stations: {
      name,
      printer_ip: printerIp,
      printer_port: 9100,
      printer_enabled: true,
    },
    orders: extra.orders ?? {
      id: "o1",
      business_id: "biz1",
      daily_number: 7,
      table_id: "t1",
      delivery_type: "dine_in",
      tables: { label: "Mesa 1" },
    },
    comanda_items: extra.comanda_items ?? unItem(),
  };
}

// `makeRow` emite a las 00:00:00Z. Una comanda del mismo envío cae a menos de
// 10 s; una tanda anterior, mucho antes.
const MISMO_ENVIO = "2026-01-01T00:00:00.600Z";
const TANDA_ANTERIOR = "2025-12-31T23:30:00Z"; // media hora antes

/** Fila de `order_items` con su sector y la comanda a la que pertenece (si tiene). */
function itemDePedido(
  product_name: string,
  station_id: string,
  stationName: string,
  comandaEmittedAt?: string,
  cancelledAt: string | null = null,
  comboName: string | null = null,
  /** Spec 180: a qué comanda está vinculado (puede ser la de OTRO sector). */
  comandaId = `c-${stationName}`,
): Row {
  return {
    order_id: "o1",
    quantity: 1,
    product_name,
    station_id,
    stations: { name: stationName },
    // El ítem padre del menú del día, o null si es un producto suelto (spec 145).
    parent: comboName ? { product_name: comboName } : null,
    comanda_items: comandaEmittedAt
      ? [
          {
            comanda_id: comandaId,
            comandas: {
              emitted_at: comandaEmittedAt,
              cancelled_at: cancelledAt,
            },
          },
        ]
      : [],
  };
}

function getReq(auth = "Bearer test-key") {
  return new Request(
    "http://localhost/api/print-agent?business_id=biz1&wait_ms=0",
    {
      headers: auth ? { authorization: auth } : {},
    },
  );
}

function postReq(body: unknown, auth = "Bearer test-key") {
  // `business_id` es obligatorio en el POST; los tests operan sobre biz1, así que
  // lo inyectamos por defecto cuando el body no lo trae. Un test que necesite
  // probar mismatch/ausencia pasa el `business_id` explícito (o arma su Request).
  const merged =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    !("business_id" in body)
      ? { business_id: "biz1", ...(body as object) }
      : body;
  return new Request("http://localhost/api/print-agent", {
    method: "POST",
    headers: auth
      ? { authorization: auth, "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: JSON.stringify(merged),
  });
}

beforeEach(() => {
  process.env.PRINT_AGENT_KEY = "test-key";
  rows = [makeRow("Cocina", "192.168.10.50"), makeRow("Bar", null)];
  itemRows = [];
  postRow = null;
  captured = { updates: [], orFilters: [] };
  notifyCalls = [];
  scopeDelAgente = null;
  sondaCounts = {};
  sondaError = null;
  sondaCalls = [];
  upserts = [];
});

describe("GET /api/print-agent — printer_ip por comanda (spec 28)", () => {
  it("incluye printer_ip/printer_port del sector en cada comanda", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      comandas: {
        station_name: string;
        printer_ip: string | null;
        printer_port: number;
      }[];
    };
    const cocina = body.comandas.find((c) => c.station_name === "Cocina");
    expect(cocina?.printer_ip).toBe("192.168.10.50");
    expect(cocina?.printer_port).toBe(9100);
  });

  it("sector sin IP configurada → printer_ip null (no se pierde la comanda)", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { station_name: string; printer_ip: string | null }[];
    };
    const bar = body.comandas.find((c) => c.station_name === "Bar");
    expect(bar?.printer_ip).toBeNull();
  });

  it("incluye las comandas con reimpresión pedida, no solo las pendiente (spec 35)", async () => {
    // El filtro del GET debe ser `status=pendiente OR reprint_requested_at not null`
    // para que una comanda ya avanzada con reimpresión pedida llegue al agente.
    await GET(getReq());
    expect(captured.orFilters).toHaveLength(1);
    expect(captured.orFilters[0]).toContain("status.eq.pendiente");
    expect(captured.orFilters[0]).toContain("reprint_requested_at.not.is.null");
  });

  it("comanda anulada → payload con cancelled:true + motivo (spec 049)", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        cancelled_at: "2026-07-17T00:00:00Z",
        cancelled_reason: "Mesa se levantó",
      }),
      makeRow("Bar", null),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        station_name: string;
        cancelled: boolean;
        cancelled_reason: string | null;
      }[];
    };
    const cocina = body.comandas.find((c) => c.station_name === "Cocina");
    expect(cocina?.cancelled).toBe(true);
    // Sin tilde: el texto crudo del payload sale en ASCII imprimible para que
    // un agente viejo, que renderiza con estos campos, no escupa basura.
    expect(cocina?.cancelled_reason).toBe("Mesa se levanto");
    const bar = body.comandas.find((c) => c.station_name === "Bar");
    expect(bar?.cancelled).toBe(false);
  });

  it("sanea bytes de control ESC/POS del texto del ticket (security review #8)", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        cancelled_at: "2026-07-17T00:00:00Z",
        cancelled_reason: "corte\x1b\x1d\x00papel",
      }),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { cancelled_reason: string | null }[];
    };
    expect(body.comandas[0]?.cancelled_reason).toBe("cortepapel");
  });

  it("comanda con reimpresión pedida → payload con reprint:true (spec 35)", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        status: "en_preparacion",
        reprint_requested_at: "2026-07-20T00:00:00Z",
      }),
      makeRow("Bar", null),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { station_name: string; reprint: boolean }[];
    };
    const cocina = body.comandas.find((c) => c.station_name === "Cocina");
    expect(cocina?.reprint).toBe(true);
    const bar = body.comandas.find((c) => c.station_name === "Bar");
    expect(bar?.reprint).toBe(false);
  });

  it("incluye el ticket pre-renderizado por el server (spec 051): content_escpos_b64 + content_plain, aditivo", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        station_name: string;
        items: unknown[];
        cancelled: boolean;
        reprint: boolean;
        content_escpos_b64: string;
        content_plain: string;
      }[];
    };
    const cocina = body.comandas.find((c) => c.station_name === "Cocina");
    // Campos nuevos presentes...
    expect(typeof cocina?.content_escpos_b64).toBe("string");
    expect(cocina!.content_escpos_b64.length).toBeGreaterThan(0);
    // ...y el base64 decodifica (latin1) a un stream ESC/POS con el contenido.
    const escpos = Buffer.from(cocina!.content_escpos_b64, "base64").toString(
      "latin1",
    );
    expect(escpos.startsWith("\x1b@")).toBe(true); // init ESC @
    expect(escpos).toContain("COCINA");
    expect(cocina?.content_plain).toContain("COCINA");
    // El nombre se corta por palabra a 11 col (doble ancho), así que se busca
    // el arranque de la línea del item, no el nombre entero.
    expect(cocina?.content_plain).toContain("2x Ensalada");
    // El payload estructurado viejo sigue intacto (aditivo → un agente viejo lo usa).
    expect(cocina?.station_name).toBe("Cocina");
    expect(cocina?.items).toHaveLength(1);
    expect(cocina?.cancelled).toBe(false);
    expect(cocina?.reprint).toBe(false);
  });

  it("con qué combina: lista los items del MISMO pedido que salen de otros sectores", async () => {
    rows = [makeRow("Cocina", "192.168.10.50")];
    itemRows = [
      // El item propio del sector no se repite en el bloque.
      itemDePedido("Ensalada Queso Azul", "st-Cocina", "Cocina"),
      // Con comanda del mismo envío (mismo emitted_at que la del ticket).
      itemDePedido("Entrecot", "st-Parrilla", "Parrilla", MISMO_ENVIO),
      // Todavía sin comanda: el sector que aún no se creó (envío en vuelo).
      itemDePedido("Papas Rejilla", "st-Fritera", "Fritera"),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        otros_sectores: {
          station_name: string;
          items: { product_name: string }[];
        }[];
        content_plain: string;
      }[];
    };
    const cocina = body.comandas[0]!;
    expect(cocina.otros_sectores.map((s) => s.station_name)).toEqual([
      "Parrilla",
      "Fritera",
    ]);
    expect(cocina.content_plain).toContain("COMBINA CON");
    expect(cocina.content_plain).toContain("PARRILLA");
    expect(cocina.content_plain).toContain("- 1x Entrecot");
    // Lo propio del sector no se duplica abajo.
    expect(
      cocina.otros_sectores.flatMap((s) => s.items.map((i) => i.product_name)),
    ).not.toContain("Ensalada Queso Azul");
  });

  // Spec 180 · D3 — con varias comanderas por producto, las papas de fritera
  // viajan TAMBIÉN en la comanda de cocina. «Combina con» se decide por
  // membresía, no por sector: lo que está en este papel no va abajo.
  it("combina con: lo que ya está en ESTA comanda no se repite, aunque su sector sea otro", async () => {
    rows = [makeRow("Cocina", "192.168.10.50")];
    itemRows = [
      itemDePedido("Ensalada Queso Azul", "st-Cocina", "Cocina"),
      // Papas: sector principal Fritera, pero vinculadas a la comanda de
      // COCINA (cocina es su 2ª comandera). Es propio de este papel.
      itemDePedido(
        "Papas Fritas",
        "st-Fritera",
        "Fritera",
        MISMO_ENVIO,
        null,
        null,
        "c-Cocina",
      ),
      // Entrecot: sólo parrilla. Sí combina.
      itemDePedido("Entrecot", "st-Parrilla", "Parrilla", MISMO_ENVIO),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        otros_sectores: {
          station_name: string;
          items: { product_name: string }[];
        }[];
      }[];
    };
    const combina = body.comandas[0]!.otros_sectores.flatMap((s) =>
      s.items.map((i) => i.product_name),
    );
    expect(combina).toContain("Entrecot");
    expect(combina).not.toContain("Papas Fritas");
  });

  it("combina con: NO arrastra la tanda anterior (la picada que la mesa ya se comió)", async () => {
    // `kitchen_status` sólo llega a `delivered` si alguien lo tilda a mano, así
    // que filtrar por eso deja entrar toda tanda vieja que el mozo levantó sin
    // tocar el celular. El corte real es la comanda: si es de otro envío, fuera.
    rows = [makeRow("Parrilla", "192.168.10.50")];
    itemRows = [
      itemDePedido("Picada", "st-Cocina", "Cocina", TANDA_ANTERIOR),
      itemDePedido("Papas Rejilla", "st-Fritera", "Fritera", MISMO_ENVIO),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        otros_sectores: { station_name: string }[];
        content_plain: string;
      }[];
    };
    const parrilla = body.comandas[0]!;
    expect(parrilla.otros_sectores.map((s) => s.station_name)).toEqual([
      "Fritera",
    ]);
    expect(parrilla.content_plain).not.toContain("Picada");
  });

  it("combina con: ignora los items cuya comanda está anulada", async () => {
    rows = [makeRow("Parrilla", "192.168.10.50")];
    itemRows = [
      itemDePedido(
        "Flan",
        "st-Cocina",
        "Cocina",
        MISMO_ENVIO,
        "2026-01-01T00:00:05Z",
      ),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { otros_sectores: unknown[] }[];
    };
    expect(body.comandas[0]!.otros_sectores).toEqual([]);
  });

  it("venta de mostrador (dine_in sin mesa) → MOSTRADOR, no «MESA —»", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        orders: {
          id: "o1",
          business_id: "biz1",
          table_id: null,
          delivery_type: "dine_in",
          tables: null,
        },
      }),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { content_plain: string }[];
    };
    expect(body.comandas[0]!.content_plain).toContain("MOSTRADOR");
    expect(body.comandas[0]!.content_plain).not.toContain("MESA");
  });

  it("comanda de delivery → el ticket dice DELIVERY y el repartidor, no «MESA —»", async () => {
    rows = [
      makeRow("Cocina", "192.168.10.50", {
        orders: {
          id: "o1",
          business_id: "biz1",
          table_id: null,
          delivery_type: "delivery",
          tables: null,
        },
      }),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { delivery_type: string; content_plain: string }[];
    };
    const c = body.comandas[0]!;
    expect(c.delivery_type).toBe("delivery");
    expect(c.content_plain).toContain("DELIVERY");
    expect(c.content_plain).toContain("repartidor");
    expect(c.content_plain).not.toContain("MESA");
  });

  it("comanda a medio crear (todavía sin comanda_items) NO se entrega al agente", async () => {
    // `enviarComanda` inserta la comanda y sus links en dos viajes separados; el
    // agente pollea cada 1s y puede levantarla en el medio. Si se la damos, sale
    // un ticket «(sin items)» y el ACK la pasa a `en_preparacion` → cocina nunca
    // ve el pedido. Se saltea: en el próximo poll ya está completa.
    rows = [
      makeRow("Cocina", "192.168.10.50", { comanda_items: [] }),
      makeRow("Bar", "192.168.10.51"),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as { comandas: { station_name: string }[] };
    expect(body.comandas.map((c) => c.station_name)).toEqual(["Bar"]);
  });

  it("sin Bearer válido → 401", async () => {
    const res = await GET(getReq(""));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/print-agent — con qué arma la cocina el pedido", () => {
  it("cada comanda viaja con el número de pedido, el mismo para todos los sectores", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { station_name: string; daily_number: number | null }[];
    };
    expect(body.comandas.map((c) => c.daily_number)).toEqual([7, 7]);
  });

  it("el ticket renderizado dice «PEDIDO 7», no el hash de la comanda", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { content_plain: string }[];
    };
    expect(body.comandas[0]?.content_plain).toContain("PEDIDO 7");
    expect(body.comandas[0]?.content_plain).not.toContain("Comanda #");
  });

  it("saca los acentos del texto crudo: un agente viejo renderiza con esos campos", async () => {
    // El contenido pre-renderizado ya sale en ASCII, pero un agente anterior a
    // 2026-07-28 arma el ticket con estos campos y la térmica, sin codepage,
    // imprime cualquier byte > 0x7e como basura.
    rows = [
      makeRow("Café y Postres", "192.168.10.50", {
        comanda_items: [
          {
            order_item_id: "oi-1",
            order_items: {
              id: "oi-1",
              quantity: 2,
              notes: "sin cebolla, ¡ojo!",
              unit_price_cents: 1000,
              products: { name: "Ñoquis" },
              order_item_modifiers: [
                { modifiers: { name: "con crema — extra" } },
              ],
            },
          },
        ],
      }),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        station_name: string;
        items: {
          product_name: string;
          notes: string | null;
          modifiers: string[];
        }[];
      }[];
    };
    const c = body.comandas[0];
    expect(c?.station_name).toBe("Cafe y Postres");
    expect(c?.items[0]?.product_name).toBe("Noquis");
    expect(c?.items[0]?.notes).toBe("sin cebolla, ojo!");
    expect(c?.items[0]?.modifiers).toEqual(["con crema - extra"]);
  });
});

describe("GET /api/print-agent — alcance del agente (spec 124)", () => {
  // Un negocio puede tener varias PCs con print-agent, en LANs distintas (golf:
  // una por caja). Cada una recibe sólo los trabajos cuya impresora alcanza.

  it("sin scope → no se filtra nada (el negocio de un solo agente)", async () => {
    // Es el default y lo que deja a la PC ya instalada de golf recibiendo todo
    // exactamente como antes de esta spec: si esto se rompe, el local se queda
    // sin papel sin que nadie haya tocado esa máquina.
    rows = [
      makeRow("Cocina", "192.168.1.50"),
      makeRow("Bar", "192.168.2.50"),
      makeRow("Postres", null),
    ];
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { comandas: { station_name: string }[] };
    expect(body.comandas.map((c) => c.station_name)).toEqual([
      "Cocina",
      "Bar",
      "Postres",
    ]);
  });

  it("scope por rango → sólo las comandas de impresoras de esa LAN", async () => {
    scopeDelAgente = ["192.168.1.0/24"];
    rows = [makeRow("Cocina", "192.168.1.50"), makeRow("Bar", "192.168.2.50")];
    const res = await GET(getReq());
    const body = (await res.json()) as { comandas: { station_name: string }[] };
    expect(body.comandas.map((c) => c.station_name)).toEqual(["Cocina"]);
  });

  it("comanda sin printer_ip → se sirve igual aunque el agente tenga scope", async () => {
    // Sin IP no se la puede atribuir a ninguna LAN, y filtrarla la haría
    // desaparecer del pull sin que nadie la vea. Papel de más es ruido; papel
    // de menos es un pedido que no llega a cocina.
    scopeDelAgente = ["192.168.1.0/24"];
    rows = [makeRow("Cocina", "192.168.1.50"), makeRow("Bar", null)];
    const res = await GET(getReq());
    const body = (await res.json()) as { comandas: { station_name: string }[] };
    expect(body.comandas.map((c) => c.station_name)).toEqual(["Cocina", "Bar"]);
  });

  it("scope con basura → responde 200 igual, no se lleva puesto el pull", async () => {
    // El filtro corre FUERA de `safePrintables`, así que un matcher que tirara
    // con una entrada mal cargada dejaría a cocina sin comandas, no sólo sin
    // los papeles de la otra caja.
    scopeDelAgente = ["no-es-una-ip"];
    rows = [makeRow("Cocina", "192.168.1.50"), makeRow("Bar", null)];
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { comandas: { station_name: string }[] };
    // La entrada inválida no matchea nada, pero la comanda sin IP sale igual.
    expect(body.comandas.map((c) => c.station_name)).toEqual(["Bar"]);
  });
});

describe("POST /api/print-agent — confirmación y reporte de fallo (spec 33)", () => {
  it("result:failed sin flag previo → setea print_failed_at, notifica, NO cambia estado", async () => {
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: null,
      orders: { business_id: "biz1" },
    };
    const res = await POST(postReq({ comanda_id: "c1", result: "failed" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notified: boolean };
    expect(body.notified).toBe(true);
    expect(notifyCalls).toEqual([{ businessId: "biz1", comandaId: "c1" }]);
    // setea print_failed_at, no toca status
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]).toHaveProperty("print_failed_at");
    expect(captured.updates[0]).not.toHaveProperty("status");
  });

  it("result:failed con flag ya seteado → dedup, NO re-notifica ni actualiza", async () => {
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: "2026-01-01T00:00:00Z",
      orders: { business_id: "biz1" },
    };
    const res = await POST(postReq({ comanda_id: "c1", result: "failed" }));
    const body = (await res.json()) as {
      notified: boolean;
      alreadyFlagged: boolean;
    };
    expect(body.notified).toBe(false);
    expect(body.alreadyFlagged).toBe(true);
    expect(notifyCalls).toHaveLength(0);
    expect(captured.updates).toHaveLength(0);
  });

  it("result:ok (default) → pendiente → en_preparacion + limpia los flags", async () => {
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
      orders: { business_id: "biz1" },
    };
    const res = await POST(postReq({ comanda_id: "c1" }));
    const body = (await res.json()) as { status: string; changed: boolean };
    expect(body.status).toBe("en_preparacion");
    expect(body.changed).toBe(true);
    expect(captured.updates[0]).toMatchObject({
      status: "en_preparacion",
      print_failed_at: null,
      reprint_requested_at: null,
    });
    expect(notifyCalls).toHaveLength(0);
  });

  it("result:ok sobre una comanda `entregado` reimpresa → limpia reprint sin regresar estado (spec 35, R1.3)", async () => {
    postRow = {
      id: "c1",
      status: "entregado",
      print_failed_at: null,
      reprint_requested_at: "2026-07-06T00:00:00Z",
      orders: { business_id: "biz1" },
    };
    const res = await POST(postReq({ comanda_id: "c1" }));
    const body = (await res.json()) as { status: string; changed: boolean };
    // Sigue `entregado`, no vuelve a `en_preparacion`.
    expect(body.status).toBe("entregado");
    expect(body.changed).toBe(false);
    // Limpia el flag de reimpresión (y no toca el status).
    expect(captured.updates).toHaveLength(1);
    expect(captured.updates[0]).toMatchObject({ reprint_requested_at: null });
    expect(captured.updates[0]).not.toHaveProperty("status");
  });

  it("comanda inexistente → 404", async () => {
    postRow = null;
    const res = await POST(postReq({ comanda_id: "nope", result: "failed" }));
    expect(res.status).toBe(404);
  });

  it("sin Bearer válido → 401", async () => {
    const res = await POST(postReq({ comanda_id: "c1" }, ""));
    expect(res.status).toBe(401);
  });

  it("comanda de OTRO negocio → 404 (con key válida de biz2, no toca comanda ajena; security review #4)", async () => {
    // biz2 se autentica con SU key, pero la comanda es de biz1 → ownership 404.
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
      orders: { business_id: "biz1" },
    };
    const res = await POST(
      postReq({ comanda_id: "c1", business_id: "biz2" }, "Bearer key-biz2"),
    );
    expect(res.status).toBe(404);
    expect(captured.updates).toHaveLength(0);
  });

  it("sin business_id → 401 (sin negocio no se puede autenticar la key; security review #4)", async () => {
    postRow = {
      id: "c1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
      orders: { business_id: "biz1" },
    };
    const req = new Request("http://localhost/api/print-agent", {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ comanda_id: "c1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(captured.updates).toHaveLength(0);
  });
});

// ── Spec 145 · de qué menú viene el plato ───────────────────────────────────

describe("GET /api/print-agent — de qué menú viene el plato (spec 145)", () => {
  /** Un hijo de combo: producto propio, sector propio, y el padre con el menú. */
  const hijoDeCombo = (
    id: string,
    productName: string,
    comboName: string | null,
  ) => ({
    order_item_id: id,
    order_items: {
      id,
      quantity: 1,
      notes: null,
      unit_price_cents: 0,
      parent_order_item_id: comboName ? "padre-1" : null,
      parent: comboName ? { product_name: comboName } : null,
      products: { name: productName },
      order_item_modifiers: [],
    },
  });

  beforeEach(() => {
    // La Fritera manda la milanesa del ejecutivo; el puré sale de Cocina.
    rows = [
      makeRow("Fritera", "192.168.10.50", {
        station_id: "st-fritera",
        comanda_items: [hijoDeCombo("oi-mila", "Milanesa", "Menu Ejecutivo")],
      }),
    ];
    itemRows = [
      itemDePedido(
        "Puré",
        "st-cocina",
        "Cocina",
        MISMO_ENVIO,
        null,
        "Menu Ejecutivo",
      ),
    ];
  });

  it("el ítem viaja con el nombre del menú del padre", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        items: { product_name: string; combo_name: string | null }[];
      }[];
    };
    expect(body.comandas[0]?.items[0]).toMatchObject({
      product_name: "Milanesa",
      combo_name: "Menu Ejecutivo",
    });
  });

  it("el ticket impreso lo dice: la Fritera deja de mandar la de la carta", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { content_plain: string }[];
    };
    const plain = body.comandas[0]?.content_plain ?? "";
    expect(plain).toContain("MENU EJECUTIVO");
    // Arriba del plato, que es lo que cambia cómo se lee el nombre.
    expect(plain.indexOf("MENU EJECUTIVO")).toBeLessThan(
      plain.indexOf("Milanesa"),
    );
  });

  it("el «COMBINA CON» identifica la guarnición del mismo menú", async () => {
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        content_plain: string;
        otros_sectores: {
          station_name: string;
          items: { product_name: string; combo_name: string | null }[];
        }[];
      }[];
    };
    expect(body.comandas[0]?.otros_sectores[0]?.items[0]).toMatchObject({
      product_name: "Pure",
      combo_name: "Menu Ejecutivo",
    });
    // En el papel: «- 1x Pure (Menu Ejecutivo)», cortado a 24 col por palabra.
    const bloque =
      (body.comandas[0]?.content_plain ?? "").split("COMBINA CON")[1] ?? "";
    expect(bloque.replace(/\r\n/g, " ")).toContain(
      "- 1x Pure (Menu Ejecutivo)",
    );
  });

  it("un producto suelto no lleva marca: el ticket sale como siempre", async () => {
    rows = [
      makeRow("Fritera", "192.168.10.50", {
        station_id: "st-fritera",
        comanda_items: [hijoDeCombo("oi-papas", "Papas fritas", null)],
      }),
    ];
    itemRows = [];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: {
        content_plain: string;
        items: { combo_name: string | null }[];
      }[];
    };
    expect(body.comandas[0]?.items[0]?.combo_name).toBeNull();
    expect(body.comandas[0]?.content_plain).toContain("1x Papas");
  });

  it("saca los acentos del nombre del menú, como todo lo que va al papel", async () => {
    rows = [
      makeRow("Fritera", "192.168.10.50", {
        station_id: "st-fritera",
        comanda_items: [hijoDeCombo("oi-mila", "Milanesa", "Menú Niños")],
      }),
    ];
    const res = await GET(getReq());
    const body = (await res.json()) as {
      comandas: { items: { combo_name: string | null }[] }[];
    };
    expect(body.comandas[0]?.items[0]?.combo_name).toBe("Menu Ninos");
  });
});

// ── Retención del GET (spec 183 · D5) ──────────────────────────────────────
// Cuando no hay nada para imprimir, el GET no contesta vacío al toque: espera
// mirando la cola y contesta apenas aparece algo. Es lo que baja el período del
// agente a ~30 s SIN tocar el `.exe` instalado, y a la vez hace que la comanda
// salga más rápido que hoy (2 s de sondeo contra 10,99 s de período en golf).
describe("GET /api/print-agent — retención cuando no hay nada (D5)", () => {
  /** Request sin `wait_ms`: retención por default, como la del agente real. */
  function getReqRetenido() {
    return new Request("http://localhost/api/print-agent?business_id=biz1", {
      headers: { authorization: "Bearer test-key" },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nada para imprimir → no contesta, espera", async () => {
    rows = [];
    let contestó = false;
    const p = GET(getReqRetenido()).then((r) => {
      contestó = true;
      return r;
    });

    // Un sondeo entero (2 s) sin novedades: sigue esperando.
    await vi.advanceTimersByTimeAsync(2_100);
    expect(sondaCalls.length).toBeGreaterThan(0);
    expect(contestó).toBe(false);

    // Se agota la retención (25 s) → contesta vacío, que es lo que el agente
    // ya sabe manejar.
    await vi.advanceTimersByTimeAsync(24_000);
    const body = (await (await p).json()) as { comandas: unknown[] };
    expect(contestó).toBe(true);
    expect(body.comandas).toHaveLength(0);
  });

  it("aparece una comanda a mitad de la retención → contesta ahí mismo", async () => {
    rows = [];
    const p = GET(getReqRetenido());
    await vi.advanceTimersByTimeAsync(2_100); // un sondeo en falso

    // Alguien marcha una mesa: la sonda la ve y el payload sale.
    rows = [makeRow("Cocina", "192.168.10.50")];
    sondaCounts = { comandas: 1 };
    await vi.advanceTimersByTimeAsync(2_100);

    const body = (await (await p).json()) as {
      comandas: { station_name: string }[];
    };
    expect(body.comandas).toHaveLength(1);
    expect(body.comandas[0].station_name).toBe("Cocina");
    // Dentro de la retención, no después: la comanda no esperó los 25 s.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("`wait_ms=0` contesta vacío al toque (es lo que usa `--once`)", async () => {
    rows = [];
    const res = await GET(
      new Request(
        "http://localhost/api/print-agent?business_id=biz1&wait_ms=0",
        { headers: { authorization: "Bearer test-key" } },
      ),
    );
    const body = (await res.json()) as { comandas: unknown[] };
    expect(body.comandas).toHaveLength(0);
    expect(sondaCalls).toHaveLength(0);
  });

  it("si la sonda falla, rearma el payload en vez de dejar la comanda esperando", async () => {
    // El modo de fallar que importa: una sonda que dice «no hay» con una
    // comanda en la cola deja a la cocina sin ticket. Ante el error contesta
    // «puede que haya» y se rearma el payload.
    rows = [];
    sondaError = { message: "PGRST100" };
    const p = GET(getReqRetenido());
    await vi.advanceTimersByTimeAsync(2_100);
    rows = [makeRow("Cocina", "192.168.10.50")];
    await vi.advanceTimersByTimeAsync(2_100);
    const body = (await (await p).json()) as { comandas: unknown[] };
    expect(body.comandas).toHaveLength(1);
  });

  it("trabajo que este agente no alcanza → contesta vacío sin rearmar 12 veces", async () => {
    // Negocio con dos PCs (golf): el papel del otro agente hace positiva la
    // sonda de este. Sin techo serían 12 reconstrucciones del payload en una
    // sola request — más caro que no retener.
    scopeDelAgente = ["10.0.0.0/24"]; // la comanda de abajo está en 192.168.x
    rows = [makeRow("Cocina", "192.168.10.50")];
    sondaCounts = { comandas: 1 };

    const p = GET(getReqRetenido());
    await vi.advanceTimersByTimeAsync(25_100);
    const body = (await (await p).json()) as { comandas: unknown[] };
    expect(body.comandas).toHaveLength(0);
    // 3 reconstrucciones = 3 sondeos × 2 tablas.
    expect(sondaCalls).toHaveLength(6);
  });

  it("el agente que corta la conexión no se sigue sondeando", async () => {
    rows = [];
    const ctrl = new AbortController();
    const p = GET(
      new Request("http://localhost/api/print-agent?business_id=biz1", {
        headers: { authorization: "Bearer test-key" },
        signal: ctrl.signal,
      }),
    );
    await vi.advanceTimersByTimeAsync(2_100);
    const sondeosAntes = sondaCalls.length;
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    const body = (await (await p).json()) as { comandas: unknown[] };
    expect(body.comandas).toHaveLength(0);
    expect(sondaCalls).toHaveLength(sondeosAntes);
  });
});

// ── El latido viaja adentro del pull (spec 183 · D1) ───────────────────────
// El agente mandaba dos requests por vuelta: `POST /heartbeat` + `GET`. El GET
// ya autenticó y ya sabe qué agente es, así que registra el latido él mismo y
// la versión viaja en un header. Mitad de las invocaciones por tick, y el
// latido queda atado a la pregunta que el panel quiere contestar: «¿este agente
// está pidiendo comandas?».
describe("GET /api/print-agent — el pull registra el latido (D1)", () => {
  function getReqConVersion(version?: string) {
    return new Request(
      "http://localhost/api/print-agent?business_id=biz1&wait_ms=0",
      {
        headers: {
          authorization: "Bearer test-key",
          ...(version ? { "x-agent-version": version } : {}),
        },
      },
    );
  }

  it("upsertea print_agent_status con el agent_id que ya resolvió la key", async () => {
    await GET(getReqConVersion("2026-09-15"));
    const latido = upserts.find((u) => u.table === "print_agent_status");
    expect(latido).toBeTruthy();
    expect(latido!.vals.business_id).toBe("biz1");
    expect(latido!.vals.agent_id).toBe("agente-biz1");
    expect(latido!.vals).toHaveProperty("last_seen_at");
    expect(latido!.opts).toEqual({ onConflict: "business_id,agent_id" });
  });

  it("guarda la versión que viene en x-agent-version", async () => {
    await GET(getReqConVersion("2026-09-15"));
    const latido = upserts.find((u) => u.table === "print_agent_status");
    expect(latido!.vals.agent_version).toBe("2026-09-15");
  });

  it("sin x-agent-version NO pisa la versión guardada (regla de la #278)", async () => {
    // Los dos agentes instalados tienen `agent_version` NULL. Cuando uno se
    // actualiza y el otro no, el viejo no puede borrarle el dato al nuevo — y
    // el NULL es información: «este .exe es anterior a set-2026».
    await GET(getReqConVersion());
    const latido = upserts.find((u) => u.table === "print_agent_status");
    expect(latido).toBeTruthy();
    expect(latido!.vals).not.toHaveProperty("agent_version");
  });

  it("una versión vacía cuenta como ausente", async () => {
    await GET(getReqConVersion("   "));
    const latido = upserts.find((u) => u.table === "print_agent_status");
    expect(latido!.vals).not.toHaveProperty("agent_version");
  });

  it("late aunque no haya nada para imprimir — es el caso del 99%", async () => {
    rows = [];
    await GET(getReqConVersion("2026-09-15"));
    expect(
      upserts.filter((u) => u.table === "print_agent_status"),
    ).toHaveLength(1);
  });

  it("`beat=0` no late (es el `--dry-run`, que no tiene que mentirle al panel)", async () => {
    await GET(
      new Request(
        "http://localhost/api/print-agent?business_id=biz1&wait_ms=0&beat=0",
        { headers: { authorization: "Bearer test-key" } },
      ),
    );
    expect(upserts).toHaveLength(0);
  });

  it("el 401 no late: sin key no hay agente al que atribuirle el latido", async () => {
    const res = await GET(
      new Request("http://localhost/api/print-agent?business_id=biz1", {
        headers: { authorization: "Bearer key-ajena" },
      }),
    );
    expect(res.status).toBe(401);
    expect(upserts).toHaveLength(0);
  });
});

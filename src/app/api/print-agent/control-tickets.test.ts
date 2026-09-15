import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 063 — el control de pedido viajando por el endpoint del print-agent.
 *
 * Lo que se protege acá es el contrato con el agente **instalado en el local**:
 * los controles salen en el mismo array `comandas` y se confirman con el mismo
 * `comanda_id`, para que no haya que recompilar ni reinstalar el .exe.
 */

type Row = Record<string, unknown>;

let businessRow: Row | null;
let controlRows: Row[];
let cuentaRows: Row[];
let controlPostRow: Row | null;
let agentScope: string[] | null;
let captured: { updates: { table: string; vals: Record<string, unknown> }[] };

vi.mock("@/lib/notifications/events", () => ({
  notifyPrintFailed: async () => {},
}));

vi.mock("@/lib/print-agent/credentials", () => ({
  listPrintAgentCredentials: async (businessId: string) =>
    businessId === "biz1"
      ? [
          {
            id: "agente-biz1",
            apiKey: "test-key",
            label: null,
            // Se lee en cada llamada, así que un test puede angostar el alcance
            // del agente sin rearmar el mock (spec 124).
            printerScope: agentScope,
          },
        ]
      : [],
}));

// Mock consciente de la tabla: las comandas de cocina quedan vacías para aislar
// el camino del control.
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => {
        // El mock tiene que distinguir por `kind`: desde spec 084 el GET
        // consulta `print_jobs` tres veces (control / cuenta / factura) y sin
        // esto las filas de control se colarían por las otras dos ramas.
        let kind: string | null = null;
        const b = {
          eq: (col: string, val: unknown) => {
            if (col === "kind") kind = String(val);
            return b;
          },
          in: () => b,
          or: () => b,
          order: () => b,
          maybeSingle: async () => ({
            data:
              table === "businesses"
                ? businessRow
                : table === "print_jobs"
                  ? controlPostRow
                  : // `comandas` siempre vacía: el POST tiene que caer al
                    // camino de print_jobs, que es lo que se está probando.
                    null,
          }),
          then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
            resolve({
              data:
                table === "business_users"
                  ? businessUsersRows
                  : table !== "print_jobs"
                  ? []
                  : kind === "control"
                    ? controlRows
                    : kind === "cuenta"
                      ? cuentaRows
                      : [],
              error: null,
            }),
        };
        return b;
      },
      update: (vals: Record<string, unknown>) => ({
        eq: () => {
          captured.updates.push({ table, vals });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

const { GET, POST } = await import("./route");

const AUTH = { authorization: "Bearer test-key" };

function getReq() {
  return new Request("http://x/api/print-agent?business_id=biz1&wait_ms=0", {
    headers: AUTH,
  });
}

function postReq(body: Record<string, unknown>) {
  return new Request("http://x/api/print-agent", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ticket(over: Row = {}): Row {
  return {
    id: "ct1",
    status: "pendiente",
    emitted_at: "2026-07-28T19:16:00-03:00",
    reprint_requested_at: null,
    orders: {
      daily_number: 123,
      delivery_type: "delivery",
      customer_name: "Rodrigo",
      customer_phone: "341 555 1234",
      delivery_address: "Oroño 1234",
      delivery_notes: null,
      subtotal_cents: 11050000,
      delivery_fee_cents: 150000,
      discount_cents: 0,
      total_cents: 11200000,
      payment_method: "cash",
      payment_status: "pending",
      scheduled_at: null,
      order_items: [
        {
          quantity: 2,
          unit_price_cents: 3300000,
          notes: null,
          cancelled_at: null,
          products: { name: "Brochette de lomo" },
          order_item_modifiers: [],
        },
      ],
    },
    ...over,
  };
}

/** Una cuenta de mesa pendiente, con su comandera en OTRA LAN que el control. */
function cuentaJob(): Row {
  return {
    id: "cta1",
    status: "pendiente",
    emitted_at: "2026-07-28T19:16:00-03:00",
    reprint_requested_at: null,
    orders: {
      daily_number: 77,
      subtotal_cents: 100000,
      discount_cents: 0,
      discount_reason: null,
      tip_cents: 0,
      total_cents: 100000,
      total_paid_cents: 0,
      tables: {
        label: "12",
        floor_plans: {
          name: "Terraza",
          cuenta_printer_ip: "192.168.20.70",
          cuenta_printer_port: 9100,
          cuenta_printer_enabled: true,
        },
      },
      order_items: [
        {
          quantity: 1,
          unit_price_cents: 100000,
          notes: null,
          cancelled_at: null,
          products: { name: "Cafe" },
        },
      ],
    },
  };
}

let businessUsersRows: Row[] = [];

beforeEach(() => {
  businessUsersRows = [];
  businessRow = {
    name: "Restaurant del Golf",
    address: "Bv. Wilde",
    phone: "0341-15",
    control_printer_ip: "192.168.10.60",
    control_printer_port: 9100,
    control_printer_enabled: true,
  };
  controlRows = [ticket()];
  cuentaRows = [];
  controlPostRow = null;
  agentScope = null;
  captured = { updates: [] };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET · controles de pedido", () => {
  it("sale en el mismo array que las comandas, con la IP de control", async () => {
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toHaveLength(1);
    const c = body.comandas[0];
    expect(c.comanda_id).toBe("ct1");
    expect(c.station_name).toBe("CONTROL");
    expect(c.printer_ip).toBe("192.168.10.60");
    expect(c.printer_port).toBe(9100);
    // El agente imprime bytes pre-renderizados: si faltan, no imprime nada.
    expect(typeof c.content_escpos_b64).toBe("string");
    expect(c.content_escpos_b64.length).toBeGreaterThan(0);
  });

  it("el contenido dice cuánto cobrar", async () => {
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].content_plain).toContain("A COBRAR:");
    expect(body.comandas[0].content_plain).toContain("112000.00");
  });

  it("no sale si el negocio no tiene comandera de control", async () => {
    businessRow = { ...businessRow!, control_printer_ip: null };
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toEqual([]);
  });

  // ── Spec 181 · D4 — el control se resuelve por quien lo pidió ──────────
  it("un control pedido por una terminal con impresora sale por la SUYA", async () => {
    // El que pregunta es el agente DE la terminal: un `local:` sólo se sirve
    // al agente que lo declara (D3). Sin alcance no le llegaría.
    agentScope = ["local:CONTROL-T1"];
    controlRows = [ticket({ requested_by: "term1" })];
    businessUsersRows = [
      {
        user_id: "term1",
        role: "terminal",
        control_printer_ip: "local:CONTROL-T1",
        control_printer_port: null,
      },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toHaveLength(1);
    expect(body.comandas[0].printer_ip).toBe("local:CONTROL-T1");
  });

  it("un control del sistema (sin requested_by) sigue yendo a la del negocio", async () => {
    controlRows = [ticket({ requested_by: null })];
    businessUsersRows = [
      { user_id: "term1", role: "terminal", control_printer_ip: "local:CONTROL-T1", control_printer_port: null },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("192.168.10.60");
  });

  it("una terminal SIN impresora propia cae a la del negocio", async () => {
    controlRows = [ticket({ requested_by: "term2" })];
    businessUsersRows = [
      { user_id: "term2", role: "terminal", control_printer_ip: null, control_printer_port: null },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("192.168.10.60");
  });

  it("un negocio SIN control central igual sirve los de sus terminales", async () => {
    // Antes esto era un cortocircuito: sin `control_printer_ip` en el negocio,
    // `[]` y listo. Con terminales, el negocio puede no tener control central.
    agentScope = ["local:CONTROL-T1"];
    businessRow = { ...businessRow!, control_printer_ip: null };
    controlRows = [ticket({ requested_by: "term1" }), ticket({ id: "ct2", requested_by: null })];
    businessUsersRows = [
      { user_id: "term1", role: "terminal", control_printer_ip: "local:CONTROL-T1", control_printer_port: null },
    ];
    const body = await (await GET(getReq())).json();
    // El de la terminal sale; el del sistema no tiene destino y queda pendiente.
    expect(body.comandas.map((c: Row) => c.comanda_id)).toEqual(["ct1"]);
  });

  it("el agente de cocina (alcance por IP) no recibe el control de la terminal", async () => {
    agentScope = ["192.168.10.0/24"];
    controlRows = [ticket({ requested_by: "term1" }), ticket({ id: "ct2", requested_by: null })];
    businessUsersRows = [
      { user_id: "term1", role: "terminal", control_printer_ip: "local:CONTROL-T1", control_printer_port: null },
    ];
    const body = await (await GET(getReq())).json();
    // Sólo el del sistema, que va a la comandera de control del negocio (.60).
    expect(body.comandas.map((c: Row) => c.comanda_id)).toEqual(["ct2"]);
  });

  it("la impresora de una persona (no terminal) no se usa: no es un puesto", async () => {
    controlRows = [ticket({ requested_by: "sofia" })];
    businessUsersRows = [
      { user_id: "sofia", role: "encargado", control_printer_ip: "local:X", control_printer_port: null },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("192.168.10.60");
  });

  it("no sale si la comandera está apagada", async () => {
    businessRow = { ...businessRow!, control_printer_enabled: false };
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toEqual([]);
  });

  it("no imprime ítems anulados", async () => {
    const t = ticket();
    (t.orders as Row).order_items = [
      {
        quantity: 1,
        unit_price_cents: 100000,
        notes: null,
        cancelled_at: "2026-07-28T19:20:00-03:00",
        products: { name: "Anulado" },
        order_item_modifiers: [],
      },
    ];
    controlRows = [t];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].content_plain).not.toContain("Anulado");
    expect(body.comandas[0].content_plain).toContain("(sin items)");
  });
});

describe("GET · alcance del agente (spec 124)", () => {
  // El `?station_id=` viejo filtraba sólo comandas de cocina: control, cuenta y
  // factura se arman por `business_id` y se las llevaban los dos agentes. Estos
  // tests están acá porque este archivo es el único con un mock que distingue
  // tablas, o sea el único donde se puede ver una familia que no es comanda.
  it("un control fuera del alcance no se le entrega al agente", async () => {
    agentScope = ["192.168.99.0/24"];
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toEqual([]);
  });

  it("el mismo control sale entero si el agente no declara alcance", async () => {
    agentScope = null;
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toHaveLength(1);
    expect(body.comandas[0].comanda_id).toBe("ct1");
  });

  it("con dos familias, cada una se mide contra su propia impresora", async () => {
    // El agente llega a la comandera de control (…10.60) pero no a la de la
    // terraza (…20.70): sin el filtro reportaría `failed` por la cuenta del
    // otro local y le pisaría el papel al agente que sí la imprimió.
    cuentaRows = [cuentaJob()];
    agentScope = ["192.168.10.0/24"];
    const body = await (await GET(getReq())).json();
    expect(body.comandas.map((c: Row) => c.comanda_id)).toEqual(["ct1"]);
  });

  it("sin alcance el agente se lleva el control y la cuenta", async () => {
    cuentaRows = [cuentaJob()];
    const body = await (await GET(getReq())).json();
    expect(body.comandas.map((c: Row) => c.station_name)).toEqual([
      "CONTROL",
      "CUENTA",
    ]);
  });
});

describe("POST · confirmación de un control", () => {
  it("`ok` lo marca impreso y limpia los flags", async () => {
    controlPostRow = {
      business_id: "biz1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
    };
    const res = await POST(postReq({ comanda_id: "ct1", business_id: "biz1" }));
    expect(await res.json()).toEqual({ status: "impreso", changed: true });
    const upd = captured.updates.find((u) => u.table === "print_jobs");
    expect(upd?.vals).toMatchObject({
      status: "impreso",
      print_failed_at: null,
      reprint_requested_at: null,
    });
  });

  it("`failed` marca el fallo sin cambiar el estado (se reintenta)", async () => {
    controlPostRow = {
      business_id: "biz1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
    };
    const res = await POST(
      postReq({ comanda_id: "ct1", business_id: "biz1", result: "failed" }),
    );
    expect(await res.json()).toMatchObject({ status: "pendiente" });
    const upd = captured.updates.find((u) => u.table === "print_jobs");
    // El estado NO se toca: sólo el flag de fallo y su motivo (spec 176).
    expect(Object.keys(upd!.vals).sort()).toEqual([
      "last_error",
      "print_failed_at",
    ]);
  });

  it("un `failed` repetido no vuelve a marcar (dedup)", async () => {
    controlPostRow = {
      business_id: "biz1",
      status: "pendiente",
      print_failed_at: "2026-07-28T19:20:00-03:00",
      reprint_requested_at: null,
    };
    const res = await POST(
      postReq({ comanda_id: "ct1", business_id: "biz1", result: "failed" }),
    );
    expect(await res.json()).toMatchObject({ alreadyFlagged: true });
    expect(captured.updates).toEqual([]);
  });

  it("un control de OTRO negocio da 404 y no se toca", async () => {
    controlPostRow = {
      business_id: "biz2",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
    };
    const res = await POST(postReq({ comanda_id: "ct1", business_id: "biz1" }));
    expect(res.status).toBe(404);
    expect(captured.updates).toEqual([]);
  });

  it("un id que no es ni comanda ni control da 404", async () => {
    controlPostRow = null;
    const res = await POST(postReq({ comanda_id: "nope", business_id: "biz1" }));
    expect(res.status).toBe(404);
  });
});

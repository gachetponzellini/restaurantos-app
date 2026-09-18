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
      // El GET late como efecto del pull (spec 183 · D1). Acá sólo hace falta
      // que no explote: el latido se testea en route.test.ts.
      upsert: () => Promise.resolve({ error: null }),
      select: (_cols?: string, opts?: { head?: boolean }) => {
        // La sonda de la retención y el count de actividad de la cadencia
        // (spec 183 · D5/D2) son las queries con `head: true`: no traen filas.
        if (opts?.head) {
          const sonda = {
            eq: () => sonda,
            or: () => sonda,
            gt: () => sonda,
            limit: () => sonda,
            then: (resolve: (v: { count: number; error: null }) => unknown) =>
              resolve({ count: 0, error: null }),
          };
          return sonda;
        }
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
          gt: () => b,
          // Spec 095 · H-37: la cuenta excluye las órdenes anuladas.
          neq: () => b,
          // Spec 190: el resolver filtra los usuarios sin comandera elegida.
          not: () => b,
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
function cuentaJob(over: Row = {}): Row {
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
    ...over,
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
        control_printers: {
          printer_ip: "local:CONTROL-T1",
          printer_port: null,
          is_active: true,
        },
      },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toHaveLength(1);
    expect(body.comandas[0].printer_ip).toBe("local:CONTROL-T1");
  });

  it("un control del sistema (sin requested_by) sigue yendo a la del negocio", async () => {
    controlRows = [ticket({ requested_by: null })];
    businessUsersRows = [
      {
        user_id: "term1",
        control_printers: {
          printer_ip: "local:CONTROL-T1",
          printer_port: null,
          is_active: true,
        },
      },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("192.168.10.60");
  });

  it("una terminal SIN impresora propia cae a la del negocio", async () => {
    controlRows = [ticket({ requested_by: "term2" })];
    businessUsersRows = [
      {
        user_id: "term2",
        control_printers: null,
      },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("192.168.10.60");
  });

  it("un negocio SIN control central igual sirve los de sus terminales", async () => {
    // Antes esto era un cortocircuito: sin `control_printer_ip` en el negocio,
    // `[]` y listo. Con terminales, el negocio puede no tener control central.
    agentScope = ["local:CONTROL-T1"];
    businessRow = { ...businessRow!, control_printer_ip: null };
    controlRows = [
      ticket({ requested_by: "term1" }),
      ticket({ id: "ct2", requested_by: null }),
    ];
    businessUsersRows = [
      {
        user_id: "term1",
        control_printers: {
          printer_ip: "local:CONTROL-T1",
          printer_port: null,
          is_active: true,
        },
      },
    ];
    const body = await (await GET(getReq())).json();
    // El de la terminal sale; el del sistema no tiene destino y queda pendiente.
    expect(body.comandas.map((c: Row) => c.comanda_id)).toEqual(["ct1"]);
  });

  it("el agente de cocina (alcance por IP) no recibe el control de la terminal", async () => {
    agentScope = ["192.168.10.0/24"];
    controlRows = [
      ticket({ requested_by: "term1" }),
      ticket({ id: "ct2", requested_by: null }),
    ];
    businessUsersRows = [
      {
        user_id: "term1",
        control_printers: {
          printer_ip: "local:CONTROL-T1",
          printer_port: null,
          is_active: true,
        },
      },
    ];
    const body = await (await GET(getReq())).json();
    // Sólo el del sistema, que va a la comandera de control del negocio (.60).
    expect(body.comandas.map((c: Row) => c.comanda_id)).toEqual(["ct2"]);
  });

  // Spec 186 · D3 — hasta acá esta prueba decía lo contrario: «la impresora de
  // una persona no se usa, no es un puesto». Se dio vuelta con la segunda caja
  // de KCC, que la atiende la encargada con su cuenta. Quién puede tener
  // impresora se decide al guardarla, no al imprimir.
  it("la impresora de un encargado SÍ se usa: es el puesto de la segunda caja", async () => {
    agentScope = ["local:CAJA2"];
    controlRows = [ticket({ requested_by: "sofia" })];
    businessUsersRows = [
      {
        user_id: "sofia",
        control_printers: {
          printer_ip: "local:CAJA2",
          printer_port: null,
          is_active: true,
        },
      },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toHaveLength(1);
    expect(body.comandas[0].printer_ip).toBe("local:CAJA2");
  });

  it("una comandera DESACTIVADA no se usa: cae a la del negocio (spec 190)", async () => {
    // Apagarla sin acordarse de a quién se la habías asignado no puede dejar
    // ese papel sin salir: sale por la del local.
    agentScope = [];
    controlRows = [ticket({ requested_by: "sofia" })];
    businessUsersRows = [
      {
        user_id: "sofia",
        control_printers: {
          printer_ip: "local:CAJA2",
          printer_port: null,
          is_active: false,
        },
      },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("192.168.10.60");
  });

  it("un encargado sin impresora propia cae a la del negocio, como siempre", async () => {
    controlRows = [ticket({ requested_by: "sofia" })];
    businessUsersRows = [
      {
        user_id: "sofia",
        control_printers: null,
      },
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

describe("GET · cuenta de mesa pedida por alguien con comandera propia (#342)", () => {
  // Para el local, el «control» es la cuenta de la mesa (el ticket de control
  // de MaxiRest). La USB de la terminal tiene que sacar ESE papel.
  const usb = {
    user_id: "term1",
    control_printers: {
      printer_ip: "local:Control",
      printer_port: null,
      is_active: true,
    },
  };

  beforeEach(() => {
    controlRows = [];
  });

  it("la cuenta que pide la terminal sale por SU comandera", async () => {
    // Un `local:` sólo lo alcanza el agente que lo lista (spec 181 · D3).
    agentScope = ["local:Control"];
    cuentaRows = [cuentaJob({ requested_by: "term1" })];
    businessUsersRows = [usb];
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toHaveLength(1);
    expect(body.comandas[0].printer_ip).toBe("local:Control");
  });

  it("la que pide alguien sin comandera propia sigue saliendo por la del salón", async () => {
    cuentaRows = [cuentaJob({ requested_by: "sofia" })];
    businessUsersRows = [];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("192.168.20.70");
  });

  it("una comandera propia desactivada no se usa: cae a la del salón", async () => {
    cuentaRows = [cuentaJob({ requested_by: "term1" })];
    businessUsersRows = [
      { ...usb, control_printers: { ...usb.control_printers, is_active: false } },
    ];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("192.168.20.70");
  });

  it("sale aunque el salón no tenga comandera de cuentas", async () => {
    // Un `local:` sólo lo alcanza el agente que lo lista (spec 181 · D3).
    agentScope = ["local:Control"];
    const job = cuentaJob({ requested_by: "term1" });
    const orders = job.orders as Row;
    const tables = orders.tables as Row;
    tables.floor_plans = {
      name: "Terraza",
      cuenta_printer_ip: null,
      cuenta_printer_port: null,
      cuenta_printer_enabled: true,
    };
    cuentaRows = [job];
    businessUsersRows = [usb];
    const body = await (await GET(getReq())).json();
    expect(body.comandas[0].printer_ip).toBe("local:Control");
  });

  it("el agente principal (alcance por IP) no se la lleva: es de la terminal", async () => {
    cuentaRows = [cuentaJob({ requested_by: "term1" })];
    businessUsersRows = [usb];
    agentScope = ["192.168.20.0/24"];
    const body = await (await GET(getReq())).json();
    expect(body.comandas).toEqual([]);
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
    const res = await POST(
      postReq({ comanda_id: "nope", business_id: "biz1" }),
    );
    expect(res.status).toBe(404);
  });
});

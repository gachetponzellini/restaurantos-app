import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 061 — la marcha automática con lead por negocio.
 *
 * Dos cosas que este test protege y que no se ven a simple vista:
 *  1. **Qué trae la query.** El `.or()` es la traducción literal de la política
 *     de spec 047 ("imprime solo lo que el local ya avaló"). Si alguien lo
 *     ablanda, un pedido en efectivo sin aceptar entra a cocina solo.
 *  2. **Qué se marcha de lo que trajo.** El `lte` del SQL es a propósito ancho
 *     (el techo del lead configurable); el corte fino es en TS, por pedido.
 */

type DueRow = {
  id: string;
  business_id: string;
  delivery_type: string;
  scheduled_at: string | null;
  kitchen_at?: string | null;
  /** #148 · H-42 */
  march_attempts?: number;
  march_alerted_at?: string | null;
  business: {
    scheduled_march_lead_pickup_min: number | null;
    scheduled_march_lead_delivery_min: number | null;
    scheduled_march_lead_kitchen_min?: number | null;
  } | null;
};

type Captured = {
  select?: string;
  /** Spec 127: ahora hay dos `.or()` — la política de estados y la ventana. */
  ors: string[];
  lte?: [string, string];
  in?: [string, string[]];
};

let rows: DueRow[] = [];
let captured: Captured = { ors: [] };
const routed: string[] = [];

/**
 * Spec 127 — los UPDATE de estado que el cron hace por su cuenta (el encargue
 * de hoy, cuyo papel ya salió). El builder se vuelve "modo update" apenas se
 * llama `.update()`, así el `then` resuelve la fila tocada en vez del listado.
 */
const updates: Record<string, unknown>[] = [];

/** Spec 127: qué contesta el SELECT de `comandas` (el chequeo de terminadas). */
let comandasDelPedido: { status: string; cancelled_at: string | null }[] = [];

function makeFakeService() {
  return {
    from(tabla: string) {
      let esUpdate = false;
      let patch: Record<string, unknown> | null = null;
      const filtros: Record<string, unknown> = {};
      const esComandas = tabla === "comandas";
      const builder = {
        update(p: Record<string, unknown>) {
          esUpdate = true;
          patch = p;
          updates.push(p);
          return builder;
        },
        eq(col: string, val: unknown) {
          filtros[col] = val;
          return builder;
        },
        /** #148 · H-42 — la guarda «todavía no se avisó». */
        is(col: string, val: unknown) {
          filtros[`is:${col}`] = val;
          return builder;
        },
        select(cols: string) {
          captured.select = cols;
          return builder;
        },
        not() {
          return builder;
        },
        in(col: string, vals: string[]) {
          captured.in = [col, vals];
          return builder;
        },
        or(expr: string) {
          captured.ors.push(expr);
          return builder;
        },
        lte(col: string, val: string) {
          captured.lte = [col, val];
          return builder;
        },
        then(resolve: (v: { data: unknown; error: unknown }) => void) {
          // #148 · H-42 — los updates de `orders` quedan en la fila, así la
          // corrida siguiente del cron ve los intentos acumulados.
          if (esUpdate && tabla === "orders" && patch) {
            const fila = rows.find((r) => r.id === filtros.id) as
              | Record<string, unknown>
              | undefined;
            const guarda = filtros["is:march_alerted_at"];
            const pasa =
              !fila || guarda === undefined || (fila.march_alerted_at ?? null) === guarda;
            if (fila && pasa) Object.assign(fila, patch);
            resolve({ data: fila && pasa ? [{ id: fila.id }] : [], error: null });
            return;
          }
          resolve(
            esUpdate
              ? { data: [{ id: "avanzado" }], error: null }
              : esComandas
                ? { data: comandasDelPedido, error: null }
                : { data: rows, error: null },
          );
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => makeFakeService(),
}));

/** Spec 127: los tests que necesitan el camino "ya tenía comandas" lo prenden. */
let yaTeniaComandas = false;
/** #148 · H-42: «falla» devuelve error; «tira» lanza una excepción. */
let ruteo: "ok" | "falla" | "tira" = "ok";
const avisos: { orderId: string; attempts: number }[] = [];

vi.mock("@/lib/notifications/events", () => ({
  notifyMarchaFallida: async (p: { orderId: string; attempts: number }) => {
    avisos.push({ orderId: p.orderId, attempts: p.attempts });
  },
}));

vi.mock("./route-to-cocina", () => ({
  routeOrderToCocina: async (orderId: string) => {
    routed.push(orderId);
    if (ruteo === "tira") throw new Error("boom");
    if (ruteo === "falla") return { ok: false, error: "boom" };
    return {
      ok: true,
      data: {
        order_id: orderId,
        comanda_ids: yaTeniaComandas ? [] : ["c1"],
        items_without_station: 0,
        already_had_comandas: yaTeniaComandas,
      },
    };
  },
}));

const { marchDueScheduledOrders, MARCH_ATTEMPTS_MAX } = await import("./march-scheduled");

// Reloj de referencia: 2026-06-26 20:00 AR.
const NOW = new Date("2026-06-26T20:00:00-03:00");

function row(o: Partial<DueRow> & Pick<DueRow, "id" | "scheduled_at">): DueRow {
  return {
    business_id: "b1",
    delivery_type: "delivery",
    business: {
      scheduled_march_lead_pickup_min: 40,
      scheduled_march_lead_delivery_min: 60,
    },
    ...o,
  };
}

describe("marchDueScheduledOrders", () => {
  beforeEach(() => {
    rows = [];
    captured = { ors: [] };
    routed.length = 0;
    updates.length = 0;
    yaTeniaComandas = false;
    ruteo = "ok";
    avisos.length = 0;
    comandasDelPedido = [{ status: "pendiente", cancelled_at: null }];
  });

  it("solo pide pagados-sin-tocar o aceptados (política de spec 047)", async () => {
    await marchDueScheduledOrders(NOW);
    expect(captured.ors).toContain(
      "and(status.eq.pending,payment_status.eq.paid),status.eq.confirmed",
    );
    // Un `pending` impago no matchea ninguna de las dos ramas.
    expect(captured.ors.join(" ")).not.toContain(
      "status.eq.pending,payment_status.eq.pending",
    );
  });

  it("no trae pedidos en mesa y acota la ventana con el techo del lead", async () => {
    await marchDueScheduledOrders(NOW);
    expect(captured.in).toEqual(["delivery_type", ["pickup", "delivery"]]);
    // Spec 127 — la ventana mira las DOS horas: la de cocina cuando está, y la
    // del pedido sólo cuando no. Cada rama por su lado para que use su índice.
    const ventana = captured.ors.find((o) => o.includes("kitchen_at"))!;
    expect(ventana).toBeDefined();
    const cutoff = ventana.match(/kitchen_at\.lte\.([^,]+)/)![1];
    // 240 min = MAX_MARCH_LEAD_MIN.
    expect(new Date(cutoff).getTime() - NOW.getTime()).toBe(240 * 60_000);
    expect(ventana).toContain("and(kitchen_at.is.null,scheduled_at.lte.");
  });

  it("trae los dos leads del negocio en el join", async () => {
    await marchDueScheduledOrders(NOW);
    expect(captured.select).toContain("scheduled_march_lead_pickup_min");
    expect(captured.select).toContain("scheduled_march_lead_delivery_min");
    expect(captured.select).toContain("scheduled_march_lead_kitchen_min");
  });

  it("un delivery con lead 60 marcha a T−60 pero no a T−61", async () => {
    // T = 21:00. A las 20:00 faltan exactamente 60 → marcha.
    rows = [row({ id: "justo", scheduled_at: "2026-06-26T21:00:00-03:00" })];
    expect((await marchDueScheduledOrders(NOW)).marched).toBe(1);

    routed.length = 0;
    // T = 21:01 → faltan 61 → todavía no.
    rows = [row({ id: "temprano", scheduled_at: "2026-06-26T21:01:00-03:00" })];
    const res = await marchDueScheduledOrders(NOW);
    expect(res.marched).toBe(0);
    expect(res.considered).toBe(0);
  });

  it("en el mismo tick, retiro y delivery cortan distinto", async () => {
    // Los dos para las 20:50 (faltan 50 min). Delivery (lead 60) entra; retiro
    // (lead 40) todavía no.
    rows = [
      row({ id: "del", scheduled_at: "2026-06-26T20:50:00-03:00" }),
      row({
        id: "pick",
        delivery_type: "pickup",
        scheduled_at: "2026-06-26T20:50:00-03:00",
      }),
    ];
    await marchDueScheduledOrders(NOW);
    expect(routed).toEqual(["del"]);
  });

  it("dos negocios con leads distintos se resuelven cada uno con el suyo", async () => {
    rows = [
      row({
        id: "house",
        scheduled_at: "2026-06-26T21:30:00-03:00",
        business: {
          scheduled_march_lead_pickup_min: 40,
          scheduled_march_lead_delivery_min: 90, // faltan 90 → justo entra
        },
      }),
      row({
        id: "golf",
        business_id: "b2",
        scheduled_at: "2026-06-26T21:30:00-03:00",
        business: {
          scheduled_march_lead_pickup_min: 40,
          scheduled_march_lead_delivery_min: 60, // faltan 90 > 60 → no
        },
      }),
    ];
    await marchDueScheduledOrders(NOW);
    expect(routed).toEqual(["house"]);
  });

  it("`considered` cuenta los que entraron en ventana, no los que trajo la query", async () => {
    rows = [
      row({ id: "entra", scheduled_at: "2026-06-26T20:30:00-03:00" }),
      row({ id: "no-entra", scheduled_at: "2026-06-26T23:00:00-03:00" }),
    ];
    const res = await marchDueScheduledOrders(NOW);
    expect(res).toEqual({
      considered: 1,
      marched: 1,
      failed: 0,
      // spec 093 — el cron deja de descartar estos dos: un pedido que "marchó"
      // sin que saliera un papel en cocina era indistinguible de uno sano.
      withoutComanda: 0,
      controlFailed: 0,
      // spec 127 — el encargue de hoy llega acá con la comanda ya impresa y lo
      // único que se le hace es avanzar el estado. Éste marchó completo.
      advancedOnly: 0,
      // #148 · H-42 — ninguno llegó al techo de reintentos.
      gaveUp: 0,
    });
  });

  // ── Spec 127 · el encargue de hoy: el papel ya salió, falta el kanban ──
  it("al encargue que ya imprimió su comanda sólo le avanza el estado", async () => {
    yaTeniaComandas = true;
    rows = [
      row({
        id: "hoy",
        scheduled_at: "2026-06-26T21:00:00-03:00",
        kitchen_at: "2026-06-26T20:30:00-03:00",
        business: {
          scheduled_march_lead_pickup_min: 40,
          scheduled_march_lead_delivery_min: 60,
          scheduled_march_lead_kitchen_min: 40,
        },
      }),
    ];
    // Marcha a 20:30 − 40 = 19:50, o sea que a las 20:00 ya está en ventana.
    const res = await marchDueScheduledOrders(NOW);
    expect(res.considered).toBe(1);
    expect(res.advancedOnly).toBe(1);
    expect(updates).toEqual([{ status: "preparing" }]);
  });

  it("no lo baja a Preparando si cocina ya lo terminó", async () => {
    // El papel salió a las 18:00 y cocina lo despachó a las 19:00; a las 20:35
    // el pedido sigue en `confirmed` porque ningún gesto de cocina mueve
    // `orders.status` (ejes independientes, spec 091). Avanzarlo ahí diría que
    // recién se empieza a preparar algo que ya está hecho.
    yaTeniaComandas = true;
    comandasDelPedido = [{ status: "entregado", cancelled_at: null }];
    rows = [
      row({
        id: "ya-hecho",
        scheduled_at: "2026-06-26T21:00:00-03:00",
        kitchen_at: "2026-06-26T20:30:00-03:00",
        business: {
          scheduled_march_lead_pickup_min: 40,
          scheduled_march_lead_delivery_min: 60,
          scheduled_march_lead_kitchen_min: 40,
        },
      }),
    ];
    const res = await marchDueScheduledOrders(NOW);
    expect(res.advancedOnly).toBe(0);
    expect(updates).toEqual([]);
  });

  it("al programado que todavía no imprimió no le toca el estado a mano", async () => {
    // Camino de siempre: `routeOrderToCocina` crea las comandas Y avanza.
    rows = [row({ id: "manana", scheduled_at: "2026-06-26T21:00:00-03:00" })];
    const res = await marchDueScheduledOrders(NOW);
    expect(res.marched).toBe(1);
    expect(res.advancedOnly).toBe(0);
    expect(updates).toEqual([]);
  });

  it("cuenta hacia atrás desde la hora de cocina, no desde la del pedido", async () => {
    // Listo 21:15, entrega 23:00 — el viaje es largo. Con lead de cocina 40, la
    // marcha es 20:35. A las 20:00 (NOW) todavía no.
    rows = [
      row({
        id: "cocina",
        scheduled_at: "2026-06-26T23:00:00-03:00",
        kitchen_at: "2026-06-26T21:15:00-03:00",
        business: {
          scheduled_march_lead_pickup_min: 40,
          scheduled_march_lead_delivery_min: 60,
          scheduled_march_lead_kitchen_min: 40,
        },
      }),
    ];
    expect((await marchDueScheduledOrders(NOW)).considered).toBe(0);

    // A las 20:35 sí.
    const alas2035 = new Date("2026-06-26T20:35:00-03:00");
    expect((await marchDueScheduledOrders(alas2035)).considered).toBe(1);
  });

  // ── #148 · H-42 · el programado que falla siempre ──────────────────────
  describe("un pedido que falla siempre al marchar (H-42)", () => {
    const vencido = () =>
      row({ id: "malo", scheduled_at: "2026-06-26T20:30:00-03:00" });

    it("cuenta cada intento fallido en la orden", async () => {
      ruteo = "falla";
      rows = [vencido()];
      const res = await marchDueScheduledOrders(NOW);
      expect(res.failed).toBe(1);
      expect(rows[0].march_attempts).toBe(1);
    });

    it("una excepción también cuenta como intento fallido", async () => {
      ruteo = "tira";
      rows = [vencido()];
      await marchDueScheduledOrders(NOW);
      expect(rows[0].march_attempts).toBe(1);
    });

    it("al llegar al techo deja de reintentar y avisa UNA sola vez", async () => {
      ruteo = "falla";
      rows = [vencido()];
      for (let i = 0; i < MARCH_ATTEMPTS_MAX; i++) {
        await marchDueScheduledOrders(NOW);
      }
      expect(routed).toHaveLength(MARCH_ATTEMPTS_MAX);
      expect(avisos).toEqual([]);

      // Tick siguiente: ya no lo toca y avisa.
      const res = await marchDueScheduledOrders(NOW);
      expect(routed).toHaveLength(MARCH_ATTEMPTS_MAX);
      expect(res).toMatchObject({ considered: 1, marched: 0, failed: 0, gaveUp: 1 });
      expect(avisos).toEqual([{ orderId: "malo", attempts: MARCH_ATTEMPTS_MAX }]);
      expect(rows[0].march_alerted_at).toBeTruthy();

      // Y el siguiente no vuelve a avisar.
      await marchDueScheduledOrders(NOW);
      expect(avisos).toHaveLength(1);
      expect(routed).toHaveLength(MARCH_ATTEMPTS_MAX);
    });

    it("si ya se avisó (otro tick ganó la guarda), no avisa de nuevo", async () => {
      rows = [
        { ...vencido(), march_attempts: MARCH_ATTEMPTS_MAX, march_alerted_at: "2026-06-26T19:00:00-03:00" },
      ];
      const res = await marchDueScheduledOrders(NOW);
      expect(res.gaveUp).toBe(1);
      expect(avisos).toEqual([]);
      expect(routed).toEqual([]);
    });

    it("un pedido sano no toca los contadores", async () => {
      rows = [vencido()];
      await marchDueScheduledOrders(NOW);
      expect(rows[0].march_attempts).toBeUndefined();
      expect(updates).toEqual([]);
    });

    it("trae los contadores en el select", async () => {
      await marchDueScheduledOrders(NOW);
      expect(captured.select).toContain("march_attempts");
      expect(captured.select).toContain("march_alerted_at");
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 176 — el papel de prueba de comandera viajando por el endpoint.
 *
 * Lo que se protege: la prueba sale por el MISMO array `comandas` que todo lo
 * demás (el .exe del local no se toca), con la IP tipeada en la fila y no con
 * la que esté configurada; y una prueba vieja no aparece media hora después en
 * medio del servicio.
 */

type Row = Record<string, unknown>;

let pruebaRows: Row[];
let pruebaPostRow: Row | null;
let capturedGte: { col: string; val: unknown }[];
let captured: { table: string; vals: Record<string, unknown> }[];

vi.mock("@/lib/notifications/events", () => ({
  notifyPrintFailed: async () => {},
}));

vi.mock("@/lib/print-agent/credentials", () => ({
  listPrintAgentCredentials: async (businessId: string) =>
    businessId === "biz1"
      ? [{ id: "agente-biz1", apiKey: "test-key", label: null, printerScope: null }]
      : [],
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => {
        let kind: string | null = null;
        const b = {
          eq: (col: string, val: unknown) => {
            if (col === "kind") kind = String(val);
            return b;
          },
          gte: (col: string, val: unknown) => {
            capturedGte.push({ col, val });
            return b;
          },
          or: () => b,
          order: () => b,
          // `businesses` null y `comandas` null: se aísla el camino de la prueba.
          maybeSingle: async () => ({
            data: table === "print_jobs" ? pruebaPostRow : null,
          }),
          then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
            resolve({
              data:
                table === "print_jobs" && kind === "prueba" ? pruebaRows : [],
              error: null,
            }),
        };
        return b;
      },
      update: (vals: Record<string, unknown>) => ({
        eq: () => {
          captured.push({ table, vals });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

const { GET, POST } = await import("./route");

const AUTH = { authorization: "Bearer test-key" };

function job(over: Row = {}): Row {
  return {
    id: "pj1",
    emitted_at: "2026-09-09T21:30:00.000Z",
    test_printer_ip: "192.168.10.55",
    test_printer_port: 9100,
    test_label: "Parrilla",
    users: { full_name: "Sofía Núñez" },
    businesses: { name: "Restaurante Demo" },
    ...over,
  };
}

beforeEach(() => {
  pruebaRows = [job()];
  pruebaPostRow = null;
  capturedGte = [];
  captured = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET · papel de prueba", () => {
  it("sale con la IP de la fila y el contenido ya renderizado", async () => {
    const body = await (
      await GET(
        new Request("http://x/api/print-agent?business_id=biz1&wait_ms=0", {
          headers: AUTH,
        }),
      )
    ).json();

    expect(body.comandas).toHaveLength(1);
    const c = body.comandas[0];
    expect(c.comanda_id).toBe("pj1");
    expect(c.printer_ip).toBe("192.168.10.55");
    expect(c.station_name).toBe("PRUEBA · Parrilla");
    expect(c.content_plain).toContain("PRUEBA");
    expect(c.content_plain).toContain("192.168.10.55:9100");
    expect(c.content_escpos_b64.length).toBeGreaterThan(0);
  });

  it("sólo pide las pruebas de los últimos minutos", async () => {
    await GET(
      new Request("http://x/api/print-agent?business_id=biz1&wait_ms=0", {
        headers: AUTH,
      }),
    );
    const ventana = capturedGte.find((g) => g.col === "emitted_at");
    expect(ventana).toBeTruthy();
    const edad = Date.now() - new Date(String(ventana!.val)).getTime();
    expect(edad).toBeGreaterThan(0);
    expect(edad).toBeLessThanOrEqual(6 * 60_000);
  });

  it("una fila sin IP no se le entrega al agente", async () => {
    pruebaRows = [job({ test_printer_ip: "  " })];
    const body = await (
      await GET(
        new Request("http://x/api/print-agent?business_id=biz1&wait_ms=0", {
          headers: AUTH,
        }),
      )
    ).json();
    expect(body.comandas).toHaveLength(0);
  });
});

describe("POST · el resultado de la prueba", () => {
  const postReq = (body: Record<string, unknown>) =>
    new Request("http://x/api/print-agent", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("guarda el motivo del fallo, no sólo el timestamp", async () => {
    pruebaPostRow = {
      id: "pj1",
      business_id: "biz1",
      status: "pendiente",
      print_failed_at: null,
      reprint_requested_at: null,
    };
    await POST(
      postReq({
        comanda_id: "pj1",
        business_id: "biz1",
        result: "failed",
        error: "connect ECONNREFUSED 192.168.10.55:9100",
      }),
    );
    const upd = captured.find((u) => u.table === "print_jobs");
    expect(upd?.vals.last_error).toBe(
      "connect ECONNREFUSED 192.168.10.55:9100",
    );
    expect(upd?.vals.print_failed_at).toBeTruthy();
  });

  it("al imprimir bien la marca impresa y limpia el motivo", async () => {
    pruebaPostRow = {
      id: "pj1",
      business_id: "biz1",
      status: "pendiente",
      print_failed_at: "2026-09-09T21:00:00.000Z",
      reprint_requested_at: null,
    };
    await POST(postReq({ comanda_id: "pj1", business_id: "biz1", result: "ok" }));
    const upd = captured.find((u) => u.table === "print_jobs");
    expect(upd?.vals.status).toBe("impreso");
    expect(upd?.vals.last_error).toBeNull();
  });
});

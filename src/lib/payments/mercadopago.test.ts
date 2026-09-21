// #148 · H-20 — el reintento sin vencimiento sólo si MP rechazó el vencimiento.
//
// Revisión adversarial: con un catch genérico, un timeout en el que MP sí creó
// la preferencia disparaba una segunda SIN vencimiento, y era la que se
// guardaba — justo lo que el barrido de impagos necesita que no pase.
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {},
  Preference: class {
    create = create;
  },
  Payment: class {},
}));

const { createPreference, pagoEnCursoPorReferencia } = await import("./mercadopago");

const args = {
  accessToken: "APP_USR-x",
  siteUrl: "https://restaurant.mithandir.com",
  businessSlug: "kcc",
  businessId: "b1",
  orderId: "o1",
  orderNumber: 7,
  items: [{ id: "p1", title: "Milanesa", quantity: 1, unit_price: 10_000 }],
};
const ok = { id: "pref-1", init_point: "https://mp/1", sandbox_init_point: null };

beforeEach(() => create.mockReset());

describe("createPreference · vencimiento", () => {
  it("manda el vencimiento en la preferencia", async () => {
    create.mockResolvedValueOnce(ok);
    await createPreference(args as never);
    const body = create.mock.calls[0][0].body;
    expect(body.expires).toBe(true);
    expect(body.expiration_date_to).toMatch(/-03:00$/);
    expect(body.date_of_expiration).toMatch(/-03:00$/);
  });

  it("un error cualquiera (timeout, 5xx) NO reintenta: falla como antes", async () => {
    create.mockRejectedValueOnce(new Error("timeout of 8000ms exceeded"));
    await expect(createPreference(args as never)).rejects.toThrow(/timeout/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("un 400 que rechaza el vencimiento reintenta una vez sin él", async () => {
    create
      .mockRejectedValueOnce({
        status: 400,
        message: "invalid expiration_date_to",
        cause: [{ code: 4001, description: "expiration_date_to invalid format" }],
      })
      .mockResolvedValueOnce(ok);
    const r = await createPreference(args as never);
    expect(r.preferenceId).toBe("pref-1");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].body.expires).toBeUndefined();
  });

  it("un 400 por otra cosa no reintenta", async () => {
    create.mockRejectedValueOnce({ status: 400, message: "invalid unit_price" });
    await expect(createPreference(args as never)).rejects.toMatchObject({ status: 400 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("acepta un vencimiento explícito para el reintento (#368)", async () => {
    create.mockResolvedValueOnce(ok);
    const venceEl = new Date("2026-09-21T15:20:00Z");
    await createPreference({ ...args, venceEl } as never);
    expect(create.mock.calls[0][0].body.expiration_date_to).toBe(
      "2026-09-21T12:20:00.000-03:00",
    );
  });
});

// Auditoría de pedidos · MEDIA — el reintento no puede abrir un segundo cobro
// mientras el primero sigue en proceso (un cupón de Rapipago, un in_process).
describe("pagoEnCursoPorReferencia", () => {
  const conResultados = (results: { id: string; status: string }[]) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ results }), { status: 200 }),
    );

  it("un pago aprobado manda", async () => {
    conResultados([{ id: "1", status: "rejected" }, { id: "2", status: "approved" }]);
    expect(await pagoEnCursoPorReferencia("tok", "o1")).toBe("aprobado");
  });

  it("pending / in_process / authorized cuentan como en proceso", async () => {
    for (const status of ["pending", "in_process", "authorized"]) {
      conResultados([{ id: "1", status }]);
      expect(await pagoEnCursoPorReferencia("tok", "o1")).toBe("en_proceso");
    }
  });

  it("sólo rechazados o cancelados: nada en curso", async () => {
    conResultados([{ id: "1", status: "rejected" }, { id: "2", status: "cancelled" }]);
    expect(await pagoEnCursoPorReferencia("tok", "o1")).toBeNull();
  });

  it("si MP no contesta, no bloquea (null) — se loguea", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await pagoEnCursoPorReferencia("tok", "o1")).toBeNull();
  });
});

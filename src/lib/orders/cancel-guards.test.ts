import { beforeEach, describe, expect, it } from "vitest";

import { bloqueoPorPlata } from "./cancel-guards";

/**
 * Spec 092 — anular no puede pasar por encima de plata ya movida.
 *
 * Lo que se fija acá es el **criterio**, no la query: cuándo se bloquea, con
 * qué prioridad y con qué mensaje. El mensaje importa porque es lo único que
 * el encargado va a leer en hora pico, y tiene que decirle qué hacer.
 */

let pagos: { amount_cents: number }[];
let facturas: { status: string; provider?: string }[];

function fakeService() {
  return {
    from(table: string) {
      const rows = table === "payments" ? pagos : facturas;
      const builder = {
        select: () => builder,
        in: () => builder,
        eq: () => builder,
        then: (resolve: (v: { data: unknown }) => void) =>
          resolve({ data: rows }),
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  pagos = [];
  facturas = [];
});

describe("bloqueoPorPlata", () => {
  it("deja anular una mesa sin pagos ni facturas", async () => {
    expect(await bloqueoPorPlata(fakeService(), ["o1"])).toBeNull();
  });

  it("no consulta nada si no hay órdenes", async () => {
    expect(await bloqueoPorPlata(fakeService(), [])).toBeNull();
  });

  it("bloquea si hay plata cobrada, y dice cuánta", async () => {
    // El encargado tiene que poder decidir sin ir a buscar el número a otra
    // pantalla: uno de la mesa pagó y el grupo se fue.
    pagos = [{ amount_cents: 12000 }, { amount_cents: 8000 }];
    const msg = await bloqueoPorPlata(fakeService(), ["o1"]);
    expect(msg).toContain("200"); // $200,00 = 12000 + 8000 centavos
    expect(msg).toMatch(/anulá el cobro primero/i);
  });

  it("bloquea con una factura AUTORIZADA y manda a la nota de crédito", async () => {
    // El CAE ya existe: no hay forma de deshacerlo, sólo compensarlo.
    facturas = [{ status: "authorized" }];
    const msg = await bloqueoPorPlata(fakeService(), ["o1"]);
    expect(msg).toMatch(/nota de crédito/i);
  });

  it("bloquea con una factura EN CURSO, y el mensaje es otro", async () => {
    // Todavía no hay CAE: la salida no es una NC, es esperar. El gateway tarda
    // ~28 min de promedio y hasta 85 en el peor caso.
    facturas = [{ status: "pending" }];
    const msg = await bloqueoPorPlata(fakeService(), ["o1"]);
    expect(msg).toMatch(/en curso/i);
    expect(msg).not.toMatch(/nota de crédito/i);
  });

  it("la plata cobrada tiene prioridad sobre la factura", async () => {
    // Si están las dos cosas, el primer paso es siempre deshacer el cobro.
    pagos = [{ amount_cents: 5000 }];
    facturas = [{ status: "authorized" }];
    expect(await bloqueoPorPlata(fakeService(), ["o1"])).toMatch(
      /anulá el cobro primero/i,
    );
  });

  it("una factura de SANDBOX no frena: no es fiscal (spec 215 · D4)", async () => {
    // En KCC todas las mesas cobradas tienen una B de sandbox hasta que ARCA
    // esté activo: si frenara, no se podría anular ninguna.
    facturas = [{ status: "authorized", provider: "sandbox" }];
    expect(await bloqueoPorPlata(fakeService(), ["o1"])).toBeNull();
  });

  it("una real sigue frenando aunque haya otra de sandbox", async () => {
    facturas = [
      { status: "authorized", provider: "sandbox" },
      { status: "authorized", provider: "gateway" },
    ];
    expect(await bloqueoPorPlata(fakeService(), ["o1"])).toMatch(/nota de crédito/i);
  });
});

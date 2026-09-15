import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitControlTicket } from "./control-ticket-emit";

/**
 * Spec 063 — emisión del control de pedido. Lo que importa: sale para lo que
 * se lleva del local, NO sale para mesa, y no se duplica por más veces que se
 * marche el mismo pedido.
 *
 * ⚠️ **Este archivo no puede probar que el insert ande.** Su fake nunca toca
 * Postgres, y por eso no detectó que el `upsert({ onConflict: "order_id" })`
 * anterior devolvía `42P10` contra el índice **parcial** — el control no se
 * emitió durante días sin que nada se pusiera rojo. La prueba de que la
 * sentencia entra en la base vive en `control-ticket-emit.integration.test.ts`.
 * Acá se prueban las **ramas de negocio**: a quién le corresponde papel y qué
 * se considera fallo.
 */

type OrderRow = { business_id: string; delivery_type: string } | null;

let orderRow: OrderRow;
let existingCount: number;
let inserts: Record<string, unknown>[];
let insertError: { message: string; code?: string } | null;

/** Fake del service client: `orders.select`, el conteo previo y el insert. */
function fakeService() {
  return {
    from(table: string) {
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          // `print_jobs`: el pre-chequeo de "¿ya existe el control?".
          if (table === "print_jobs" && opts?.head) {
            return {
              eq: () => ({
                eq: async () => ({ count: existingCount }),
              }),
            };
          }
          return {
            eq: () => ({ maybeSingle: async () => ({ data: orderRow }) }),
          };
        },
        insert: async (row: Record<string, unknown>) => {
          if (table === "print_jobs") inserts.push(row);
          return { error: insertError };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  orderRow = { business_id: "biz1", delivery_type: "delivery" };
  existingCount = 0;
  inserts = [];
  insertError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("emitControlTicket", () => {
  it("emite para delivery", async () => {
    const res = await emitControlTicket(fakeService(), "o1", "biz1");
    expect(res).toEqual({ emitted: true, failed: false });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      order_id: "o1",
      business_id: "biz1",
      kind: "control",
      // Spec 186 · D2 — el ruteo no tiene persona detrás (a veces es el cron),
      // así que el control de delivery sigue yendo a la del negocio.
      requested_by: null,
    });
  });

  it("con un pedidor, el papel queda estampado a su nombre (spec 186 · D2)", async () => {
    const res = await emitControlTicket(fakeService(), "o1", "biz1", "sofia");
    expect(res).toEqual({ emitted: true, failed: false });
    expect(inserts[0]).toMatchObject({ requested_by: "sofia" });
  });

  it("emite para retiro", async () => {
    orderRow = { business_id: "biz1", delivery_type: "pickup" };
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: true,
      failed: false,
    });
  });

  it("NO emite para un pedido de mesa / venta de mostrador, y eso no es un fallo", async () => {
    orderRow = { business_id: "biz1", delivery_type: "dine_in" };
    const res = await emitControlTicket(fakeService(), "o1", "biz1");
    expect(res).toEqual({ emitted: false, failed: false });
    expect(inserts).toEqual([]);
  });

  it("si el control ya existe no inserta de nuevo, y tampoco es un fallo", async () => {
    // El camino normal de la re-marcha: reintento del cron, ticks solapados,
    // «Marchar ahora» sobre algo que el cron ya tomó.
    existingCount = 1;
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: false,
      failed: false,
    });
    expect(inserts).toEqual([]);
  });

  it("una carrera contra el índice único (23505) tampoco es un fallo", async () => {
    // El pre-chequeo dijo que no existía, pero entre medio otro lo creó. El
    // desenlace es el correcto —hay un control y sólo uno—, así que no se
    // reporta como error ni se ensucia el log.
    insertError = { message: "duplicate key", code: "23505" };
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: false,
      failed: false,
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("no emite si el pedido no existe, y lo marca como fallo", async () => {
    orderRow = null;
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: false,
      failed: true,
    });
    expect(inserts).toEqual([]);
  });

  it("no emite si el pedido es de otro negocio (defensa cross-tenant)", async () => {
    orderRow = { business_id: "biz2", delivery_type: "delivery" };
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: false,
      failed: true,
    });
    expect(inserts).toEqual([]);
  });

  it("un error real de la DB se reporta como fallo, sin tirar", async () => {
    // Es la señal que viaja hasta `control_failed` y llega al board: acá SÍ
    // falta el papel y hay que ir a buscarlo.
    insertError = { message: "boom", code: "42P10" };
    expect(await emitControlTicket(fakeService(), "o1", "biz1")).toEqual({
      emitted: false,
      failed: true,
    });
    expect(console.error).toHaveBeenCalled();
  });
});

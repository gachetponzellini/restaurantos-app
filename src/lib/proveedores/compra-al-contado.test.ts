import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BusinessRole } from "@/lib/admin/context";

/**
 * Cargar la compra ya pagada — spec 187.
 *
 * *«En la misma carga debería estar la opción de pago. Efectivo o cta cte»* —
 * Rocío, encargada del Golf, 2026-09-15.
 *
 * Lo que se fija acá es el orden, que es toda la decisión:
 *
 *   1 · las guardas del efectivo corren ANTES de crear el comprobante (D2), así
 *       que un «no» deja el formulario intacto en vez de una compra a medias;
 *   2 · el pago va DESPUÉS de los renglones, porque si los renglones fallan el
 *       comprobante ya se anuló solo (165·D3) y pagar uno anulado es lo que la
 *       RPC rechaza;
 *   3 · si el pago falla, el comprobante **queda** (D3) — no se anula una compra
 *       buena para dejar la pantalla prolija.
 *
 * Se mockea el borde (tenant, auth, la caja administrativa y el service client)
 * y se afirma sobre lo que la action escribe, igual que
 * `pago-caja-administrativa.test.ts` de la 160.
 */

const BIZ = "biz-1";
const SUPPLIER = "00000000-0000-4000-8000-000000000001";
const CAJA_ADMIN = "11111111-1111-4111-8111-111111111111";
const INGREDIENTE = "33333333-3333-4333-8333-333333333333";

let role: BusinessRole;
let cajaAdmin: { id: string; name: string; is_active: boolean } | null;

/** Todo lo insertado, por tabla, en orden. */
let inserts: Record<string, Record<string, unknown>[]>;
/** Todo lo actualizado, por tabla — acá se ve si el comprobante se anuló. */
let updates: Record<string, Record<string, unknown>[]>;
/** Las llamadas a RPC, en orden. */
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
/** Qué RPC tiene que fallar, para el caso en que el pago revienta. */
let rpcQueFalla: string | null;

vi.mock("@/lib/mozo/auth", () => ({
  requireMozoActionContext: async () => ({
    ok: true as const,
    data: { userId: "u1", role, isPlatformAdmin: false },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/caja/queries", () => ({
  getCajaAdministrativa: async () => cajaAdmin,
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === rpcQueFalla) {
        return { data: null, error: { message: "boom", code: "P0001" } };
      }
      return { data: [{ payment_id: "pago-nuevo", caja_movimiento_id: "mov-nuevo" }], error: null };
    },
    from: (tabla: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
          const filas = Array.isArray(row) ? row : [row];
          inserts[tabla] = [...(inserts[tabla] ?? []), ...filas];
          return chain;
        },
        update: (row: Record<string, unknown>) => {
          updates[tabla] = [...(updates[tabla] ?? []), row];
          return chain;
        },
        single: async () => ({ data: { id: `${tabla}-nuevo` }, error: null }),
        maybeSingle: async () => {
          if (tabla === "businesses") return { data: { id: BIZ }, error: null };
          if (tabla === "suppliers") {
            return {
              data: {
                id: SUPPLIER,
                name: "Verdulería del Sur",
                default_expense_concept_id: null,
                payment_terms_days: 7,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

const { createSupplierInvoice } = await import("./actions");

beforeEach(() => {
  role = "encargado";
  cajaAdmin = { id: CAJA_ADMIN, name: "Caja Mayor", is_active: true };
  inserts = {};
  updates = {};
  rpcCalls = [];
  rpcQueFalla = null;
});

const pagoEscrito = () => rpcCalls.find((c) => c.fn === "registrar_pago_proveedor_tx")?.args;
const comprobantesCreados = () => inserts["supplier_invoices"] ?? [];

const cargar = (over: Record<string, unknown> = {}) =>
  createSupplierInvoice("demo", {
    supplier_id: SUPPLIER,
    invoice_date: "2026-09-15",
    total_cents: 482_100_00,
    document_type: "interno",
    ...over,
  });

describe("createSupplierInvoice · en cuenta corriente (lo de siempre)", () => {
  it("sin decir nada, no se paga nada", async () => {
    const r = await cargar();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pago).toBe("no_aplica");
    expect(comprobantesCreados()).toHaveLength(1);
    expect(pagoEscrito()).toBeUndefined();
  });

  it("no toca la caja aunque no haya Caja Mayor", async () => {
    cajaAdmin = null;
    const r = await cargar();

    expect(r.ok).toBe(true);
    expect(comprobantesCreados()).toHaveLength(1);
  });
});

describe("createSupplierInvoice · al contado (spec 187)", () => {
  it("el efectivo sale de la Caja Mayor, imputado al comprobante recién creado", async () => {
    const r = await cargar({ payment_condition: "contado", payment_method: "cash" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pago).toBe("registrado");

    const args = pagoEscrito();
    expect(args?.p_caja_id).toBe(CAJA_ADMIN);
    expect(args?.p_amount_cents).toBe(482_100_00);
    expect(args?.p_method).toBe("cash");
    expect(args?.p_caja_reason).toBe("Pago a proveedor · Verdulería del Sur");
    // Imputado al comprobante, por el total: contado es por el total o no es.
    expect(args?.p_imputaciones).toEqual([
      { invoice_id: "supplier_invoices-nuevo", amount_cents: 482_100_00 },
    ]);
  });

  /**
   * D4 · el pago se fecha contra el papel; el movimiento de caja lo estampa la
   * RPC con `now()`. Son dos hechos distintos: la Caja Mayor se entera hoy.
   */
  it("el pago lleva la fecha del comprobante", async () => {
    await cargar({
      invoice_date: "2026-09-10",
      payment_condition: "contado",
      payment_method: "cash",
    });

    expect(pagoEscrito()?.p_paid_at).toBe("2026-09-10");
  });

  it("por transferencia no se toca la caja", async () => {
    const r = await cargar({ payment_condition: "contado", payment_method: "transfer" });

    expect(r.ok).toBe(true);
    const args = pagoEscrito();
    expect(args?.p_caja_id).toBeNull();
    expect(args?.p_method).toBe("transfer");
  });

  it("sin Caja Mayor, el efectivo falla ANTES de crear el comprobante", async () => {
    cajaAdmin = null;
    const r = await cargar({ payment_condition: "contado", payment_method: "cash" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Caja Mayor/);
    // Lo que fija la D2: el formulario queda intacto, no a medias.
    expect(comprobantesCreados()).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("con la Caja Mayor inactiva, tampoco", async () => {
    cajaAdmin = { id: CAJA_ADMIN, name: "Caja Mayor", is_active: false };
    const r = await cargar({ payment_condition: "contado", payment_method: "cash" });

    expect(r.ok).toBe(false);
    expect(comprobantesCreados()).toHaveLength(0);
  });

  it("un rol sin permiso de sangría no saca efectivo por esta puerta", async () => {
    role = "mozo";
    const r = await cargar({ payment_condition: "contado", payment_method: "cash" });

    expect(r.ok).toBe(false);
    expect(comprobantesCreados()).toHaveLength(0);
  });

  /**
   * D3 · el comprobante sin pago es un estado VÁLIDO —es la cuenta corriente—,
   * y anularlo obligaría además a revertir los renglones que ya entraron.
   */
  it("si el pago falla, el comprobante queda y se dice", async () => {
    rpcQueFalla = "registrar_pago_proveedor_tx";
    const r = await cargar({ payment_condition: "contado", payment_method: "cash" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.pago).toBe("pendiente");
    expect(comprobantesCreados()).toHaveLength(1);
    // Nadie lo anuló.
    expect(updates["supplier_invoices"] ?? []).toHaveLength(0);
  });

  it("el pago va después de los renglones", async () => {
    await cargar({
      payment_condition: "contado",
      payment_method: "cash",
      items: [
        {
          ingredient_id: INGREDIENTE,
          presentation_id: null,
          units: 2,
          unit_cost_cents: 1_000_00,
        },
      ],
    });

    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "registrar_items_comprobante_tx",
      "registrar_pago_proveedor_tx",
    ]);
  });

  it("si fallan los renglones no se paga nada: el comprobante ya se anuló", async () => {
    rpcQueFalla = "registrar_items_comprobante_tx";
    const r = await cargar({
      payment_condition: "contado",
      payment_method: "cash",
      items: [
        {
          ingredient_id: INGREDIENTE,
          presentation_id: null,
          units: 2,
          unit_cost_cents: 1_000_00,
        },
      ],
    });

    expect(r.ok).toBe(false);
    expect(pagoEscrito()).toBeUndefined();
    expect(updates["supplier_invoices"]?.[0]).toMatchObject({
      cancelled_reason: "Revertido: falló la carga del detalle por insumo",
    });
  });
});

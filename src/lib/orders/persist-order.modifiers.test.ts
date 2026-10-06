import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistableOrderInput } from "./schema";

// QA #382 · H-01 — `persistOrder` tiene que validar en el server los
// `modifier_ids` de cada línea de producto contra los grupos de ESE producto.
//
// Antes sólo se miraba que el adicional existiera, fuera del negocio y estuviera
// disponible. Capturando el `createOrder` de Tallarines y reenviándolo con el
// payload tocado entraron los pedidos #85–#88 de la auditoría:
//   #85 sin la salsa obligatoria · #86 con la salsa de Ñoquis (+$14.500)
//   #87 el mismo adicional ×3 (+$1.350) · #88 dos salsas en un grupo de máx. 1.
// Esta suite fija esos cuatro casos (más los caminos válidos, que no cambian
// de precio). Fake por tabla, como `persist-order.dine-in.test.ts`.

const BIZ = {
  id: "biz1",
  slug: "golf",
  timezone: "America/Argentina/Buenos_Aires",
  delivery_fee_cents: 0,
  min_order_cents: 0,
  mp_access_token: null,
  mp_accepts_payments: false,
};

const TALLARINES = "00000000-0000-4000-8000-0000000000a1";
const NOQUIS = "00000000-0000-4000-8000-0000000000a2";
const SODA = "00000000-0000-4000-8000-0000000000a3";

const G_SALSA = "00000000-0000-4000-8000-0000000000b1"; // Tallarines · obligatorio 1–1
const G_EXTRA = "00000000-0000-4000-8000-0000000000b2"; // Tallarines · opcional 0–3
const G_NOQUIS = "00000000-0000-4000-8000-0000000000b3"; // Ñoquis · obligatorio 1–1

const S_BOLOGNESA = "00000000-0000-4000-8000-0000000000c1";
const S_FILETTO = "00000000-0000-4000-8000-0000000000c2";
const X_CUATRO_QUESOS = "00000000-0000-4000-8000-0000000000c3";
const N_SALSA_NOQUIS = "00000000-0000-4000-8000-0000000000c4";

const PRODUCTS = [
  { id: TALLARINES, name: "Tallarines", price_cents: 10_000 },
  { id: NOQUIS, name: "Ñoquis", price_cents: 9_000 },
  { id: SODA, name: "Soda", price_cents: 3_000 },
].map((p) => ({
  ...p,
  business_id: BIZ.id,
  is_active: true,
  is_available: true,
}));

type Mod = {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
  is_available: boolean;
};
const MODIFIERS: Mod[] = [
  { id: S_BOLOGNESA, group_id: G_SALSA, name: "Bolognesa", price_delta_cents: 0, is_available: true },
  { id: S_FILETTO, group_id: G_SALSA, name: "Filetto", price_delta_cents: 500, is_available: true },
  { id: X_CUATRO_QUESOS, group_id: G_EXTRA, name: "Cuatro Quesos", price_delta_cents: 450, is_available: true },
  { id: N_SALSA_NOQUIS, group_id: G_NOQUIS, name: "Salsa de Ñoquis", price_delta_cents: 14_500, is_available: true },
];

const GROUPS = [
  { id: G_SALSA, product_id: TALLARINES, name: "Salsa para pasta", is_required: true, min_selection: 1, max_selection: 1 },
  { id: G_EXTRA, product_id: TALLARINES, name: "Extras", is_required: false, min_selection: 0, max_selection: 3 },
  { id: G_NOQUIS, product_id: NOQUIS, name: "Salsa", is_required: true, min_selection: 1, max_selection: 1 },
].map((g) => ({
  ...g,
  business_id: BIZ.id,
  sort_order: 0,
  modifiers: MODIFIERS.filter((m) => m.group_id === g.id).map((m) => ({
    id: m.id,
    is_available: m.is_available,
  })),
}));

let inserted: Record<string, Record<string, unknown>[]>;

function fakeClient() {
  function chain(table: string) {
    const filters: [string, unknown[]][] = [];
    const resolve = () => {
      const byIn = <T extends Record<string, unknown>>(rows: T[]) =>
        rows.filter((r) =>
          filters.every(([col, vals]) => vals.includes(r[col])),
        );
      switch (table) {
        case "businesses":
          return { data: BIZ };
        case "products":
          return { data: byIn(PRODUCTS) };
        case "modifiers":
          return {
            data: byIn(MODIFIERS).map((m) => ({
              ...m,
              modifier_groups: { business_id: BIZ.id },
            })),
          };
        case "modifier_groups":
          return { data: byIn(GROUPS) };
        case "customers":
          return { data: { id: "cust1" } };
        case "orders":
          return { data: { id: "ord1", order_number: 7 } };
        case "order_items":
          return { data: { id: "oi1" } };
        default:
          return { data: null };
      }
    };
    const record = (row: unknown) => {
      (inserted[table] ??= []).push(row as Record<string, unknown>);
    };
    const self: Record<string, unknown> = {
      select: () => self,
      eq: () => self,
      in: (col: string, vals: unknown[]) => (filters.push([col, vals]), self),
      not: () => self,
      is: () => self,
      order: () => self,
      limit: () => self,
      insert: (row: unknown) => (record(row), self),
      upsert: (row: unknown) => (record(row), self),
      update: (row: unknown) => (record(row), self),
      maybeSingle: async () => resolve(),
      single: async () => resolve(),
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(ok, err),
    };
    return self;
  }
  return { from: (table: string) => chain(table) };
}

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => fakeClient(),
}));

vi.mock("@/lib/notifications/create", () => ({
  createNotification: async () => undefined,
}));

import { persistOrder } from "./persist-order";

function input(
  items: { product_id: string; quantity?: number; modifier_ids: string[] }[],
): PersistableOrderInput {
  return {
    business_slug: "golf",
    delivery_type: "dine_in",
    customer_name: "Mostrador",
    customer_phone: "-",
    items: items.map((i) => ({ quantity: 1, ...i })),
  } as PersistableOrderInput;
}

function rechazado(res: Awaited<ReturnType<typeof persistOrder>>): string {
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("se esperaba un rechazo");
  return res.error;
}

beforeEach(() => {
  inserted = {};
});

describe("persistOrder · modifier_ids contra los grupos del producto (H-01)", () => {
  it("#85 · rechaza Tallarines sin la salsa obligatoria, nombrando producto y grupo", async () => {
    const res = await persistOrder(
      input([{ product_id: TALLARINES, modifier_ids: [] }]),
    );
    const error = rechazado(res);
    expect(error).toContain("Tallarines");
    expect(error).toContain("Salsa para pasta");
    expect(error).toBe("Tallarines: elegí una opción de Salsa para pasta");
    expect(inserted.orders).toBeUndefined();
  });

  it("#86 · rechaza el adicional de otro producto (Ñoquis en Tallarines)", async () => {
    const res = await persistOrder(
      input([
        {
          product_id: TALLARINES,
          modifier_ids: [S_BOLOGNESA, N_SALSA_NOQUIS],
        },
      ]),
    );
    expect(rechazado(res)).toContain("Tallarines");
    expect(inserted.orders).toBeUndefined();
  });

  it("#87 · rechaza el mismo adicional repetido ×3", async () => {
    const res = await persistOrder(
      input([
        {
          product_id: TALLARINES,
          modifier_ids: [
            S_BOLOGNESA,
            X_CUATRO_QUESOS,
            X_CUATRO_QUESOS,
            X_CUATRO_QUESOS,
          ],
        },
      ]),
    );
    expect(rechazado(res)).toContain("Tallarines");
    expect(inserted.orders).toBeUndefined();
  });

  it("#88 · rechaza dos salsas en un grupo de máximo 1", async () => {
    const res = await persistOrder(
      input([
        { product_id: TALLARINES, modifier_ids: [S_BOLOGNESA, S_FILETTO] },
      ]),
    );
    const error = rechazado(res);
    expect(error).toContain("Tallarines");
    expect(error).toContain("Salsa para pasta");
    expect(inserted.orders).toBeUndefined();
  });

  it("acepta la salsa elegida y suma el adicional una sola vez (precio sin cambios)", async () => {
    const res = await persistOrder(
      input([
        {
          product_id: TALLARINES,
          quantity: 2,
          modifier_ids: [S_FILETTO, X_CUATRO_QUESOS],
        },
      ]),
    );
    expect(res.ok).toBe(true);
    // (10.000 base + 500 + 450) × 2
    expect(inserted.orders?.[0]).toMatchObject({ subtotal_cents: 21_900 });
  });

  it("un producto sin grupos acepta modifier_ids vacío", async () => {
    const res = await persistOrder(
      input([{ product_id: SODA, modifier_ids: [] }]),
    );
    expect(res.ok).toBe(true);
    expect(inserted.orders?.[0]).toMatchObject({ subtotal_cents: 3_000 });
  });

  it("rechaza un adicional en un producto que no tiene grupos", async () => {
    const res = await persistOrder(
      input([{ product_id: SODA, modifier_ids: [X_CUATRO_QUESOS] }]),
    );
    expect(rechazado(res)).toContain("Soda");
  });

  it("valida cada línea por separado: la salsa de Ñoquis sirve en Ñoquis", async () => {
    const res = await persistOrder(
      input([
        { product_id: NOQUIS, modifier_ids: [N_SALSA_NOQUIS] },
        { product_id: TALLARINES, modifier_ids: [] },
      ]),
    );
    expect(rechazado(res)).toContain("Tallarines");
  });
});

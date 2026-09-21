import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PersistableOrderInput } from "./schema";

// Spec 058 — el camino `dine_in` de `persistOrder`: la venta de mostrador nace
// sin mesa, sin datos de entrega y sin notificar al encargado. Lo importante
// que fija esta suite es la **no-regresión del checkout público**: el mismo
// motor tiene que seguir cobrando envío y avisando en `delivery`/`pickup`.
//
// `persistOrder` habla con Supabase directo, así que el fake de abajo resuelve
// las lecturas por tabla y guarda los inserts para poder afirmar sobre ellos.

const BIZ = {
  id: "biz1",
  slug: "golf",
  timezone: "America/Argentina/Buenos_Aires",
  delivery_fee_cents: 1_500,
  min_order_cents: 0,
  mp_access_token: null,
  mp_accepts_payments: false,
};

const PRODUCT = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "Alfajor",
  price_cents: 2_000,
  business_id: BIZ.id,
  is_active: true,
  is_available: true,
};

/** Filas insertadas por el último `persistOrder`, por tabla. */
let inserted: Record<string, Record<string, unknown>[]>;
const createNotificationMock = vi.fn(async (..._args: unknown[]) => undefined);

function fakeClient() {
  function chain(table: string) {
    const resolve = () => {
      switch (table) {
        case "businesses":
          return { data: BIZ };
        case "products":
          return { data: [PRODUCT] };
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
      in: () => self,
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
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}));

// Espía sobre el resolver real de la ficha del cliente (auditoría de pedidos):
// el fake de Supabase devuelve una ficha para cualquier consulta, así que lo que
// se verifica acá es CON QUÉ CUENTA se resuelve; la lógica en sí la cubre
// `resolver-cliente.integration.test.ts` contra Postgres.
const resolverSpy = vi.hoisted(() => ({ fn: null as unknown }));
vi.mock("@/lib/customers/resolver-cliente", async () => {
  const actual = await vi.importActual<typeof import("@/lib/customers/resolver-cliente")>(
    "@/lib/customers/resolver-cliente",
  );
  const spy = vi.fn(actual.resolverClienteDelPedido);
  resolverSpy.fn = spy;
  return { ...actual, resolverClienteDelPedido: spy };
});

import { persistOrder } from "./persist-order";

const items = [{ product_id: PRODUCT.id, quantity: 1, modifier_ids: [] }];

function input(
  overrides: Partial<PersistableOrderInput> = {},
): PersistableOrderInput {
  return {
    business_slug: "golf",
    delivery_type: "dine_in",
    customer_name: "Mostrador",
    customer_phone: "-",
    items,
    ...overrides,
  } as PersistableOrderInput;
}

/** La fila insertada en `orders` (la primera update/insert de esa tabla). */
function orderInsert() {
  return inserted.orders?.[0] ?? {};
}

beforeEach(() => {
  inserted = {};
  createNotificationMock.mockClear();
});

describe("persistOrder — camino dine_in (venta de mostrador)", () => {
  it("crea la orden sin dirección ni envío", async () => {
    const res = await persistOrder(input());
    expect(res.ok).toBe(true);
    expect(orderInsert()).toMatchObject({
      delivery_type: "dine_in",
      delivery_address: null,
      delivery_fee_cents: 0,
      subtotal_cents: 2_000,
      total_cents: 2_000,
    });
  });

  it("no exige teléfono real ni dirección para validar", async () => {
    const res = await persistOrder(input());
    expect(res.ok).toBe(true);
  });

  it("NO notifica al encargado de su propia venta", async () => {
    await persistOrder(input());
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("registra quién vendió en mozo_id", async () => {
    await persistOrder(input(), "u1", { mozoId: "u1" });
    expect(orderInsert()).toMatchObject({ mozo_id: "u1" });
  });

  it("rechaza programar una venta de mostrador (no es retiro)", async () => {
    const res = await persistOrder(
      input({ scheduled_at: "2030-01-01T18:00:00.000Z" }),
    );
    expect(res.ok).toBe(false);
  });
});

describe("persistOrder — el checkout público no regresiona", () => {
  it("delivery sigue cobrando el envío", async () => {
    const res = await persistOrder(
      input({
        delivery_type: "delivery",
        customer_name: "Juan",
        customer_phone: "1155551234",
        delivery_address: "Av. Golf 123",
      }),
    );
    expect(res.ok).toBe(true);
    expect(orderInsert()).toMatchObject({
      delivery_type: "delivery",
      delivery_fee_cents: 1_500,
      total_cents: 3_500,
    });
  });

  it("delivery sigue notificando al encargado", async () => {
    await persistOrder(
      input({
        delivery_type: "delivery",
        customer_name: "Juan",
        customer_phone: "1155551234",
        delivery_address: "Av. Golf 123",
      }),
    );
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("pickup sigue notificando al encargado y sin envío", async () => {
    await persistOrder(
      input({
        delivery_type: "pickup",
        customer_name: "Juan",
        customer_phone: "1155551234",
      }),
    );
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(orderInsert()).toMatchObject({ delivery_fee_cents: 0 });
  });
});

// El pedido cargado por staff no es del staff: `userId` acá es el EMPLEADO
// logueado (lo usa el override de precio y `mozo_id`), no el comensal. Ligarlo
// a `customers.user_id` reventaba contra la unique parcial
// `customers_business_user_unique (business_id, user_id)`: el segundo cliente
// distinto que cargaba el mismo encargado tiraba «No pudimos guardar tus
// datos.» y no dejaba marchar el delivery.
describe("persistOrder — el cliente no se liga a la cuenta del staff", () => {
  /** La fila upserteada en `customers`. */
  const customerRow = () =>
    (inserted.customers?.[0] ?? {}) as Record<string, unknown>;

  it("cargado por staff: NO manda user_id", async () => {
    await persistOrder(
      input({
        delivery_type: "delivery",
        customer_name: "Juan",
        customer_phone: "1155551234",
        delivery_address: "Av. Golf 123",
      }),
      "empleado-1",
      { mozoId: "empleado-1" },
    );
    expect(customerRow()).not.toHaveProperty("user_id");
  });

  it("dos clientes distintos del mismo encargado no chocan entre sí", async () => {
    for (const phone of ["1155551234", "1166665555"]) {
      inserted = {};
      await persistOrder(
        input({
          delivery_type: "delivery",
          customer_name: "Cliente",
          customer_phone: phone,
          delivery_address: "Av. Golf 123",
        }),
        "empleado-1",
        { mozoId: "empleado-1" },
      );
      expect(customerRow()).not.toHaveProperty("user_id");
    }
  });

  it("checkout público con login: sigue ligando la cuenta del comensal", async () => {
    await persistOrder(
      input({
        delivery_type: "delivery",
        customer_name: "Juan",
        customer_phone: "1155551234",
        delivery_address: "Av. Golf 123",
      }),
      "comensal-1",
    );
    const llamadas = (resolverSpy.fn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(llamadas.at(-1)?.[1]).toMatchObject({ userId: "comensal-1" });
  });

  it("checkout público sin login: no pisa con null el user_id ya ligado", async () => {
    await persistOrder(
      input({
        delivery_type: "delivery",
        customer_name: "Juan",
        customer_phone: "1155551234",
        delivery_address: "Av. Golf 123",
      }),
    );
    expect(customerRow()).not.toHaveProperty("user_id");
  });
});

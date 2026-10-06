import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import {
  MAX_QTY_PER_LINE,
  getCartStore,
  cartItemSubtotal,
  cartTotal,
  cartCount,
  type CartItem,
} from "./cart";

const item = (q: number, price: number, mods: number[] = []): CartItem => ({
  id: crypto.randomUUID(),
  product_id: crypto.randomUUID(),
  product_name: "x",
  unit_price_cents: price,
  quantity: q,
  modifiers: mods.map((p) => ({
    modifier_id: crypto.randomUUID(),
    group_id: crypto.randomUUID(),
    name: "m",
    price_delta_cents: p,
  })),
});

// Combo de menú del día con `extra_price_cents` por opción elegida (spec 29).
const dailyMenu = (
  q: number,
  base: number,
  extras: number[],
): CartItem => ({
  id: crypto.randomUUID(),
  kind: "daily_menu",
  daily_menu_id: crypto.randomUUID(),
  product_name: "Combo",
  unit_price_cents: base,
  quantity: q,
  modifiers: [],
  selected_choices: extras.map((extra_price_cents) => ({
    choice_group_id: crypto.randomUUID(),
    choice_group_label: "Bebida",
    product_id: crypto.randomUUID(),
    product_name: "opt",
    extra_price_cents,
    modifiers: [],
  })),
});

describe("cart math", () => {
  it("subtotal includes modifiers times quantity", () => {
    expect(cartItemSubtotal(item(2, 1000, [100, 200]))).toBe(2600);
  });

  it("subtotal with no modifiers", () => {
    expect(cartItemSubtotal(item(3, 500))).toBe(1500);
  });

  it("total sums all items", () => {
    expect(cartTotal([item(1, 1000, [100]), item(2, 500)])).toBe(2100);
  });

  it("count sums quantities", () => {
    expect(cartCount([item(2, 100), item(3, 100), item(1, 100)])).toBe(6);
  });
});

describe("cart math · combo del menú del día (spec 29)", () => {
  it("suma el adicional de la opción elegida al subtotal", () => {
    // base 5000 + cerveza 800 = 5800
    expect(cartItemSubtotal(dailyMenu(1, 5000, [800]))).toBe(5800);
  });

  it("el adicional multiplica por cantidad", () => {
    // (5000 + 800) * 2 = 11600
    expect(cartItemSubtotal(dailyMenu(2, 5000, [800]))).toBe(11600);
  });

  it("una opción incluida ($0) deja el precio base", () => {
    expect(cartItemSubtotal(dailyMenu(1, 5000, [0]))).toBe(5000);
  });

  it("suma adicionales de varios grupos", () => {
    // 5000 + 800 + 500 = 6300
    expect(cartItemSubtotal(dailyMenu(1, 5000, [800, 500]))).toBe(6300);
  });
});

// QA #382 · H-12 — tope de 99 unidades por línea. El schema del server rechaza
// `quantity > 99`; sin tope en el store el cliente llegaba a 101 y recién en el
// checkout se enteraba (con un mensaje genérico).
describe("cart store · tope por línea (H-12)", () => {
  const slug = "test-tope";
  const store = () => getCartStore(slug);

  // El store persiste en localStorage; en el runner (Node reciente + jsdom) el
  // global no siempre está usable, así que va uno en memoria.
  beforeAll(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    store().setState({ items: [] });
  });

  it("MAX_QTY_PER_LINE es 99", () => {
    expect(MAX_QTY_PER_LINE).toBe(99);
  });

  it("addItem topea la cantidad en 99", () => {
    store().getState().addItem({ ...item(150, 1000), id: "a" });
    expect(store().getState().items[0].quantity).toBe(99);
  });

  it("updateQuantity no pasa de 99", () => {
    store().getState().addItem({ ...item(98, 1000), id: "a" });
    store().getState().updateQuantity("a", 101);
    expect(store().getState().items[0].quantity).toBe(99);
  });

  it("updateQuantity sigue quitando la línea en 0 y aceptando valores normales", () => {
    store().getState().addItem({ ...item(2, 1000), id: "a" });
    store().getState().updateQuantity("a", 5);
    expect(store().getState().items[0].quantity).toBe(5);
    store().getState().updateQuantity("a", 0);
    expect(store().getState().items).toHaveLength(0);
  });
});

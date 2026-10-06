"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type CartModifier = {
  modifier_id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
};

export type CartDailyMenuComponent = {
  id: string;
  label: string;
  description: string | null;
};

export type CartSelectedChoice = {
  choice_group_id: string;
  choice_group_label: string;
  product_id: string;
  product_name: string;
  /**
   * Adicional de esta opción dentro del combo (spec 29). Se suma al subtotal
   * de la línea junto al precio base del menú. Default 0 = incluida. El server
   * lo re-valida contra la DB; el cliente nunca fija el precio.
   */
  extra_price_cents: number;
  modifiers: CartModifier[];
};

/**
 * Un item del carrito es un `product` o un `daily_menu` (combo cerrado).
 * `kind` es el discriminador. Para ítems persistidos antes de introducir
 * este campo, el código que lea `kind` debe tratar `undefined` como
 * `'product'` (back-compat).
 *
 * Campos específicos por kind:
 *   - product: `product_id`, `modifiers` (puede estar vacío).
 *   - daily_menu: `daily_menu_id`, `components_snapshot`, `modifiers` siempre `[]`.
 *
 * `product_name`, `unit_price_cents`, `image_url` se usan en ambos como
 * "label", precio base y miniatura de la línea.
 */
export type CartItem = {
  id: string;
  kind?: "product" | "daily_menu";
  product_id?: string;
  daily_menu_id?: string;
  components_snapshot?: CartDailyMenuComponent[];
  selected_choices?: CartSelectedChoice[];
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  notes?: string;
  image_url?: string | null;
  modifiers: CartModifier[];
};

/**
 * Tope de unidades por línea (H-12 · QA #382). Es el mismo máximo que valida el
 * schema del server (`quantity.max(99)`): sin tope acá el cliente llegaba a 101
 * y recién en el checkout se enteraba.
 */
export const MAX_QTY_PER_LINE = 99;

function clampQty(qty: number): number {
  return Math.min(qty, MAX_QTY_PER_LINE);
}

export type CartState = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  updateQuantity: (id: string, qty: number) => void;
  removeItem: (id: string) => void;
  clear: () => void;
};

type CartStoreHook = ReturnType<typeof createCartStore>;

const storeCache = new Map<string, CartStoreHook>();

function createCartStore(slug: string) {
  return create<CartState>()(
    persist(
      (set) => ({
        items: [],
        addItem: (item) =>
          set((s) => ({
            items: [...s.items, { ...item, quantity: clampQty(item.quantity) }],
          })),
        updateQuantity: (id, qty) =>
          set((s) => ({
            items: s.items
              .map((i) =>
                i.id === id ? { ...i, quantity: clampQty(qty) } : i,
              )
              .filter((i) => i.quantity > 0),
          })),
        removeItem: (id) =>
          set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
        clear: () => set({ items: [] }),
      }),
      {
        name: `cart:${slug}`,
        storage: createJSONStorage(() => localStorage),
      },
    ),
  );
}

export function getCartStore(slug: string): CartStoreHook {
  let existing = storeCache.get(slug);
  if (!existing) {
    existing = createCartStore(slug);
    storeCache.set(slug, existing);
  }
  return existing;
}

export function useCart<T>(slug: string, selector: (s: CartState) => T): T {
  const useStore = getCartStore(slug);
  return useStore(selector);
}

export function cartItemSubtotal(item: CartItem): number {
  const modsTotal = item.modifiers.reduce(
    (acc, m) => acc + m.price_delta_cents,
    0,
  );
  // Combos: cada opción elegida puede sumar un adicional (spec 29).
  const choicesTotal = (item.selected_choices ?? []).reduce(
    (acc, sc) => acc + (sc.extra_price_cents ?? 0),
    0,
  );
  return (item.unit_price_cents + modsTotal + choicesTotal) * item.quantity;
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((acc, i) => acc + cartItemSubtotal(i), 0);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((acc, i) => acc + i.quantity, 0);
}

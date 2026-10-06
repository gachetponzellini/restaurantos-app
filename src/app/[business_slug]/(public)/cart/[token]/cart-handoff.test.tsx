import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// QA #382 · H-17 — abrir el link del bot reemplazaba el carrito local sin
// avisar. Con ítems locales ahora se pregunta; con el carrito vacío, el
// comportamiento de siempre.

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { getCartStore, type CartItem } from "@/stores/cart";

import { CartHandoff } from "./cart-handoff";

const SLUG = "kcc";

const item = (id: string, name: string): CartItem => ({
  id,
  product_id: "00000000-0000-4000-8000-000000000001",
  product_name: name,
  unit_price_cents: 1_000,
  quantity: 1,
  modifiers: [],
});

const delChat = [item("chat-1", "Milanesa")];

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
  replace.mockReset();
  getCartStore(SLUG).setState({ items: [] });
});

const itemsDelCarrito = () => getCartStore(SLUG).getState().items.map((i) => i.id);

describe("CartHandoff (H-17)", () => {
  it("carrito vacío: carga el del chat y va al carrito, sin preguntar", () => {
    render(<CartHandoff slug={SLUG} items={delChat} />);
    expect(itemsDelCarrito()).toEqual(["chat-1"]);
    expect(replace).toHaveBeenCalledWith(`/${SLUG}/carrito`);
    expect(screen.queryByText(/ya tenés productos/i)).not.toBeInTheDocument();
  });

  it("con productos locales: pregunta y no toca nada hasta que elija", () => {
    getCartStore(SLUG).setState({ items: [item("local-1", "Tallarines")] });
    render(<CartHandoff slug={SLUG} items={delChat} />);
    expect(
      screen.getByText(
        "Ya tenés productos en tu carrito. ¿Los reemplazamos por los del chat?",
      ),
    ).toBeInTheDocument();
    expect(itemsDelCarrito()).toEqual(["local-1"]);
    expect(replace).not.toHaveBeenCalled();
  });

  it("Reemplazar: queda el carrito del chat", () => {
    getCartStore(SLUG).setState({ items: [item("local-1", "Tallarines")] });
    render(<CartHandoff slug={SLUG} items={delChat} />);
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar" }));
    expect(itemsDelCarrito()).toEqual(["chat-1"]);
    expect(replace).toHaveBeenCalledWith(`/${SLUG}/carrito`);
  });

  it("Mantener el mío: el carrito local queda como estaba", () => {
    getCartStore(SLUG).setState({ items: [item("local-1", "Tallarines")] });
    render(<CartHandoff slug={SLUG} items={delChat} />);
    fireEvent.click(screen.getByRole("button", { name: "Mantener el mío" }));
    expect(itemsDelCarrito()).toEqual(["local-1"]);
    expect(replace).toHaveBeenCalledWith(`/${SLUG}/carrito`);
  });
});

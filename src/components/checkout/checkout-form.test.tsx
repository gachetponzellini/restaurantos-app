import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// QA #382 — checkout del cliente: H-03 (doble click), H-11 (sin red),
// H-13 (mínimo sólo en envío), H-22 («N productos»), H-23/24/25 (inputs).

const createOrder = vi.fn();
const toastError = vi.fn();
const routerPush = vi.fn();

vi.mock("@/lib/orders/create-order", () => ({
  createOrder: (...a: unknown[]) => createOrder(...a),
}));
vi.mock("@/lib/promos/preview-action", () => ({ previewPromoCode: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { getCartStore } from "@/stores/cart";

import { CheckoutForm } from "./checkout-form";

const SLUG = "golf";

function linea(quantity: number, unit = 3_000) {
  return {
    id: `l-${Math.random()}`,
    product_id: "00000000-0000-4000-8000-000000000001",
    product_name: "Soda",
    unit_price_cents: unit,
    quantity,
    modifiers: [],
  };
}

function montar(props: Partial<React.ComponentProps<typeof CheckoutForm>> = {}) {
  return render(
    <CheckoutForm
      slug={SLUG}
      businessName="Golf"
      businessAddress="Av. Siempre Viva 123"
      businessTimezone="America/Argentina/Buenos_Aires"
      deliveryFeeCents={0}
      estimatedMinutes={null}
      initialName="Ana"
      initialPhone="1155551234"
      {...props}
    />,
  );
}

const botonConfirmar = () =>
  screen.getByRole("button", { name: /confirmar pedido|procesando/i });

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
  createOrder.mockReset();
  toastError.mockReset();
  routerPush.mockReset();
  getCartStore(SLUG).setState({ items: [linea(1)] });
});

/** Pasa a «Retiro en el local» (no pide dirección). */
function retirar() {
  fireEvent.click(screen.getByRole("button", { name: /retiro en el local/i }));
}

describe("checkout · doble click (H-03)", () => {
  it("dos clicks en el mismo tick disparan un solo createOrder", async () => {
    createOrder.mockReturnValue(new Promise(() => {}));
    montar();
    retirar();
    const boton = botonConfirmar();
    act(() => {
      fireEvent.click(boton);
      fireEvent.click(boton);
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
  });
});

describe("checkout · sin red (H-11)", () => {
  it("si la action rechaza, avisa y deja reintentar", async () => {
    createOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    montar();
    retirar();
    await act(async () => {
      fireEvent.click(botonConfirmar());
    });
    expect(toastError).toHaveBeenCalledWith(
      "No pudimos conectar. Revisá tu conexión y probá de nuevo.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /confirmar pedido/i }),
      ).toBeEnabled(),
    );
  });

  it("después del fallo, el reintento sí manda el pedido", async () => {
    createOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    createOrder.mockResolvedValueOnce({
      ok: true,
      data: { order_id: "o1", order_number: 1 },
    });
    montar();
    retirar();
    await act(async () => {
      fireEvent.click(botonConfirmar());
    });
    await act(async () => {
      fireEvent.click(botonConfirmar());
    });
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(routerPush).toHaveBeenCalledWith(`/${SLUG}/confirmacion/o1`);
  });
});

describe("checkout · mínimo sólo en envío (H-13)", () => {
  it("envío por debajo del mínimo: avisa y bloquea el confirmar", () => {
    montar({ minOrderCents: 5_000 });
    expect(screen.getByText(/mínimo de/i)).toBeInTheDocument();
    expect(botonConfirmar()).toBeDisabled();
    fireEvent.click(botonConfirmar());
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("retiro: sin aviso y el confirmar queda habilitado", () => {
    montar({ minOrderCents: 5_000 });
    retirar();
    expect(screen.queryByText(/mínimo de/i)).not.toBeInTheDocument();
    expect(botonConfirmar()).toBeEnabled();
  });

  it("envío que llega al mínimo: sin aviso", () => {
    getCartStore(SLUG).setState({ items: [linea(2)] });
    montar({ minOrderCents: 5_000 });
    expect(screen.queryByText(/mínimo de/i)).not.toBeInTheDocument();
  });
});

describe("checkout · «N productos» (H-22)", () => {
  it("cuenta unidades, no líneas, con el plural correcto", () => {
    getCartStore(SLUG).setState({ items: [linea(2)] });
    montar();
    expect(screen.getByText(/2 productos ·/)).toBeInTheDocument();
  });

  it("singular con una sola unidad", () => {
    montar();
    expect(screen.getByText(/1 producto ·/)).toBeInTheDocument();
    expect(screen.queryByText(/ítems/)).not.toBeInTheDocument();
  });

  it("dos líneas de 1 unidad = 2 productos", () => {
    getCartStore(SLUG).setState({ items: [linea(1), linea(1)] });
    montar();
    expect(screen.getByText(/2 productos ·/)).toBeInTheDocument();
  });
});

describe("checkout · inputs (H-23 / H-25)", () => {
  it("todos los inputs tienen label asociado y ≥16px", () => {
    const { container } = montar({ minOrderCents: 0 });
    const campos = container.querySelectorAll("input, textarea");
    expect(campos.length).toBeGreaterThan(0);
    for (const el of Array.from(campos)) {
      const nombre = el.getAttribute("placeholder") ?? el.outerHTML;
      expect(parseFloat(getComputedStyle(el).fontSize), nombre).toBeGreaterThanOrEqual(16);
      const conLabel =
        el.getAttribute("aria-label") ||
        (el.id && container.querySelector(`label[for="${el.id}"]`));
      expect(conLabel, nombre).toBeTruthy();
    }
  });

  it("autocomplete y tipo según el campo", () => {
    montar();
    expect(screen.getByLabelText(/teléfono/i)).toHaveAttribute("type", "tel");
    expect(screen.getByLabelText(/notas para el repartidor/i)).toHaveAttribute(
      "autocomplete",
      "off",
    );
    expect(screen.getByLabelText(/piso \/ depto/i)).toHaveAttribute(
      "autocomplete",
      "address-line2",
    );
    const cupon = screen.getByLabelText(/código de cupón/i);
    expect(cupon).toHaveAttribute("autocomplete", "off");
    expect(cupon).toHaveAttribute("autocapitalize", "characters");
  });

  it("las notas de retiro también salen sin autocompletar", () => {
    montar();
    retirar();
    expect(screen.getByLabelText(/notas \(opcional\)/i)).toHaveAttribute(
      "autocomplete",
      "off",
    );
  });
});

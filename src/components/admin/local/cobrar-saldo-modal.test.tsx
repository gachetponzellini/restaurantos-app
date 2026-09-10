import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CobrarSaldoModal } from "./cobrar-saldo-modal";
import type { Caja } from "@/lib/caja/types";

/**
 * La cobranza de una cuenta corriente usa el **mismo selector de método** que la
 * mesa, el pedido y el mostrador (spec 157 · D1). Tenía el suyo: era la cuarta
 * copia de la misma grilla.
 *
 * Lo que NO comparte es el resto de `CobroForm`, y estos tests fijan por qué:
 * una cobranza admite pagar de menos —un saldo se paga de a poco— y no lleva
 * ajuste por método, porque lo que entra es lo que se debe.
 */
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const registrarCobranza = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  data: { id: "s1", saldo_cents: 0 },
}));
vi.mock("@/lib/caja/cuenta-corriente-actions", () => ({
  registrarCobranza: (input: unknown) => registrarCobranza(input),
}));

const CAJA: Caja = {
  id: "caja-1",
  business_id: "biz-1",
  name: "Principal",
  is_active: true,
  sort_order: 0,
  is_default: true,
  is_administrative: false,
  fondo_fijo_cents: 0,
};

const deudor = {
  customer_id: "c1",
  name: "Sanatorio Parque",
  phone: "3415550000",
  saldo_cents: 50_000,
} as React.ComponentProps<typeof CobrarSaldoModal>["deudor"];

function abrir(cajas: Caja[] = [CAJA]) {
  render(
    <CobrarSaldoModal
      slug="demo"
      cajas={cajas}
      deudor={deudor}
      onClose={vi.fn()}
    />,
  );
}

const metodos = () =>
  screen.getAllByRole("button").filter((b) => b.dataset.metodo === "true");
const registrar = () =>
  screen.getByRole("button", { name: /registrar pago/i }) as HTMLButtonElement;

describe("<CobrarSaldoModal /> — el selector es el mismo de las otras pantallas", () => {
  it("ofrece los cuatro métodos que el server sabe registrar, y ninguno más", () => {
    abrir();
    expect(metodos().map((b) => b.textContent)).toEqual([
      expect.stringContaining("Efectivo"),
      expect.stringContaining("Tarjeta"),
      expect.stringContaining("Transferencia"),
      expect.stringContaining("Otro"),
    ]);
    // No se paga una deuda con otra deuda, y MP no pasa por acá.
    expect(screen.queryByText(/cuenta corriente/i)).toBeNull();
    expect(screen.queryByText(/mercado pago/i)).toBeNull();
  });

  it("los dígitos eligen método, como en el cobro de la mesa (spec 075)", async () => {
    const user = userEvent.setup();
    abrir();
    metodos()[0].focus();
    await user.keyboard("3");
    // Transferencia no toca el cajón: la caja deja de preguntarse.
    expect(screen.queryByLabelText(/entra en/i)).toBeNull();
  });

  it("sólo el efectivo pregunta a qué caja entra", async () => {
    const user = userEvent.setup();
    abrir([CAJA, { ...CAJA, id: "caja-2", name: "Bar", is_default: false }]);
    expect(screen.getByLabelText(/entra en/i)).toBeInTheDocument();

    await user.click(metodos()[3]); // Otro
    expect(screen.queryByLabelText(/entra en/i)).toBeNull();
  });

  it("cobrar de MENOS es válido: un saldo se paga de a poco", async () => {
    const user = userEvent.setup();
    abrir();
    const monto = screen.getByLabelText(/cuánto paga/i);
    await user.clear(monto);
    await user.type(monto, "200");

    expect(registrar()).toBeEnabled();
    await user.click(registrar());
    expect(registrarCobranza).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 20_000, method: "cash" }),
    );
  });

  it("cobrar de MÁS no: nadie debe más de lo que debe", async () => {
    const user = userEvent.setup();
    abrir();
    const monto = screen.getByLabelText(/cuánto paga/i);
    await user.clear(monto);
    await user.type(monto, "900");
    expect(registrar()).toBeDisabled();
  });

  it("no muestra ajuste por método: lo que entra es lo que se debe", () => {
    abrir();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CobroForm, type CobroSubmit } from "./cobro-form";
import type { Caja, PaymentMethodConfig } from "@/lib/caja/types";

// El form no importa server actions — `onSubmit` es del caller. Eso es lo que
// permite testear todas las reglas de dinero sin tocar Supabase.

const CAJA: Caja = {
  id: "caja-1",
  business_id: "biz-1",
  name: "Principal",
  is_active: true,
  sort_order: 0,
  is_default: true,
  is_administrative: false,
};

const okResult = { ok: true as const, data: {} };

function config(method: string, percent: number): PaymentMethodConfig {
  return {
    id: `cfg-${method}`,
    business_id: "biz-1",
    method: method as PaymentMethodConfig["method"],
    adjustment_percent: percent,
    label: null,
    is_active: true,
    sort_order: 0,
  };
}

function setup(props: Partial<React.ComponentProps<typeof CobroForm>> = {}) {
  const onSubmit = vi.fn(async (_i: CobroSubmit) => okResult);
  render(
    <CobroForm
      amountDueCents={10_000}
      cajas={[CAJA]}
      cajaId={CAJA.id}
      methodConfigs={[]}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

const pick = (label: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name: label }));

const confirm = () =>
  fireEvent.click(screen.getByRole("button", { name: /confirmar/i }));

describe("<CobroForm /> — las reglas de dinero, una sola vez", () => {
  it("cobra el monto que falta cuando el método no tiene ajuste", async () => {
    const { onSubmit } = setup();
    pick(/efectivo/i);
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      method: "cash",
      amountCents: 10_000,
      adjustmentCents: 0,
      adjustmentPercent: 0,
    });
  });

  it("aplica el recargo del método al monto y lo persiste desagregado", async () => {
    const { onSubmit } = setup({ methodConfigs: [config("card_manual", 10)] });
    pick(/tarjeta/i);
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      method: "card_manual",
      amountCents: 11_000,
      adjustmentPercent: 10,
      adjustmentCents: 1_000,
    });
  });

  it("aplica el descuento por efectivo (porcentaje negativo)", async () => {
    const { onSubmit } = setup({ methodConfigs: [config("cash", -10)] });
    pick(/efectivo/i);
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      amountCents: 9_000,
      adjustmentCents: -1_000,
    });
  });

  it("en efectivo no deja confirmar de menos", () => {
    setup();
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "50" }, // $50 de $100
    });
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeDisabled();
    expect(screen.getByText(/no se puede cobrar menos/i)).toBeInTheDocument();
  });

  it("en efectivo deja confirmar de más, muestra el vuelto y cobra lo que se debe", async () => {
    // issue #188 — el botón dice lo que la caja va a contar, no el billete.
    //
    // spec 177 — pero lo que VIAJA es el billete crudo + el destino: el reparto
    // entre cobrado, vuelto y propina lo hace el server, que es donde vive el
    // resto de las reglas de plata.
    const { onSubmit } = setup();
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "150" },
    });
    expect(screen.getByText(/vuelto/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirmar/i }),
    ).toHaveTextContent("100");
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].amountCents).toBe(15_000);
    expect(onSubmit.mock.calls[0][0].destinoExcedente).toBe("vuelto");
  });

  // ── Spec 177 · Parte A — el excedente ───────────────────────────────────
  it("«se lo dejan de propina»: el mismo billete pasa a entrar entero", async () => {
    const { onSubmit } = setup();
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "150" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /se lo dejan de propina/i }),
    );
    expect(screen.getByText(/^Propina:/)).toBeInTheDocument();
    // El botón deja de decir «lo que se debe»: ahora entra todo.
    expect(
      screen.getByRole("button", { name: /confirmar/i }),
    ).toHaveTextContent("150");
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].amountCents).toBe(15_000);
    expect(onSubmit.mock.calls[0][0].destinoExcedente).toBe("propina");
  });

  it("en tarjeta el excedente es propina sin preguntar: no hay vuelto que dar", async () => {
    // Lo que estaba mal hasta la 177: esos $50 entraban como VENTA del negocio.
    const { onSubmit } = setup();
    pick(/tarjeta/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "150" },
    });
    expect(screen.getByText(/^Propina:/)).toBeInTheDocument();
    expect(screen.queryByText(/^Vuelto:/)).not.toBeInTheDocument();
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].destinoExcedente).toBe("propina");
  });

  it("cambiar de método vuelve el excedente a su default", async () => {
    // «Quedátelo» en efectivo no puede sobrevivir a un cambio a tarjeta, ni al
    // revés: el destino se deriva del método salvo tilde explícito.
    const { onSubmit } = setup();
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "150" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /se lo dejan de propina/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /cambiar/i }));
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "150" },
    });
    expect(screen.getByText(/^Vuelto:/)).toBeInTheDocument();
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].destinoExcedente).toBe("vuelto");
  });

  it("la guarda de efectivo no aplica a los otros métodos", () => {
    setup();
    pick(/tarjeta/i);
    fireEvent.change(screen.getByLabelText(/monto/i), {
      target: { value: "50" },
    });
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeEnabled();
  });

  it("transferencia cobra sin nota, y la nota viaja si la escriben (spec 126)", async () => {
    // Antes la exigía. Lo que llegaba eran referencias como "T" o "a": el que
    // cierra el pedido no tiene el comprobante de la transferencia a mano.
    const { onSubmit } = setup();
    pick(/transferencia/i);
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/notas/i), {
      target: { value: "alias juan.mp" },
    });
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      method: "transfer",
      notes: "alias juan.mp",
    });
  });

  it("«otro» sigue exigiendo nota: es lo único que dice qué fue el cobro", () => {
    setup();
    pick(/otro/i);
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/notas/i), {
      target: { value: "cheque 1234" },
    });
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeEnabled();
  });

  it("sin el prop `mp` no se ofrecen link ni QR de Mercado Pago", () => {
    // Es la palanca con la que el cobro del pedido online los saca (spec 126):
    // generar una preference no cobra nada, deja el pedido abierto.
    setup();
    expect(
      screen.queryByRole("button", { name: /link mercado pago/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /qr mercado pago/i }),
    ).toBeNull();
  });

  it("los últimos 4 dígitos son opcionales, pero si van tienen que ser 4", async () => {
    const { onSubmit } = setup();
    pick(/tarjeta/i);
    const input = screen.getByLabelText(/últimos 4/i);
    fireEvent.change(input, { target: { value: "12" } });
    expect(screen.getByRole("button", { name: /confirmar/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: "1234" } });
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      lastFour: "1234",
      cardBrand: "visa",
    });
  });

  it("dos taps seguidos mandan el mismo requestId (idempotencia)", async () => {
    const onSubmit = vi.fn(
      async (_i: CobroSubmit) =>
        new Promise<typeof okResult>((r) => setTimeout(() => r(okResult), 20)),
    );
    render(
      <CobroForm
        amountDueCents={10_000}
        cajas={[CAJA]}
        cajaId={CAJA.id}
        methodConfigs={[]}
        onSubmit={onSubmit}
      />,
    );
    pick(/efectivo/i);
    const btn = screen.getByRole("button", { name: /confirmar/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const ids = onSubmit.mock.calls.map((c) => c[0].requestId);
    expect(new Set(ids).size).toBe(1);
  });

  it("sin capacidad MP no ofrece MP", () => {
    setup();
    expect(screen.queryByRole("button", { name: /mercado pago/i })).toBeNull();
  });

  it("allowedMethods filtra los métodos ofrecidos", () => {
    setup({ allowedMethods: ["cash"] });
    expect(
      screen.getByRole("button", { name: /efectivo/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tarjeta/i })).toBeNull();
  });
});

describe("<CobroForm /> — la propina sale de donde corresponda", () => {
  it("mode 'none': no se pide y va en 0", async () => {
    const { onSubmit } = setup();
    pick(/efectivo/i);
    expect(screen.queryByLabelText(/propina/i)).toBeNull();
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].tipCents).toBe(0);
  });

  it("mode 'fixed': viene de la orden, no se edita (caso mozo)", async () => {
    const { onSubmit } = setup({ tip: { mode: "fixed", cents: 1_500 } });
    pick(/efectivo/i);
    expect(screen.queryByLabelText(/propina/i)).toBeNull();
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].tipCents).toBe(1_500);
  });

  it("mode 'editable': se carga en el cobro (caso encargado)", async () => {
    const { onSubmit } = setup({ tip: { mode: "editable" } });
    pick(/efectivo/i);
    fireEvent.change(screen.getByLabelText(/propina/i), {
      target: { value: "20" },
    });
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].tipCents).toBe(2_000);
  });
});

/**
 * El selector de método por teclado (spec 075, FR-018/019/020). Es un camino
 * nuevo hacia un botón que mueve plata, así que lo primero que se fija es que
 * **elegir no cobre**.
 */
describe("<CobroForm /> — elegir método con el teclado", () => {
  const metodos = () =>
    screen.getAllByRole("button").filter((b) => b.dataset.metodo === "true");
  const enPaso2 = () =>
    screen.queryByRole("button", { name: /confirmar/i }) !== null;

  it("un dígito elige el método de esa posición y NO cobra", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    metodos()[0].focus();
    await user.keyboard("2");

    expect(enPaso2()).toBe(true);
    expect(screen.getByText("Tarjeta")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Enter sobre un método elige y NO cobra", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    metodos()[0].focus();
    await user.keyboard("{Enter}");

    expect(enPaso2()).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("↓ baja una fila de la grilla y → se mueve de a uno", async () => {
    const user = userEvent.setup();
    setup();

    const grilla = metodos();
    grilla[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(grilla[2]).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(grilla[3]).toHaveFocus();
  });

  it("un dígito más allá del último método no hace nada", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ allowedMethods: ["cash", "card_manual"] });

    metodos()[0].focus();
    await user.keyboard("9");

    expect(enPaso2()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Esc vuelve al selector de método sin cobrar", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    metodos()[0].focus();
    await user.keyboard("1");
    expect(enPaso2()).toBe(true);

    await user.keyboard("{Escape}");
    expect(enPaso2()).toBe(false);
    expect(metodos().length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Esc no se escapa al panel de arriba mientras hay método elegido", async () => {
    const user = userEvent.setup();
    const onEscDelPanel = vi.fn();
    const onSubmit = vi.fn(async (_i: CobroSubmit) => okResult);
    render(
      <div onKeyDown={(e) => e.key === "Escape" && onEscDelPanel()}>
        <CobroForm
          amountDueCents={10_000}
          cajas={[CAJA]}
          cajaId={CAJA.id}
          methodConfigs={[]}
          onSubmit={onSubmit}
        />
      </div>,
    );

    screen
      .getAllByRole("button")
      .filter((b) => b.dataset.metodo === "true")[0]
      .focus();
    await user.keyboard("1");
    await user.keyboard("{Escape}");

    // El panel no se enteró: ese Esc era del cobro.
    expect(onEscDelPanel).not.toHaveBeenCalled();
  });

  it("⌘Enter cobra una sola vez", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    metodos()[0].focus();
    await user.keyboard("1");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ method: "cash" });
  });

  it("Esc para cambiar de método no arrastra el monto tipeado", async () => {
    const user = userEvent.setup();
    setup({ methodConfigs: [config("card_manual", 10)] });

    // Efectivo, y el cliente paga con un billete más grande.
    metodos()[0].focus();
    await user.keyboard("1");
    const monto = screen.getByLabelText(/monto/i) as HTMLInputElement;
    fireEvent.change(monto, { target: { value: "150" } });
    expect(monto).toHaveValue(150);

    // Se arrepiente: Esc y tarjeta (+10% sobre $10.000 = $11.000).
    await user.keyboard("{Escape}");
    metodos()[1].focus();
    await user.keyboard("2");

    await waitFor(() => {
      expect(screen.getByLabelText(/monto/i)).toHaveValue(110);
    });
  });
});

/**
 * El flujo rápido (spec 157 · D2). El mostrador venía con **otro** formulario
 * para lograr «tipear, Enter, Enter, cobrar»; ahora esa ergonomía es un modo de
 * éste. Lo que estos tests fijan no es que se vea parecido: es que **no cueste
 * un tap más** que el formulario propio que reemplaza.
 */
describe("<CobroForm /> — el flujo rápido del mostrador", () => {
  const metodos = () =>
    screen.getAllByRole("button").filter((b) => b.dataset.metodo === "true");

  it("abre con el método ya elegido: cobrar es un solo click", async () => {
    const { onSubmit } = setup({ flujo: "rapido" });

    // Sin elegir método antes — eso es el tap que la spec 058 no puede pagar.
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ method: "cash" });
  });

  it("los métodos quedan a la vista y cambiarlos no esconde el botón", () => {
    setup({ methodConfigs: [config("card_manual", 10)], flujo: "rapido" });

    expect(metodos().length).toBeGreaterThan(1);
    pick(/tarjeta/i);
    // Sigue todo en una pantalla: no hay paso 2 al que ir.
    expect(metodos().length).toBeGreaterThan(1);
    // $100 + 10% = $110: el ajuste del método se ve sin cambiar de pantalla.
    expect(
      screen.getByRole("button", { name: /confirmar/i }),
    ).toHaveTextContent("110");
  });

  it("Esc es del panel, no del formulario: no hay selector al que volver", async () => {
    const user = userEvent.setup();
    const onEscDelPanel = vi.fn();
    render(
      <div onKeyDown={(e) => e.key === "Escape" && onEscDelPanel()}>
        <CobroForm
          amountDueCents={10_000}
          cajas={[CAJA]}
          cajaId={CAJA.id}
          methodConfigs={[]}
          flujo="rapido"
          onSubmit={async () => okResult}
        />
      </div>,
    );

    metodos()[0].focus();
    await user.keyboard("{Escape}");
    // En el mostrador Esc cierra la venta rápida. Comérselo acá encerraría al
    // encargado en un formulario que no tiene "atrás".
    expect(onEscDelPanel).toHaveBeenCalled();
  });

  it("no le roba el foco al buscador al montarse", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    setup({ flujo: "rapido" });

    // El panel del mostrador enfoca el buscador al abrir (spec 058): si el
    // cobro se quedara con el foco, la primera letra no llegaría a ningún lado.
    expect(input).toHaveFocus();
    input.remove();
  });

  it("después de cobrar se limpia para la venta siguiente, pero se queda con el método", async () => {
    const { onSubmit } = setup({ flujo: "rapido" });

    pick(/tarjeta/i);
    fireEvent.change(screen.getByLabelText(/últimos 4/i), {
      target: { value: "1234" },
    });
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    // Tres cafés seguidos con la misma tarjeta no se re-eligen tres veces…
    await waitFor(() =>
      expect(screen.getByLabelText(/últimos 4/i)).toHaveValue(""),
    );
    // …pero los datos del cliente anterior no se arrastran al próximo cobro.
    expect(onSubmit.mock.calls[0][0].lastFour).toBe("1234");
  });

  it("el requestId se renueva entre ventas (cada venta es una, no un reintento)", async () => {
    const { onSubmit } = setup({ flujo: "rapido" });
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirmar/i })).toBeEnabled(),
    );
    confirm();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    const ids = onSubmit.mock.calls.map((c) => c[0].requestId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("el flujo estándar sigue arrancando en el selector", () => {
    setup();
    expect(screen.queryByRole("button", { name: /confirmar/i })).toBeNull();
  });
});

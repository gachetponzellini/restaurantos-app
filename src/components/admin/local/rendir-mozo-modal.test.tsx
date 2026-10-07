import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CajaPayment } from "@/lib/caja/queries";
import type { SaldoMozo } from "@/lib/caja/turno-queries";
import { formatCurrency } from "@/lib/currency";

// Los mocks declaran los parámetros de la action real para que `mock.calls[0][0]`
// typechequee; el wrapper con arrow es porque la factory de `vi.mock` se hoistea.
type TurnoActions = typeof import("@/lib/caja/turno-actions");

const rendirMozo = vi.fn(
  async (..._args: Parameters<TurnoActions["rendirMozo"]>): ReturnType<TurnoActions["rendirMozo"]> => ({
    ok: true,
    data: { entregado_cents: 0, propina_pagada_cents: 0, saldo_restante_cents: 0, diferencia_cents: 0 },
  }),
);
const reconocerDeuda = vi.fn(
  async (..._args: Parameters<TurnoActions["reconocerDeuda"]>): ReturnType<TurnoActions["reconocerDeuda"]> => ({
    ok: true,
    data: { deuda_cents: 0 },
  }),
);

const imprimirLiquidacion = vi.fn(
  async (..._args: Parameters<TurnoActions["imprimirLiquidacion"]>): ReturnType<TurnoActions["imprimirLiquidacion"]> => ({
    ok: true,
    // Por defecto «ya estaba impreso»: así no suma un toast a los tests de la rendición.
    data: { impreso: false },
  }),
);

vi.mock("@/lib/caja/turno-actions", () => ({
  rendirMozo: (...args: Parameters<typeof rendirMozo>) => rendirMozo(...args),
  reconocerDeuda: (...args: Parameters<typeof reconocerDeuda>) => reconocerDeuda(...args),
  imprimirLiquidacion: (...args: Parameters<typeof imprimirLiquidacion>) => imprimirLiquidacion(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { RendirMozoModal } from "./rendir-mozo-modal";

function pesos(cents: number) {
  // formatCurrency separa con espacio duro; Testing Library normaliza el texto
  // del DOM a espacio común pero no el string con el que se busca.
  return formatCurrency(cents).replace(/ /g, " ");
}

function saldoMozo(over: Partial<SaldoMozo> = {}): SaldoMozo {
  return {
    mozo_id: "mozo-1",
    mozo_name: "Lucía Pérez",
    caja_id: "caja-1",
    caja_name: "Caja Salón",
    anterior_cents: 0,
    efectivo_cents: 100_000,
    propina_tarjeta_cents: 0,
    propina_efectivo_cents: 0,
    cobros_count: 3,
    entregado_cents: 0,
    pagado_cents: 0,
    saldo_cents: 100_000,
    resuelto: false,
    mesas_sin_cobrar: [],
    deuda: false,
    ...over,
  };
}

const onOpenChange = vi.fn();
const onRendido = vi.fn();

function abrir(saldo: SaldoMozo, cobros?: CajaPayment[]) {
  return render(
    <RendirMozoModal
      open
      onOpenChange={onOpenChange}
      slug="golf-jcr"
      saldo={saldo}
      cobros={cobros}
      onRendido={onRendido}
    />,
  );
}

describe("RendirMozoModal", () => {
  beforeEach(() => {
    rendirMozo.mockClear();
    reconocerDeuda.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    onOpenChange.mockClear();
    onRendido.mockClear();
  });

  it("muestra la cuenta: cobró, su propina, ya entregó y lo que tiene que entregar", () => {
    abrir(
      saldoMozo({
        anterior_cents: 10_000,
        efectivo_cents: 100_000,
        propina_tarjeta_cents: 5_000,
        entregado_cents: 20_000,
        pagado_cents: 2_000,
        saldo_cents: 87_000,
      }),
    );
    expect(screen.getByText("Rendición de Lucía Pérez")).toBeInTheDocument();
    expect(screen.getByText("Saldo anterior")).toBeInTheDocument();
    expect(screen.getByText(/Cobró en efectivo/)).toBeInTheDocument();
    expect(screen.getByText(/Su propina de tarjeta y QR/).closest("div")).toHaveTextContent(`− ${pesos(5_000)}`);
    expect(screen.getByText("Ya entregó").closest("div")).toHaveTextContent(`− ${pesos(20_000)}`);
    expect(screen.getByText("Le pagó la caja de propina")).toBeInTheDocument();
    expect(screen.getByText("Tiene que entregar").closest("div")).toHaveTextContent(pesos(87_000));
  });

  it("«Entregó $X justo» rinde el saldo exacto en la caja del saldo", async () => {
    rendirMozo.mockResolvedValueOnce({
      ok: true,
      data: { entregado_cents: 100_000, propina_pagada_cents: 0, saldo_restante_cents: 0, diferencia_cents: 0 },
    });
    abrir(saldoMozo());
    await userEvent.click(screen.getByRole("button", { name: `Entregó ${formatCurrency(100_000)} justo` }));

    await waitFor(() => expect(rendirMozo).toHaveBeenCalledTimes(1));
    expect(rendirMozo.mock.calls[0][0]).toMatchObject({
      slug: "golf-jcr",
      mozoId: "mozo-1",
      cajaId: "caja-1",
      entregadoCents: 100_000,
    });
    await waitFor(() => expect(onRendido).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccess).toHaveBeenCalledWith(`Lucía Pérez rindió ${formatCurrency(100_000)}.`);
  });

  it("al rendir menciona la propina de tarjeta que el mozo se quedó", async () => {
    rendirMozo.mockResolvedValueOnce({
      ok: true,
      data: { entregado_cents: 95_000, propina_pagada_cents: 0, saldo_restante_cents: 0, diferencia_cents: 0 },
    });
    abrir(saldoMozo({ propina_tarjeta_cents: 5_000, saldo_cents: 95_000 }));
    await userEvent.click(screen.getByRole("button", { name: `Entregó ${formatCurrency(95_000)} justo` }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toContain(`Ya se quedó con su propina de ${formatCurrency(5_000)}.`);
  });

  it("si la acción falla muestra el error y no cierra", async () => {
    rendirMozo.mockResolvedValueOnce({ ok: false, error: "Esa caja no se puede usar para rendir." });
    abrir(saldoMozo());
    await userEvent.click(screen.getByRole("button", { name: `Entregó ${formatCurrency(100_000)} justo` }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Esa caja no se puede usar para rendir."));
    expect(onRendido).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("«Entregó otro monto» manda el monto tipeado", async () => {
    rendirMozo.mockResolvedValueOnce({
      ok: true,
      data: { entregado_cents: 80_000, propina_pagada_cents: 0, saldo_restante_cents: 20_000, diferencia_cents: -20_000 },
    });
    abrir(saldoMozo());
    await userEvent.click(screen.getByRole("button", { name: "Entregó otro monto" }));

    // Mientras no hay monto, el botón lo dice y está apagado.
    expect(screen.getByRole("button", { name: "Cargá cuánto entregó" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("¿Cuánto entregó?"), "800");
    expect(screen.getByText(`Falta ${pesos(20_000)}. Queda en su saldo: lo puede traer después o marcarlo como «no entregó».`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: `Registrar entrega de ${formatCurrency(80_000)}` }));
    await waitFor(() => expect(rendirMozo).toHaveBeenCalledTimes(1));
    expect(rendirMozo.mock.calls[0][0]).toMatchObject({
      mozoId: "mozo-1",
      cajaId: "caja-1",
      entregadoCents: 80_000,
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        `Lucía Pérez entregó ${formatCurrency(80_000)}. Le falta ${formatCurrency(20_000)}.`,
      ),
    );
  });

  it("si entrega de más pide el motivo antes de registrar", async () => {
    abrir(saldoMozo());
    await userEvent.click(screen.getByRole("button", { name: "Entregó otro monto" }));
    await userEvent.type(screen.getByLabelText("¿Cuánto entregó?"), "1200");

    expect(screen.getByText(`Sobran ${pesos(20_000)}. Entran al cajón y quedan anotados: escribí por qué.`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escribí por qué sobra" })).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText("Trajo de más el cambio…"), "Trajo el cambio");
    await userEvent.click(screen.getByRole("button", { name: `Registrar entrega de ${formatCurrency(120_000)}` }));

    await waitFor(() => expect(rendirMozo).toHaveBeenCalledTimes(1));
    expect(rendirMozo.mock.calls[0][0]).toMatchObject({ entregadoCents: 120_000, notas: "Trajo el cambio" });
  });

  it("«Volver» deja la elección sin llamar a la acción", async () => {
    abrir(saldoMozo());
    await userEvent.click(screen.getByRole("button", { name: "Entregó otro monto" }));
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByRole("button", { name: `Entregó ${formatCurrency(100_000)} justo` })).toBeInTheDocument();
    expect(rendirMozo).not.toHaveBeenCalled();
  });

  it("«No entregó» exige el motivo y después reconoce la deuda", async () => {
    reconocerDeuda.mockResolvedValueOnce({ ok: true, data: { deuda_cents: 100_000 } });
    abrir(saldoMozo());
    await userEvent.click(screen.getByRole("button", { name: "No entregó" }));

    expect(screen.getByRole("button", { name: "Escribí el motivo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Escribí el motivo" }));
    expect(reconocerDeuda).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("¿Por qué no entregó?"), "Se fue temprano");
    await userEvent.click(screen.getByRole("button", { name: "Dejar como deuda" }));

    await waitFor(() => expect(reconocerDeuda).toHaveBeenCalledTimes(1));
    expect(reconocerDeuda.mock.calls[0][0]).toMatchObject({
      slug: "golf-jcr",
      mozoId: "mozo-1",
      cajaId: "caja-1",
      motivo: "Se fue temprano",
    });
    expect(rendirMozo).not.toHaveBeenCalled();
    await waitFor(() => expect(onRendido).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith(`Lucía Pérez quedó debiendo ${formatCurrency(100_000)}.`);
  });

  it("con saldo negativo ofrece darle la propina del cajón y rinde con 0", async () => {
    rendirMozo.mockResolvedValueOnce({
      ok: true,
      data: { entregado_cents: 0, propina_pagada_cents: 8_000, saldo_restante_cents: 0, diferencia_cents: 0 },
    });
    abrir(saldoMozo({ efectivo_cents: 0, propina_tarjeta_cents: 8_000, saldo_cents: -8_000 }));

    expect(screen.getByText("La caja le debe de propina")).toBeInTheDocument();
    // No se ofrece entregar nada.
    expect(screen.queryByRole("button", { name: "Entregó otro monto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No entregó" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: `Darle ${formatCurrency(8_000)} de propina del cajón` }));
    await waitFor(() => expect(rendirMozo).toHaveBeenCalledTimes(1));
    expect(rendirMozo.mock.calls[0][0]).toMatchObject({ mozoId: "mozo-1", cajaId: "caja-1", entregadoCents: 0 });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(`Le diste ${formatCurrency(8_000)} de propina a Lucía Pérez.`),
    );
  });

  it("con saldo 0 no hay nada que rendir y el botón solo cierra", async () => {
    abrir(saldoMozo({ efectivo_cents: 50_000, entregado_cents: 50_000, saldo_cents: 0, resuelto: true }));
    await userEvent.click(screen.getByRole("button", { name: "No tiene nada pendiente" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(rendirMozo).not.toHaveBeenCalled();
  });

  it("con mesas sin cobrar bloquea la entrega y manda al salón", async () => {
    abrir(
      saldoMozo({
        mesas_sin_cobrar: [{ orderId: "o-1", tableLabel: "4", saldoCents: 30_000 }],
      }),
    );
    expect(screen.getByText(/Tiene mesa 4 sin cobrar/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir al salón" })).toHaveAttribute("href", "/golf-jcr/admin/operacion?tab=salon");

    const primario = screen.getByRole("button", { name: "Cobrá sus mesas antes de rendir" });
    expect(primario).toBeDisabled();
    expect(screen.getByRole("button", { name: "Entregó otro monto" })).toBeDisabled();

    await userEvent.click(primario);
    expect(rendirMozo).not.toHaveBeenCalled();
  });

  it("si ya quedó como deuda avisa y no vuelve a ofrecer «No entregó»", () => {
    abrir(saldoMozo({ deuda: true, resuelto: true }));
    expect(screen.getByText(/Quedó registrado que no entregó/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No entregó" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Entregó ${formatCurrency(100_000)} justo` })).toBeInTheDocument();
  });

  it("lista los cobros del turno y aclara que tarjeta y QR no se rinden", () => {
    const cobros = [
      {
        id: "p-1",
        method: "cash",
        amount_cents: 60_000,
        tip_cents: 0,
        table_label: "2",
        customer_name: null,
        order_number: 11,
        created_at: "2026-10-06T21:30:00Z",
      },
      {
        id: "p-2",
        method: "mp_qr",
        amount_cents: 40_000,
        tip_cents: 4_000,
        table_label: null,
        customer_name: "Marta",
        order_number: 12,
        created_at: "2026-10-06T22:00:00Z",
      },
    ] as unknown as CajaPayment[];
    abrir(saldoMozo(), cobros);

    expect(screen.getByText("Sus cobros del turno")).toBeInTheDocument();
    expect(screen.getByText("Mesa 2")).toBeInTheDocument();
    expect(screen.getByText("Marta")).toBeInTheDocument();
    expect(screen.getByText(pesos(60_000))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`propina ${pesos(4_000).replace("$", "\\$")}`))).toBeInTheDocument();
    expect(screen.getByText("Tarjeta y QR ya entraron por el posnet: no se rinden.")).toBeInTheDocument();
  });

  describe("el papel de la rendición (spec 213)", () => {
    it("al abrir la rendición pide imprimir la liquidación de ese mozo en esa caja, sin forzar", async () => {
      imprimirLiquidacion.mockClear();
      abrir(saldoMozo({ saldo_cents: 60_000 }));
      await waitFor(() => expect(imprimirLiquidacion).toHaveBeenCalledTimes(1));
      expect(imprimirLiquidacion.mock.calls[0][0]).toMatchObject({ slug: "golf-jcr", mozoId: "mozo-1" });
      expect(imprimirLiquidacion.mock.calls[0][0].forzar).toBeUndefined();
    });

    it("«Reimprimir» fuerza el papel y puede llevar el detalle de cobros", async () => {
      const user = userEvent.setup();
      abrir(saldoMozo({ saldo_cents: 60_000 }));
      await waitFor(() => expect(imprimirLiquidacion).toHaveBeenCalled());
      imprimirLiquidacion.mockClear();
      await user.click(screen.getByRole("checkbox", { name: "Con el detalle de cobros" }));
      await user.click(screen.getByRole("button", { name: /Reimprimir/ }));
      await waitFor(() => expect(imprimirLiquidacion).toHaveBeenCalledTimes(1));
      expect(imprimirLiquidacion.mock.calls[0][0]).toMatchObject({ conCobros: true, forzar: true });
    });
  });
});

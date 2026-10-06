import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CajaPayment } from "@/lib/caja/queries";
import type { SaldoMozo } from "@/lib/caja/turno-queries";
import type { CajaLiveStats } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";

type OperacionActions = typeof import("@/app/[business_slug]/admin/(authed)/operacion/actions");

const getSaldosCajaTabData = vi.fn(
  async (
    ..._args: Parameters<OperacionActions["getSaldosCajaTabData"]>
  ): ReturnType<OperacionActions["getSaldosCajaTabData"]> => ({ ok: true, data: [] }),
);

vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getSaldosCajaTabData: (...args: Parameters<typeof getSaldosCajaTabData>) => getSaldosCajaTabData(...args),
}));

// El modal de rendición se abre desde acá; sus acciones no se ejecutan en estos tests.
vi.mock("@/lib/caja/turno-actions", () => ({
  rendirMozo: vi.fn(),
  reconocerDeuda: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { EfectivoDeLaCaja } from "./efectivo-de-la-caja";

function pesos(cents: number) {
  // formatCurrency separa con espacio duro; Testing Library normaliza el texto
  // del DOM a espacio común pero no el string con el que se busca.
  return formatCurrency(cents).replace(/ /g, " ");
}

const EMPTY_METODO = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
  mp_manual: 0,
  cuenta_corriente: 0,
};

function stats(over: Partial<CajaLiveStats> = {}, directoCents = 200_000): CajaLiveStats {
  return {
    caja_id: "caja-1",
    total_ventas_cents: 500_000,
    total_fiado_cents: 0,
    total_propinas_cents: 0,
    ventas_por_metodo: { ...EMPTY_METODO, cash: 285_000, mp_qr: 215_000 },
    cobros_por_metodo: { ...EMPTY_METODO },
    ventas_por_origen_y_metodo: {
      salon: { ...EMPTY_METODO },
      delivery: { ...EMPTY_METODO },
      takeaway: { ...EMPTY_METODO },
      otro: { ...EMPTY_METODO },
    },
    cobros_por_origen: { salon: 0, delivery: 0, takeaway: 0, otro: 0 },
    ventas_por_origen: { salon: 0, delivery: 0, takeaway: 0, otro: 0 },
    cobros_count: 0,
    expected_cash_cents: directoCents,
    periodo_desde: "2026-10-06T12:00:00Z",
    desglose_esperado: {
      apertura_cents: 0,
      retiro_cierre_cents: 0,
      efectivo_cents: directoCents,
      ingresos_cents: 0,
      sangrias_cents: 0,
      propinas_pagadas_cents: 0,
    },
    ...over,
  };
}

function saldo(over: Partial<SaldoMozo> = {}): SaldoMozo {
  return {
    mozo_id: "mozo-1",
    mozo_name: "Ana Gómez",
    caja_id: "caja-1",
    caja_name: "Caja Salón",
    anterior_cents: 0,
    efectivo_cents: 0,
    propina_tarjeta_cents: 0,
    propina_efectivo_cents: 0,
    cobros_count: 0,
    entregado_cents: 0,
    pagado_cents: 0,
    saldo_cents: 0,
    resuelto: false,
    mesas_sin_cobrar: [],
    deuda: false,
    ...over,
  };
}

const ANA_RINDIO = saldo({
  mozo_id: "mozo-1",
  mozo_name: "Ana Gómez",
  efectivo_cents: 50_000,
  entregado_cents: 50_000,
  saldo_cents: 0,
  resuelto: true,
});
const BETO_DEBE = saldo({
  mozo_id: "mozo-2",
  mozo_name: "Beto Ruiz",
  efectivo_cents: 35_000,
  propina_tarjeta_cents: 5_000,
  saldo_cents: 30_000,
});
const CAMI_LE_DEBEN = saldo({
  mozo_id: "mozo-3",
  mozo_name: "Cami Soto",
  propina_tarjeta_cents: 4_000,
  saldo_cents: -4_000,
});

const onChanged = vi.fn();

function abrir(
  over: { stats?: CajaLiveStats | null; active?: boolean; payments?: CajaPayment[]; refreshKey?: number } = {},
) {
  return render(
    <EfectivoDeLaCaja
      slug="golf-jcr"
      cajaId="caja-1"
      stats={over.stats === undefined ? stats() : over.stats}
      payments={over.payments ?? []}
      active={over.active ?? true}
      refreshKey={over.refreshKey ?? 0}
      onChanged={onChanged}
    />,
  );
}

/** El valor de un tile: el `<div>` que contiene el título. */
function tile(label: string) {
  return screen.getByText(label).closest("div") as HTMLElement;
}

describe("EfectivoDeLaCaja", () => {
  beforeEach(() => {
    getSaldosCajaTabData.mockReset();
    onChanged.mockClear();
    getSaldosCajaTabData.mockResolvedValue({ ok: true, data: [ANA_RINDIO, BETO_DEBE, CAMI_LE_DEBEN] });
  });

  it("carga los saldos de la caja desde el inicio del período", async () => {
    abrir();
    await screen.findByText("Ana Gómez");
    expect(getSaldosCajaTabData).toHaveBeenCalledWith("golf-jcr", "caja-1", "2026-10-06T12:00:00Z");
  });

  it("los tiles suman: lo cobró la caja, rendido, a rendir y propinas", async () => {
    abrir();
    await screen.findByText("Ana Gómez");

    expect(tile("Lo cobró la caja")).toHaveTextContent(pesos(200_000));
    expect(tile("Rendido por mozos")).toHaveTextContent(pesos(50_000));
    // A rendir: sólo lo que tienen encima (Beto); el saldo negativo de Cami no resta.
    expect(tile("A rendir")).toHaveTextContent(pesos(30_000));
    expect(tile("A rendir")).toHaveTextContent("En manos de Beto");
    // Propinas que se quedaron del efectivo: Beto 5.000. Cami no cobró en
    // efectivo: su propina se la debe la caja (fila «le debemos»), no salió
    // de ningún efectivo.
    expect(tile("Propinas de los mozos")).toHaveTextContent(pesos(5_000));
    // Sin deudas reconocidas, ese tile no se muestra.
    expect(screen.queryByText("Quedó como deuda")).not.toBeInTheDocument();
  });

  it("el total del período es la suma de los tiles", async () => {
    abrir();
    await screen.findByText("Ana Gómez");
    // 200.000 caja + 50.000 rendido + 30.000 a rendir + 5.000 propinas.
    expect(screen.getByText("Efectivo del período").closest("p")).toHaveTextContent(pesos(285_000));
  });

  it("propina pagada por la caja y saldo de antes: los tiles siguen sumando lo que tuvieron en la mano", async () => {
    // Traía 10.000, cobró 20.000, propina de tarjeta 8.000; la caja ya le
    // había pagado 3.000 de propina; entregó 15.000. Saldo = 10+20−8−15+3 = 10.
    const raro = saldo({
      mozo_id: "mozo-9", mozo_name: "Eva Luz", anterior_cents: 10_000, efectivo_cents: 20_000,
      propina_tarjeta_cents: 8_000, pagado_cents: 3_000, entregado_cents: 15_000, saldo_cents: 10_000,
    });
    getSaldosCajaTabData.mockResolvedValue({ ok: true, data: [raro] });
    abrir();
    await screen.findByText("Eva Luz");
    expect(tile("Rendido por mozos")).toHaveTextContent(pesos(15_000));
    expect(tile("A rendir")).toHaveTextContent(pesos(10_000));
    // Se quedó 8.000 − 3.000 que le pagó la caja = 5.000. 15 + 10 + 5 = 30 = 10 + 20.
    expect(tile("Propinas de los mozos")).toHaveTextContent(pesos(5_000));
    expect(screen.getByText(/traían de antes/)).toHaveTextContent(pesos(10_000));
  });

  it("una deuda reconocida va a su tile y no a «A rendir»", async () => {
    const debe = saldo({
      mozo_id: "mozo-4",
      mozo_name: "Darío Paz",
      efectivo_cents: 70_000,
      saldo_cents: 70_000,
      resuelto: true,
      deuda: true,
    });
    getSaldosCajaTabData.mockResolvedValue({ ok: true, data: [BETO_DEBE, debe] });
    abrir();
    await screen.findByText("Darío Paz");

    expect(tile("Quedó como deuda")).toHaveTextContent(pesos(70_000));
    expect(tile("A rendir")).toHaveTextContent(pesos(30_000));
    expect(within(screen.getByText("Darío Paz").closest("tr") as HTMLElement).getByRole("button")).toHaveTextContent(
      "Debe · ver",
    );
  });

  it("la fila de quien rindió dice «Rindió» y no tiene botón", async () => {
    abrir();
    const fila = (await screen.findByText("Ana Gómez")).closest("tr") as HTMLElement;
    expect(within(fila).getByText("Rindió")).toBeInTheDocument();
    expect(within(fila).queryByRole("button")).not.toBeInTheDocument();
  });

  it("quien todavía debe tiene el botón Rendir", async () => {
    abrir();
    const fila = (await screen.findByText("Beto Ruiz")).closest("tr") as HTMLElement;
    expect(within(fila).getByRole("button", { name: "Rendir a Beto Ruiz" })).toHaveTextContent("Rendir");
    expect(within(fila).getByText("− " + pesos(5_000))).toBeInTheDocument();
    expect(within(fila).getByText(pesos(30_000))).toBeInTheDocument();
  });

  it("a quien la caja le debe le ofrece «Darle propina»", async () => {
    abrir();
    const fila = (await screen.findByText("Cami Soto")).closest("tr") as HTMLElement;
    expect(within(fila).getByRole("button", { name: "Rendir a Cami Soto" })).toHaveTextContent("Darle propina");
    expect(within(fila).getByText(`le debemos ${pesos(4_000)}`)).toBeInTheDocument();
  });

  it("al tocar Rendir abre la rendición de ese mozo", async () => {
    abrir();
    await screen.findByText("Beto Ruiz");
    await userEvent.click(screen.getByRole("button", { name: "Rendir a Beto Ruiz" }));
    expect(await screen.findByText("Rendición de Beto Ruiz")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Entregó ${formatCurrency(30_000)} justo` })).toBeInTheDocument();
  });

  it("muestra la columna «Anterior» sólo si algún mozo trae saldo de antes", async () => {
    abrir();
    await screen.findByText("Ana Gómez");
    expect(screen.queryByRole("columnheader", { name: "Anterior" })).not.toBeInTheDocument();
  });

  it("con saldo anterior agrega la columna", async () => {
    getSaldosCajaTabData.mockResolvedValue({
      ok: true,
      data: [saldo({ mozo_name: "Eva Díaz", anterior_cents: 12_000, efectivo_cents: 8_000, saldo_cents: 20_000 })],
    });
    abrir();
    await screen.findByText("Eva Díaz");
    expect(screen.getByRole("columnheader", { name: "Anterior" })).toBeInTheDocument();
  });

  it("sin mozos con plata sólo muestra los tiles y dice que nadie tiene plata encima", async () => {
    getSaldosCajaTabData.mockResolvedValue({ ok: true, data: [] });
    abrir();
    await waitFor(() => expect(getSaldosCajaTabData).toHaveBeenCalled());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(tile("Lo cobró la caja")).toHaveTextContent(pesos(200_000));
    expect(screen.getByText("Nadie tiene plata encima")).toBeInTheDocument();
  });

  it("no carga si la pestaña no está activa ni sin período", async () => {
    abrir({ active: false });
    expect(getSaldosCajaTabData).not.toHaveBeenCalled();
    // Sin saldos cargados igual dibuja lo que cobró la caja.
    expect(tile("Lo cobró la caja")).toHaveTextContent(pesos(200_000));
  });

  it("sin stats no dibuja nada", () => {
    const { container } = abrir({ stats: null });
    expect(container).toBeEmptyDOMElement();
    expect(getSaldosCajaTabData).not.toHaveBeenCalled();
  });

  it("si la carga de fondo falla se queda con lo que tenía", async () => {
    getSaldosCajaTabData.mockRejectedValue(new TypeError("Failed to fetch"));
    abrir();
    await waitFor(() => expect(getSaldosCajaTabData).toHaveBeenCalled());
    expect(tile("Lo cobró la caja")).toHaveTextContent(pesos(200_000));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

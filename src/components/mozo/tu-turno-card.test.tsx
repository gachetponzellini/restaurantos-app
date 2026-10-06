import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { formatCurrency } from "@/lib/currency";

type TurnoActions = typeof import("@/lib/caja/turno-actions");
type MiTurno = import("@/lib/caja/turno-actions").MiTurno;

const getMiTurno = vi.fn(
  async (..._args: Parameters<TurnoActions["getMiTurno"]>): ReturnType<TurnoActions["getMiTurno"]> => ({
    ok: true,
    data: { cajas: [], mesas_sin_cobrar: [] },
  }),
);

vi.mock("@/lib/caja/turno-actions", () => ({
  getMiTurno: (...args: Parameters<typeof getMiTurno>) => getMiTurno(...args),
}));

import { TuTurnoCard } from "./tu-turno-card";

type CajaMiTurno = MiTurno["cajas"][number];

function caja(over: Partial<CajaMiTurno> = {}): CajaMiTurno {
  return {
    caja_name: "Principal",
    anterior_cents: 0,
    efectivo_cents: 0,
    propina_tarjeta_cents: 0,
    propina_efectivo_cents: 0,
    entregado_cents: 0,
    pagado_cents: 0,
    saldo_cents: 0,
    deuda: false,
    ...over,
  };
}

function conTurno(cajas: CajaMiTurno[], mesas: string[] = []) {
  getMiTurno.mockResolvedValue({ ok: true, data: { cajas, mesas_sin_cobrar: mesas } });
}

/** Testing Library normaliza el nbsp del DOM a espacio común; el string de búsqueda no. */
function pesos(cents: number) {
  return formatCurrency(cents).replace(/ /g, " ");
}

describe("TuTurnoCard", () => {
  beforeEach(() => {
    getMiTurno.mockReset();
  });

  it("pide el turno del slug", async () => {
    conTurno([]);
    render(<TuTurnoCard slug="golf-jcr" />);
    await screen.findByText(/No tenés nada para entregar/);
    expect(getMiTurno).toHaveBeenCalledWith("golf-jcr");
  });

  it("sin efectivo cobrado dice que no hay nada para entregar", async () => {
    conTurno([]);
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByText("No tenés nada para entregar en caja.")).toBeInTheDocument();
  });

  it("una caja donde sólo cobró con tarjeta (saldo 0, sin entregas) no es «entregá $0»", async () => {
    conTurno([caja({ saldo_cents: 0 })]);
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByText("No tenés nada para entregar en caja.")).toBeInTheDocument();
    expect(screen.queryByText("Tenés que entregar en caja")).not.toBeInTheDocument();
  });

  it("con saldo positivo muestra cuánto entregar y cómo sale el número", async () => {
    conTurno([
      caja({
        efectivo_cents: 100_000,
        propina_tarjeta_cents: 10_000,
        entregado_cents: 20_000,
        saldo_cents: 70_000,
      }),
    ]);
    render(<TuTurnoCard slug="golf-jcr" />);

    expect(await screen.findByText("Tenés que entregar en caja")).toBeInTheDocument();
    // El importe aparece en el hero y en la fila final «Entregás».
    expect(screen.getAllByText(pesos(70_000))).toHaveLength(2);
    expect(screen.getByText("En efectivo · ya descontada tu propina de tarjeta")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Cómo sale el número" })).toBeInTheDocument();
    expect(screen.getByText("Cobraste en efectivo").nextSibling).toHaveTextContent(pesos(100_000));
    // Propina de tarjeta y «ya entregaste» restan: van con el signo menos.
    expect(screen.getByText("Tu propina de tarjeta y QR (te la quedás)").nextSibling).toHaveTextContent(
      `− ${pesos(10_000)}`,
    );
    expect(screen.getByText("Ya entregaste").nextSibling).toHaveTextContent(`− ${pesos(20_000)}`);
    expect(screen.getByText("Entregás")).toBeInTheDocument();
    // Lo que no aplica no aparece.
    expect(screen.queryByText("Traías de antes")).not.toBeInTheDocument();
    expect(screen.queryByText("Te dieron de propina en caja")).not.toBeInTheDocument();
  });

  it("muestra lo que traía de antes y la propina en efectivo que no entra en la cuenta", async () => {
    conTurno([
      caja({ anterior_cents: 5_000, efectivo_cents: 20_000, propina_efectivo_cents: 3_000, saldo_cents: 25_000 }),
    ]);
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByText("Traías de antes")).toBeInTheDocument();
    expect(
      screen.getByText(`La propina en efectivo (${pesos(3_000)}) ya la tenés: no entra en la cuenta.`),
    ).toBeInTheDocument();
  });

  it("con saldo negativo dice que le dan propina en caja", async () => {
    conTurno([caja({ saldo_cents: -8_000, propina_tarjeta_cents: 8_000 })]);
    render(<TuTurnoCard slug="golf-jcr" />);

    expect(await screen.findByText("Te dan en caja de propina")).toBeInTheDocument();
    expect(screen.getAllByText(pesos(8_000)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Te dan en caja")).toBeInTheDocument();
    expect(screen.queryByText("Tenés que entregar en caja")).not.toBeInTheDocument();
  });

  it("con saldo 0 y plata entregada dice que rindió y no muestra importe", async () => {
    conTurno([caja({ efectivo_cents: 50_000, entregado_cents: 50_000, saldo_cents: 0 })]);
    render(<TuTurnoCard slug="golf-jcr" />);

    expect(await screen.findByText("Rendiste. No debés nada.")).toBeInTheDocument();
    expect(screen.queryByText("Tenés que entregar en caja")).not.toBeInTheDocument();
    expect(screen.getByText("Ya entregaste")).toBeInTheDocument();
  });

  it("con deuda reconocida avisa que quedó pendiente de entregar", async () => {
    conTurno([caja({ efectivo_cents: 30_000, saldo_cents: 30_000, deuda: true })]);
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByText("Quedó pendiente de entregar")).toBeInTheDocument();
  });

  it("con varias cajas rotula cada una por su nombre", async () => {
    conTurno([
      caja({ caja_name: "Principal", efectivo_cents: 10_000, saldo_cents: 10_000 }),
      caja({ caja_name: "Barra", efectivo_cents: 5_000, saldo_cents: 5_000 }),
    ]);
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByLabelText("Tu turno · Principal")).toBeInTheDocument();
    expect(screen.getByLabelText("Tu turno · Barra")).toBeInTheDocument();
  });

  it("sin mesas pendientes dice que puede ir a rendir", async () => {
    conTurno([caja({ efectivo_cents: 10_000, saldo_cents: 10_000 })], []);
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByText("Ninguna. Podés ir a rendir.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mesas sin cobrar" })).toBeInTheDocument();
  });

  it("avisa de la mesa sin cobrar", async () => {
    conTurno([caja({ efectivo_cents: 10_000, saldo_cents: 10_000 })], ["4"]);
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByRole("heading", { name: "Tenés la mesa 4 sin cobrar" })).toBeInTheDocument();
    expect(screen.getByText(/Cobrala antes de ir a rendir/)).toBeInTheDocument();
  });

  it("lista varias mesas sin cobrar", async () => {
    conTurno([caja({ efectivo_cents: 10_000, saldo_cents: 10_000 })], ["4", "7"]);
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(
      await screen.findByRole("heading", { name: "Tenés las mesas 4 y 7 sin cobrar" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cobralas antes de ir a rendir/)).toBeInTheDocument();
  });

  it("si getMiTurno devuelve error lo dice, en vez de desaparecer", async () => {
    getMiTurno.mockResolvedValue({ ok: false, error: "No tenés acceso a esto." });
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByText(/No pudimos cargar tu cuenta del turno/)).toBeInTheDocument();
  });

  it("si getMiTurno falla (red) lo dice", async () => {
    getMiTurno.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<TuTurnoCard slug="golf-jcr" />);
    expect(await screen.findByText(/No pudimos cargar tu cuenta del turno/)).toBeInTheDocument();
  });

  it("al volver a la app se refresca", async () => {
    conTurno([caja({ efectivo_cents: 50_000, saldo_cents: 50_000 })]);
    render(<TuTurnoCard slug="golf-jcr" />);
    await screen.findByText("Tenés que entregar en caja");
    conTurno([caja({ efectivo_cents: 50_000, entregado_cents: 50_000, saldo_cents: 0 })]);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(await screen.findByText("Rendiste. No debés nada.")).toBeInTheDocument();
  });
});

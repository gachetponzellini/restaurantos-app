import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CuentaAbierta } from "@/lib/caja/queries";
import type { CajaDelTurno, EstadoTurno, SaldoMozo } from "@/lib/caja/turno-queries";
import { formatCurrency } from "@/lib/currency";

type OperacionActions = typeof import("@/app/[business_slug]/admin/(authed)/operacion/actions");
type TurnoActions = typeof import("@/lib/caja/turno-actions");

const getEstadoTurnoTabData = vi.fn(
  async (
    ..._args: Parameters<OperacionActions["getEstadoTurnoTabData"]>
  ): ReturnType<OperacionActions["getEstadoTurnoTabData"]> => ({ ok: true, data: estado() }),
);

vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getEstadoTurnoTabData: (...args: Parameters<typeof getEstadoTurnoTabData>) => getEstadoTurnoTabData(...args),
}));

const cerrarTurno = vi.fn(
  async (..._args: Parameters<TurnoActions["cerrarTurno"]>): ReturnType<TurnoActions["cerrarTurno"]> => ({
    ok: true,
    data: { mesasLiberadas: 0, mozosLimpiados: 0 },
  }),
);

// El modal de rendición se abre desde la franja: necesita estas dos exports.
vi.mock("@/lib/caja/turno-actions", () => ({
  cerrarTurno: (...args: Parameters<typeof cerrarTurno>) => cerrarTurno(...args),
  rendirMozo: vi.fn(),
  reconocerDeuda: vi.fn(),
  imprimirLiquidacion: async () => ({ ok: true, data: { impreso: false } }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { CierreDelTurno } from "./cierre-del-turno";

function pesos(cents: number) {
  // formatCurrency separa con espacio duro; Testing Library normaliza el texto
  // del DOM a espacio común pero no el string con el que se busca.
  return formatCurrency(cents).replace(/ /g, " ");
}

function caja(over: Partial<CajaDelTurno> = {}): CajaDelTurno {
  return {
    id: "caja-1",
    name: "Principal",
    is_default: true,
    sin_contar: false,
    ultimo_corte_at: null,
    ...over,
  };
}

function mozo(over: Partial<SaldoMozo> = {}): SaldoMozo {
  return {
    mozo_id: "mozo-1",
    mozo_name: "Lucía Pérez",
    caja_id: "caja-1",
    caja_name: "Principal",
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

function cuenta(over: Partial<CuentaAbierta> = {}): CuentaAbierta {
  return {
    order_id: "o-4",
    order_number: 40,
    table_id: "t-4",
    table_label: "4",
    mozo_name: "Lucía Pérez",
    total_cents: 90_000,
    pendiente_cents: 60_000,
    ...over,
  };
}

/** Un turno con todo resuelto: sin mesas, sin mozos pendientes y la caja contada. */
function estado(over: Partial<EstadoTurno> = {}): EstadoTurno {
  return {
    turno_id: "turno-1",
    abierto_at: "2026-10-06T12:00:00Z",
    cuentas_abiertas: [],
    saldos: [],
    cajas: [caja()],
    ...over,
  };
}

const onContar = vi.fn();
const onChanged = vi.fn();

function abrir(cajaActivaId = "caja-1") {
  return render(
    <CierreDelTurno
      slug="golf-jcr"
      cajaActivaId={cajaActivaId}
      active
      refreshKey={0}
      onContar={onContar}
      onChanged={onChanged}
    />,
  );
}

function conEstado(e: EstadoTurno) {
  getEstadoTurnoTabData.mockResolvedValue({ ok: true, data: e });
}

/** El primario de la franja es el único botón o link con este texto exacto en su contenido. */
function primario(texto: string) {
  const candidatos = [...screen.queryAllByRole("button"), ...screen.queryAllByRole("link")].filter((el) => el.textContent?.trim() === texto);
  expect(candidatos).toHaveLength(1);
  return candidatos[0];
}

describe("CierreDelTurno", () => {
  beforeEach(() => {
    getEstadoTurnoTabData.mockReset();
    cerrarTurno.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    onContar.mockClear();
    onChanged.mockClear();
    conEstado(estado());
  });

  it("pide el estado del turno del slug", async () => {
    abrir();
    await screen.findByRole("heading", { name: "Cierre del turno" });
    expect(getEstadoTurnoTabData).toHaveBeenCalledWith("golf-jcr");
  });

  it("si no se pudo cargar lo dice en lugar del esqueleto", async () => {
    getEstadoTurnoTabData.mockResolvedValue({ ok: false, error: "Sin permiso" });
    abrir();
    expect(await screen.findByText("No se pudo cargar el cierre del turno: Sin permiso")).toBeInTheDocument();
  });

  describe("con cuentas abiertas", () => {
    it("no hay botón arriba: cada mesa tiene su «Cobrar», que vuelve al cierre", async () => {
      conEstado(estado({ cuentas_abiertas: [cuenta()], saldos: [mozo()], cajas: [caja({ sin_contar: true })] }));
      abrir();

      await screen.findByRole("heading", { name: "Cierre del turno" });
      expect(screen.queryByText(/mesas? abiertas?$/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Cobrar mesa 4$/ })).not.toBeInTheDocument();
      const fila = screen.getByRole("link", { name: `Cobrar Mesa 4, falta ${formatCurrency(60_000)}` });
      expect(fila).toHaveAttribute("href", "/golf-jcr/admin/mesa/t-4/cobrar?volver=%2Fgolf-jcr%2Fadmin%2Foperacion%3Ftab%3Dcaja%26caja%3Dcaja-1");
      expect(screen.getByText("Falta 1 mesa")).toBeInTheDocument();
      // Mientras haya mesas no se ofrece rendir ni cerrar.
      expect(screen.queryByRole("button", { name: /Rendir a/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cerrar el turno" })).not.toBeInTheDocument();
    });

    it("lista cada mesa con lo que falta cobrar", async () => {
      conEstado(
        estado({
          cuentas_abiertas: [cuenta(), cuenta({ order_id: "o-7", table_id: "t-7", table_label: "7", mozo_name: null, pendiente_cents: 25_000 })],
        }),
      );
      abrir();

      await screen.findByText("Faltan 2 mesas");
      const fila4 = screen.getByRole("link", { name: `Cobrar Mesa 4, falta ${formatCurrency(60_000)}` });
      expect(fila4).toHaveTextContent(`Cobrar ${pesos(60_000)}`);
      expect(fila4).toHaveAttribute("href", "/golf-jcr/admin/mesa/t-4/cobrar?volver=%2Fgolf-jcr%2Fadmin%2Foperacion%3Ftab%3Dcaja%26caja%3Dcaja-1");
      expect(screen.getByRole("link", { name: `Cobrar Mesa 7, falta ${formatCurrency(25_000)}` })).toHaveAttribute(
        "href",
        "/golf-jcr/admin/mesa/t-7/cobrar?volver=%2Fgolf-jcr%2Fadmin%2Foperacion%3Ftab%3Dcaja%26caja%3Dcaja-1",
      );
    });
    it("en el mismo listado van las cuentas cerradas con saldo, después y sin frenar el cierre", async () => {
      conEstado(
        estado({
          cuentas_abiertas: [cuenta()],
          cuentas_con_saldo: [
            {
              orderId: "o-208", orderNumber: 555, dailyNumber: 208, tableId: null, tableLabel: null,
              totalCents: 1_500_000, paidCents: 0, saldoCents: 1_500_000, cerrada: true,
            },
          ],
        }),
      );
      abrir();
      const lista = await screen.findByRole("region", { name: /Por cobrar/ });
      void lista;
      const listaPorCobrar = screen.getByRole("region", { name: /Por cobrar/ });
      const filas = within(listaPorCobrar).getAllByRole("listitem");
      expect(filas).toHaveLength(2);
      expect(filas[0]).toHaveTextContent("Mesa 4");
      expect(filas[1]).toHaveTextContent("Pedido #208");
      expect(filas[1]).toHaveTextContent("Cerrada con saldo: no frena el cierre");
      expect(within(filas[1]).getByRole("link")).toHaveAttribute("href", "/golf-jcr/admin/pedidos/historial?q=555");
      // Un solo aviso: no hay otro listado de «cuentas con saldo».
      expect(screen.queryByText(/cuentas con saldo pendiente/i)).not.toBeInTheDocument();
    });
  });

  describe("con mozos sin rendir", () => {
    it("no hay botón arriba: cada mozo tiene su «Rendir», que abre su rendición", async () => {
      conEstado(estado({ saldos: [mozo()], cajas: [caja({ sin_contar: true })] }));
      abrir();

      await screen.findByRole("heading", { name: "Cierre del turno" });
      expect(screen.getByText("Falta 1")).toBeInTheDocument();
      expect(screen.getByText(`tiene que entregar ${pesos(100_000)}`)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Rendir a Lucía Pérez$/ })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /Rendir a/ })).toHaveLength(1);

      await userEvent.click(screen.getByRole("button", { name: "Rendir a Lucía Pérez" }));
      expect(await screen.findByText("Rendición de Lucía Pérez")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Entregó ${formatCurrency(100_000)} justo` })).toBeInTheDocument();
    });

    it("con varios pendientes, cada uno con su botón y sin primario arriba", async () => {
      conEstado(
        estado({
          saldos: [mozo(), mozo({ mozo_id: "mozo-2", mozo_name: "Beto Ruiz", saldo_cents: 40_000 })],
          cajas: [caja({ sin_contar: true })],
        }),
      );
      abrir();

      await screen.findByText("Faltan 2");
      expect(screen.queryByText("Faltan 2 rendiciones")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Rendir a Beto Ruiz" }));
      expect(await screen.findByText("Rendición de Beto Ruiz")).toBeInTheDocument();
    });

    it("si la caja le debe al mozo, su fila lo dice y su rendición ofrece darle la propina", async () => {
      conEstado(
        estado({
          saldos: [mozo({ saldo_cents: -6_000, efectivo_cents: 0, propina_tarjeta_cents: 6_000 })],
          cajas: [caja({ sin_contar: true })],
        }),
      );
      abrir();

      await screen.findByText(`la caja le debe ${pesos(6_000)}`);
      await userEvent.click(screen.getByRole("button", { name: "Rendir a Lucía Pérez" }));
      expect(await screen.findByText("Rendición de Lucía Pérez")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Darle ${formatCurrency(6_000)} de propina del cajón` })).toBeInTheDocument();
    });

    it("los mozos ya resueltos no aparecen en la lista de pendientes", async () => {
      conEstado(
        estado({
          saldos: [mozo(), mozo({ mozo_id: "mozo-2", mozo_name: "Beto Ruiz", saldo_cents: 0, resuelto: true })],
          cajas: [caja({ sin_contar: true })],
        }),
      );
      abrir();
      await screen.findByText("Falta 1");
      expect(screen.queryByText("Beto Ruiz")).not.toBeInTheDocument();
    });
  });

  describe("con todo rendido y alguna caja sin contar", () => {
    it("el primario es contar la caja y avisa cuál", async () => {
      conEstado(estado({ cajas: [caja({ sin_contar: true })] }));
      abrir();

      await screen.findByRole("heading", { name: "Cierre del turno" });
      await userEvent.click(primario("Contar la caja Principal"));
      expect(onContar).toHaveBeenCalledTimes(1);
      expect(onContar).toHaveBeenCalledWith("caja-1");
      expect(cerrarTurno).not.toHaveBeenCalled();
    });

    it("con varias cajas elige la que está mirando", async () => {
      conEstado(
        estado({
          cajas: [
            caja({ id: "caja-1", name: "Principal", sin_contar: true }),
            caja({ id: "caja-2", name: "Barra", is_default: false, sin_contar: true }),
          ],
        }),
      );
      abrir("caja-2");

      await screen.findByText("Principal pendiente · Barra pendiente");
      await userEvent.click(primario("Contar la caja Barra"));
      expect(onContar).toHaveBeenCalledWith("caja-2");
    });

    it("si ya contó la que mira, ofrece la que falta", async () => {
      conEstado(
        estado({
          cajas: [
            caja({ id: "caja-1", name: "Principal", sin_contar: true }),
            caja({ id: "caja-2", name: "Barra", is_default: false, sin_contar: false }),
          ],
        }),
      );
      abrir("caja-2");

      await screen.findByText("Principal pendiente · Barra ✓");
      await userEvent.click(primario("Contar la caja Principal"));
      expect(onContar).toHaveBeenCalledWith("caja-1");
    });
  });

  describe("con todo resuelto", () => {
    it("«Cerrar el turno» pide confirmación antes de cerrar", async () => {
      abrir();

      await screen.findByText("Todas cobradas");
      expect(screen.getByText("Todos resueltos")).toBeInTheDocument();
      expect(screen.getByText("Contada")).toBeInTheDocument();

      await userEvent.click(primario("Cerrar el turno"));
      // Todavía no cerró: pregunta.
      expect(cerrarTurno).not.toHaveBeenCalled();
      expect(screen.getByText(/Al cerrar el turno se liberan las mesas/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sí, cerrar el turno" })).toBeInTheDocument();
    });

    it("al confirmar cierra el turno del slug y avisa", async () => {
      cerrarTurno.mockResolvedValueOnce({ ok: true, data: { mesasLiberadas: 3, mozosLimpiados: 2 } });
      abrir();

      await screen.findByText("Todas cobradas");
      await userEvent.click(primario("Cerrar el turno"));
      await userEvent.click(screen.getByRole("button", { name: "Sí, cerrar el turno" }));

      await waitFor(() => expect(cerrarTurno).toHaveBeenCalledTimes(1));
      expect(cerrarTurno).toHaveBeenCalledWith({ slug: "golf-jcr" });
      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith("Turno cerrado. Se liberaron 3 mesas. Arranca el turno siguiente."),
      );
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("sin mesas para liberar el aviso no las menciona", async () => {
      abrir();
      await screen.findByText("Todas cobradas");
      await userEvent.click(primario("Cerrar el turno"));
      await userEvent.click(screen.getByRole("button", { name: "Sí, cerrar el turno" }));
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Turno cerrado. Arranca el turno siguiente."));
    });

    it("«Cancelar» vuelve atrás sin cerrar", async () => {
      abrir();
      await screen.findByText("Todas cobradas");
      await userEvent.click(primario("Cerrar el turno"));
      await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(cerrarTurno).not.toHaveBeenCalled();
      expect(screen.queryByText(/Al cerrar el turno se liberan las mesas/)).not.toBeInTheDocument();
      expect(primario("Cerrar el turno")).toBeInTheDocument();
    });

    it("si cerrar falla muestra el error y no avisa a nadie", async () => {
      cerrarTurno.mockResolvedValueOnce({
        ok: false,
        error: "Hay mesas con la cuenta abierta. Cobralas antes de cerrar.",
      });
      abrir();

      await screen.findByText("Todas cobradas");
      await userEvent.click(primario("Cerrar el turno"));
      await userEvent.click(screen.getByRole("button", { name: "Sí, cerrar el turno" }));

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith("Hay mesas con la cuenta abierta. Cobralas antes de cerrar."),
      );
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });
  });
});

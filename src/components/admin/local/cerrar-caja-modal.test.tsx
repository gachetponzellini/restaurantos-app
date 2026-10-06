import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CierreCajaData } from "@/lib/caja/queries";
import type { RendicionMozoPendiente } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";

// Los mocks declaran los parámetros de la action real: sin eso `vi.fn` infiere
// una firma sin argumentos y `cerrarCaja.mock.calls[0][0]` no typechequea
// (tupla vacía). El wrapper con arrow es para que la factory de `vi.mock`,
// que se hoistea, resuelva la referencia recién al llamarla.
type CajaActions = typeof import("@/lib/caja/actions");

const cerrarCaja = vi.fn(
  async (..._args: Parameters<CajaActions["cerrarCaja"]>) => ({
    ok: true as const,
    data: {
      corte: { id: "corte-9" },
      retiro_cents: 312_400,
      mesasLiberadas: 0,
      mozosLimpiados: 0,
    },
  }),
);

vi.mock("@/lib/caja/actions", () => ({
  cerrarCaja: (...args: Parameters<typeof cerrarCaja>) => cerrarCaja(...args),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

let DATA: CierreCajaData;
/** Cuántas cargas más funcionan antes de que se corte la red (null = siempre). */
let CARGAS_OK: number | null = null;
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getCierreCajaTabData: async () => {
    if (CARGAS_OK !== null) {
      if (CARGAS_OK <= 0) throw new TypeError("Failed to fetch");
      CARGAS_OK -= 1;
    }
    return { ok: true, data: DATA };
  },
}));

import { CerrarCajaModal } from "./cerrar-caja-modal";

const EMPTY_METODO = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
  mp_manual: 0,  cuenta_corriente: 0,
};

function data(over: Partial<CierreCajaData> = {}): CierreCajaData {
  return {
    stats: {
      caja_id: "c1",
      total_fiado_cents: 0,
    total_ventas_cents: 500_000,
      total_propinas_cents: 12_000,
      ventas_por_metodo: { ...EMPTY_METODO, cash: 312_400, mp_qr: 187_600 },
      cobros_por_metodo: { ...EMPTY_METODO, cash: 4, mp_qr: 2 },
      ventas_por_origen_y_metodo: {
        salon: { ...EMPTY_METODO, cash: 312_400, mp_qr: 187_600 },
        delivery: { ...EMPTY_METODO },
        takeaway: { ...EMPTY_METODO },
        otro: { ...EMPTY_METODO },
      },
      cobros_por_origen: { salon: 6, delivery: 0, takeaway: 0, otro: 0 },
      ventas_por_origen: {
        salon: 400_000,
        delivery: 100_000,
        takeaway: 0,
        otro: 0,
      },
      cobros_count: 14,
      expected_cash_cents: 312_400,
      periodo_desde: "2026-08-30T12:00:00Z",
      desglose_esperado: {
        apertura_cents: 0,
        retiro_cierre_cents: 0,
        efectivo_cents: 312_400,
        ingresos_cents: 0,
        sangrias_cents: 0,
        propinas_pagadas_cents: 0,
      },
    },
    fondo_fijo_cents: 0,
    reparto: { en_cajon_cents: 312_400, mozos: [], descuadre_cents: 0 },
    cuentas_abiertas: [],
    pedidos_abiertos: [],
    salon: { mesas_a_liberar: 0, mozos_asignados: 0 },
    barre_salon: true,
    deben_rendir: [],
    sin_operadores: false,
    ...over,
  };
}

function pendiente(
  over: Partial<RendicionMozoPendiente> & { mozo_id: string; mozo_name: string },
): RendicionMozoPendiente {
  return {
    efectivo_cents: 71_200,
    efectivo_bruto_cents: 71_200,
    tickets_cents: 0,
    por_metodo: { ...EMPTY_METODO },
    total_propinas_cents: 0,
    propina_efectivo_cents: 0,
    propina_a_entregar_cents: 0,
    pagos_count: 3,
    por_canal: {},
    ...over,
  };
}


function pesos(cents: number) {
  // formatCurrency separa con espacio duro; Testing Library normaliza el texto
  // del DOM a espacio común pero no el string con el que se busca.
  return formatCurrency(cents).replace(/\u00a0/g, " ");
}

/** Carga el total (no por billete) y aprieta «Listo, conté». */
async function contarTotal(valor: string) {
  fireEvent.click(await screen.findByRole("button", { name: "El total" }));
  fireEvent.change(screen.getByLabelText(/Efectivo contado/i), {
    target: { value: valor },
  });
  fireEvent.click(screen.getByRole("button", { name: "Listo, conté" }));
  await screen.findByText("Debería haber");
}

function abrir() {
  return render(
    <CerrarCajaModal
      open
      onOpenChange={() => {}}
      slug="golf-jcr"
      cajaId="c1"
      cajaName="Caja principal"
      onCerrada={() => {}}
    />,
  );
}

const MESA_12 = {
  order_id: "o1",
  order_number: 128,
  table_id: "t1",
  table_label: "12",
  mozo_name: "Nacho",
  total_cents: 84_000,
  pendiente_cents: 84_000,
};

/**
 * Spec 209 — el modal es sólo para contar, y el conteo es ciego: lo que se fija
 * es que el número contra el que se compara no se vea hasta terminar de contar,
 * que un recuento deje rastro y que nunca haya un botón apagado sin decir qué
 * falta.
 */
describe("CerrarCajaModal · conteo ciego (spec 209)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    DATA = data();
  });

  it("mientras se cuenta no se ve cuánto debería haber ni la diferencia", async () => {
    abrir();
    expect(await screen.findByText("Contá la plata del cajón")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "El total" }));
    fireEvent.change(screen.getByLabelText(/Efectivo contado/i), {
      target: { value: "300000" },
    });
    expect(screen.queryByText(pesos(312_400))).not.toBeInTheDocument();
    expect(screen.queryByText(/Falta|Sobra|Cuadra/)).not.toBeInTheDocument();
  });

  it("arranca contando por billete y suma solo", async () => {
    abrir();
    const veintes = await screen.findByLabelText(/Billetes de .*20\.000/);
    fireEvent.change(veintes, { target: { value: "15" } });
    expect(screen.getByText(pesos(30_000_000))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Listo, conté" }));
    expect(await screen.findByText("Debería haber")).toBeInTheDocument();
    expect(screen.getByText("Sobra")).toBeInTheDocument();
    expect(screen.getByText(pesos(30_000_000 - 312_400))).toBeInTheDocument();
  });

  it("un día sin efectivo se declara en $0 sin buscar el otro modo", async () => {
    DATA = data({
      stats: { ...data().stats, expected_cash_cents: 0 },
    });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "No hay efectivo en el cajón" }));
    fireEvent.click(screen.getByRole("button", { name: "Listo, conté" }));
    expect(await screen.findByText("Cuadra")).toBeInTheDocument();
  });

  it("billetes con coma o negativos no ensucian el total", async () => {
    abrir();
    fireEvent.change(await screen.findByLabelText(/Billetes de .*20\.000/), {
      target: { value: "1.5" },
    });
    fireEvent.change(screen.getByLabelText(/Billetes de .*10\.000/), {
      target: { value: "-2" },
    });
    expect(screen.getByText(pesos(2_000_000))).toBeInTheDocument();
  });

  it("sin nada cargado, el botón dice qué falta en vez de apagarse mudo", async () => {
    abrir();
    const b = await screen.findByRole("button", { name: "Cargá lo que contaste" });
    expect(b).toBeDisabled();
  });

  it("con diferencia: dice Falta, pide el motivo y el botón lo explica", async () => {
    abrir();
    await contarTotal("3000");
    expect(screen.getByText("Falta")).toBeInTheDocument();
    expect(screen.getByText(pesos(12_400))).toBeInTheDocument();
    const b = screen.getByRole("button", { name: "Escribí qué pasó para cerrar" });
    expect(b).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Qué pasó/), {
      target: { value: "vuelto mal dado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar con esta diferencia" }));
    await waitFor(() => expect(cerrarCaja).toHaveBeenCalledTimes(1));
    expect(cerrarCaja.mock.calls[0][0]).toMatchObject({
      closing_cash_cents: 300_000,
      closing_notes: "vuelto mal dado",
      retirar: true,
      expected_visto_cents: 312_400,
      recuentos_cents: [],
    });
  });

  it("«Volver a contar» empieza de cero y el conteo descartado viaja al cierre", async () => {
    abrir();
    await contarTotal("3000");
    fireEvent.click(screen.getByRole("button", { name: /Volver a contar/ }));

    expect(await screen.findByText(/Recuento 2/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Efectivo contado/i)).toHaveValue(null);

    await contarTotal("3124");
    expect(screen.getByText("Cuadra")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cerrar caja y retirar/ }));
    await waitFor(() => expect(cerrarCaja).toHaveBeenCalledTimes(1));
    expect(cerrarCaja.mock.calls[0][0]).toMatchObject({
      closing_cash_cents: 312_400,
      recuentos_cents: [300_000],
    });
  });

  it("al cerrar lleva al resumen del cierre, no a un toast", async () => {
    abrir();
    await contarTotal("3124");
    fireEvent.click(screen.getByRole("button", { name: /Cerrar caja y retirar/ }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0][0]).toMatch(
      /^\/golf-jcr\/admin\/caja\/cierres\/corte-9\?recien=1$/,
    );
  });

  it("si entró plata mientras contaba, recalcula sin pedir que recuente (R6)", async () => {
    cerrarCaja.mockResolvedValueOnce({
      ok: false,
      error: "cambió",
      esperado_actual_cents: 317_400,
      delta_cents: 5_000,
    } as never);
    abrir();
    await contarTotal("3124");
    fireEvent.click(screen.getByRole("button", { name: /Cerrar caja y retirar/ }));

    expect(await screen.findByText(/mientras contabas/)).toBeInTheDocument();
    expect(screen.getByText(pesos(317_400))).toBeInTheDocument();
    expect(screen.getByText("Falta")).toBeInTheDocument();
    // Los $50 aparecen dos veces: lo que entró (banner) y lo que ahora falta.
    expect(screen.getAllByText(pesos(5_000))).toHaveLength(2);
    expect(push).not.toHaveBeenCalled();

    // Confirmar de nuevo manda el número nuevo, no el que vio al contar.
    fireEvent.change(screen.getByLabelText(/Qué pasó/), {
      target: { value: "entró un cobro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar con esta diferencia" }));
    await waitFor(() => expect(cerrarCaja).toHaveBeenCalledTimes(2));
    expect(cerrarCaja.mock.calls[1][0]).toMatchObject({ expected_visto_cents: 317_400 });
  });

  it("una mesa abierta: dice qué falta y lleva a cobrarla, sin dejar contar", async () => {
    DATA = data({ cuentas_abiertas: [MESA_12] });
    abrir();
    expect(await screen.findByText(/Antes de contar falta/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Cobrar/ });
    expect(link).toHaveAttribute("href", "/golf-jcr/admin/mesa/t1/cobrar");
    expect(screen.queryByText("Contá la plata del cajón")).not.toBeInTheDocument();
  });

  it("un mozo sin rendir también frena, y se dice dónde rendirlo", async () => {
    DATA = data({
      deben_rendir: [pendiente({ mozo_id: "m1", mozo_name: "Diego" })],
    });
    abrir();
    expect(await screen.findByText("Rendir a Diego")).toBeInTheDocument();
    expect(screen.getByText(/desde «Cierre del día»/)).toBeInTheDocument();
  });

  it("si se corta la red al terminar de contar, lo dice y deja reintentar", async () => {
    CARGAS_OK = 1; // abre bien; la re-lectura de «Listo, conté» falla
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "El total" }));
    fireEvent.change(screen.getByLabelText(/Efectivo contado/i), {
      target: { value: "3124" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Listo, conté" }));
    expect(await screen.findByText(/No hay conexión/)).toBeInTheDocument();
    expect(screen.queryByText("Debería haber")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listo, conté" })).toBeEnabled();
    CARGAS_OK = null;
  });

  it("anuncia lo que el cierre va a barrer antes de apretar", async () => {
    DATA = data({ salon: { mesas_a_liberar: 12, mozos_asignados: 4 } });
    abrir();
    await contarTotal("3124");
    expect(
      screen.getByText(/se liberan 12 mesas y se limpia la distribución de 4 mozos/),
    ).toBeInTheDocument();
  });
});

describe("cerrar caja · el fondo que queda en el cajón (spec 177)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin fondo, se retira todo y la caja arranca en $0", async () => {
    DATA = data();
    abrir();
    await contarTotal("3124");
    expect(screen.getByText(/y la caja arranca en \$0/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Cerrar caja y retirar \$\s3\.124$/ }),
    ).toBeInTheDocument();
  });

  it("con fondo, retira lo contado menos el fondo y lo explica", async () => {
    DATA = data({ fondo_fijo_cents: 50_000 });
    abrir();
    await contarTotal("3124");
    expect(
      screen.getByRole("button", { name: /Cerrar caja y retirar \$\s2\.624$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/quedan \$ 500 de fondo/)).toBeInTheDocument();
  });
});

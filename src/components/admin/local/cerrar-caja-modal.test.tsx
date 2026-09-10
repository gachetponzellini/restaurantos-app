import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CierreCajaData } from "@/lib/caja/queries";
import type { RendicionMozoPendiente } from "@/lib/caja/types";

// Los mocks declaran los parámetros de la action real: sin eso `vi.fn` infiere
// una firma sin argumentos y `cerrarCaja.mock.calls[0][0]` no typechequea
// (tupla vacía). El wrapper con arrow es para que la factory de `vi.mock`,
// que se hoistea, resuelva la referencia recién al llamarla.
type CajaActions = typeof import("@/lib/caja/actions");

const cerrarCaja = vi.fn(
  async (..._args: Parameters<CajaActions["cerrarCaja"]>) => ({
    ok: true as const,
    data: {
      corte: {},
      retiro_cents: 312_400,
      mesasLiberadas: 0,
      mozosLimpiados: 0,
    },
  }),
);
const registrarRendicionMozo = vi.fn(
  async (..._args: Parameters<CajaActions["registrarRendicionMozo"]>) => ({
    ok: true as const,
    data: {},
  }),
);

vi.mock("@/lib/caja/actions", () => ({
  cerrarCaja: (...args: Parameters<typeof cerrarCaja>) => cerrarCaja(...args),
  registrarRendicionMozo: (...args: Parameters<typeof registrarRendicionMozo>) =>
    registrarRendicionMozo(...args),
}));

let DATA: CierreCajaData;
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getCierreCajaTabData: async () => ({ ok: true, data: DATA }),
}));

import { CerrarCajaModal } from "./cerrar-caja-modal";

const EMPTY_METODO = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
  cuenta_corriente: 0,
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
    pagos_count: 3,
    ...over,
  };
}

/**
 * El campo es `type="number"` y el Dialog toma el foco al abrirse: tipear
 * carácter por carácter perdía el primero cada tantas corridas y el test se
 * volvía flaky. Un `change` directo dice lo mismo sin la carrera.
 */
function contar(valor: string) {
  fireEvent.change(screen.getByLabelText(/Efectivo contado/i), {
    target: { value: valor },
  });
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

/**
 * Lo que se fija acá es el criterio del cierre, no el pixel: que la mesa
 * abierta frene el botón (D7), que el retiro sea una casilla y no un número
 * tipeado (D2) y que el mozo sin rendir esté a la vista **antes** de contar
 * (D5/D6) — que es lo que hace que la diferencia del arqueo ya venga explicada.
 */
describe("CerrarCajaModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("una mesa con la cuenta abierta bloquea el cierre y se dice cuál", async () => {
    DATA = data({
      cuentas_abiertas: [
        {
          order_id: "o1",
          order_number: 128,
          table_id: "t1",
          table_label: "12",
          mozo_name: "Nacho",
          total_cents: 84_000,
          pendiente_cents: 84_000,
        },
      ],
    });
    abrir();

    expect(
      await screen.findByText(/Hay una mesa con la cuenta abierta/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Mesa 12")).toBeInTheDocument();
    expect(screen.getByText(/Nacho/)).toBeInTheDocument();

    const cerrar = screen.getByRole("button", { name: /Cerrar caja/i });
    expect(cerrar).toBeDisabled();
  });

  it("el delivery abierto avisa pero no frena", async () => {
    DATA = data({
      pedidos_abiertos: [
        {
          order_id: "o2",
          order_number: 130,
          origen: "delivery",
          customer_name: "Ana",
          total_cents: 20_000,
        },
      ],
    });
    const user = userEvent.setup();
    abrir();

    expect(
      await screen.findByText(/No frenan el cierre/i),
    ).toBeInTheDocument();

    contar("3124");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cerrar caja/i })).toBeEnabled(),
    );
  });

  it("el CTA dice cuánto se retira, y cambia si se destilda la casilla", async () => {
    DATA = data();
    const user = userEvent.setup();
    abrir();

    await screen.findByLabelText(/Efectivo contado/i);
    contar("3124");
    expect(
      await screen.findByRole("button", { name: /Cerrar caja y retirar/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: /Cerrar caja sin retirar/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sin retirar/i }));
    await waitFor(() => expect(cerrarCaja).toHaveBeenCalled());
    expect(cerrarCaja.mock.calls[0][0]).toMatchObject({
      cajaId: "c1",
      closing_cash_cents: 312_400,
      retirar: false,
    });
  });

  it("con diferencia pide motivo antes de dejar cerrar", async () => {
    DATA = data();
    const user = userEvent.setup();
    abrir();

    // Cuenta $3.000 contra $3.124 esperados: faltan $124.
    await screen.findByLabelText(/Efectivo contado/i);
    contar("3000");
    expect(await screen.findByText("Te falta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cerrar caja/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/Qué pasó/i), "vuelto mal dado");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cerrar caja/i })).toBeEnabled(),
    );
  });

  it("el mozo sin rendir aparece con su monto y **frena** el cierre (139 · D1)", async () => {
    DATA = data({
      reparto: {
        en_cajon_cents: 198_000,
        mozos: [
          { mozo_id: "m1", mozo_name: "Nacho", efectivo_cents: 71_200 },
          { mozo_id: "m2", mozo_name: "Caro", efectivo_cents: 43_200 },
        ],
        descuadre_cents: 0,
      },
      deben_rendir: [
        pendiente({ mozo_id: "m1", mozo_name: "Nacho", efectivo_cents: 71_200 }),
        pendiente({ mozo_id: "m2", mozo_name: "Caro", efectivo_cents: 43_200 }),
      ],
    });
    abrir();

    expect(await screen.findByText("Nacho")).toBeInTheDocument();
    expect(screen.getByText("Caro")).toBeInTheDocument();
    expect(screen.getAllByText(/sin rendir/i)).toHaveLength(2);
    expect(
      screen.getByText(/Faltan 2 rendiciones para poder cerrar/i),
    ).toBeInTheDocument();

    // Aunque el arqueo cuadre perfecto, no se cierra hasta resolverlos.
    contar("3124");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cerrar caja/i })).toBeDisabled(),
    );
  });

  it("la rendición no se autocompleta: el monto se tipea (139 · D2)", async () => {
    DATA = data({
      deben_rendir: [
        pendiente({ mozo_id: "m1", mozo_name: "Nacho", efectivo_cents: 71_200 }),
      ],
    });
    const user = userEvent.setup();
    abrir();

    await user.click(await screen.findByRole("button", { name: "Rendir" }));

    // Sin número, el botón no se puede apretar: antes esto rendía $71.200 solo.
    const registrar = screen.getByRole("button", { name: /Registrar rendición/i });
    expect(registrar).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Efectivo que entrega/i), {
      target: { value: "712" },
    });
    await waitFor(() => expect(registrar).toBeEnabled());
    await user.click(registrar);

    await waitFor(() => expect(registrarRendicionMozo).toHaveBeenCalled());
    expect(registrarRendicionMozo.mock.calls[0]).toEqual([
      "m1",
      71_200,
      null,
      "golf-jcr",
      "rendida",
    ]);
  });

  it("«No entregó» exige el motivo y deja la deuda declarada (139 · D1)", async () => {
    DATA = data({
      deben_rendir: [
        pendiente({ mozo_id: "m1", mozo_name: "Nacho", efectivo_cents: 71_200 }),
      ],
    });
    const user = userEvent.setup();
    abrir();

    await user.click(await screen.findByRole("button", { name: "No entregó" }));

    const marcar = screen.getByRole("button", { name: /Marcar como no entregó/i });
    expect(marcar).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Por qué/i), {
      target: { value: "se fue temprano" },
    });
    await waitFor(() => expect(marcar).toBeEnabled());
    await user.click(marcar);

    await waitFor(() => expect(registrarRendicionMozo).toHaveBeenCalled());
    expect(registrarRendicionMozo.mock.calls[0]).toEqual([
      "m1",
      0,
      "se fue temprano",
      "golf-jcr",
      "no_entrego",
    ]);
  });

  it("el que cobró sólo con tarjeta también rinde (139 · D4)", async () => {
    DATA = data({
      deben_rendir: [
        pendiente({
          mozo_id: "m3",
          mozo_name: "Lucía",
          efectivo_cents: 0,
          tickets_cents: 84_400,
        }),
      ],
    });
    abrir();

    expect(await screen.findByText("Lucía")).toBeInTheDocument();
    expect(screen.getByText(/sólo tickets/i)).toBeInTheDocument();
  });

  it("avisa cuando la caja no tiene operador asignado (139 · D3)", async () => {
    DATA = data({ sin_operadores: true });
    abrir();

    expect(
      await screen.findByText(/Nadie figura como operador de esta caja/i),
    ).toBeInTheDocument();
  });

  it("anuncia lo que el cierre va a barrer antes de apretar", async () => {
    DATA = data({ salon: { mesas_a_liberar: 12, mozos_asignados: 4 } });
    abrir();

    expect(await screen.findByText(/liberan 12 mesas/i)).toBeInTheDocument();
    expect(screen.getByText(/distribución de 4 mozos/i)).toBeInTheDocument();
  });
});

// ── Spec 177 · Parte C — el fondo de caja ────────────────────────────────
//
// La spec 130 · D2 había descartado el fondo de cambio por «una decisión menos
// a la 1 de la mañana». Con el fondo CONFIGURADO no hay decisión que tomar: el
// cierre lo aplica solo y la casilla dice cuánto queda.
describe("cerrar caja · el fondo que queda en el cajón (spec 177)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin fondo, la casilla dice que se retira todo", async () => {
    DATA = data();
    abrir();
    await screen.findByLabelText(/Efectivo contado/i);
    contar("3124");

    expect(screen.getByText(/Retirar todo el efectivo/i)).toBeInTheDocument();
  });

  it("con fondo, retira lo contado menos el fondo y lo explica", async () => {
    DATA = data({ fondo_fijo_cents: 100_000 });
    abrir();
    await screen.findByLabelText(/Efectivo contado/i);
    contar("3124");

    // Contado $3.124, fondo $1.000 → se retiran $2.124 y quedan $1.000.
    expect(screen.getAllByText(/\$ 2\.124/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/quedan .* de fondo para el próximo turno/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Retirar todo el efectivo/i)).toBeNull();
  });
});

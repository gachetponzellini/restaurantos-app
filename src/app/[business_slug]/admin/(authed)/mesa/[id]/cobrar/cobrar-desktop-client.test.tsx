import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { CobrarDesktopClient } from "./cobrar-desktop-client";
import type { IniciarCobroResult } from "@/lib/billing/cobro-actions";
import type { CuentaState } from "@/lib/billing/types";

// #137 — el cobro de mesa del ENCARGADO era el único de los cuatro puntos de
// cobro sin UI de facturación. Como el encargado tampoco llega a la sección
// Facturación (`permissions/sections.ts` le da "none"), no tenía NINGUNA
// pantalla desde donde emitir: se cobraba y el comprobante no salía nunca.
// Estos tests fijan que la sección aparezca con la mesa cobrada y AFIP
// configurado — y que sin AFIP la pantalla quede como estaba.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/billing/cobro-actions", () => ({
  anularCobro: vi.fn(),
  iniciarPagoMp: vi.fn(),
  registrarPago: vi.fn(),
}));
vi.mock("@/lib/afip/emit-invoice", () => ({
  emitInvoice: vi.fn(),
  retryInvoice: vi.fn(),
}));
vi.mock("@/lib/afip/poll", () => ({ waitForInvoiceTerminal: vi.fn() }));
vi.mock("@/lib/caja/use-caja-preferida", () => ({
  useCajaPreferida: () => ["caja-1", vi.fn()],
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

const TOTAL = 350_000;

/** Mesa cobrada = la ORDEN CERRÓ (señal del server). No alcanza con que la
 *  suma del cliente dé cero: ver el test de la orden abierta con total 0. */
function cuentaCobrada(
  over: Partial<CuentaState["order"]> = {},
): CuentaState {
  return {
    order: {
      id: "ord-1",
      business_id: "biz-1",
      order_number: 34,
      table_id: "tbl-1",
      tip_cents: 0,
      discount_cents: 0,
      discount_reason: null,
      lifecycle_status: "closed",
      total_cents: TOTAL,
      closed_at: "2026-08-04T21:47:55Z",
      total_paid_cents: TOTAL,
      ...over,
    },
    items: [],
    splits: [
      {
        id: "split-1",
        order_id: "ord-1",
        business_id: "biz-1",
        split_mode: "por_personas",
        split_index: 0,
        expected_amount_cents: TOTAL,
        tip_cents: 0,
        paid_amount_cents: TOTAL,
        status: "paid",
        label: null,
      },
    ],
    totals: {
      subtotal_cents: TOTAL,
      tip_cents: 0,
      discount_cents: 0,
      total_cents: TOTAL,
    },
    last_mozo_id: null,
  } as CuentaState;
}

function init(cuenta: CuentaState): IniciarCobroResult {
  return {
    order: {
      id: cuenta.order.id,
      business_id: cuenta.order.business_id,
      order_number: cuenta.order.order_number,
      table_id: cuenta.order.table_id,
      lifecycle_status: cuenta.order.lifecycle_status,
      status: cuenta.order.status,
      total_cents: cuenta.order.total_cents,
      total_paid_cents: cuenta.order.total_paid_cents,
      tip_cents: cuenta.order.tip_cents,
      discount_cents: cuenta.order.discount_cents,
    },
    splits: cuenta.splits,
    hasImplicitSplit: false,
    cajas: [
      {
        id: "caja-1",
        business_id: "biz-1",
        name: "Principal",
        is_active: true,
        sort_order: 0,
        is_default: true,
        is_administrative: false,
  fondo_fijo_cents: 0,
      },
    ],
    methodConfigs: [],
  } as IniciarCobroResult;
}

function setup(
  afipConfigured: boolean,
  over: Partial<CuentaState["order"]> = {},
) {
  const cuenta = cuentaCobrada(over);
  return render(
    <CobrarDesktopClient
      slug="golf-jcr"
      tableId="tbl-1"
      tableLabel="Mesa 4"
      role="encargado"
      cuenta={cuenta}
      init={init(cuenta)}
      afipConfigured={afipConfigured}
    />,
  );
}

describe("CobrarDesktopClient · facturación del encargado (#137)", () => {
  it("con la mesa cobrada y AFIP configurado ofrece emitir el comprobante", () => {
    setup(true);
    expect(screen.getAllByText("Mesa cobrada").length).toBeGreaterThan(0);
    expect(screen.getByText("Emitir comprobante")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Emitir Factura B/ }),
    ).toBeInTheDocument();
  });

  it("invita a emitir antes de volver al salón", () => {
    setup(true);
    expect(
      screen.getByText("Emití el comprobante o volvé al salón."),
    ).toBeInTheDocument();
    // La salida sigue estando: no encerramos al encargado en la pantalla.
    expect(
      screen.getAllByRole("button", { name: /Volver al salón/ }).length,
    ).toBeGreaterThan(0);
  });

  it("sin AFIP configurado la pantalla queda como estaba (sin facturación)", () => {
    setup(false);
    expect(screen.getAllByText("Mesa cobrada").length).toBeGreaterThan(0);
    expect(screen.queryByText("Emitir comprobante")).not.toBeInTheDocument();
    expect(
      screen.getByText("La mesa se va a marcar para limpiar."),
    ).toBeInTheDocument();
  });

  // Una orden ABIERTA con total 0 —mesa sin ítems, todo anulado, descuento del
  // 100%— da `totalPending === 0` sin que nadie haya pagado, y no se cierra
  // sola nunca (`closeOrderIfFullyPaid` exige `total_cents > 0`). Si el gate
  // fuera la suma del cliente, ahí se ofrecería emitir un comprobante fiscal
  // de una mesa impaga.
  it("una orden abierta con total 0 NO ofrece facturar", () => {
    setup(true, {
      lifecycle_status: "open",
      closed_at: null,
      total_cents: 0,
      total_paid_cents: 0,
    });
    expect(screen.queryByText("Emitir comprobante")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Emitir Factura/ }),
    ).not.toBeInTheDocument();
  });

  it("con la orden cerrada no quedan sub-cuentas ofreciendo cobrar", () => {
    setup(true);
    // Los splits de `init` quedaron viejos (no hay refetch): no se listan.
    expect(screen.queryByText("Pago único")).not.toBeInTheDocument();
  });
});

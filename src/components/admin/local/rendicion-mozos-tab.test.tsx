import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RendicionMozoPendiente } from "@/lib/caja/types";

vi.mock("@/lib/caja/actions", () => ({
  registrarRendicionMozo: vi.fn(async () => ({ ok: true as const, data: {} })),
}));
vi.mock("@/lib/caja/rendicion-print-actions", () => ({
  imprimirRendicion: vi.fn(async () => ({
    ok: true as const,
    data: { print_job_id: "pj-1", reimpresion: false },
  })),
}));

vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getRendicionTabData: async () => ({
    ok: false as const,
    error: "sin refetch",
  }),
}));

// El panel de asignaciones trae su propio árbol (y sus propias actions); acá se
// renderiza con `showAssignments: false`, pero el import igual se evalúa.
vi.mock("@/components/admin/local/caja-assignments-tab", () => ({
  CajaAssignmentsPanel: () => null,
}));

import { RendicionMozosTab } from "./rendicion-mozos-tab";

const EMPTY_METODO = {
  cash: 0,
  card_manual: 0,
  mp_link: 0,
  mp_qr: 0,
  transfer: 0,
  other: 0,
  cuenta_corriente: 0,
};

/**
 * Un mozo con cobros mixtos: $18.500 en efectivo y $38.500 con tarjeta.
 * Es el caso real que motivó la spec 151 (Lucía, en `demo`).
 */
function pendienteMixto(
  over: Partial<RendicionMozoPendiente> = {},
): RendicionMozoPendiente {
  return {
    mozo_id: "m1",
    mozo_name: "Lucía Moza",
    efectivo_cents: 1_850_000,
    efectivo_bruto_cents: 1_850_000,
    tickets_cents: 3_850_000,
    por_metodo: { ...EMPTY_METODO, cash: 1_850_000, card_manual: 3_850_000 },
    total_propinas_cents: 0,
    pagos_count: 2,
    ...over,
  };
}

type Historial = React.ComponentProps<typeof RendicionMozosTab>["initialHistorial"];

function renderTab(
  pendientes: RendicionMozoPendiente[],
  historial: Historial = [],
) {
  return render(
    <RendicionMozosTab
      slug="demo"
      initialPendientes={pendientes}
      initialHistorial={historial}
      cajas={[]}
      cajaAssignments={[]}
      members={[]}
      showAssignments={false}
    />,
  );
}

describe("rendición · sólo se rinde el efectivo (spec 151)", () => {
  // #330 — lo cobrado con otros métodos vuelve, pero sólo informativo: el
  // monto a entregar sigue siendo el efectivo y la leyenda lo dice.
  it("muestra el efectivo a entregar y la tarjeta como informativo", () => {
    renderTab([pendienteMixto()]);

    expect(screen.getByText("$ 18.500")).toBeInTheDocument();
    expect(screen.getByText(/otros cobros · informativo/i)).toBeInTheDocument();
    expect(screen.getByText("Tarjeta")).toBeInTheDocument();
    expect(screen.getByText("$ 38.500")).toBeInTheDocument();
    expect(screen.getByText(/sólo se rinde el efectivo/i)).toBeInTheDocument();
  });

  it("no vuelve el rótulo de tickets", () => {
    renderTab([pendienteMixto()]);
    expect(screen.queryByText(/tickets/i)).not.toBeInTheDocument();
  });

  it("el modal pide el efectivo y la tarjeta queda como informativo", async () => {
    const user = userEvent.setup();
    renderTab([pendienteMixto()]);

    await user.click(
      screen.getByRole("button", { name: /registrar rendición/i }),
    );

    expect(
      await screen.findByText(/efectivo que debería entregar/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$ 18.500").length).toBeGreaterThan(0);
    // Tarjeta del listado + modal.
    expect(screen.getAllByText(/sólo se rinde el efectivo/i)).toHaveLength(2);
    expect(screen.queryByText(/en tickets/i)).not.toBeInTheDocument();
  });

  it("un mozo con sólo efectivo no muestra el bloque informativo", () => {
    renderTab([
      pendienteMixto({ por_metodo: { ...EMPTY_METODO, cash: 1_850_000 } }),
    ]);
    expect(screen.queryByText(/otros cobros/i)).not.toBeInTheDocument();
  });

  // Spec 177 · Parte B — la propina dejó de ser un número informativo: se le
  // paga en esta misma rendición y sale del cajón.
  it("la propina se muestra como lo que hay que pagarle", () => {
    renderTab([pendienteMixto({ total_propinas_cents: 420_000 })]);

    expect(screen.getByText(/propina a pagarle/i)).toBeInTheDocument();
    expect(screen.getByText("$ 4.200")).toBeInTheDocument();
  });

  it("el mozo que cobró todo con tarjeta sigue en la lista, con $0 (spec 139 · D4)", () => {
    renderTab([
      pendienteMixto({
        mozo_name: "Diego Mozo",
        efectivo_cents: 0,
        por_metodo: { ...EMPTY_METODO, card_manual: 3_850_000 },
        pagos_count: 1,
      }),
    ]);

    expect(screen.getByText("Diego Mozo")).toBeInTheDocument();
    expect(screen.getByText("$ 0")).toBeInTheDocument();
    expect(screen.getByText("$ 38.500")).toBeInTheDocument();
  });

  describe("el mozo que no tiene efectivo para entregar", () => {
    function soloTarjeta() {
      return pendienteMixto({
        mozo_name: "Diego Mozo",
        efectivo_cents: 0,
        por_metodo: { ...EMPTY_METODO, card_manual: 3_850_000 },
        pagos_count: 1,
      });
    }

    it("le explica que no hay nada que entregar, en vez de pedirle $0", async () => {
      renderTab([soloTarjeta()]);
      await userEvent.click(
        screen.getByRole("button", { name: /registrar rendición/i }),
      );

      expect(
        screen.getByText(/no tiene efectivo para entregar/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/efectivo que debería entregar/i),
      ).not.toBeInTheDocument();
    });

    it("no ofrece «No entregó»: una deuda de $0 avisada al dueño es ruido", async () => {
      renderTab([soloTarjeta()]);
      await userEvent.click(
        screen.getByRole("button", { name: /registrar rendición/i }),
      );

      expect(
        screen.queryByRole("button", { name: /no entregó/i }),
      ).not.toBeInTheDocument();
    });

    it("cierra el período de un toque, sin tipear un cero a mano", async () => {
      const { registrarRendicionMozo } = await import("@/lib/caja/actions");
      renderTab([soloTarjeta()]);
      await userEvent.click(
        screen.getByRole("button", { name: /registrar rendición/i }),
      );

      const cerrar = screen.getByRole("button", { name: /cerrar período/i });
      expect(cerrar).toBeEnabled();
      await userEvent.click(cerrar);

      // Se registra como rendición normal en $0, NO como deuda declarada.
      expect(registrarRendicionMozo).toHaveBeenCalledWith(
        "m1",
        0,
        null,
        "demo",
        "rendida",
      );
    });

    it("con efectivo, el flujo de siempre no cambia", async () => {
      renderTab([pendienteMixto()]);
      await userEvent.click(
        screen.getByRole("button", { name: /registrar rendición/i }),
      );

      expect(
        screen.getByText(/efectivo que debería entregar/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /no entregó/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/no tiene efectivo para entregar/i),
      ).not.toBeInTheDocument();
    });
  });
});

// ── Spec 178 — el papel de la rendición, a pedido ─────────────────────────
describe("rendición · el ticket por mozo (spec 178)", () => {
  const rendida: Historial[number] = {
    id: "r1",
    business_id: "biz",
    mozo_id: "m1",
    mozo_name: "Lucía Moza",
    registered_by: "s1",
    registered_by_name: "Sofía",
    expected_cash_cents: 1_850_000,
    delivered_cash_cents: 1_850_000,
    difference_cents: 0,
    notes: null,
    por_metodo: { ...EMPTY_METODO, cash: 1_850_000 },
    estado: "rendida",
    propina_pagada_cents: 420_000,
    created_at: "2026-09-10T23:41:00Z",
  };

  it("cada rendición del historial tiene su botón de imprimir", () => {
    renderTab([], [rendida]);
    expect(
      screen.getByRole("button", { name: /imprimir rendición de lucía moza/i }),
    ).toBeInTheDocument();
  });

  it("apretar manda ESA rendición, y el botón pasa a «Reimprimir»", async () => {
    // Es el cableado que a la 177 se le escapó: que el botón llame a la action
    // con el id correcto, no sólo que la action exista.
    const { imprimirRendicion } = await import(
      "@/lib/caja/rendicion-print-actions"
    );
    renderTab([], [rendida]);

    const boton = screen.getByRole("button", {
      name: /imprimir rendición de lucía moza/i,
    });
    await userEvent.click(boton);

    expect(imprimirRendicion).toHaveBeenCalledWith("r1", "demo");
    expect(await screen.findByText(/reimprimir/i)).toBeInTheDocument();
  });
});

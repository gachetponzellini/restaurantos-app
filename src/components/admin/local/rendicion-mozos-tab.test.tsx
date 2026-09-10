import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RendicionMozoPendiente } from "@/lib/caja/types";

vi.mock("@/lib/caja/actions", () => ({
  registrarRendicionMozo: vi.fn(async () => ({ ok: true as const, data: {} })),
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

function renderTab(pendientes: RendicionMozoPendiente[]) {
  return render(
    <RendicionMozosTab
      slug="demo"
      initialPendientes={pendientes}
      initialHistorial={[]}
      cajas={[]}
      cajaAssignments={[]}
      members={[]}
      showAssignments={false}
    />,
  );
}

describe("rendición · sólo se rinde el efectivo (spec 151)", () => {
  it("muestra el efectivo y NO el monto cobrado con tarjeta", () => {
    renderTab([pendienteMixto()]);

    expect(screen.getByText("$ 18.500")).toBeInTheDocument();
    // El monto de tarjeta no se rinde: no puede estar en ningún lado de la
    // tarjeta del mozo. Antes aparecía dos veces — como «Tickets
    // (tarj./transf.)» y otra vez en «Detalle por método».
    expect(screen.queryByText("$ 38.500")).not.toBeInTheDocument();
  });

  it("no queda ni el rótulo de tickets ni el desglose por método", () => {
    renderTab([pendienteMixto()]);

    expect(screen.queryByText(/tickets/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/detalle por método/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tarjeta/i)).not.toBeInTheDocument();
  });

  it("el modal pide el efectivo y tampoco nombra la tarjeta", async () => {
    const user = userEvent.setup();
    renderTab([pendienteMixto()]);

    await user.click(
      screen.getByRole("button", { name: /registrar rendición/i }),
    );

    expect(
      await screen.findByText(/efectivo que debería entregar/i),
    ).toBeInTheDocument();
    // El monto sigue siendo sólo el efectivo, y no hay línea «+ $X en tickets».
    expect(screen.getAllByText("$ 18.500").length).toBeGreaterThan(0);
    expect(screen.queryByText("$ 38.500")).not.toBeInTheDocument();
    expect(screen.queryByText(/en tickets/i)).not.toBeInTheDocument();
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
    expect(screen.queryByText("$ 38.500")).not.toBeInTheDocument();
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

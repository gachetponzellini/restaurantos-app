import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { CierreCajaData } from "@/lib/caja/queries";
import type { RendicionMozoPendiente } from "@/lib/caja/types";

let DATA: CierreCajaData;
vi.mock("@/app/[business_slug]/admin/(authed)/operacion/actions", () => ({
  getCierreCajaTabData: async () => ({ ok: true, data: DATA }),
}));

// El modal de rendición se prueba aparte (rendicion-en-caja); acá importa a
// quién se le abre y con qué datos.
vi.mock("@/components/admin/local/rendicion-en-caja", () => ({
  RendirModal: ({ pendiente }: { pendiente: RendicionMozoPendiente }) => (
    <div role="dialog" aria-label={`Rendición de ${pendiente.mozo_name}`}>
      mesas sin cobrar: {pendiente.mesas_sin_cobrar?.length ?? "—"}
    </div>
  ),
}));

import { CierreDelDia } from "./cierre-del-dia";

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

function data(over: Partial<CierreCajaData> = {}): CierreCajaData {
  return {
    stats: {} as CierreCajaData["stats"],
    fondo_fijo_cents: 0,
    reparto: { en_cajon_cents: 0, mozos: [], descuadre_cents: 0 },
    cuentas_abiertas: [],
    pedidos_abiertos: [],
    salon: { mesas_a_liberar: 0, mozos_asignados: 0 },
    barre_salon: true,
    deben_rendir: [],
    sin_operadores: false,
    ...over,
  };
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

const onContar = vi.fn();

function montar(pendientesConMesas: RendicionMozoPendiente[] = []) {
  return render(
    <CierreDelDia
      slug="golf-jcr"
      cajaId="c1"
      active
      refreshKey={0}
      pendientesConMesas={pendientesConMesas}
      onContar={onContar}
      onChanged={() => {}}
    />,
  );
}

/**
 * Spec 209 · R1/R2 — la franja muestra los tres pasos y **un** primario que
 * siempre es el próximo. Lo que se fija: que nunca haya un botón de cierre
 * apagado y mudo, y que cada pendiente lleve a resolverse.
 */
describe("CierreDelDia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("con una mesa abierta, el primario es cobrarla y lleva a su cobro", async () => {
    DATA = data({
      cuentas_abiertas: [MESA_12],
      deben_rendir: [pendiente({ mozo_id: "m1", mozo_name: "Diego" })],
    });
    montar();
    const primario = await screen.findByRole("link", { name: "Cobrar mesa 12" });
    expect(primario).toHaveAttribute("href", "/golf-jcr/admin/mesa/t1/cobrar");
    expect(screen.getByText("Falta 1 mesa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Contar y cerrar/ })).not.toBeInTheDocument();
  });

  it("sin mesas y con un mozo sin rendir, el primario le abre la rendición", async () => {
    DATA = data({ deben_rendir: [pendiente({ mozo_id: "m1", mozo_name: "Diego" })] });
    montar();
    // El primario y la fila de Diego abren lo mismo; se prueba el primario.
    fireEvent.click((await screen.findAllByRole("button", { name: "Rendir a Diego" }))[0]);
    expect(screen.getByRole("dialog", { name: "Rendición de Diego" })).toBeInTheDocument();
  });

  it("la rendición se abre con los datos del board, que traen las mesas sin cobrar", async () => {
    DATA = data({ deben_rendir: [pendiente({ mozo_id: "m1", mozo_name: "Diego" })] });
    montar([
      pendiente({
        mozo_id: "m1",
        mozo_name: "Diego",
        mesas_sin_cobrar: [{ table_id: "t5", table_label: "5" } as never],
      }),
    ]);
    fireEvent.click((await screen.findAllByRole("button", { name: "Rendir a Diego" }))[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent("mesas sin cobrar: 1");
  });

  it("el que cobró sólo con tarjeta también está en la lista (139 · D4)", async () => {
    DATA = data({
      deben_rendir: [
        pendiente({ mozo_id: "m1", mozo_name: "Diego", efectivo_cents: 0, tickets_cents: 90_000 }),
        pendiente({ mozo_id: "m2", mozo_name: "Ana" }),
      ],
    });
    montar();
    expect(await screen.findByRole("button", { name: /Faltan 2 rendiciones/ })).toBeInTheDocument();
    expect(screen.getByText("sin efectivo")).toBeInTheDocument();
    expect(screen.getByText(/tiene que entregar/)).toBeInTheDocument();
  });

  it("todo resuelto: el primario es «Contar y cerrar»", async () => {
    DATA = data();
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Contar y cerrar/ }));
    expect(onContar).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Todas cobradas")).toBeInTheDocument();
    expect(screen.getByText("Todos rindieron")).toBeInTheDocument();
  });

  it("la caja del bar no pide mesas ni rendiciones: sólo contar", async () => {
    DATA = data({ barre_salon: false });
    montar();
    expect(await screen.findByRole("button", { name: /Contar y cerrar/ })).toBeEnabled();
    expect(screen.queryByText("Mesas cobradas")).not.toBeInTheDocument();
  });

  it("avisa cuando la caja no tiene operador asignado (139 · D3)", async () => {
    DATA = data({
      sin_operadores: true,
      deben_rendir: [pendiente({ mozo_id: "m1", mozo_name: "Diego" })],
    });
    montar();
    expect(await screen.findByText(/Nadie figura como operador/)).toBeInTheDocument();
  });

  it("nunca muestra un botón primario apagado", async () => {
    DATA = data({ cuentas_abiertas: [MESA_12] });
    montar();
    await screen.findByRole("link", { name: "Cobrar mesa 12" });
    for (const b of screen.queryAllByRole("button")) expect(b).toBeEnabled();
  });
});

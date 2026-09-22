import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductModal } from "./product-modal";
import type { CatalogProduct } from "@/lib/mozo/catalog-query";

/**
 * Los atajos del modal de alta de ítem: `/` marca «Como entrada» (spec 050,
 * atajo agregado en la 075) y `+`/`−` mueven la cantidad (spec 055 fast-follow).
 * En Observaciones ninguno aplica — ahí una barra es una barra.
 */

const MILANESA = {
  id: "p1",
  name: "Milanesa",
  description: null,
  price_cents: 100000,
  image_url: null,
  category_id: "c1",
  station_id: null,
  show_online: true,
  modifier_groups: [],
} as unknown as CatalogProduct;

function abrir(
  onAdd = vi.fn(),
  props: Partial<React.ComponentProps<typeof ProductModal>> = {},
) {
  render(
    <ProductModal
      open
      product={MILANESA}
      onClose={vi.fn()}
      onAdd={onAdd}
      {...props}
    />,
  );
  return { onAdd };
}

const comoEntrada = () => screen.getByRole("button", { name: /Como entrada/ });
const agregar = () => screen.getByRole("button", { name: /Agregar/i });

describe("<ProductModal /> — atajos de teclado", () => {
  it("`/` marca el ítem como entrada", async () => {
    const user = userEvent.setup();
    abrir();

    expect(comoEntrada()).toHaveAttribute("aria-pressed", "false");
    await user.keyboard("/");
    expect(comoEntrada()).toHaveAttribute("aria-pressed", "true");
  });

  it("`/` de nuevo lo desmarca", async () => {
    const user = userEvent.setup();
    abrir();

    await user.keyboard("/");
    await user.keyboard("/");
    expect(comoEntrada()).toHaveAttribute("aria-pressed", "false");
  });

  it("la observación sale con el marcador antepuesto", async () => {
    const user = userEvent.setup();
    const { onAdd } = abrir();

    await user.keyboard("/");
    await user.type(screen.getByPlaceholderText(/sin jamón/i), "sin sal");
    await user.click(agregar());

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].notes).toBe("Como entrada · sin sal");
  });

  it("escribiendo en Observaciones, `/` es una barra", async () => {
    const user = userEvent.setup();
    abrir();

    const obs = screen.getByPlaceholderText(/sin jamón/i);
    await user.click(obs);
    await user.keyboard("1/2");

    expect(obs).toHaveValue("1/2");
    expect(comoEntrada()).toHaveAttribute("aria-pressed", "false");
  });

  it("`+` y `−` mueven la cantidad, y en Observaciones no", async () => {
    const user = userEvent.setup();
    const { onAdd } = abrir();

    await user.keyboard("+++");
    await user.click(agregar());
    expect(onAdd.mock.calls[0][0].quantity).toBe(4);
  });
});

describe("<ProductModal /> — «Como entrada» sólo donde hay tiempos que ordenar", () => {
  it("en el mostrador no aparece ni responde al atajo", async () => {
    const user = userEvent.setup();
    const { onAdd } = abrir(vi.fn(), { permiteComoEntrada: false });

    expect(
      screen.queryByRole("button", { name: /Como entrada/ }),
    ).not.toBeInTheDocument();

    // La barra no marca nada: la nota sale sin el marcador.
    await user.keyboard("/");
    await user.click(agregar());
    expect(onAdd.mock.calls[0][0].notes).not.toMatch(/Como entrada/);
  });
});

/**
 * Esc confirma, como en Maxirest (issue #374). La encargada carga sin mouse:
 * Enter en «a punto», `+` para la cantidad, y Esc por costumbre. Esc tiene que
 * dejar el ítem cargado como lo especificó. Si el modal se abrió y no se tocó
 * nada, Esc sigue cancelando: cubre el producto abierto por error.
 */
const ENTRECOTE = {
  ...MILANESA,
  id: "p2",
  name: "Entrecote",
  modifier_groups: [
    {
      id: "g1",
      name: "Punto de cocción",
      min_selection: 1,
      max_selection: 1,
      is_required: true,
      modifiers: [
        { id: "m1", group_id: "g1", name: "Jugoso", price_delta_cents: 0 },
        { id: "m2", group_id: "g1", name: "A punto", price_delta_cents: 0 },
      ],
    },
  ],
} as unknown as CatalogProduct;

const SALSAS = {
  ...MILANESA,
  id: "p3",
  name: "Ñoquis",
  modifier_groups: [
    {
      id: "g2",
      name: "Salsa",
      min_selection: 1,
      max_selection: 1,
      is_required: true,
      modifiers: [
        { id: "s1", group_id: "g2", name: "Tuco", price_delta_cents: 0 },
      ],
    },
    {
      id: "g3",
      name: "Extra",
      min_selection: 1,
      max_selection: 2,
      is_required: true,
      modifiers: [
        { id: "e1", group_id: "g3", name: "Queso", price_delta_cents: 0 },
      ],
    },
  ],
} as unknown as CatalogProduct;

describe("<ProductModal /> — Esc confirma el ítem (issue #374)", () => {
  it("sin tocar nada, Esc cancela", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { onAdd } = abrir(vi.fn(), { onClose });

    await user.keyboard("{Escape}");

    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter en «a punto», `+` y Esc: el ítem queda cargado así", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { onAdd } = abrir(vi.fn(), { product: ENTRECOTE, onClose });

    await user.keyboard("{ArrowDown}{Enter}++{Escape}");

    expect(onAdd).toHaveBeenCalledTimes(1);
    const item = onAdd.mock.calls[0][0];
    expect(item.modifiers.map((m: { name: string }) => m.name)).toEqual([
      "A punto",
    ]);
    expect(item.quantity).toBe(3);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter sobre la opción preelegida («Seguir») ya cuenta como tocar", async () => {
    const user = userEvent.setup();
    const { onAdd } = abrir(vi.fn(), { product: ENTRECOTE });

    await user.keyboard("{Enter}{Escape}");

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].modifiers[0].name).toBe("Jugoso");
  });

  it("si falta un obligatorio, Esc avisa y no cierra", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { onAdd } = abrir(vi.fn(), { product: SALSAS, onClose });

    await user.keyboard("+{Escape}");

    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("la X sigue cancelando aunque se haya tocado algo", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { onAdd } = abrir(vi.fn(), { onClose });

    await user.keyboard("++");
    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("<ProductModal /> — Observaciones sin mouse (issue #374)", () => {
  const obs = () => screen.getByPlaceholderText(/sin jamón/i);

  it("tipear una letra fuera de Observaciones la escribe ahí", async () => {
    const user = userEvent.setup();
    abrir(vi.fn(), { product: ENTRECOTE });

    await user.keyboard("{Enter}sin sal");

    expect(obs()).toHaveValue("sin sal");
    expect(obs()).toHaveFocus();
  });

  it("Enter en Observaciones agrega; Shift+Enter hace salto de línea", async () => {
    const user = userEvent.setup();
    const { onAdd } = abrir();

    await user.click(obs());
    await user.keyboard("sin sal{Shift>}{Enter}{/Shift}bien cocido");
    expect(onAdd).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].notes).toBe("sin sal\nbien cocido");
  });

  it("Esc con una observación escrita la confirma", async () => {
    const user = userEvent.setup();
    const { onAdd } = abrir(vi.fn(), { product: ENTRECOTE });

    await user.keyboard("{Enter}con tuco{Escape}");

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].notes).toBe("con tuco");
  });
});

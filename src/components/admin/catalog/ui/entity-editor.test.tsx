import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  EditorLinkList,
  EntityEditor,
  type EntityEditorProps,
} from "./entity-editor";

function setup(over: Partial<EntityEditorProps> = {}) {
  const props: EntityEditorProps = {
    onClose: vi.fn(),
    title: "Bife de chorizo",
    eyebrow: "Parrilla",
    dirty: false,
    onSave: vi.fn(),
    nav: { index: 1, total: 3, onPrev: vi.fn(), onNext: vi.fn() },
    sections: [
      { id: "basico", label: "Básico", content: <input aria-label="Nombre" /> },
      {
        id: "precio",
        label: "Precio y costo",
        content: (
          <EditorLinkList
            items={[
              {
                key: "i",
                label: "Aceite",
                onOpen: over.back ? vi.fn() : vi.fn(),
              },
            ]}
          />
        ),
      },
    ],
    ...over,
  };
  render(<EntityEditor {...props} />);
  return { props, user: userEvent.setup() };
}

describe("EntityEditor (spec 205 · D4/D6)", () => {
  it("muestra título, posición en la lista y el índice de secciones", () => {
    setup();
    expect(
      screen.getByRole("dialog", { name: "Bife de chorizo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Precio y costo" }),
    ).toBeInTheDocument();
  });

  it("← → recorren la lista fuera de un campo, no adentro", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Básico" }));
    await user.keyboard("{ArrowRight}");
    expect(props.nav!.onNext).toHaveBeenCalledTimes(1);
    await user.keyboard("{ArrowLeft}");
    expect(props.nav!.onPrev).toHaveBeenCalledTimes(1);
    await user.click(screen.getByLabelText("Nombre"));
    await user.keyboard("{ArrowRight}");
    expect(props.nav!.onNext).toHaveBeenCalledTimes(1);
  });

  it("⌘↵ guarda (también desde un campo) y Guardar no cierra", async () => {
    const { props, user } = setup();
    await user.click(screen.getByLabelText("Nombre"));
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(props.onSave).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /^Guardar/ }));
    expect(props.onSave).toHaveBeenCalledTimes(2);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("sin cambios, cerrar cierra de una", async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("con cambios, cerrar y ‹ › piden confirmar; «Seguir editando» no hace nada", async () => {
    const { props, user } = setup({ dirty: true });
    expect(screen.getByText("● Cambios sin guardar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(props.nav!.onNext).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(props.nav!.onNext).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("abierto por un enlace: muestra «Volver a …» y Esc vuelve un nivel", async () => {
    const onBack = vi.fn();
    const { props, user } = setup({
      back: { label: "Parrilla", onBack },
      nav: null,
    });
    await user.click(screen.getByRole("button", { name: /Volver a Parrilla/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

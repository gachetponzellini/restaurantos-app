import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";

import { useSlashToFocus } from "./use-slash-to-focus";

function Harness({ dialog = false, enabled = true }) {
  const ref = useRef<HTMLInputElement>(null);
  useSlashToFocus(ref, enabled);
  return (
    <>
      <button type="button">afuera</button>
      <input aria-label="otro" />
      <input aria-label="buscar" ref={ref} />
      {dialog && <div role="dialog" aria-modal="true" />}
    </>
  );
}

describe("useSlashToFocus — «/» lleva al buscador (spec 205 · D2)", () => {
  it("desde cualquier lado de la página enfoca el buscador sin escribir la barra", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("afuera"));
    await user.keyboard("/");
    const buscar = screen.getByLabelText("buscar");
    expect(buscar).toHaveFocus();
    expect(buscar).toHaveValue("");
  });

  it("escribiendo en otro campo, la barra es una barra", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText("otro"));
    await user.keyboard("/");
    expect(screen.getByLabelText("otro")).toHaveValue("/");
  });

  it("con un modal abierto no le roba el foco", async () => {
    const user = userEvent.setup();
    render(<Harness dialog />);
    await user.click(screen.getByText("afuera"));
    await user.keyboard("/");
    expect(screen.getByLabelText("buscar")).not.toHaveFocus();
  });

  it("deshabilitado no hace nada", async () => {
    const user = userEvent.setup();
    render(<Harness enabled={false} />);
    await user.click(screen.getByText("afuera"));
    await user.keyboard("/");
    expect(screen.getByLabelText("buscar")).not.toHaveFocus();
  });
});

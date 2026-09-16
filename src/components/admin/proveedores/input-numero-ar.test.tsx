import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InputNumeroAR } from "./input-numero-ar";

/**
 * Spec 198·D4 — lo que tipeó Rocío, tecla por tecla.
 *
 * Se tipea de a un carácter a propósito: el bug viejo no estaba en el valor final
 * sino en el camino, donde «2,» ya valía `NaN` y borraba lo escrito.
 */
function Probador({ inicial = null }: { inicial?: number | null }) {
  const [v, setV] = useState<number | null>(inicial);
  return (
    <>
      <InputNumeroAR aria-label="campo" value={v} onValue={setV} />
      <output data-testid="valor">{v === null ? "null" : String(v)}</output>
    </>
  );
}

function tipear(input: HTMLElement, texto: string) {
  fireEvent.focus(input);
  let acumulado = "";
  for (const c of texto) {
    acumulado += c;
    fireEvent.change(input, { target: { value: acumulado } });
    // Lo que se ve tiene que ser siempre lo tipeado, carácter por carácter.
    expect((input as HTMLInputElement).value).toBe(acumulado);
  }
}

describe("InputNumeroAR", () => {
  it("«2,900» son 2 kilos 900, y la coma no borra nada en el camino", () => {
    render(<Probador />);
    const input = screen.getByLabelText("campo");
    tipear(input, "2,900");
    expect(screen.getByTestId("valor").textContent).toBe("2.9");
  });

  it("«72.500» son setenta y dos mil quinientos", () => {
    render(<Probador />);
    const input = screen.getByLabelText("campo");
    tipear(input, "72.500");
    expect(screen.getByTestId("valor").textContent).toBe("72500");
  });

  it("al salir del campo muestra el número formateado", () => {
    render(<Probador />);
    const input = screen.getByLabelText("campo");
    tipear(input, "2,9");
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe("2,9");
  });

  it("vacío es null, no cero", () => {
    render(<Probador inicial={5} />);
    const input = screen.getByLabelText("campo");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("valor").textContent).toBe("null");
  });

  it("afuera del foco sigue al valor que llega de afuera", () => {
    const { rerender } = render(<InputNumeroAR aria-label="campo" value={14.5} onValue={() => {}} />);
    expect((screen.getByLabelText("campo") as HTMLInputElement).value).toBe("14,5");
    rerender(<InputNumeroAR aria-label="campo" value={3} onValue={() => {}} />);
    expect((screen.getByLabelText("campo") as HTMLInputElement).value).toBe("3");
  });
});

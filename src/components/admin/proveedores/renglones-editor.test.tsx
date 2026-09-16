import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SupplierInvoiceItemInput } from "@/lib/proveedores/schema";

import { RenglonesEditor, type InsumoOption } from "./renglones-editor";

/**
 * Spec 199 — el renglón de Rocío, en el componente de verdad.
 *
 * «Yo cargo manteca, tengo 5 kilos, y pongo el total, 58 mil, y ahí me suma 290
 * mil.» Lo que se fija acá es la forma de la fila: se tipean cantidad y total, el
 * precio se calcula, y lo que llega a `onChange` —lo que va al server— son envases
 * y el precio del envase.
 */

const MANTECA: InsumoOption = {
  id: "00000000-0000-4000-8000-00000000000a",
  name: "Manteca",
  unit: "kg",
  presentationId: "00000000-0000-4000-8000-00000000000b",
  presentationName: "Pan 200g",
  netQuantity: 0.2,
  costCents: 2_169_60,
};

function Probador({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const [items, setItems] = useState<SupplierInvoiceItemInput[]>([
    {
      ingredient_id: MANTECA.id,
      presentation_id: MANTECA.presentationId,
      units: 1,
      unit_cost_cents: MANTECA.costCents!,
    },
  ]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <RenglonesEditor
        insumos={[MANTECA]}
        value={items}
        onChange={setItems}
        totalComprobanteCents={0}
      />
      <output data-testid="items">{JSON.stringify(items)}</output>
      <button type="submit">Cargar compra</button>
    </form>
  );
}

const items = () =>
  JSON.parse(screen.getByTestId("items").textContent!) as SupplierInvoiceItemInput[];

function tipear(input: HTMLElement, texto: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: texto } });
}

describe("RenglonesEditor · se carga el total (spec 199)", () => {
  it("5 kg por $58.000 son $11.600 el kg — no $290.000", () => {
    render(<Probador />);

    tipear(screen.getByLabelText("Cantidad en kg"), "5");
    tipear(screen.getByLabelText("Total de la línea"), "58.000");

    expect(screen.getByLabelText("Precio por kg").textContent).toMatch(/11\.600/);
    // Lo que va al server: 25 panes de 200 g a $2.320.
    expect(items()[0]).toMatchObject({ units: 25, unit_cost_cents: 2_320_00 });
  });

  it("cambiar la cantidad con el total puesto cambia el precio, no el total", () => {
    render(<Probador />);

    tipear(screen.getByLabelText("Total de la línea"), "58.000");
    tipear(screen.getByLabelText("Cantidad en kg"), "4");

    expect(screen.getByLabelText("Precio por kg").textContent).toMatch(/14\.500/);
    expect((screen.getByLabelText("Total de la línea") as HTMLInputElement).value).toBe("58.000");
    expect(items()[0]).toMatchObject({ units: 20, unit_cost_cents: 2_900_00 });
  });

  it("el precio no es un campo", () => {
    render(<Probador />);
    expect(screen.getByLabelText("Precio por kg").tagName).not.toBe("INPUT");
  });

  it("Enter en la cantidad va al total", () => {
    render(<Probador />);
    const cantidad = screen.getByLabelText("Cantidad en kg");
    cantidad.focus();
    fireEvent.keyDown(cantidad, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("Total de la línea"));
  });

  /**
   * D3 · desde el último total, el foco va al botón. Guardar sigue siendo un
   * acto aparte: el Enter en el campo no manda el formulario.
   */
  it("Enter en el último total lleva el foco a «Cargar compra» sin guardar", () => {
    const onSubmit = vi.fn();
    render(<Probador onSubmit={onSubmit} />);
    const total = screen.getByLabelText("Total de la línea");
    total.focus();
    fireEvent.keyDown(total, { key: "Enter" });

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cargar compra" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

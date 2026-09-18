import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
  CatalogHeaderAction,
  CatalogHeaderActionProvider,
  CatalogHeaderActionSlot,
} from "./header-action";

describe("CatalogHeaderAction — la acción de la tab va al header (spec 205 · D6)", () => {
  it("lo que declara la tab se pinta en el slot del header", () => {
    render(
      <CatalogHeaderActionProvider>
        <header data-testid="header">
          <CatalogHeaderActionSlot />
        </header>
        <main>
          <CatalogHeaderAction>
            <button type="button">Nueva categoría</button>
          </CatalogHeaderAction>
        </main>
      </CatalogHeaderActionProvider>,
    );
    expect(
      within(screen.getByTestId("header")).getByRole("button", { name: "Nueva categoría" }),
    ).toBeInTheDocument();
  });

  it("sin provider se pinta en el lugar (la tab sigue andando suelta)", () => {
    render(
      <CatalogHeaderAction>
        <button type="button">Nuevo sector</button>
      </CatalogHeaderAction>,
    );
    expect(screen.getByRole("button", { name: "Nuevo sector" })).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

import { CatalogTable, type CatalogTableHandle } from "./catalog-table";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Row = { id: string; name: string; cat: string; price: number };

const rows: Row[] = [
  { id: "1", name: "Soda", cat: "Aguas", price: 3000 },
  { id: "2", name: "Agua Mineral", cat: "Aguas", price: 3000 },
  { id: "3", name: "Coca-Cola", cat: "Gaseosas", price: 3400 },
];

function setup(
  props: Partial<React.ComponentProps<typeof CatalogTable<Row>>> = {},
) {
  const onOpen = vi.fn();
  const ref = createRef<CatalogTableHandle>();
  render(
    <CatalogTable<Row>
      ref={ref}
      aria-label="Productos"
      rows={rows}
      getKey={(r) => r.id}
      rowLabel={(r) => r.name}
      group={(r) => ({ key: r.cat, label: r.cat })}
      columns={[
        {
          key: "name",
          header: "Producto",
          width: "minmax(0,1fr)",
          cell: (r) => r.name,
        },
        {
          key: "price",
          header: "Precio",
          width: "88px",
          align: "end",
          cell: (r) => `$${r.price}`,
        },
        {
          key: "sw",
          header: "Disponible",
          width: "80px",
          hideOnMobile: true,
          cell: (r) => (
            <button type="button" aria-label={`toggle ${r.name}`}>
              sw
            </button>
          ),
        },
      ]}
      onOpen={onOpen}
      empty="Sin productos."
      {...props}
    />,
  );
  return { onOpen, ref, user: userEvent.setup() };
}

describe("CatalogTable (spec 205 · D1/D2)", () => {
  it("agrupa con un header por grupo y su cantidad", () => {
    setup();
    const aguas = screen.getByRole("rowgroup", { name: "Aguas" });
    expect(within(aguas).getByText("2")).toBeInTheDocument();
    expect(within(aguas).getAllByRole("row")).toHaveLength(2);
    expect(
      screen.getByRole("rowgroup", { name: "Gaseosas" }),
    ).toBeInTheDocument();
  });

  it("click en la fila abre", async () => {
    const { onOpen, user } = setup();
    await user.click(screen.getByText("Agua Mineral"));
    expect(onOpen).toHaveBeenCalledWith(rows[1], 1);
  });

  it("un control dentro de la fila no abre el editor", async () => {
    const { onOpen, user } = setup();
    await user.click(screen.getByRole("button", { name: "toggle Soda" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("↓ ↓ Enter abre la tercera fila, cruzando el grupo", async () => {
    const { onOpen, ref, user } = setup();
    ref.current!.focusFirst();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onOpen).toHaveBeenCalledWith(rows[2], 2);
  });

  it("con href, el nombre es un link real (cmd+click abre otra pestaña)", async () => {
    const { onOpen, user } = setup({ href: (r) => `/p/${r.id}` });
    const link = screen.getByRole("link", { name: "Soda" });
    expect(link).toHaveAttribute("href", "/p/1");
    await user.click(link);
    expect(onOpen).toHaveBeenCalledWith(rows[0], 0);
  });

  it("sin filas muestra el vacío", () => {
    setup({ rows: [] });
    expect(screen.getByText("Sin productos.")).toBeInTheDocument();
  });
});

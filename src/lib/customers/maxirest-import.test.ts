import { describe, expect, it } from "vitest";

import {
  loteDeCliente,
  nombreDeCliente,
  planificarImportClientes,
  telefonoDeCliente,
  type MxcliClienteRow,
} from "./maxirest-import";

function fila(p: Partial<MxcliClienteRow> = {}): MxcliClienteRow {
  return {
    codigo: "1",
    nombre: "",
    apellido: "",
    razon: "",
    calle: "",
    altura: "",
    telefono: "",
    celular: "",
    e_mail: "",
    ...p,
  };
}

describe("telefonoDeCliente", () => {
  it("prefiere el celular: es el que contesta y el que tiene WhatsApp", () => {
    expect(
      telefonoDeCliente(fila({ telefono: "4938031", celular: "341 697-1030" })),
    ).toBe("3416971030");
  });

  it("el interno del barrio no es un teléfono", () => {
    expect(telefonoDeCliente(fila({ telefono: "4938031" }))).toBe("");
  });
});

describe("loteDeCliente", () => {
  it("la altura es el lote", () => {
    expect(loteDeCliente(fila({ calle: "LOS PINOS", altura: "43" }))).toEqual({
      lote: "43",
      origen: "altura",
    });
  });

  it("las altas nuevas lo escribieron a mano en la calle", () => {
    expect(loteDeCliente(fila({ codigo: "704", calle: "LOTE 354" }))).toEqual({
      lote: "354",
      origen: "calle-lote",
    });
  });

  it("manda la altura sobre el código: el 707 vive en el lote 420", () => {
    expect(
      loteDeCliente(fila({ codigo: "707", calle: "LOS RHUS", altura: "420" })),
    ).toEqual({ lote: "420", origen: "altura" });
  });

  it("sin altura, el código viejo es el lote — el nuevo no", () => {
    expect(loteDeCliente(fila({ codigo: "651", calle: "LAS TIPAS" }))).toEqual({
      lote: "651",
      origen: "codigo",
    });
    expect(loteDeCliente(fila({ codigo: "716", calle: "xxxx" }))).toBeNull();
  });

  it("el cero a la izquierda se cae: el lote 090 es el 90", () => {
    expect(loteDeCliente(fila({ altura: "090" }))?.lote).toBe("90");
  });
});

describe("nombreDeCliente", () => {
  it("no repite el apellido cuando MaxiRest lo tiene en los dos campos", () => {
    expect(nombreDeCliente(fila({ nombre: "FARIAS", apellido: "FARIAS" }))).toBe(
      "FARIAS",
    );
  });

  it("el relleno de la carga no es un nombre", () => {
    expect(nombreDeCliente(fila({ nombre: "xxxxx", apellido: "" }))).toBeNull();
  });
});

describe("planificarImportClientes", () => {
  it("sin teléfono no hay cliente: es la identidad de la tabla", () => {
    const plan = planificarImportClientes([
      fila({ codigo: "3", apellido: "CASTILLO", calle: "LAS ACACIAS", altura: "3" }),
    ]);
    expect(plan.clientes).toHaveLength(0);
    expect(plan.descartados[0].motivo).toBe("sin teléfono");
  });

  it("la calle queda como referencia, no como dirección", () => {
    const [c] = planificarImportClientes([
      fila({
        codigo: "12",
        nombre: "PABLO",
        apellido: "MARCHETTI",
        calle: "LAS TIPAS",
        altura: "12",
        celular: "3468641070",
      }),
    ]).clientes;
    expect(c).toMatchObject({
      phone: "3468641070",
      name: "PABLO MARCHETTI",
      lote: "12",
      calle: "LAS TIPAS",
      aviso: null,
    });
  });

  it("«LOTE 354» como calle no se repite como referencia", () => {
    const [c] = planificarImportClientes([
      fila({ codigo: "704", apellido: "MIRANDA", calle: "LOTE 354", celular: "3415080048" }),
    ]).clientes;
    expect(c.lote).toBe("354");
    expect(c.calle).toBeNull();
  });

  it("con el teléfono repetido gana la fila más completa, y la otra se reporta", () => {
    const plan = planificarImportClientes([
      fila({ codigo: "80", celular: "3415000000" }),
      fila({ codigo: "81", apellido: "GOMEZ", altura: "81", celular: "3415000000" }),
    ]);
    expect(plan.clientes).toHaveLength(1);
    expect(plan.clientes[0].codigo).toBe("81");
    expect(plan.descartados[0]).toMatchObject({ codigo: "80" });
  });

  it("un teléfono de más dígitos se importa, pero marcado para revisar", () => {
    const [c] = planificarImportClientes([
      fila({ codigo: "703", apellido: "FARIAS", calle: "LOTE 79", celular: "34153109912" }),
    ]).clientes;
    expect(c.aviso).toMatch(/revisar/);
  });
});

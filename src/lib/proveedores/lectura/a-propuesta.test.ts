import { describe, expect, it } from "vitest";

import {
  aPropuesta,
  clasificarUnidad,
  type InsumoDelCatalogo,
} from "@/lib/proveedores/lectura/a-propuesta";
import type { RenglonModelo } from "@/lib/proveedores/lectura/schema-modelo";

const entrecot: InsumoDelCatalogo = {
  id: "ing-entrecot",
  name: "Entrecot",
  unit: "kg",
  presentationId: "pres-10kg",
  presentationName: "Compra 10kg",
  netQuantity: 10,
  costCents: 175_000_00,
};

const huevos: InsumoDelCatalogo = {
  id: "ing-huevos",
  name: "Huevos",
  unit: "un",
  presentationId: "pres-maple",
  presentationName: "Maple 30 un",
  netQuantity: 30,
  costCents: 5_749_80,
};

const linea = (p: Partial<RenglonModelo>): RenglonModelo => ({
  descripcion: "ENTRECOT",
  cantidad: null,
  unidad: null,
  precio_unitario: null,
  total_linea: null,
  tasa_iva: null,
  origen: "ENTRECOT 82,600 kg 17.500 1.445.500",
  confianza: "alta",
  ...p,
});

describe("aPropuesta · la conversión de la carnicería", () => {
  it("82,600 kg a $17.500 el kilo entran como 8,26 envases a $175.000", () => {
    // Es el test de aceptación de la feature entera: los tres números salen del
    // papel real y el del medio es el que se escribe en el costo del insumo.
    const p = aPropuesta(
      linea({ cantidad: "82,600", unidad: "kg", precio_unitario: "17.500", total_linea: "1.445.500" }),
      entrecot,
      "exacto",
    );

    expect(p.units).toBeCloseTo(8.26, 3);
    expect(p.unitCostCents).toBe(17_500_000);
    expect(p.quantityBase).toBeCloseTo(82.6, 3);
    expect(p.estado).toBe("cuadra");
    expect(p.incluir).toBe(true);
  });

  it("el precio no cambió, así que no hay salto que avisar", () => {
    const p = aPropuesta(
      linea({ cantidad: "82,600", unidad: "kg", precio_unitario: "17.500", total_linea: "1.445.500" }),
      entrecot,
      "exacto",
    );

    expect(p.avisos.map((a) => a.codigo)).not.toContain("salto_de_precio");
  });

  it("guarda lo que decía el papel", () => {
    const p = aPropuesta(linea({ cantidad: "1", precio_unitario: "175.000" }), entrecot, "exacto");

    expect(p.sourceText).toBe("ENTRECOT");
    expect(p.origen).toContain("82,600");
  });
});

describe("aPropuesta · el caso de los huevos, que no se puede resolver solo", () => {
  it("marca el salto de precio y NO lo tilda", () => {
    // «4 HUEVOS ENTRE RIOS B1 × $27.500» contra una presentación de Maple 30 un
    // a $5.749,80. Si esos 4 son cajas y no maples, la conversión sale mal — y
    // el sistema no tiene forma de saberlo. Lo único honesto es poner el número
    // delante de los ojos.
    const p = aPropuesta(
      linea({
        descripcion: "HUEVOS ENTRE RIOS B1",
        cantidad: "4",
        unidad: null,
        precio_unitario: "27.500",
        total_linea: "110.000",
      }),
      huevos,
      "fuzzy",
    );

    const codigos = p.avisos.map((a) => a.codigo);
    expect(codigos).toContain("salto_de_precio");
    expect(p.incluir).toBe(false);
  });
});

describe("aPropuesta · las guardas de columna", () => {
  it("rechaza el renglón cuyo costo no entra en el integer de la presentación", () => {
    // `ingredient_presentations.cost_cents` es integer y `unit_cost_cents` es
    // bigint: pasarse hace desbordar el UPDATE, y la RPC se lleva el comprobante
    // entero por delante.
    const p = aPropuesta(
      linea({ cantidad: "1", unidad: "kg", precio_unitario: "99.999.999", total_linea: "99.999.999" }),
      entrecot,
      "exacto",
    );

    expect(p.avisos.map((a) => a.codigo)).toContain("costo_excede_columna");
    expect(p.units).toBeNull();
    expect(p.incluir).toBe(false);
  });

  it("rechaza la cantidad que se redondea a cero", () => {
    // `check (units > 0)`: 1 gramo contra un envase de 10 kg da 0,0001 envases,
    // que a 3 decimales es 0 y aborta la RPC.
    const p = aPropuesta(
      linea({ cantidad: "1", unidad: "g", precio_unitario: "17,50", total_linea: "17,50" }),
      entrecot,
      "exacto",
    );

    expect(p.avisos.map((a) => a.codigo)).toContain("cantidad_muy_chica");
    expect(p.incluir).toBe(false);
  });

  it("un insumo sin presentación entra al stock pero avisa que no toca el costo", () => {
    const sinEnvase: InsumoDelCatalogo = { id: "x", name: "Suelto", unit: "kg" };
    const p = aPropuesta(
      linea({ cantidad: "5", unidad: "kg", precio_unitario: "1.000", total_linea: "5.000" }),
      sinEnvase,
      "exacto",
    );

    expect(p.avisos.map((a) => a.codigo)).toContain("sin_presentacion");
    expect(p.units).toBe(5);
    expect(p.presentationId).toBeNull();
  });
});

describe("aPropuesta · quién arranca tildado", () => {
  it("la memoria y el nombre exacto arrancan tildados", () => {
    const base = linea({ cantidad: "10", unidad: "kg", precio_unitario: "17.500", total_linea: "175.000" });

    expect(aPropuesta(base, entrecot, "memoria").incluir).toBe(true);
    expect(aPropuesta(base, entrecot, "exacto").incluir).toBe(true);
  });

  it("el fuzzy y el modelo arrancan DESTILDADOS", () => {
    // 172·D3: el sistema no puede escribir una adivinanza. Apretar rápido carga
    // menos insumos, nunca insumos mal.
    const base = linea({ cantidad: "10", unidad: "kg", precio_unitario: "17.500", total_linea: "175.000" });

    expect(aPropuesta(base, entrecot, "fuzzy").incluir).toBe(false);
    expect(aPropuesta(base, entrecot, "llm").incluir).toBe(false);
  });

  it("sin insumo no se tilda ni se propone cantidad", () => {
    const p = aPropuesta(
      linea({ descripcion: "PATA MUSLO ENERCOOP", cantidad: "8", precio_unitario: "6.200" }),
      null,
      null,
    );

    expect(p.ingredientId).toBeNull();
    expect(p.incluir).toBe(false);
    expect(p.sourceText).toBe("PATA MUSLO ENERCOOP");
  });

  it("un renglón que no cuadra no arranca tildado aunque el match sea exacto", () => {
    const p = aPropuesta(
      linea({ cantidad: "3", unidad: "kg", precio_unitario: "1.000", total_linea: "50.000" }),
      entrecot,
      "exacto",
    );

    expect(p.estado).toBe("no_cuadra");
    expect(p.incluir).toBe(false);
  });
});

describe("clasificarUnidad", () => {
  it("reconoce la familia de la unidad base", () => {
    expect(clasificarUnidad("kg", "kg")).toEqual({ clase: "base", factor: 1 });
    expect(clasificarUnidad("g", "kg")).toEqual({ clase: "base", factor: 0.001 });
    expect(clasificarUnidad("ml", "lt")).toEqual({ clase: "base", factor: 0.001 });
    expect(clasificarUnidad("u", "un")).toEqual({ clase: "base", factor: 1 });
  });

  it("reconoce los envases, incluida la notación de la verdulería", () => {
    expect(clasificarUnidad("caj", "kg").clase).toBe("envase");
    expect(clasificarUnidad("cajón", "kg").clase).toBe("envase");
    expect(clasificarUnidad("x1B", "kg").clase).toBe("envase");
    expect(clasificarUnidad("maple", "un").clase).toBe("envase");
  });

  it("marca ambigua la unidad ausente o de otra familia", () => {
    expect(clasificarUnidad(null, "kg").clase).toBe("ambigua");
    // Kilos contra un insumo que se cuenta por unidad no es la misma cosa.
    expect(clasificarUnidad("kg", "un").clase).toBe("ambigua");
    expect(clasificarUnidad("chirimbolos", "kg").clase).toBe("ambigua");
  });
});

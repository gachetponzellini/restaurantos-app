import { describe, expect, it } from "vitest";

import { unirPaginas } from "@/lib/proveedores/lectura/unir-paginas";
import type { PaginaLeida } from "@/lib/proveedores/lectura/unir-paginas";
import type { LecturaModelo, RenglonModelo } from "@/lib/proveedores/lectura/schema-modelo";

/** Un renglón como los que devuelve el modelo, con lo justo para el caso. */
function renglon(over: Partial<RenglonModelo> = {}): RenglonModelo {
  return {
    descripcion: "MILANESA DE PELUDO",
    cantidad: "2",
    unidad: "u",
    precio_unitario: "1.500",
    total_linea: "3.000",
    tasa_iva: null,
    origen: "renglón del ticket",
    confianza: "alta",
    ...over,
  };
}

/**
 * La lectura de una página, con `cabecera` parcial: los casos de acá dicen «esta
 * página trae sólo el total» y el resto son nulos, que es como vuelven de verdad.
 */
type Cabecera = LecturaModelo["cabecera"];
type LecturaParcial = Partial<Omit<LecturaModelo, "cabecera">> & {
  cabecera?: Partial<Cabecera>;
};

const CABECERA_VACIA: Cabecera = {
  proveedor_nombre: null,
  proveedor_cuit: null,
  tipo_comprobante: null,
  numero: null,
  fecha: null,
  total: null,
  origen_total: null,
  condicion_pago: null,
  neto: null,
  iva: null,
  percepciones: null,
};

function lectura({ cabecera, ...resto }: LecturaParcial = {}): LecturaModelo {
  return {
    es_comprobante: true,
    motivo_descarte: null,
    formato: "ticket_termico",
    renglones: [],
    ...resto,
    cabecera: { ...CABECERA_VACIA, ...cabecera },
  };
}

function ok(pagina: number, over: LecturaParcial = {}): PaginaLeida {
  return { pagina, ok: true, lectura: lectura(over) };
}

describe("unirPaginas · una sola página", () => {
  it("no cambia nada de lo que ya hacía la lectura de una foto", () => {
    const unida = unirPaginas([
      ok(1, {
        formato: "factura_impresa",
        cabecera: {
          proveedor_nombre: "DISTRIBUIDORA EL SOL",
          proveedor_cuit: "30-68469261-1",
          tipo_comprobante: "factura_a",
          numero: "0001-00012345",
          fecha: "15/03/2026",
          total: "165.101,80",
          origen_total: "TOTAL $ 165.101,80",
        },
        renglones: [renglon(), renglon({ descripcion: "PAN RALLADO" })],
      }),
    ]);

    expect(unida.esComprobante).toBe(true);
    expect(unida.motivoDescarte).toBeNull();
    expect(unida.formato).toBe("factura_impresa");
    expect(unida.cabecera?.proveedor_nombre).toBe("DISTRIBUIDORA EL SOL");
    expect(unida.cabecera?.total).toBe("165.101,80");
    expect(unida.paginasFallidas).toEqual([]);
    expect(unida.renglones).toHaveLength(2);
    expect(unida.renglones.every((r) => r.pagina === 1)).toBe(true);
    expect(unida.renglones.every((r) => r.posibleDuplicado === false)).toBe(true);
  });
});

describe("unirPaginas · la cabecera arriba, el total abajo", () => {
  it("toma el total de la ÚLTIMA página que lo trae", () => {
    // El membrete está en la primera foto y el TOTAL al pie de la última. Tomar
    // el primero agarra un subtotal de página y lo muestra como el importe de
    // la compra.
    const unida = unirPaginas([
      ok(1, {
        cabecera: {
          proveedor_nombre: "DISTRIBUIDORA EL SOL",
          proveedor_cuit: "30-68469261-1",
          numero: "0001-00012345",
          fecha: "15/03/2026",
          total: "80.000,00",
          origen_total: "SUBTOTAL HOJA 1",
        },
        renglones: [renglon()],
      }),
      ok(2, {
        cabecera: { total: "120.000,00", origen_total: "SUBTOTAL HOJA 2" },
        renglones: [renglon({ descripcion: "ACEITE" })],
      }),
      ok(3, {
        cabecera: { total: "165.101,80", origen_total: "TOTAL $ 165.101,80" },
        renglones: [renglon({ descripcion: "SERVILLETAS" })],
      }),
    ]);

    expect(unida.cabecera?.total).toBe("165.101,80");
    // La cita viaja con el número que explica: mezclarlas muestra un renglón
    // que no dice lo que el total dice.
    expect(unida.cabecera?.origen_total).toBe("TOTAL $ 165.101,80");
    // Y el resto del membrete sigue saliendo de la primera.
    expect(unida.cabecera?.proveedor_nombre).toBe("DISTRIBUIDORA EL SOL");
    expect(unida.cabecera?.numero).toBe("0001-00012345");
    expect(unida.cabecera?.fecha).toBe("15/03/2026");
  });

  it("completa campo por campo con la primera página que lo trae", () => {
    const unida = unirPaginas([
      ok(1, { cabecera: { proveedor_nombre: "EL SOL", numero: null } }),
      ok(2, { cabecera: { proveedor_nombre: "EL SOL S.R.L.", numero: "0002-99" } }),
    ]);

    expect(unida.cabecera?.proveedor_nombre).toBe("EL SOL");
    expect(unida.cabecera?.numero).toBe("0002-99");
  });

  it("un campo en blanco no es un campo", () => {
    // El modelo devuelve `null`, pero una cadena de espacios entra igual por el
    // JSON y taparía el dato bueno de la página siguiente.
    const unida = unirPaginas([
      ok(1, { cabecera: { proveedor_nombre: "   " } }),
      ok(2, { cabecera: { proveedor_nombre: "EL SOL" } }),
    ]);

    expect(unida.cabecera?.proveedor_nombre).toBe("EL SOL");
  });

  it("ordena por número de página aunque lleguen desordenadas", () => {
    // Vuelven de un `Promise.all`; alcanza un reintento para que se desordenen.
    const unida = unirPaginas([
      ok(3, { cabecera: { total: "165.101,80" }, renglones: [renglon({ descripcion: "C" })] }),
      ok(1, { cabecera: { numero: "0001-1", total: "80.000" }, renglones: [renglon({ descripcion: "A" })] }),
      ok(2, { renglones: [renglon({ descripcion: "B" })] }),
    ]);

    expect(unida.cabecera?.numero).toBe("0001-1");
    expect(unida.cabecera?.total).toBe("165.101,80");
    expect(unida.renglones.map((r) => r.descripcion)).toEqual(["A", "B", "C"]);
    expect(unida.renglones.map((r) => r.pagina)).toEqual([1, 2, 3]);
  });
});

describe("unirPaginas · una página del medio no sabe que es un comprobante", () => {
  it("sigue siendo comprobante si al menos una página lo reconoce", () => {
    // El pedazo de tira que sólo tiene renglones dice que no, y tiene razón
    // desde donde mira. Si eso mandara, el comprobante se descartaría entero.
    const unida = unirPaginas([
      ok(1, { renglones: [renglon()] }),
      ok(2, {
        es_comprobante: false,
        motivo_descarte: "no se ve encabezado ni total",
        formato: "otro",
        renglones: [renglon({ descripcion: "ACEITE" })],
      }),
      ok(3, { cabecera: { total: "10.000" } }),
    ]);

    expect(unida.esComprobante).toBe(true);
    expect(unida.motivoDescarte).toBeNull();
    expect(unida.formato).toBe("ticket_termico");
    expect(unida.renglones).toHaveLength(2);
  });

  it("descarta sólo si ninguna página reconoce un comprobante", () => {
    const unida = unirPaginas([
      ok(1, { es_comprobante: false, motivo_descarte: "es una lista de precios", formato: "otro" }),
      ok(2, { es_comprobante: false, motivo_descarte: "sigue la lista", formato: "otro" }),
    ]);

    expect(unida.esComprobante).toBe(false);
    expect(unida.motivoDescarte).toBe("es una lista de precios");
  });
});

describe("unirPaginas · una página que falló", () => {
  it("entrega las que llegaron y avisa cuál se cayó", () => {
    const unida = unirPaginas([
      ok(1, { cabecera: { numero: "0001-1" }, renglones: [renglon({ descripcion: "A" })] }),
      { pagina: 2, ok: false, error: "la lectura tardó más de 45 s" },
      ok(3, { cabecera: { total: "10.000" }, renglones: [renglon({ descripcion: "C" })] }),
    ]);

    expect(unida.esComprobante).toBe(true);
    expect(unida.cabecera?.numero).toBe("0001-1");
    expect(unida.cabecera?.total).toBe("10.000");
    expect(unida.renglones.map((r) => r.descripcion)).toEqual(["A", "C"]);
    expect(unida.paginasFallidas).toEqual([{ pagina: 2, error: "la lectura tardó más de 45 s" }]);
  });

  it("si no se leyó ninguna, no dice que no es un comprobante: dice que no sabe", () => {
    const unida = unirPaginas([
      { pagina: 1, ok: false, error: "429 del proveedor del modelo" },
      { pagina: 2, ok: false, error: "429 del proveedor del modelo" },
    ]);

    expect(unida.cabecera).toBeNull();
    expect(unida.renglones).toEqual([]);
    expect(unida.esComprobante).toBe(false);
    // Y sin motivo de descarte: la pantalla tiene que mirar `paginasFallidas`
    // ANTES que `esComprobante`, o le dice a la persona que su factura no es una
    // factura porque se cayó la API.
    expect(unida.motivoDescarte).toBeNull();
    expect(unida.paginasFallidas).toHaveLength(2);
  });

  it("con la lista vacía no explota", () => {
    expect(unirPaginas([])).toEqual({
      esComprobante: false,
      motivoDescarte: null,
      formato: "otro",
      cabecera: null,
      renglones: [],
      paginasFallidas: [],
    });
  });
});

describe("unirPaginas · el solapamiento de la tira larga", () => {
  it("marca el renglón repetido y NO lo borra", () => {
    // Al fotografiar una tira de un metro se repite el último renglón para no
    // cortarlo por la mitad. Los dos quedan; el segundo, avisado.
    const unida = unirPaginas([
      ok(1, {
        renglones: [
          renglon({ descripcion: "PAN RALLADO", total_linea: "1.200" }),
          renglon({ descripcion: "MILANESA DE PELUDO", total_linea: "3.000" }),
        ],
      }),
      ok(2, {
        renglones: [
          renglon({ descripcion: "Milanesa de peludo", total_linea: "3.000" }),
          renglon({ descripcion: "ACEITE", total_linea: "8.400" }),
        ],
      }),
    ]);

    expect(unida.renglones).toHaveLength(4);
    expect(unida.renglones.map((r) => r.posibleDuplicado)).toEqual([false, false, true, false]);
    expect(unida.renglones[2]!.pagina).toBe(2);
  });

  it("compara el total por valor, no por texto", () => {
    // La misma línea fotografiada dos veces vuelve como `1.234,56` y `1234,56`.
    const unida = unirPaginas([
      ok(1, { renglones: [renglon({ descripcion: "ACEITE", total_linea: "1.234,56" })] }),
      ok(2, { renglones: [renglon({ descripcion: "ACEITE", total_linea: "1234,56" })] }),
    ]);

    expect(unida.renglones[1]!.posibleDuplicado).toBe(true);
  });

  it("no marca dos cajones del mismo tomate que costaron distinto", () => {
    // Misma descripción, otro importe: son dos renglones de verdad.
    const unida = unirPaginas([
      ok(1, { renglones: [renglon({ descripcion: "TOMATE", total_linea: "4.000" })] }),
      ok(2, { renglones: [renglon({ descripcion: "TOMATE", total_linea: "4.500" })] }),
    ]);

    expect(unida.renglones[1]!.posibleDuplicado).toBe(false);
  });

  it("no marca lo repetido dentro de la MISMA página", () => {
    // Dos cajones del mismo tomate al mismo precio en la misma factura son dos.
    // El solapamiento sólo puede pasar en el borde entre dos fotos.
    const unida = unirPaginas([
      ok(1, {
        renglones: [
          renglon({ descripcion: "TOMATE", total_linea: "4.000" }),
          renglon({ descripcion: "TOMATE", total_linea: "4.000" }),
        ],
      }),
    ]);

    expect(unida.renglones.map((r) => r.posibleDuplicado)).toEqual([false, false]);
  });

  it("mira la última página que trajo renglones, no la anterior a secas", () => {
    // Si en el medio se cayó una foto, el solapamiento de la tira sigue estando
    // y el aviso tiene que seguir saliendo.
    const unida = unirPaginas([
      ok(1, { renglones: [renglon({ descripcion: "ACEITE", total_linea: "8.400" })] }),
      { pagina: 2, ok: false, error: "se cortó la subida" },
      ok(3, { renglones: [renglon({ descripcion: "ACEITE", total_linea: "8.400" })] }),
    ]);

    expect(unida.renglones[1]!.posibleDuplicado).toBe(true);
  });
});

/**
 * spec 187 · la condición de pago está impresa al pie, igual que el total.
 *
 * Por eso no usa `primeroConDato`: en un ticket de tres fotos, la página 1 no
 * dice nada de cómo se paga y la 3 sí. Tomar el primero daría siempre null.
 */
describe("unirPaginas · la condición de pago (spec 187)", () => {
  it("sale de la última página que la traiga", () => {
    const unida = unirPaginas([
      ok(1, { cabecera: { proveedor_nombre: "Carnicería El Peludo" } }),
      ok(2),
      ok(3, { cabecera: { total: "2.474.280", condicion_pago: "CONTADO EFECTIVO" } }),
    ]);

    expect(unida.cabecera?.condicion_pago).toBe("CONTADO EFECTIVO");
    expect(unida.cabecera?.proveedor_nombre).toBe("Carnicería El Peludo");
  });

  it("si ninguna página la trae, queda en null", () => {
    const unida = unirPaginas([ok(1), ok(2)]);
    expect(unida.cabecera?.condicion_pago).toBeNull();
  });
});

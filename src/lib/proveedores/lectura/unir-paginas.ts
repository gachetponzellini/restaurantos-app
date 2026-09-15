import { parseNumeroAR } from "./numeros-ar";
import type { LecturaModelo, RenglonModelo } from "./schema-modelo";

/**
 * Un comprobante que vino en varias fotos — spec 172.
 *
 * El ticket del proveedor es una tira de un metro y no entra en una foto. Antes
 * se subía una sola y se cargaba a mano lo que quedaba afuera. Ahora se suben
 * hasta cinco páginas y el papel vuelve a ser uno solo… pero recién acá.
 *
 * **Las páginas se leen en llamadas PARALELAS, una por foto, y se unen en el
 * código.** No es una preferencia de diseño: la ruta tiene `maxDuration = 60` y
 * el techo de la lectura es `TECHO_MS = 45_000`. Una sola llamada con cinco
 * imágenes adentro se come el presupuesto entero y corta a la mitad — perdiendo
 * las cinco. En paralelo, la lectura tarda lo que la página más lenta, y si una
 * revienta las otras cuatro llegan igual: por eso `paginasFallidas` es parte del
 * resultado y no una excepción.
 *
 * Las tres reglas de la unión salen de cómo está impreso el papel, no de cómo
 * sería más cómodo programarlo:
 *
 * · **La cabecera vive arriba y el total abajo.** El membrete (nombre, CUIT,
 *   número, fecha) está en la primera página; el TOTAL está al pie de la última.
 *   Por eso cada campo toma el primero que aparezca salvo el total, que toma el
 *   último — tomar el primero ahí agarra un subtotal de página y lo muestra como
 *   el importe de la compra.
 * · **Una página del medio no sabe que es un comprobante.** El pedazo de tira que
 *   sólo tiene renglones va a decir `es_comprobante: false`, y tiene razón desde
 *   donde mira. Alcanza con que UNA diga que sí.
 * · **El solapamiento se marca, nunca se borra.** Al fotografiar una tira larga
 *   se repite el último renglón para no cortar por la mitad, así que aparece dos
 *   veces. Pero dos cajones del mismo tomate en la misma factura también
 *   aparecen dos veces, y son dos. Borrar el segundo pierde plata en silencio;
 *   mostrarlo con un aviso cuesta que el encargado mire un renglón.
 */

/**
 * `schema-modelo.ts` exporta el objeto Zod `CabeceraModelo` pero no el tipo
 * homónimo, así que se saca de `LecturaModelo`, que sí está exportado. Sale del
 * mismo esquema: si mañana la cabecera cambia, esto cambia con ella.
 */
type CabeceraModelo = LecturaModelo["cabecera"];

export type PaginaLeida =
  | { pagina: number; ok: true; lectura: LecturaModelo }
  | { pagina: number; ok: false; error: string };

export type RenglonConPagina = RenglonModelo & {
  /** De qué foto salió. Es lo que deja saltar de un renglón dudoso a su papel. */
  pagina: number;
  /** Aparece igual en la página anterior. Se avisa, no se descarta. */
  posibleDuplicado: boolean;
};

export type LecturaUnida = {
  esComprobante: boolean;
  motivoDescarte: string | null;
  formato: LecturaModelo["formato"];
  cabecera: CabeceraModelo | null;
  renglones: RenglonConPagina[];
  paginasFallidas: { pagina: number; error: string }[];
};

/** `null`, `undefined` y `"   "` son lo mismo: la página no trajo el dato. */
function vacio(valor: string | null | undefined): boolean {
  return valor === null || valor === undefined || valor.trim() === "";
}

/**
 * El ÚLTIMO que aporte algo. Para lo que está impreso al pie —el total, la
 * condición de pago— y no en el membrete: tomar el primero agarra el subtotal de
 * la página 1 y lo muestra como el importe de la compra.
 */
function ultimoConDato<T extends string>(valores: (T | null)[]): T | null {
  for (let i = valores.length - 1; i >= 0; i--) {
    const v = valores[i];
    if (v !== null && v !== undefined && !vacio(v)) return v;
  }
  return null;
}

/** El primero que aporte algo, en orden de página. */
function primeroConDato<T extends string>(valores: (T | null)[]): T | null {
  for (const v of valores) {
    if (v !== null && !vacio(v)) return v;
  }
  return null;
}

/**
 * Dos descripciones son «la misma» si lo son a ojo del encargado: mayúsculas,
 * acentos y la puntuación con la que el modelo separa columnas no cuentan.
 * `MILANESA DE PELUDO x 10` y `Milanesa de peludo x10` son el mismo renglón.
 */
function normalizarDescripcion(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Los totales se comparan por VALOR, no por texto: la misma línea fotografiada
 * dos veces puede volver como `"1.234,56"` y como `"1234,56"`, y comparar los
 * strings las daría por distintas justo en el caso para el que existe esto.
 * Comparar los dígitos pelados sería peor: `123.456` y `1.234,56` tienen los
 * mismos dígitos y son dos importes que no se parecen en nada.
 */
function mismoTotal(a: string | null, b: string | null): boolean {
  const na = parseNumeroAR(a);
  const nb = parseNumeroAR(b);
  if (na !== null && nb !== null) return na === nb;
  // Los dos sin total es el estado NORMAL de la lista de pedido de la verdulería:
  // ahí el aviso lo sostiene la descripción sola.
  return na === null && nb === null;
}

function mismoRenglon(a: RenglonModelo, b: RenglonModelo): boolean {
  return (
    normalizarDescripcion(a.descripcion) === normalizarDescripcion(b.descripcion) &&
    mismoTotal(a.total_linea, b.total_linea)
  );
}

export function unirPaginas(paginas: PaginaLeida[]): LecturaUnida {
  // Se ordena por número de página y no se confía en el orden del array: las
  // lecturas vuelven de un `Promise.all` y alcanza con que alguien cambie a
  // `allSettled` o agregue un reintento para que lleguen desordenadas. Si eso
  // pasara sin este orden, el «total de la última página» sería el de cualquiera.
  const enOrden = [...paginas].sort((x, y) => x.pagina - y.pagina);

  const leidas = enOrden.filter((p): p is Extract<PaginaLeida, { ok: true }> => p.ok);
  const paginasFallidas = enOrden
    .filter((p): p is Extract<PaginaLeida, { ok: false }> => !p.ok)
    .map((p) => ({ pagina: p.pagina, error: p.error }));

  if (leidas.length === 0) {
    // Ninguna página se pudo leer. Sale `esComprobante: false`, pero eso NO es
    // «no es un comprobante»: es «no sabemos». Quien muestre esto tiene que
    // mirar `paginasFallidas` ANTES que `esComprobante`, o le va a decir a la
    // persona que su factura no es una factura porque se cayó la API.
    return {
      esComprobante: false,
      motivoDescarte: null,
      formato: "otro",
      cabecera: null,
      renglones: [],
      paginasFallidas,
    };
  }

  const cabeceras = leidas.map((p) => p.lectura.cabecera);

  // El total sale de la ÚLTIMA página que lo traiga. Es el único campo de la
  // cabecera que está impreso al pie y no en el membrete.
  let iTotal = -1;
  for (let i = 0; i < cabeceras.length; i++) {
    if (!vacio(cabeceras[i]!.total)) iTotal = i;
  }

  const cabecera: CabeceraModelo = {
    proveedor_nombre: primeroConDato(cabeceras.map((c) => c.proveedor_nombre)),
    proveedor_cuit: primeroConDato(cabeceras.map((c) => c.proveedor_cuit)),
    tipo_comprobante: primeroConDato(cabeceras.map((c) => c.tipo_comprobante)),
    numero: primeroConDato(cabeceras.map((c) => c.numero)),
    fecha: primeroConDato(cabeceras.map((c) => c.fecha)),
    total: iTotal >= 0 ? cabeceras[iTotal]!.total : null,
    // `origen_total` viaja con el total y no se elige aparte: es la cita de
    // dónde salió ese número. Mezclar el total de la página 3 con la evidencia
    // de la 1 es mostrar una cita que no dice lo que el número dice.
    origen_total:
      iTotal >= 0
        ? cabeceras[iTotal]!.origen_total
        : primeroConDato(cabeceras.map((c) => c.origen_total)),
    // spec 187 · va con el total, al pie de la última página que lo traiga.
    condicion_pago: ultimoConDato(cabeceras.map((c) => c.condicion_pago ?? null)),
  };

  const renglones: RenglonConPagina[] = [];
  // La comparación es contra la última página que TRAJO renglones, no contra la
  // anterior a secas: si en el medio se cayó una foto o salió una en blanco, el
  // solapamiento de la tira sigue existiendo y el aviso tiene que seguir saliendo.
  let anteriores: RenglonModelo[] = [];
  for (const p of leidas) {
    const propios = p.lectura.renglones;
    for (const r of propios) {
      renglones.push({
        ...r,
        pagina: p.pagina,
        posibleDuplicado: anteriores.some((a) => mismoRenglon(a, r)),
      });
    }
    if (propios.length > 0) anteriores = propios;
  }

  const esComprobante = leidas.some((p) => p.lectura.es_comprobante);

  return {
    esComprobante,
    // El motivo de descarte sólo se muestra si NINGUNA página reconoció un
    // comprobante. Si una lo reconoció, el «esto es una lista de precios» que
    // escribió otra es un comentario sobre ese pedazo de papel, no sobre la
    // compra, y mostrarlo contradice a la pantalla que ya está cargando renglones.
    motivoDescarte: esComprobante
      ? null
      : primeroConDato(leidas.map((p) => p.lectura.motivo_descarte)),
    // El formato lo define la primera página que se reconoció como comprobante:
    // una foto de la parte de atrás del remito clasifica «otro» y no describe
    // nada. Si ninguna se reconoció, vale la primera que se pudo leer.
    formato: (leidas.find((p) => p.lectura.es_comprobante) ?? leidas[0]!).lectura.formato,
    cabecera,
    renglones,
    paginasFallidas,
  };
}

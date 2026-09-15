import { parseTasa } from "../iva";
import { conciliarRenglon, type EstadoConciliacion } from "./conciliar";
import type { RenglonModelo } from "./schema-modelo";

/**
 * De lo impreso al renglón que la RPC sabe cargar — spec 172.
 *
 * Acá vive la conversión que el modelo NO hace: la factura habla en kilos y
 * `supplier_invoice_items` guarda ENVASES (165·D5). Es aritmética pura, así que
 * se testea sin llamar al modelo y se recalcula en el cliente cuando la persona
 * corrige el insumo de un renglón.
 *
 *     Entrecot: 82,600 kg a $17.500/kg, envase "Compra 10kg" (net_quantity 10)
 *       units           = 82,600 / 10 = 8,26 envases
 *       unit_cost_cents = 17.500 × 10 = $175.000 por envase
 *       verificación    : 8,26 × 175.000 = $1.445.500 == el total impreso
 */

export type InsumoDelCatalogo = {
  id: string;
  name: string;
  /** Unidad base: kg, lt, un, g, ml. */
  unit: string;
  presentationId?: string | null;
  presentationName?: string | null;
  netQuantity?: number;
  costCents?: number;
};

export type CodigoAviso =
  /** La unidad del papel no se reconoció; se asumió unidad base. */
  | "unidad_ambigua"
  /** El insumo no tiene presentación: entra el stock pero NO se actualiza el costo. */
  | "sin_presentacion"
  /** `cantidad × precio` no da el total impreso. */
  | "no_cuadra"
  /** Faltaba un número y se dedujo de los otros dos. */
  | "reconstruido"
  /** Después de redondear a 3 decimales, `units` da 0 y el CHECK de la base lo rechaza. */
  | "cantidad_muy_chica"
  /** El costo del envase no entra en el `integer` de `ingredient_presentations`. */
  | "costo_excede_columna"
  /** El precio por unidad base se aparta mucho del actual. */
  | "salto_de_precio";

export type Aviso = { codigo: CodigoAviso; detalle?: string };

export type RenglonPropuesto = {
  /** Lo que decía el papel, verbatim. Es el ancla contra la que se compara. */
  sourceText: string;
  origen: string;
  ingredientId: string | null;
  matchSource: string | null;
  /**
   * La alícuota IMPRESA en el renglón, o null — spec 188·D5.
   *
   * Null es la respuesta normal: la factura A4 con columna de tasa es la
   * minoría. La tasa que se muestra cuando esto es null la pone la pantalla,
   * que sabe de qué tipo es el comprobante y qué dice su pie; acá no se hereda
   * nada porque `aPropuesta` no conoce la cabecera.
   */
  tasaIva: number | null;
  /** Envases. `null` si no se pudo calcular. */
  units: number | null;
  unitCostCents: number | null;
  /** Lo que va a entrar al stock, en unidad base. Para mostrar, no para guardar. */
  quantityBase: number | null;
  presentationId: string | null;
  presentationName: string | null;
  estado: EstadoConciliacion;
  avisos: Aviso[];
  /**
   * Arranca tildado sólo si la propuesta NO es una adivinanza (spec 172·D3).
   * Una fila destildada no entra en el payload: es la prohibición de
   * auto-asignar implementada en el dato, no en la disciplina de la UI.
   */
  incluir: boolean;
};

/** El `integer` de `ingredient_presentations.cost_cents`. */
const TECHO_COST_CENTS = 2_147_483_647;

/** Familias de unidad: qué es «la misma cosa» que la unidad base del insumo. */
const FACTORES: Record<string, { base: string; factor: number }> = {
  kg: { base: "kg", factor: 1 },
  kilo: { base: "kg", factor: 1 },
  kilos: { base: "kg", factor: 1 },
  k: { base: "kg", factor: 1 },
  g: { base: "kg", factor: 0.001 },
  gr: { base: "kg", factor: 0.001 },
  grs: { base: "kg", factor: 0.001 },
  lt: { base: "lt", factor: 1 },
  l: { base: "lt", factor: 1 },
  lts: { base: "lt", factor: 1 },
  litro: { base: "lt", factor: 1 },
  litros: { base: "lt", factor: 1 },
  ml: { base: "lt", factor: 0.001 },
  cc: { base: "lt", factor: 0.001 },
  un: { base: "un", factor: 1 },
  u: { base: "un", factor: 1 },
  uni: { base: "un", factor: 1 },
  unid: { base: "un", factor: 1 },
  unidad: { base: "un", factor: 1 },
  unidades: { base: "un", factor: 1 },
};

/** Palabras que nombran un ENVASE, no una unidad base. */
const ENVASES = new Set([
  "caj", "caja", "cajon", "cajón", "cajones", "bolsa", "bolsas", "bulto", "bultos",
  "pack", "paquete", "bandeja", "balde", "bidon", "bidón", "lata", "latas", "maple",
  "maples", "atado", "atados", "pieza", "piezas", "horma", "hormas", "barra", "b", "c",
]);

const redondear3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Cómo se leyó la unidad impresa.
 *
 * Tres casos y hay que decidirlos, no promediarlos: `base` convierte con el
 * `net_quantity`; `envase` toma la cantidad como envases directo; y `ambigua` va
 * por el camino de `base` pero **marcado**, porque la unidad ausente aparece
 * sobre todo en renglones manuscritos de kilos y ahí acertar es lo normal.
 */
export function clasificarUnidad(
  unidadImpresa: string | null,
  unidadBase: string,
): { clase: "base" | "envase" | "ambigua"; factor: number } {
  const u = (unidadImpresa ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!u) return { clase: "ambigua", factor: 1 };

  const conocida = FACTORES[u];
  if (conocida) {
    // `kg` contra un insumo que se mide en `un` no es la misma familia: se marca.
    if (conocida.base === unidadBase) return { clase: "base", factor: conocida.factor };
    return { clase: "ambigua", factor: 1 };
  }

  // «x1B», «x2C»: la notación de la verdulería. La letra nombra un envase.
  const notacion = u.match(/^x?\d*\s*([a-z]+)$/);
  if (notacion && ENVASES.has(notacion[1]!)) return { clase: "envase", factor: 1 };
  if (ENVASES.has(u)) return { clase: "envase", factor: 1 };

  return { clase: "ambigua", factor: 1 };
}

export function aPropuesta(
  leido: RenglonModelo,
  insumo: InsumoDelCatalogo | null,
  matchSource: string | null,
): RenglonPropuesto {
  const c = conciliarRenglon({
    cantidad: leido.cantidad,
    precioUnitario: leido.precio_unitario,
    totalLinea: leido.total_linea,
  });

  const avisos: Aviso[] = [];
  if (c.estado === "no_cuadra") avisos.push({ codigo: "no_cuadra" });
  if (c.estado === "reconstruido" && c.reconstruido) {
    avisos.push({ codigo: "reconstruido", detalle: c.reconstruido });
  }

  const base = {
    sourceText: leido.descripcion,
    origen: leido.origen,
    ingredientId: insumo?.id ?? null,
    matchSource,
    estado: c.estado,
    // Lo que no es una alícuota de ARCA vuelve null: un «2,1» mal leído no
    // puede convertirse en 21 (188).
    tasaIva: parseTasa(leido.tasa_iva),
    presentationId: null as string | null,
    presentationName: null as string | null,
  };

  if (!insumo || c.cantidad === null || c.precioUnitario === null) {
    return { ...base, units: null, unitCostCents: null, quantityBase: null, avisos, incluir: false };
  }

  const { clase, factor } = clasificarUnidad(leido.unidad, insumo.unit);
  if (clase === "ambigua") avisos.push({ codigo: "unidad_ambigua", detalle: leido.unidad ?? "" });

  const neto = insumo.netQuantity ?? 0;
  const tienePresentacion = Boolean(insumo.presentationId) && neto > 0;

  let units: number;
  let unitCostCents: number;

  if (!tienePresentacion) {
    // Sin envase la RPC toma `units` como unidad base y **no actualiza el
    // costo** — es la rama que no sirve para lo que esta spec vino a hacer, así
    // que entra el stock y se avisa.
    avisos.push({ codigo: "sin_presentacion" });
    units = redondear3(c.cantidad * factor);
    unitCostCents = Math.round((c.precioUnitario / factor) * 100);
  } else if (clase === "envase") {
    // «2 cajones»: la cantidad ya está en envases y el precio es por envase.
    units = redondear3(c.cantidad);
    unitCostCents = Math.round(c.precioUnitario * 100);
  } else {
    // El caso normal: kilos del papel → envases del sistema.
    const cantidadBase = c.cantidad * factor;
    units = redondear3(cantidadBase / neto);
    unitCostCents = Math.round(c.precioUnitario * 100 * neto);
  }

  // `check (units > 0)` y `check (quantity_base > 0)`: si el redondeo a 3
  // decimales lo deja en cero, la RPC aborta y se lleva el comprobante entero.
  if (!(units > 0)) {
    avisos.push({ codigo: "cantidad_muy_chica" });
    return { ...base, units: null, unitCostCents: null, quantityBase: null, avisos, incluir: false };
  }

  // `ingredient_presentations.cost_cents` es `integer` aunque
  // `supplier_invoice_items.unit_cost_cents` sea `bigint`: si se pasa, el UPDATE
  // desborda, la RPC falla entera y el comprobante se anula solo.
  if (unitCostCents > TECHO_COST_CENTS) {
    avisos.push({ codigo: "costo_excede_columna" });
    return { ...base, units: null, unitCostCents: null, quantityBase: null, avisos, incluir: false };
  }

  // El precio por unidad base es el número que EFECTIVAMENTE se escribe y se
  // propaga a las recetas. Compararlo con el actual es la única defensa contra
  // el caso «4 maples o 4 cajas», que el sistema no puede resolver solo.
  const costoBaseNuevo = tienePresentacion ? unitCostCents / neto : unitCostCents;
  const costoBaseActual = insumo.costCents && neto > 0 ? insumo.costCents / neto : null;
  if (costoBaseActual && costoBaseActual > 0) {
    const razon = costoBaseNuevo / costoBaseActual;
    if (razon >= 1.35 || razon <= 0.65) {
      avisos.push({ codigo: "salto_de_precio", detalle: razon.toFixed(2) });
    }
  }

  const duro = avisos.some(
    (a) => a.codigo === "no_cuadra" || a.codigo === "unidad_ambigua" || a.codigo === "salto_de_precio",
  );

  return {
    ...base,
    presentationId: tienePresentacion ? (insumo.presentationId ?? null) : null,
    presentationName: tienePresentacion ? (insumo.presentationName ?? null) : null,
    units,
    unitCostCents,
    quantityBase: tienePresentacion ? redondear3(units * neto) : units,
    avisos,
    // Sólo lo que NO es una adivinanza arranca tildado: la memoria del proveedor
    // y el nombre exacto, y sin ningún aviso duro encima. El fuzzy y el modelo
    // proponen destildados — el apuro cuesta cobertura, nunca corrección.
    incluir: (matchSource === "memoria" || matchSource === "exacto") && !duro,
  };
}

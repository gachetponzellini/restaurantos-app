/**
 * Dónde entregar, cuando el negocio reparte adentro de un barrio cerrado
 * (spec 194).
 *
 * Kentucky Club House (`kcc`) hace envíos **sólo dentro del club de campo**: el
 * que pide no escribe una calle, escribe **su número de lote**. Pedirle
 * «Dirección · Calle y número» es pedirle un dato que no tiene, y de paso el
 * checkout le rechazaba `12` porque exigía 5 caracteres.
 *
 * Es la decisión de un solo negocio y todavía no hay pantalla para
 * configurarla, así que el mapeo vive acá —en un solo lugar, testeable— y no
 * desparramado en `if (slug === "kcc")` por los tres formularios que piden la
 * dirección. El día que un segundo local quiera lo mismo, se agrega al set; el
 * día que quieran elegirlo ellos, esto se convierte en una columna de
 * `businesses` y los formularios no se enteran.
 */

/** Negocios que reparten sólo adentro del barrio. */
const NEGOCIOS_POR_LOTE = new Set(["kcc"]);

export type CopyDeEntrega = {
  /** `true` = el campo pide un lote, no una calle. */
  porLote: boolean;
  /** Etiqueta del campo de entrega. */
  label: string;
  placeholder: string;
  /** Cartel para la web. `null` = no hay restricción que avisar. */
  aviso: string | null;
  /** Error cuando el campo quedó corto. */
  error: string;
  /** Mínimo de caracteres: un lote puede ser `12`, una dirección no. */
  minChars: number;
  /** Título de los chips de direcciones guardadas. */
  guardadasLabel: string;
  /** El piso/depto no existe adentro del barrio. */
  pidePisoDepto: boolean;
  /** Etiqueta para el papel del repartidor — la térmica es ASCII. */
  labelTicket: "Lote" | "Direccion";
};

const CALLE: CopyDeEntrega = {
  porLote: false,
  label: "Dirección",
  placeholder: "Calle y número",
  aviso: null,
  error: "Completá la dirección.",
  minChars: 5,
  guardadasLabel: "Mis direcciones",
  pidePisoDepto: true,
  labelTicket: "Direccion",
};

const LOTE: CopyDeEntrega = {
  porLote: true,
  label: "Nro de lote",
  placeholder: "Ej: 124",
  aviso: "Hacemos envíos sólo dentro del barrio.",
  error: "Completá tu número de lote.",
  minChars: 1,
  guardadasLabel: "Mis lotes",
  pidePisoDepto: false,
  labelTicket: "Lote",
};

/** Cómo le pedimos a este negocio el lugar de entrega. */
export function copyDeEntrega(slug: string): CopyDeEntrega {
  return NEGOCIOS_POR_LOTE.has(slug) ? LOTE : CALLE;
}

/**
 * El lugar de entrega como se lee en una pantalla del local (#319).
 *
 * En un negocio por lote se guarda `124` a secas: mostrado así, el encargado
 * lee un número suelto en la fila de «Entrega a domicilio». Con el prefijo se
 * entiende sin explicación, y lo guardado no cambia.
 */
export function lugarDeEntrega(slug: string, address: string): string {
  const valor = address.trim();
  if (!copyDeEntrega(slug).porLote || valor === "") return valor;
  return /^lote\b/i.test(valor) ? valor : `Lote ${valor}`;
}

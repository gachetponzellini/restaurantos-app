import { z } from "zod";

/**
 * Lo que el modelo tiene permitido decir — spec 172·D1.
 *
 * **Todos los números salen como STRING, verbatim.** Si el modelo devolviera
 * `number` tendría que decidir él si `17.500` es diecisiete mil quinientos o
 * diecisiete y medio — que es exactamente la interpretación que queremos mover
 * al código, y exactamente donde se equivoca en silencio. Además el JSON number
 * borra la evidencia: `"82,600"` con coma y `"1.445.500"` con puntos son las dos
 * pistas que permiten desambiguar por convención argentina y, cuando eso no
 * alcanza, por aritmética.
 *
 * **Todo puede venir en `null`.** Es la regla que más pesa del prompt: un campo
 * vacío lo completa una persona en dos segundos, uno inventado se carga mal y no
 * lo nota nadie. Los dos errores no cuestan lo mismo.
 *
 * Este Zod es la ÚNICA fuente de verdad: `zodOutputFormat` deriva de acá el JSON
 * Schema que viaja en `output_config.format`, y el mismo objeto valida la
 * respuesta. Antes había además un JSON Schema escrito a mano, y se desincronizó
 * de la peor forma posible — usaba `type: ["string", "null"]`, que el validador
 * de structured outputs no acepta, y la API devolvía 400 en todas las lecturas.
 */
export const RenglonModelo = z.object({
  descripcion: z.string(),
  cantidad: z.string().nullable(),
  unidad: z.string().nullable(),
  precio_unitario: z.string().nullable(),
  total_linea: z.string().nullable(),
  /**
   * La alícuota impresa en la columna del renglón — spec 188·D5.
   *
   * La factura A4 con columna TASA es la minoría, así que `null` es la respuesta
   * normal y correcta. Verbatim como todo el resto: «21», «21,00», «10,5».
   */
  tasa_iva: z.string().nullable(),
  origen: z.string(),
  confianza: z.enum(["alta", "media", "baja"]),
});

export const CabeceraModelo = z.object({
  proveedor_nombre: z.string().nullable(),
  proveedor_cuit: z.string().nullable(),
  tipo_comprobante: z
    .enum([
      "factura_a",
      "factura_b",
      "factura_c",
      "ticket",
      "remito",
      "nota_credito",
      "nota_debito",
      "otro",
    ])
    .nullable(),
  numero: z.string().nullable(),
  fecha: z.string().nullable(),
  total: z.string().nullable(),
  origen_total: z.string().nullable(),
  /**
   * La condición de pago impresa, verbatim — spec 187.
   *
   * «CONTADO», «EFECTIVO», «CTA CTE», «CUENTA CORRIENTE 30 DÍAS». Sale del pie y
   * hasta ayer se descartaba: estaba en la lista de «lo que no es un ítem» del
   * prompt, que es cierto —no es un renglón— pero de ahí a tirarlo hay un paso
   * que nadie dio a propósito. Es cabecera.
   *
   * Viaja como texto y la interpreta `condicionDePagoLeida`, que es pura: el
   * modelo no decide si eso significa pagar de la Caja Mayor.
   */
  condicion_pago: z.string().nullable(),
  /**
   * El pie fiscal, verbatim — spec 188.
   *
   * Hasta ayer el prompt los listaba entre «lo que no es un ítem» y ahí moría:
   * NETO GRAVADO, IVA 21%, PERCEPCIÓN. No son renglones —eso era cierto— pero
   * son la cabecera del comprobante, y sin ellos el subdiario de IVA compras no
   * se puede armar.
   *
   * `percepciones` es UNA sola: lo que hace falta es que el pie cierre contra el
   * total, no desagregar IIBB de Ganancias.
   */
  neto: z.string().nullable(),
  iva: z.string().nullable(),
  percepciones: z.string().nullable(),
});

export const LecturaModelo = z.object({
  es_comprobante: z.boolean(),
  motivo_descarte: z.string().nullable(),
  formato: z.enum([
    "manuscrito",
    "lista_preimpresa",
    "ticket_termico",
    "factura_impresa",
    "recibo",
    "otro",
  ]),
  cabecera: CabeceraModelo,
  renglones: z.array(RenglonModelo).max(60),
});

export type LecturaModelo = z.infer<typeof LecturaModelo>;
export type RenglonModelo = z.infer<typeof RenglonModelo>;

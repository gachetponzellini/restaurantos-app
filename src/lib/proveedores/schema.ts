import { z } from "zod";

import { TASAS_IVA } from "./iva";

export const SupplierInput = z.object({
  name: z.string().min(1, "Requerido.").max(100),
  cuit: z.string().max(13).nullable().optional(),
  contact: z.string().max(100).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z
    .string()
    .email("Email inválido.")
    .max(100)
    .nullable()
    .optional()
    .or(z.literal("")),
  notes: z.string().max(500).nullable().optional(),
  is_active: z.boolean(),
  // spec 158 · lo que precarga la compra: el concepto por defecto y los días de
  // crédito (`cod_cga` y `dias_venc` de MaxiRest).
  default_expense_concept_id: z.string().uuid().nullable().optional(),
  payment_terms_days: z.number().int().min(0).max(365).optional(),
});
export type SupplierInput = z.infer<typeof SupplierInput>;

// spec 158 · `interno` es el `Z` de MaxiRest: la compra diaria sin factura, que
// es el 36% de los comprobantes del Golf. Por eso es el default.
export const DOCUMENT_TYPES = [
  "interno",
  "factura_a",
  "factura_b",
  "factura_c",
  "ticket",
  "remito",
  "nota_credito",
  "nota_debito",
] as const;

export const EXPENSE_RUBROS = [
  "mercaderias",
  "servicios",
  "mantenimiento",
  "personal",
  "impuestos",
  "vajilla",
  "societarios",
  "otros",
] as const;

export type ExpenseRubro = (typeof EXPENSE_RUBROS)[number];

/**
 * Cómo se llama cada rubro en pantalla. Vivía adentro de `getGastoPorConcepto`
 * como una constante local; el ABM de la spec 162 necesita las mismas
 * etiquetas, y dos copias del mismo diccionario se desincronizan solas.
 */
export const RUBRO_LABELS: Record<ExpenseRubro, string> = {
  mercaderias: "Mercaderías",
  servicios: "Servicios",
  mantenimiento: "Mantenimiento",
  personal: "Gastos en personal",
  impuestos: "Impuestos y tasas",
  vajilla: "Vajilla y mantelería",
  societarios: "Movimientos societarios",
  otros: "Otros gastos",
};

/**
 * Lo que se puede corregir de un comprobante ya cargado — spec 163.
 *
 * **La guarda está partida en dos**, y esa es la decisión: los campos de PLATA
 * (total, fecha, tipo) sólo se tocan mientras no haya pagos vivos imputados;
 * los de CLASIFICACIÓN (concepto, vencimiento, número, notas) siempre.
 *
 * El caso que duele es justamente el segundo: el concepto de gasto es columna
 * nuestra, alimenta el informe de la 158, y es lo típico que se descubre mal
 * clasificado a fin de mes con la compra ya paga. Sin esto, corregir un rótulo
 * obliga a anular el pago —y `anularPagoProveedor` marca la sangría que el
 * arqueo ya contó—, así que nadie lo hace y el informe queda sucio para
 * siempre.
 */
export const SupplierInvoiceEditInput = z.object({
  id: z.string().uuid(),
  // Clasificación: siempre editable.
  expense_concept_id: z.string().uuid().nullable().optional(),
  invoice_number: z.string().max(50).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimiento inválido.")
    .nullable()
    .optional(),
  // Plata: sólo sin pagos vivos. Lo verifica el server, no este schema.
  total_cents: z.number().int().optional(),
  invoice_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
    .optional(),
  document_type: z.enum(DOCUMENT_TYPES).optional(),
});
export type SupplierInvoiceEditInput = z.infer<typeof SupplierInvoiceEditInput>;

export const SUPPLIER_PAYMENT_METHODS = [
  "cash",
  "transfer",
  "card_manual",
  "other",
] as const;

/**
 * Cómo se salda la compra — spec 187.
 *
 * **No es una columna de `supplier_invoices`** (187·D1): el saldo del proveedor
 * se DERIVA de `Σ comprobantes vivos − Σ pagos vivos` (158·D3), así que una
 * columna diciendo «contado» sería una segunda fuente para la misma pregunta —
 * y se separarían el día que alguien anule el pago.
 *
 * `contado` es un atajo: escribe el mismo pago e imputación que escribiría el
 * diálogo de pago, por el total, contra el comprobante recién creado.
 */
export const PAYMENT_CONDITIONS = ["cuenta_corriente", "contado"] as const;
export type PaymentCondition = (typeof PAYMENT_CONDITIONS)[number];

/**
 * Un renglón del comprobante — spec 165.
 *
 * `units` son ENVASES (2 bolsas), no unidades base: el server multiplica por el
 * `net_quantity` de la presentación, que es lo que `ingredient_presentations`
 * ya sabe convertir. `unit_cost_cents` es lo que costó UN envase, y es el precio
 * que se propaga al insumo.
 */
/**
 * De dónde salió la propuesta de insumo de un renglón — 172·D6, que declaró la
 * columna y nunca la llenó. Espeja el CHECK de la 0092.
 */
export const MATCH_SOURCES = [
  "memoria",
  "exacto",
  "fuzzy",
  "llm",
  "manual",
  "manual_corregido",
] as const;

export const SupplierInvoiceItemInput = z.object({
  ingredient_id: z.string().uuid("Insumo inválido."),
  presentation_id: z.string().uuid().nullable().optional(),
  units: z.number().positive("La cantidad debe ser mayor a 0."),
  /**
   * Lo que costó UN envase, **en la base del papel** — spec 188·D1.
   *
   * En una factura A es el neto; en un ticket, una B o un interno es el final.
   * Cuál de los dos lo decide la RPC leyendo el `document_type` del comprobante
   * y lo escribe en `price_base`: el caller no puede mentir sobre la base de un
   * precio que se propaga al costo de un insumo.
   */
  unit_cost_cents: z.number().int().min(0),
  /**
   * La alícuota impresa en el renglón, si el papel la traía — spec 188·D5.
   *
   * Sólo sirve para mostrar el precio final. No entra en ninguna cuenta que
   * escriba plata.
   */
  tasa_iva: z
    .number()
    .refine((n) => (TASAS_IVA as readonly number[]).includes(n), "Alícuota inválida.")
    .nullable()
    .optional(),
  /** Lo que decía el papel, verbatim. El equivalente de `mxitc.referencia`. */
  source_text: z.string().max(300).nullable().optional(),
  match_source: z.enum(MATCH_SOURCES).nullable().optional(),
});
export type SupplierInvoiceItemInput = z.infer<typeof SupplierInvoiceItemInput>;

export const SupplierInvoiceInput = z
  .object({
    supplier_id: z.string().uuid("Proveedor inválido."),
    invoice_number: z.string().max(50).nullable().optional(),
    invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
    total_cents: z.number().int(),
    /**
     * La foto vieja, de a una. **Se mantiene a propósito**: la migración que
     * agrega `photo_urls` no dropea `photo_url`, y entre que se aplica y que el
     * deploy de Vercel está arriba hay una ventana donde el diálogo viejo sigue
     * mandando este campo y nada más. El server rellena las dos columnas.
     */
    photo_url: z.string().nullable().optional(),
    /**
     * Las páginas del comprobante, en orden — spec 173.
     *
     * «A veces los tickets son muy largos»: un ticket de comanda de un metro se
     * fotografía en tres o cuatro pedazos, y hasta ahora el segundo pedazo no
     * tenía dónde guardarse. El orden del array ES el orden de las páginas: el
     * lector une las lecturas por ese índice y la cabecera sale de la primera
     * página que traiga cada campo (el total, de la última — está al pie).
     *
     * El techo de 5 no es estético: cada página es una llamada al modelo, y con
     * `maxDuration = 60` en el route no entran muchas más aunque vayan en
     * paralelo.
     *
     * El `min(1)` de cada path espeja el CHECK de la 0095, que rechaza el string
     * vacío y el null adentro del array. Sin esto, un path vacío —una subida que
     * quedó a medias— rebota recién en la base, con un 23514 que la action
     * traduce a «No pudimos cargar la factura» y no dice cuál de las cinco fotos
     * era.
     */
    photo_urls: z.array(z.string().min(1)).max(5).default([]),
    notes: z.string().max(500).nullable().optional(),
    document_type: z.enum(DOCUMENT_TYPES).default("interno"),
    expense_concept_id: z.string().uuid().nullable().optional(),
    /** Si no viene, lo calcula el server con los días de crédito del proveedor. */
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Vencimiento inválido.")
      .nullable()
      .optional(),
    /**
     * spec 165 · el detalle por insumo. **Opcional a propósito**: el 92% de los
     * comprobantes del Golf se cargan sólo con concepto de gasto, y la ayuda de
     * MaxiRest bendice ese camino. Sin renglones el comprobante sigue siendo
     * válido — lo que no hace es mover stock ni actualizar costos.
     *
     * Y NO se valida que Σ renglones = total: en 2026 sólo 585 de 1.502
     * comprobantes del Golf cuadran exacto.
     */
    /**
     * El pie fiscal — spec 188.
     *
     * Los tres son `null` cuando no se leyeron, **nunca 0** (188·D3): un
     * `iva_cents = 0` en una factura A no es un dato faltante, es la declaración
     * de que la compra fue exenta, y sobre el subdiario eso es crédito fiscal
     * que se pierde. El `nullish()` es a propósito: un formulario que manda
     * `undefined` y uno que manda `null` significan lo mismo acá.
     *
     * Y NO se valida que `neto + IVA + percepciones = total` (188·D4): se
     * concilia en pantalla y se carga igual, como el `Σ renglones ≠ total` de
     * la 165·D2.
     */
    neto_cents: z.number().int().nullable().optional(),
    iva_cents: z.number().int().nullable().optional(),
    percepciones_cents: z.number().int().nullable().optional(),
    /**
     * spec 187 · la condición de pago, que Rocío pidió «en la misma carga».
     *
     * `cuenta_corriente` es lo de siempre y sigue siendo el default: no cambia
     * el comportamiento de nada que ya esté cargado ni de ningún otro caller.
     * `contado` hace que el server registre el pago por el total después de
     * crear el comprobante.
     */
    payment_condition: z.enum(PAYMENT_CONDITIONS).default("cuenta_corriente"),
    /** Sólo se mira con `contado`. `cash` sale de la Caja Mayor (160). */
    payment_method: z.enum(SUPPLIER_PAYMENT_METHODS).default("cash"),
    items: z.array(SupplierInvoiceItemInput).max(100).default([]),
  })
  // El signo lo manda el tipo (D4): la nota de crédito resta, todo lo demás
  // suma. Es el mismo check que el de la base — acá para dar el mensaje bueno.
  .refine(
    (v) => (v.document_type === "nota_credito" ? v.total_cents <= 0 : v.total_cents >= 0),
    {
      message: "La nota de crédito va en negativo; el resto de los comprobantes, en positivo.",
      path: ["total_cents"],
    },
  )
  /**
   * Cero no es un importe — spec 172.
   *
   * El `defaultValue` del formulario es `0` y el input pinta `""` cuando el valor
   * es falsy: la pantalla dice «vacío» y el modelo dice «cero». Guardar sin tocar
   * el campo daba un comprobante de $0 que figuraba cargado en la cuenta
   * corriente, sin un solo error.
   *
   * Importa el doble con el lector de facturas: un importe que el modelo no pudo
   * leer tiene que llegar VACÍO y frenar acá, nunca convertirse en un cero que
   * pasa de largo. Un dato faltante se completa; uno falso no se nota.
   *
   * El CHECK de la base sigue admitiendo 0 (cambiarlo es una migración sobre
   * datos vivos); esta es la puerta por la que entra la app.
   */
  .refine((v) => v.total_cents !== 0, {
    message: "Poné el importe del comprobante.",
    path: ["total_cents"],
  })
  /**
   * La nota de crédito no se paga — spec 187·D6.
   *
   * Su total es negativo (D4 de la 158) y `SupplierPaymentInput` exige monto
   * positivo: sin esta guarda el error aparecería recién adentro del Zod del
   * pago, con el comprobante ya creado y un mensaje que habla de otra pantalla.
   */
  .refine((v) => v.payment_condition !== "contado" || v.total_cents > 0, {
    message: "Una nota de crédito no se paga: resta del saldo.",
    path: ["payment_condition"],
  });
export type SupplierInvoiceInput = z.infer<typeof SupplierInvoiceInput>;

export const ExpenseConceptInput = z.object({
  name: z.string().min(1, "Requerido.").max(60),
  rubro: z.enum(EXPENSE_RUBROS),
  is_active: z.boolean().default(true),
});
export type ExpenseConceptInput = z.infer<typeof ExpenseConceptInput>;

export const SupplierPaymentInput = z.object({
  supplier_id: z.string().uuid("Proveedor inválido."),
  amount_cents: z.number().int().positive("El monto debe ser mayor a 0."),
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.").optional(),
  notes: z.string().max(500).nullable().optional(),
  /** Comprobantes a cancelar. Vacío = pago a cuenta. */
  invoice_ids: z.array(z.string().uuid()).max(200).default([]),
});
// spec 160 · `caja_id` ya NO viaja en el input: el efectivo sale siempre de la
// caja administrativa y el server la resuelve. Dejarlo acá sería volver a
// ofrecerle al cliente la decisión que la spec vino a sacarle — el CHECK
// `supplier_payments_caja_coherente` de la base sigue exigiendo que la fila la
// tenga, y la tiene: la que puso el server.
export type SupplierPaymentInput = z.infer<typeof SupplierPaymentInput>;

export const AnularInput = z.object({
  id: z.string().uuid(),
  reason: z.string().min(3, "Escribí un motivo.").max(200),
});
export type AnularInput = z.infer<typeof AnularInput>;

export const ImportSupplierRow = z.object({
  name: z.string().min(1, "Nombre requerido.").max(100),
  cuit: z.string().max(13).optional(),
  contact: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email("Email inválido.").max(100).optional().or(z.literal("")),
});
export type ImportSupplierRow = z.infer<typeof ImportSupplierRow>;

export const ImportSupplierBatch = z
  .array(ImportSupplierRow)
  .min(1, "Al menos una fila.")
  .max(500, "Máximo 500 filas por lote.");
export type ImportSupplierBatch = z.infer<typeof ImportSupplierBatch>;

export type Supplier = {
  id: string;
  businessId: string;
  name: string;
  cuit: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** spec 158 · lo que precarga la compra. */
  defaultExpenseConceptId: string | null;
  paymentTermsDays: number;
};

export type SupplierWithStats = Supplier & {
  totalSpentCents: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
};

export type SupplierInvoice = {
  id: string;
  businessId: string;
  supplierId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  totalCents: number;
  /**
   * El PATH en el bucket de la primera página (columna vieja `photo_url`). No es
   * una URL navegable: el bucket es privado y hay que firmarla.
   */
  photoUrl: string | null;
  /** La primera página, ya firmada. Es `photoUrls[0]`, y está para no romper a
   *  quien todavía muestra una sola foto (`supplier-detail` → `CuentaCorrientePanel`). */
  photoSignedUrl: string | null;
  /**
   * Todas las páginas del comprobante, FIRMADAS y en orden — spec 173.
   *
   * Ojo con el nombre: `photoUrl` (singular) es un path crudo y `photoUrls`
   * (plural) son URLs firmadas. Se llaman así porque el singular ya existía con
   * ese significado y renombrarlo tocaba archivos de otras specs; lo que se
   * consume en pantalla es siempre el plural.
   *
   * Los comprobantes cargados antes de la migración tienen `photo_urls` vacío y
   * `photo_url` con la única foto: acá llegan igual, como array de uno.
   */
  photoUrls: string[];
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  /** spec 158 */
  documentType: string;
  expenseConceptId: string | null;
  dueDate: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
};

/**
 * Un renglón de un comprobante ya cargado — spec 172.
 *
 * La 165 creó `supplier_invoice_items` y la dejó de sólo escritura: la RPC
 * insertaba, la reversión borraba, y no había una sola query que los leyera. Con
 * cinco renglones tipeados a mano se podía vivir sin eso, porque quien los tipeó
 * se acordaba. El lector de facturas los carga de a diez y borra esa propiedad:
 * el único rastro de qué movió el stock y pisó el costo sería una pantalla que no
 * existía.
 *
 * Y como los renglones **no se editan** (165, «qué no entra»: se anula y se
 * rehace), poder mirarlos es lo único que queda entre el encargado y una
 * auditoría a ciegas.
 */
export type SupplierInvoiceItem = {
  id: string;
  invoiceId: string;
  ingredientId: string;
  ingredientName: string;
  /** La unidad base del insumo: kg, lt, un, g, ml. */
  ingredientUnit: string;
  /** El envase con el que se cargó, congelado al momento de la compra. */
  presentationName: string | null;
  /** Envases, no unidades base (165·D5). */
  units: number;
  /** `units × net_quantity` — lo que efectivamente entró al stock. */
  quantityBase: number;
  /** Lo que costó UN envase. Es lo que pisó el costo del insumo. */
  unitCostCents: number;
  /**
   * En qué base está `unitCostCents` — spec 188. `neto` sólo en la factura A.
   * Es lo que deja mostrar el IVA de un comprobante viejo sin volver a
   * preguntarle al tipo de comprobante, que puede haberse editado después.
   */
  priceBase: "neto" | "final" | null;
  /** La alícuota del renglón, si se conocía. Para mostrar, nunca para costear. */
  tasaIva: number | null;
};

export type SupplierIngredientLink = {
  supplierId: string;
  ingredientId: string;
  ingredientName: string;
  ingredientUnit: string;
  createdAt: string;
};

export type SupplierStats = {
  supplierId: string;
  supplierName: string;
  totalSpentCents: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
};

export type SupplierOutflowItem = {
  supplierId: string;
  supplierName: string;
  totalCostCents: number;
  consumptionCount: number;
};

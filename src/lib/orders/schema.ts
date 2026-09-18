import { z } from "zod";

/**
 * Ítem de carrito. Puede ser un producto normal o un menú del día (combo).
 * Usamos un discriminated union por `kind` — omitirlo defaultea a `"product"`
 * por back-compat con ítems persistidos antes de la feature.
 */
const OrderProductItem = z.object({
  kind: z.literal("product").optional(),
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(200).optional(),
  modifier_ids: z.array(z.string().uuid()).default([]),
});

const OrderSelectedChoice = z.object({
  choice_group_id: z.string().uuid(),
  choice_group_label: z.string(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  modifier_ids: z.array(z.string().uuid()).default([]),
});

const OrderDailyMenuItem = z.object({
  kind: z.literal("daily_menu"),
  daily_menu_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(200).optional(),
  selected_choices: z.array(OrderSelectedChoice).default([]),
});

export const OrderItemInput = z.union([OrderProductItem, OrderDailyMenuItem]);
export type OrderItemInput = z.infer<typeof OrderItemInput>;

/**
 * Renglón libre — el «no existe» de MaxiRest (spec 174): nombre y precio
 * tipeados en el momento, sin producto de catálogo detrás. La torta que trajo
 * el cliente, el pescado del día que nadie cargó, el menú que se le factura al
 * sanatorio a fin de mes.
 *
 * **No está en `OrderItemInput` a propósito.** Igual que el
 * `price_override_cents` de la spec 069, esto sólo puede nacer de una mano del
 * local: si viviera en el schema público, un carrito armado a mano podría
 * inventarse un renglón con el nombre y el precio que quiera y el checkout lo
 * aceptaría. Vive únicamente en los schemas de staff, donde además hay un gate
 * de rol (`canCargarItemLibre`).
 *
 * `.strict()` porque el resto de los campos de una línea no aplican y aceptarlos
 * en silencio sería mentir: un `price_override_cents` acá no tendría sobre qué
 * precio de catálogo aplicarse —el precio ya *es* el que se tipeó— y un
 * `modifier_ids` no tiene producto al que colgarse.
 */
const OrderFreeLineItem = z
  .object({
    kind: z.literal("free"),
    /** Lo que va a leer el cliente en el ticket. Es la única explicación que
     *  lleva el renglón: por eso no pide motivo aparte, a diferencia de la 069. */
    name: z.string().trim().min(1, "Poné un nombre.").max(80),
    /** Entero ≥ 0. Sin tope, igual que el override de la 069: el control es el
     *  rol, no un límite duro. $0 es válido (la cortesía que igual se lista). */
    unit_price_cents: z.number().int().min(0),
    quantity: z.number().int().min(1).max(99),
    notes: z.string().max(200).optional(),
  })
  .strict();

export type OrderFreeLineItem = z.infer<typeof OrderFreeLineItem>;

/** ¿Es un renglón libre? Type guard compartido por las actions y los carritos. */
export function isFreeLine(item: { kind?: string }): item is OrderFreeLineItem {
  return item.kind === "free";
}

/**
 * Ítem cargado por staff (spec 069): igual al público, más el precio por ítem
 * que el encargado puede pisar para ese pedido.
 *
 * Deliberadamente **separado** de `OrderProductItem` en vez de agregarle los
 * campos: `OrderProductItem` es el que valida el checkout público y el chatbot.
 * Si el override viviera ahí, un payload público con `price_override_cents`
 * pasaría el schema y toda la defensa quedaría colgando de que ningún caller se
 * olvide de limpiarlo. Con dos schemas, el pedido del comensal no puede
 * expresar un precio ni aunque quiera.
 *
 * El gate de rol y el motivo obligatorio los aplica `validatePriceOverride`
 * en la action — acá sólo la forma.
 */
const StaffOrderProductItem = OrderProductItem.extend({
  price_override_cents: z.number().int().min(0).nullable().optional(),
  price_override_reason: z.string().max(300).nullable().optional(),
});

export const StaffOrderItemInput = z.union([
  StaffOrderProductItem,
  OrderDailyMenuItem,
  OrderFreeLineItem,
]);
export type StaffOrderItemInput = z.infer<typeof StaffOrderItemInput>;

export const CreateOrderInput = z
  .object({
    business_slug: z.string().min(1),
    delivery_type: z.enum(["delivery", "pickup"]),
    customer_name: z.string().min(1).max(100),
    customer_phone: z.string().min(6).max(20),
    customer_email: z.string().email("Email inválido.").max(200).optional(),
    delivery_address: z.string().max(200).optional(),
    delivery_notes: z.string().max(500).optional(),
    /**
     * Indicación para cocina («ENTREGAR x» en la comanda). El checkout público
     * NO la expresa —la escribe el encargado—, pero viaja acá porque
     * `cargarPedidoStaff` mapea su input a esta forma antes de persistir.
     */
    kitchen_notes: z.string().max(120).optional(),
    payment_method: z.enum(["cash", "mp"]).optional(),
    /**
     * Optional promo code typed by the customer in checkout. The DB lookup
     * is case-insensitive — we don't normalize here. Empty strings are
     * treated as "no code" by persist-order.
     */
    promo_code: z.string().trim().max(40).optional(),
    /**
     * Pedido diferido (spec 31): instante ISO de retiro futuro. Ausente = "para
     * ahora". Las reglas contextuales (horario, anticipación, ventana) se
     * validan server-side con los `business_hours` del negocio en persist-order;
     * acá sólo la coherencia que no necesita contexto.
     */
    scheduled_at: z.string().datetime({ offset: true }).optional(),
    items: z.array(OrderItemInput).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.delivery_type === "delivery" && !data.delivery_address) {
      ctx.addIssue({
        code: "custom",
        message: "Ingresá una dirección de entrega.",
        path: ["delivery_address"],
      });
    }
    // `scheduled_at` no tiene reglas cruzadas acá (spec 061): retiro y delivery
    // se programan con cualquier método de pago. Las reglas que quedan —
    // anticipación, ventana, horario del local, y que `dine_in` no se programa —
    // dependen del negocio (timezone + business_hours) y viven en
    // `validateScheduledOrder`, que corre en `persistOrder`.
  });

export type CreateOrderInput = z.infer<typeof CreateOrderInput>;

/**
 * Input para cargar un pedido para llevar / delivery a mano desde operación
 * (spec 054), más laxo que el público `CreateOrderInput`:
 * - `customer_name` opcional (el mostrador anónimo cae en "Mostrador").
 * - `customer_phone` opcional en pickup (se guarda "-"); requerido en delivery.
 * - sin `promo_code` / `payment_method` (el cobro es aparte, US3): el pedido
 *   nace en efectivo/pendiente y se cobra desde la card.
 * - **con** `scheduled_at` desde spec 085: el encargue telefónico ("para las
 *   21") que antes sólo podía entrar por el checkout del cliente. Mismas reglas
 *   —hoy, anticipación mínima, chip de la grilla— porque las aplica el mismo
 *   `validateScheduledOrder` dentro de `persistOrder`: acá sólo la forma.
 * El action `cargarPedidoStaff` mapea esto a `CreateOrderInput` aplicando los
 * defaults antes de llamar a `persistOrder`.
 */
export const StaffOrderInput = z
  .object({
    business_slug: z.string().min(1),
    delivery_type: z.enum(["delivery", "pickup"]),
    customer_name: z.string().max(100).optional(),
    customer_phone: z.string().max(20).optional(),
    delivery_address: z.string().max(200).optional(),
    delivery_notes: z.string().max(500).optional(),
    /**
     * Indicación para cocina («21:30», «junto con la mesa 5»). Sale arriba de
     * la comanda como «ENTREGAR x». Corta a propósito: es un renglón que se lee
     * de lejos en doble ancho, no un párrafo.
     */
    kitchen_notes: z.string().max(120).optional(),
    /** Spec 085 — instante de retiro/entrega. Ausente = "para ahora". */
    scheduled_at: z.string().datetime({ offset: true }).optional(),
    /**
     * Spec 127 — hora DE COCINA: para cuándo el plato tiene que estar listo. La
     * escribe el encargado a mano, junto con la del pedido; el sistema no la
     * calcula. Es la que sale impresa arriba de la comanda y la que manda la
     * ventana de marcha. Sólo existe acá: el checkout público expresa una sola
     * hora, así que `CreateOrderInput` no la tiene.
     */
    kitchen_at: z.string().datetime({ offset: true }).optional(),
    items: z.array(StaffOrderItemInput).min(1),
  })
  .superRefine((data, ctx) => {
    // Spec 127 — las dos horas van juntas: el encargado escribe las dos o
    // ninguna. Media hora cargada es un pedido que no se sabe si es para ahora.
    if (Boolean(data.scheduled_at) !== Boolean(data.kitchen_at)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Cargá las dos horas: la de cocina y la del pedido, o ninguna de las dos.",
        path: [data.scheduled_at ? "kitchen_at" : "scheduled_at"],
      });
    }
    if (data.delivery_type === "delivery") {
      if (!data.delivery_address || data.delivery_address.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "Ingresá una dirección de entrega.",
          path: ["delivery_address"],
        });
      }
      if (!data.customer_phone || data.customer_phone.trim().length < 6) {
        ctx.addIssue({
          code: "custom",
          message: "Ingresá un teléfono para el delivery.",
          path: ["customer_phone"],
        });
      }
    }
  });

export type StaffOrderInput = z.infer<typeof StaffOrderInput>;

/**
 * Contrato **interno** de `persistOrder`, más ancho que el público: suma
 * `dine_in` para la venta de mostrador (spec 058), que nace sin mesa y no pasa
 * por el board. El checkout público sigue tipado con `CreateOrderInput` (dos
 * valores) — `CreateOrderInput` es asignable a esto, así que ningún caller
 * existente cambia.
 */
export type PersistableOrderInput = Omit<
  CreateOrderInput,
  "delivery_type" | "items"
> & {
  delivery_type: CreateOrderInput["delivery_type"] | "dine_in";
  /**
   * Suma el renglón libre de la spec 174. `CreateOrderInput` sigue siendo
   * asignable a esto (su `items` es un subconjunto), así que ningún caller
   * existente cambia — pero `persistOrder` los acepta **sólo** con
   * `options.allowFreeLines`, que prenden los dos callers de staff después de
   * chequear el rol.
   */
  items: (OrderItemInput | OrderFreeLineItem)[];
};

/**
 * Venta rápida de mostrador / kiosko / barra (spec 058): productos reales de la
 * carta, **sin mesa y sin datos de cliente**, que se carga y se cobra en un solo
 * gesto. A diferencia de `StaffOrderInput` (que deja el pedido abierto en el
 * board para triage), acá el cobro viaja en el mismo input porque la venta nace
 * pagada y cerrada.
 *
 * `tip_cents` existe para no cerrarle la puerta al frasco de propinas de la
 * barra, pero la UI de fase 1 manda siempre 0.
 */
export const VentaMostradorInput = z.object({
  business_slug: z.string().min(1),
  items: z
    .array(z.union([OrderProductItem, OrderDailyMenuItem, OrderFreeLineItem]))
    .min(1, "Agregá al menos un producto."),
  method: z.enum([
    "cash",
    "card_manual",
    "transfer",
    "mp_manual",
    "other",
    // spec 141 — el mostrador también fía: es justo donde el socio dice
    // «ponelo en mi cuenta», sin mesa de por medio.
    "cuenta_corriente",
  ]),
  caja_id: z.string().uuid(),
  tip_cents: z.number().int().min(0).default(0),
  last_four: z.string().length(4).optional(),
  card_brand: z.enum(["visa", "mastercard", "amex", "otro"]).optional(),
  notes: z.string().max(500).optional(),
  /** Clave de idempotencia del intento de cobro (dedup en la RPC, issue #58). */
  request_id: z.string().uuid().optional(),
  /** A quién se le fía. Obligatorio sii `method = 'cuenta_corriente'`. */
  credit_customer_id: z.string().uuid().nullish(),
});

export type VentaMostradorInput = z.infer<typeof VentaMostradorInput>;

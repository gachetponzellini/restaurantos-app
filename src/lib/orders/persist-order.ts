import "server-only";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { menuDisponibleHoy } from "@/lib/daily-menus/disponible-hoy";
import { currentDayOfWeek } from "@/lib/day-of-week";
import { formatCurrency } from "@/lib/currency";
import { createNotification } from "@/lib/notifications/create";
import { notifyDeliveryStatusChange } from "@/lib/notifications/delivery-notify";
import { createPreference } from "@/lib/payments/mercadopago";
import { customerPhoneKey } from "@/lib/phone";
import { validatePromoCode } from "@/lib/promos/validate";
import {
  applyPriceOverride,
  lineSubtotalCents,
  type PriceOverride,
} from "@/lib/comandas/price-override";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import type {
  ReservationMode,
  WeeklySchedule,
} from "@/lib/reservations/types";

import { resolveComboUpcharge } from "./combo-pricing";
import {
  operatingDay,
  orderSlotsForDay,
  validateScheduledOrder,
} from "./scheduled";
import type { BusinessRole } from "@/lib/admin/context";
import {
  validateItemLibre,
  type ItemLibre,
} from "@/lib/comandas/item-libre";

import type { PersistableOrderInput } from "./schema";
import { aceptaPedidoInmediato, type BusinessHour } from "@/lib/business-hours";
import { clienteParaCupon, resolverClienteDelPedido } from "@/lib/customers/resolver-cliente";

export type CreateOrderResult = {
  order_id: string;
  order_number: number;
  /** El número del pedido del día (arranca en 1 cada jornada): el que sale
   *  impreso en la comanda y el que el local canta. */
  daily_number: number;
  /**
   * Present when the order was placed with MP as payment method and the
   * business has MP configured. Client should redirect to this URL to
   * complete the payment.
   */
  mp_init_point?: string;
};

export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const proto = rootDomain.includes("localhost") ? "http" : "https";
  return `${proto}://${rootDomain}`;
}

export async function persistOrder(
  data: PersistableOrderInput,
  userId?: string | null,
  options?: {
    /**
     * Staff que cargó el pedido a mano desde operación (spec 054). Se persiste
     * en `orders.mozo_id` como "cargado por" — el board no filtra por mozo_id,
     * así que no cambia el listado; sólo deja auditoría de quién lo cargó. Los
     * callers del checkout público lo omiten → `null` (comportamiento idéntico).
     */
    mozoId?: string | null;
    /**
     * Precios pisados por línea (spec 069), indexados por posición en
     * `data.items`. Llega SÓLO por el camino de staff (`cargarPedidoStaff`),
     * que ya validó rol + motivo con `validatePriceOverride`.
     *
     * Va por opciones y no dentro de `data.items` a propósito: el input del
     * checkout público es el mismo tipo, y así no hay forma de que un payload
     * del comensal exprese un precio. Si el caller público lo omite (siempre),
     * el comportamiento es idéntico al de antes de la spec.
     */
    priceOverrides?: (PriceOverride | null)[];
    /**
     * Quién carga el pedido (spec 127). `staff` afloja las tres reglas del
     * checkout —la grilla de chips, los 60 min de anticipación y el «sólo
     * hoy»— que son justo las que le impiden al encargado tomar un encargue
     * telefónico para dentro de un rato.
     *
     * Va por opciones y no dentro de `data`, como los precios pisados: el input
     * del checkout público es el mismo tipo, y así no hay forma de que un
     * payload del comensal se declare staff y se saltee la validación.
     */
    source?: "public" | "staff";
    /**
     * Hora DE COCINA (spec 127): para cuándo el plato tiene que estar listo. Es
     * la que se imprime arriba de la comanda y la que manda la ventana de
     * marcha. Por opciones por la misma razón que `source`: si viajara en el
     * input, un pedido del comensal podría adelantar su propia marcha.
     */
    kitchenAt?: string | null;
    /**
     * Este camino puede traer renglones libres (spec 174). Lo prenden los dos
     * callers de staff —`cargarPedidoStaff` y `venderMostrador`— y nadie más.
     *
     * Por opciones, como los precios pisados y el `source`: el checkout público
     * comparte esta función, y el default (ausente) hace que una línea libre
     * que se colara en el payload muera acá en vez de escribirse. El schema
     * público ya no la puede expresar; esto es la segunda cerradura.
     */
    allowFreeLines?: boolean;
    /**
     * Rol de quien carga, para el gate del renglón libre. Sólo lo mandan los
     * callers que además prenden `allowFreeLines`.
     */
    role?: BusinessRole;
  },
): Promise<ActionResult<CreateOrderResult>> {
  const supabase = createSupabaseServiceClient();

  const { data: business } = await supabase
    .from("businesses")
    .select(
      "id, slug, timezone, delivery_fee_cents, min_order_cents, mp_access_token, mp_accepts_payments",
    )
    .eq("slug", data.business_slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!business) return actionError("Negocio no encontrado.");

  const requestedPayment = data.payment_method ?? "cash";
  const wantsMp = requestedPayment === "mp";
  const mpEnabled = Boolean(
    business.mp_accepts_payments && business.mp_access_token,
  );
  if (wantsMp && !mpEnabled) {
    return actionError("Este negocio no acepta Mercado Pago por ahora.");
  }
  const paymentMethod = wantsMp ? "mp" : "cash";

  // ── Local cerrado (auditoría de pedidos · ALTA) ──────────────────────────
  // El checkout público no miraba el horario: a las 3 am un pedido pagado por
  // MP se marchaba solo e imprimía, y uno en efectivo quedaba pendiente para
  // siempre. Sólo los inmediatos: los programados se validan contra su grilla
  // abajo. El staff (mozoId / source distinto de público) carga cuando quiere.
  if (
    !data.scheduled_at &&
    !options?.mozoId &&
    (options?.source ?? "public") === "public"
  ) {
    const { data: hours } = await supabase
      .from("business_hours")
      .select("day_of_week, opens_at, closes_at")
      .eq("business_id", business.id);
    if (
      !aceptaPedidoInmediato(
        (hours ?? []) as BusinessHour[],
        business.timezone,
      )
    ) {
      return actionError(
        "El local está cerrado en este momento. Podés programar el pedido para más tarde.",
      );
    }
  }

  // ── Pedido diferido (spec 31 + 061 + 064) ───────────────────────────────
  // Con `scheduled_at` validamos que sea para HOY, con la anticipación mínima
  // y en uno de los chips que el negocio ofrece hoy en reservas (spec 064) —
  // ya no contra `business_hours` ni con ventana de días. La grilla sale del
  // modo de reservas: flexible → servicios cada 15 min; estricto → `schedule`.
  // Server es la fuente de verdad: el checkout reusa el mismo helper sólo para
  // feedback. El "agendado" es un estado derivado (futuro + sin comandas), y no
  // marcha hasta el lead del negocio (cron) o "marchar ahora"; si está impago,
  // hasta que el encargado lo acepte.
  let scheduledAtIso: string | null = null;
  // Spec 127 — la hora de cocina viaja por opciones (ver docblock). Se valida
  // junto con la del pedido: no puede ser posterior, y sin hora de pedido no
  // tiene sentido, así que se descarta.
  const kitchenAt = options?.kitchenAt ? new Date(options.kitchenAt) : null;
  let kitchenAtIso: string | null = null;
  if (data.scheduled_at) {
    const scheduledAt = new Date(data.scheduled_at);
    const [{ data: reservationSettings }, { data: services }] =
      await Promise.all([
        supabase
          .from("reservation_settings")
          .select("mode, schedule")
          .eq("business_id", business.id)
          .maybeSingle(),
        supabase
          .from("reservation_services")
          .select("day_of_week, opens_at, closes_at")
          .eq("business_id", business.id),
      ]);
    const validation = validateScheduledOrder({
      scheduledAt,
      deliveryType: data.delivery_type,
      daySlots: orderSlotsForDay(
        {
          mode: (reservationSettings?.mode ?? null) as ReservationMode | null,
          schedule: (reservationSettings?.schedule ??
            null) as WeeklySchedule | null,
          services: services ?? [],
        },
        new Date(),
        business.timezone,
      ),
      timezone: business.timezone,
      source: options?.source ?? "public",
      kitchenAt,
    });
    if (!validation.ok) return actionError(validation.error);
    scheduledAtIso = scheduledAt.toISOString();
    kitchenAtIso = kitchenAt?.toISOString() ?? null;
  }

  // Separamos ítems por tipo. Un carrito puede mezclar productos y menús.
  const productItems = data.items.filter(
    (i): i is Extract<typeof i, { product_id: string }> =>
      i.kind !== "daily_menu" && i.kind !== "free",
  );

  // ── Renglones libres (spec 174) ──────────────────────────────────────────
  // El gate corre acá, antes de escribir nada: sin `allowFreeLines` la línea
  // ni siquiera es legal en este camino, y con él todavía falta el rol.
  const freeLines = data.items.filter(
    (i): i is Extract<typeof i, { kind: "free" }> => i.kind === "free",
  );
  const freeLibreByIdx = new Map<number, ItemLibre>();
  if (freeLines.length > 0) {
    if (!options?.allowFreeLines) {
      return actionError("Este pedido no puede llevar artículos fuera de la carta.");
    }
    for (const [idx, item] of data.items.entries()) {
      if (item.kind !== "free") continue;
      const validation = validateItemLibre(item, options.role ?? "personal");
      if (!validation.ok) return actionError(validation.error);
      freeLibreByIdx.set(idx, validation.libre);
    }
  }
  const menuItems = data.items.filter(
    (i): i is Extract<typeof i, { daily_menu_id: string }> =>
      i.kind === "daily_menu",
  );

  // --- Validación de productos ---
  const productIds = [...new Set(productItems.map((i) => i.product_id))];
  const productById = new Map<
    string,
    { id: string; name: string; price_cents: number }
  >();
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("products")
      .select("id, name, price_cents, business_id, is_active, is_available")
      .in("id", productIds);
    if (!products || products.length !== productIds.length) {
      return actionError("Algún producto ya no está disponible.");
    }
    for (const p of products) {
      if (p.business_id !== business.id)
        return actionError("Producto inválido.");
      if (!p.is_active || !p.is_available) {
        return actionError(`"${p.name}" ya no está disponible.`);
      }
      productById.set(p.id, {
        id: p.id,
        name: p.name,
        price_cents: Number(p.price_cents),
      });
    }
  }

  const allModifierIds = [
    ...new Set(productItems.flatMap((i) => i.modifier_ids)),
  ];
  const modifierById = new Map<
    string,
    { id: string; name: string; price_delta_cents: number; is_available: boolean }
  >();
  if (allModifierIds.length > 0) {
    // issue #260 — los adicionales también se scopean por negocio.
    //
    // Esto buscaba sólo por id y del resultado miraba únicamente
    // `is_available`. `persistOrder` escribe con el service client, así que las
    // policies de `modifiers` —que cuelgan de `modifier_groups.business_id`, la
    // tabla no tiene `business_id` propio— no corren. Resultado: mandando en
    // `modifier_ids` el id de un adicional de OTRO local (en la nube conviven
    // `demo`, `golf-jcr` y `kcc`) la línea entraba con su nombre y su precio.
    // El `product_id` sí se validaba; el adicional no.
    //
    // El embed a `modifier_groups` es el único camino al negocio, y el filtro
    // va sobre esa relación (`!inner`) para que un adicional ajeno directamente
    // no vuelva en el resultado — y ahí lo caza el chequeo de cantidad de abajo.
    const { data: modifiers } = await supabase
      .from("modifiers")
      .select(
        "id, name, price_delta_cents, is_available, modifier_groups!inner(business_id)",
      )
      .in("id", allModifierIds)
      .eq("modifier_groups.business_id", business.id);
    if (!modifiers || modifiers.length !== allModifierIds.length) {
      return actionError("Algún adicional ya no está disponible.");
    }
    for (const m of modifiers) {
      if (!m.is_available) return actionError("Algún adicional ya no está disponible.");
      modifierById.set(m.id, {
        id: m.id,
        name: m.name,
        price_delta_cents: Number(m.price_delta_cents),
        is_available: m.is_available,
      });
    }
  }

  // --- Validación de menús del día ---
  // Importante: chequeamos `available_days` contra el DOW *en el TZ del negocio*.
  // Así no pasa que el servidor en UTC piense que es martes cuando en Argentina
  // sigue siendo lunes — y viceversa.
  type DailyMenuComponentRow = {
    id: string;
    label: string;
    description: string | null;
    sort_order: number;
    kind: string;
    product_id: string | null;
    choice_group_id: string | null;
    choice_group_label: string | null;
    extra_price_cents: number;
    /** Grupos que esta opción NO habilita (spec 074). */
    blocks_choice_group_ids: string[] | null;
  };
  type DailyMenuRow = {
    id: string;
    name: string;
    price_cents: number;
    image_url: string | null;
    available_days: number[];
    is_active: boolean;
    is_available: boolean;
    business_id: string;
    daily_menu_components: DailyMenuComponentRow[] | null;
  };
  const menuIds = [...new Set(menuItems.map((i) => i.daily_menu_id))];
  const menuById = new Map<string, DailyMenuRow>();
  if (menuIds.length > 0) {
    const { data: menus } = await supabase
      .from("daily_menus")
      .select(
        "id, name, price_cents, image_url, available_days, is_active, is_available, business_id, daily_menu_choice_groups(id, name, applies_when_group_id, applies_when_product_ids), daily_menu_components(id, label, description, sort_order, kind, product_id, choice_group_id, extra_price_cents)",
      )
      .in("id", menuIds);
    if (!menus || menus.length !== menuIds.length) {
      return actionError("Algún menú del día ya no está disponible.");
    }
    const todayDow = currentDayOfWeek(business.timezone);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const raw of menus as any[]) {
      const m: DailyMenuRow = {
        id: raw.id,
        name: raw.name,
        price_cents: Number(raw.price_cents),
        image_url: raw.image_url,
        available_days: raw.available_days ?? [],
        is_active: raw.is_active,
        is_available: raw.is_available,
        business_id: raw.business_id,
        daily_menu_components: raw.daily_menu_components,
      };
      if (m.business_id !== business.id)
        return actionError("Menú inválido.");
      if (!m.is_active || !m.is_available) {
        return actionError(`"${m.name}" ya no está disponible.`);
      }
      if (!menuDisponibleHoy(m.available_days, todayDow)) {
        return actionError(
          `"${m.name}" no está disponible hoy. Volvé otro día.`,
        );
      }
      menuById.set(m.id, m);
    }
  }

  // --- Armado de líneas (subtotal, snapshots, modifiers) ---
  type OrderLine =
    | {
        kind: "product";
        /** Null en el renglón libre de la spec 174: no hay producto detrás. */
        product_id: string | null;
        daily_menu_id: null;
        daily_menu_snapshot: null;
        product_name: string;
        unit_price_cents: number;
        /** Spec 069 — null salvo que el encargado haya pisado el precio. */
        price_original_cents: number | null;
        price_override_at: string | null;
        price_override_by: string | null;
        price_override_reason: string | null;
        quantity: number;
        notes: string | null;
        subtotal_cents: number;
        modifiers: {
          modifier_id: string;
          modifier_name: string;
          price_delta_cents: number;
        }[];
      }
    | {
        kind: "daily_menu";
        product_id: null;
        daily_menu_id: string;
        daily_menu_snapshot: {
          name: string;
          image_url: string | null;
          components: { label: string; description: string | null; kind?: string; product_id?: string | null }[];
          // Desglose de opciones elegidas con su adicional (spec 29), para que
          // el detalle de la orden explique el "+$X".
          selected_choices: {
            choice_group_label: string;
            product_name: string;
            extra_price_cents: number;
          }[];
        };
        product_name: string;
        unit_price_cents: number;
        quantity: number;
        notes: string | null;
        subtotal_cents: number;
        modifiers: never[];
        fixed_product_ids: string[];
        selected_choices: { product_id: string; modifier_ids: string[] }[];
      };

  // `for…of` (no `.map`) para poder cortar con `actionError` si una opción de
  // combo no es válida (validación server-side del adicional, spec 29).
  let subtotalCents = 0;
  const lines: OrderLine[] = [];
  for (const [itemIdx, inputItem] of data.items.entries()) {
    if (inputItem.kind === "daily_menu") {
      const menu = menuById.get(inputItem.daily_menu_id)!;

      // Adicional por opción: la fuente de verdad es la DB, NO el payload. El
      // cliente sólo informa QUÉ eligió (choice_group_id + product_id).
      const upcharge = resolveComboUpcharge(
        (menu.daily_menu_components ?? []).map((c) => ({
          kind: c.kind ?? "text",
          choice_group_id: c.choice_group_id,
          product_id: c.product_id,
          sort_order: Number(c.sort_order ?? 0),
          extra_price_cents: Number(c.extra_price_cents ?? 0),
          blocks_choice_group_ids: c.blocks_choice_group_ids ?? [],
        })),
        (inputItem.selected_choices ?? []).map((sc) => ({
          choice_group_id: sc.choice_group_id,
          product_id: sc.product_id,
        })),
        // La condición de cada grupo (spec 087): el server resuelve igual que la UI.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((menu as any).daily_menu_choice_groups ?? []).map((g: any) => ({
          id: g.id,
          applies_when_group_id: g.applies_when_group_id ?? null,
          applies_when_product_ids: g.applies_when_product_ids ?? [],
        })),
      );
      if (!upcharge.ok) return actionError(upcharge.error);

      const unitPrice = menu.price_cents + upcharge.deltaCents;
      const lineSubtotal = unitPrice * inputItem.quantity;
      subtotalCents += lineSubtotal;

      const components = (menu.daily_menu_components ?? [])
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({
          label: c.label,
          description: c.description,
          kind: c.kind ?? "text",
          product_id: c.product_id,
        }));
      const fixedProductIds = components
        .filter((c) => c.kind === "product" && c.product_id)
        .map((c) => c.product_id!);

      // Desglose de las opciones elegidas con su adicional (de la DB) para el
      // snapshot. label/product_name son sólo display (vienen del payload).
      const extraByKey = new Map(
        upcharge.choices.map((c) => [
          `${c.choice_group_id}::${c.product_id}`,
          c.extra_price_cents,
        ]),
      );
      const snapshotChoices = (inputItem.selected_choices ?? []).map((sc) => ({
        choice_group_label: sc.choice_group_label,
        product_name: sc.product_name,
        extra_price_cents:
          extraByKey.get(`${sc.choice_group_id}::${sc.product_id}`) ?? 0,
      }));

      lines.push({
        kind: "daily_menu",
        product_id: null,
        daily_menu_id: menu.id,
        daily_menu_snapshot: {
          name: menu.name,
          image_url: menu.image_url,
          components,
          selected_choices: snapshotChoices,
        },
        product_name: menu.name,
        // El adicional va en el PADRE; los hijos siguen en $0 (invariante de
        // is_combo_component → reportes/caja/confirmación sin cambios).
        unit_price_cents: unitPrice,
        quantity: inputItem.quantity,
        notes: inputItem.notes ?? null,
        subtotal_cents: lineSubtotal,
        modifiers: [],
        fixed_product_ids: fixedProductIds,
        selected_choices: (inputItem.selected_choices ?? []).map((sc) => ({
          product_id: sc.product_id,
          modifier_ids: sc.modifier_ids ?? [],
        })),
      });
      continue;
    }
    if (inputItem.kind === "free") {
      // Spec 174 — el renglón libre. `product_id` null: no cuelga de ningún
      // producto del catálogo, así que no descuenta stock (el trigger no
      // matchea nada) y `routeOrderToCocina` le resuelve sector null, o sea
      // que no genera comanda. El nombre tipeado es el que va al ticket.
      const libre = freeLibreByIdx.get(itemIdx)!;
      const lineSubtotal = libre.unit_price_cents * libre.quantity;
      subtotalCents += lineSubtotal;
      lines.push({
        kind: "product",
        product_id: null,
        daily_menu_id: null,
        daily_menu_snapshot: null,
        product_name: libre.name,
        unit_price_cents: libre.unit_price_cents,
        // Las cuatro columnas del override de la 069 van en null: no hay
        // precio de catálogo contra el cual medir un delta.
        price_original_cents: null,
        price_override_at: null,
        price_override_by: null,
        price_override_reason: null,
        quantity: libre.quantity,
        notes: libre.notes,
        subtotal_cents: lineSubtotal,
        modifiers: [],
      });
      continue;
    }
    const product = productById.get(inputItem.product_id)!;
    const modLines = inputItem.modifier_ids.map((id) => {
      const m = modifierById.get(id)!;
      return {
        modifier_id: m.id,
        modifier_name: m.name,
        price_delta_cents: m.price_delta_cents,
      };
    });
    const modsTotal = modLines.reduce((a, m) => a + m.price_delta_cents, 0);

    // Spec 069: el precio efectivo puede no ser el de catálogo si el encargado
    // lo pisó al cargar. Sin override (todo el checkout público) esto devuelve
    // el precio de catálogo y las 4 columnas en null.
    const resolvedPrice = applyPriceOverride(
      product.price_cents,
      options?.priceOverrides?.[itemIdx] ?? null,
      userId ?? "",
    );
    const lineSubtotal = lineSubtotalCents(
      resolvedPrice.unit_price_cents,
      modsTotal,
      inputItem.quantity,
    );
    subtotalCents += lineSubtotal;
    lines.push({
      kind: "product",
      product_id: product.id,
      daily_menu_id: null,
      daily_menu_snapshot: null,
      product_name: product.name,
      ...resolvedPrice,
      quantity: inputItem.quantity,
      notes: inputItem.notes ?? null,
      subtotal_cents: lineSubtotal,
      modifiers: modLines,
    });
  }

  let deliveryFeeCents = 0;
  if (data.delivery_type === "delivery") {
    const minOrder = Number(business.min_order_cents ?? 0);
    if (minOrder > 0 && subtotalCents < minOrder) {
      return actionError(
        `El pedido mínimo es ${formatCurrency(minOrder)}.`,
      );
    }
    deliveryFeeCents = Number(business.delivery_fee_cents ?? 0);
  }

  // ── Promo code validation (Fase 2) ─────────────────────────────────────
  // Validamos ANTES de calcular total. El uses_count se incrementa después
  // del insert, atómicamente, vía la RPC `increment_promo_use` — así si el
  // insert de la orden falla, no contamos el uso.
  let discountCents = 0;
  let envioAntesDelCupon: number | null = null;
  let promoCodeId: string | null = null;
  let promoCodeSnapshot: string | null = null;
  if (data.promo_code) {
    // Resolvemos el customer (por business+phone, la misma identidad que usa el
    // upsert de abajo) para validar códigos personales (spec 36 · R-D1). Cliente
    // nuevo = null → un código personal ajeno se rechaza, que es lo correcto.
    // Auditoría de pedidos · ALTA: con cuenta, el cupón se valida contra la
    // ficha de ESA cuenta, no contra el teléfono tipeado (que podía ser de otro).
    const existingCustomerId = await clienteParaCupon(supabase, {
      businessId: business.id,
      userId: Boolean(userId) && !options?.mozoId ? (userId ?? null) : null,
      phoneKey: customerPhoneKey(data.customer_phone),
    });

    const validation = await validatePromoCode(supabase, {
      businessId: business.id,
      code: data.promo_code,
      subtotalCents,
      deliveryFeeCents,
      customerId: existingCustomerId,
    });
    if (!validation.ok) {
      return actionError(validation.error);
    }
    discountCents = validation.promo.discount_cents;
    promoCodeId = validation.promo.promo_code_id;
    promoCodeSnapshot = validation.promo.code;
    // Si el cupón es free_shipping, ya seteó discount_cents = deliveryFeeCents.
    // Lo aplicamos como "delivery_fee = 0" visualmente para que el cliente vea
    // "Envío: gratis" en el detalle, en lugar de "Envío $X · Descuento -$X".
    if (validation.promo.free_shipping) {
      // Si después se pierde la carrera del cupón, el envío se vuelve a cobrar
      // (revisión adversarial): sin guardarlo, el revert dejaba el envío gratis.
      envioAntesDelCupon = deliveryFeeCents;
      deliveryFeeCents = 0;
      discountCents = 0;
    }
  }

  let totalCents = Math.max(0, subtotalCents + deliveryFeeCents - discountCents);

  // `customers.user_id` liga el cliente a una cuenta de Supabase Auth, y hay
  // una unique parcial `(business_id, user_id)`: UNA cuenta = UN cliente.
  //
  // Cuando el pedido lo carga el staff (`options.mozoId`), el `userId` que
  // llega acá es el del EMPLEADO —lo usa el override de precio y `mozo_id`—,
  // no el del comensal. Pegárselo al cliente hacía que el segundo cliente
  // distinto del mismo encargado violara la unique: el delivery no se podía
  // cargar («No pudimos guardar tus datos.»).
  //
  // Se omite la columna en vez de mandar `null`: en un upsert por
  // `(business_id, phone)`, una columna ausente NO se toca en el UPDATE. Así el
  // checkout público sin login tampoco desengancha la cuenta que ese cliente ya
  // tenía ligada de una compra anterior.
  const ligarCuenta = Boolean(userId) && !options?.mozoId;
  // Auditoría de pedidos · ALTA — ver `resolverClienteDelPedido`: tipear el
  // teléfono de otro ya no te da su ficha, y cambiar el propio no bloquea.
  // Clave de identidad normalizada (issue #114); el valor tipeado se conserva
  // en `orders.customer_phone` para mostrar/contactar.
  const resuelto = await resolverClienteDelPedido(supabase, {
    businessId: business.id,
    userId: ligarCuenta ? (userId ?? null) : null,
    phoneKey: customerPhoneKey(data.customer_phone),
    name: data.customer_name,
    email: data.customer_email ?? null,
  });
  if (!resuelto.ok) return actionError(resuelto.error);
  const customer = { id: resuelto.id };

  // Cast: `promo_code_id`, `promo_code_snapshot`, `discount_cents` were added
  // by migration 0018. Once `database.types.ts` is regenerated this cast can
  // be removed and the call inline-typed.
  // La jornada del pedido: null salvo que se trabaje otro día (ver el comentario
  // en el insert). Manda la hora de cocina, que es cuando el local lo prepara.
  const trabajaAt = kitchenAtIso
    ? new Date(kitchenAtIso)
    : scheduledAtIso
      ? new Date(scheduledAtIso)
      : null;
  const businessDay =
    trabajaAt &&
    operatingDay(trabajaAt, business.timezone) !==
      operatingDay(new Date(), business.timezone)
      ? operatingDay(trabajaAt, business.timezone)
      : null;

  const orderInsert = {
    order_number: 0,
    business_id: business.id,
    customer_id: customer.id,
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    // Snapshot del email para el canal email (spec 45). El checkout con login
    // Google lo trae; si no hay, el canal email simplemente se saltea.
    customer_email: data.customer_email ?? null,
    delivery_type: data.delivery_type,
    delivery_address: data.delivery_address ?? null,
    delivery_notes: data.delivery_notes ?? null,
    // Nota para cocina (sale como «ENTREGAR x» en la comanda). Distinta de
    // `delivery_notes`, que es del cliente y va al ticket de control.
    kitchen_notes: data.kitchen_notes ?? null,
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    discount_cents: discountCents,
    total_cents: totalCents,
    payment_method: paymentMethod,
    payment_status: "pending",
    promo_code_id: promoCodeId,
    promo_code_snapshot: promoCodeSnapshot,
    scheduled_at: scheduledAtIso,
    // Hora de cocina (spec 127): para cuándo tiene que estar LISTO. Es la que
    // sale impresa y la que manda la ventana de marcha.
    kitchen_at: kitchenAtIso,
    // Jornada operativa del pedido (spec 127). El trigger `set_order_daily_number`
    // la deriva de `created_at` cuando viene null, que es lo correcto para todo
    // pedido que se trabaja el mismo día. El encargue **para otro día** tiene
    // que nacer con la jornada en que se va a preparar: si no, se llevaría un
    // número de hoy y ese día habría dos «#7» en el pase.
    business_day: businessDay,
    // Staff que cargó el pedido a mano (spec 054); null en el checkout público.
    mozo_id: options?.mozoId ?? null,
  };
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(orderInsert as any)
    .select("id, order_number, daily_number")
    .single();
  if (orderErr || !order) {
    console.error("order insert", orderErr);
    return actionError("No pudimos crear el pedido.");
  }

  // ── Atomic increment of promo uses_count (after order is committed) ────
  // Si el RPC devuelve false (race condition: alguien ganó la carrera y agotó
  // el cupón entre nuestro check y el insert), revertimos el promo en la orden
  // para que el reporte sea honesto. La orden queda creada igual — el dueño
  // puede ofrecer el descuento manualmente.
  if (promoCodeId) {
    // RPC `increment_promo_use` is defined in migration 0018; cast bypasses the
    // typed RPC enum until database.types.ts is regenerated.
    const { data: incremented } = await (
      supabase.rpc as unknown as (
        fn: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: boolean | null; error: unknown }>
    )("increment_promo_use", {
      p_promo_id: promoCodeId,
      p_business_id: business.id,
    });
    if (incremented === false) {
      console.warn("promo race lost", { orderId: order.id, promoCodeId });
      if (envioAntesDelCupon !== null) deliveryFeeCents = envioAntesDelCupon;
      const revertPatch = {
        promo_code_id: null,
        promo_code_snapshot: null,
        discount_cents: 0,
        delivery_fee_cents: deliveryFeeCents,
        total_cents: subtotalCents + deliveryFeeCents,
      };
      await supabase
        .from("orders")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(revertPatch as any)
        .eq("id", order.id);
      // Auditoría de pedidos · media — la preferencia de MP que se arma abajo
      // tiene que cobrar la orden REVERTIDA: sin esto salía con la línea
      // «Descuento» y el cliente pagaba de menos que el total de la orden.
      discountCents = 0;
      totalCents = revertPatch.total_cents;
    }
  }

  // Persist the delivery address for this customer, idempotently. We dedupe
  // by exact street match so repeat orders to the same place don't stack.
  if (data.delivery_type === "delivery" && data.delivery_address) {
    const street = data.delivery_address;
    const { data: existing } = await supabase
      .from("customer_addresses")
      .select("id")
      .eq("customer_id", customer.id)
      .eq("street", street)
      .maybeSingle();
    if (!existing) {
      await supabase
        .from("customer_addresses")
        .insert({ customer_id: customer.id, street });
    }
  }

  for (const line of lines) {
    const { data: inserted, error: lineErr } = await supabase
      .from("order_items")
      .insert({
        order_id: order.id,
        product_id: line.product_id,
        daily_menu_id: line.daily_menu_id,
        daily_menu_snapshot: line.daily_menu_snapshot,
        product_name: line.product_name,
        unit_price_cents: line.unit_price_cents,
        quantity: line.quantity,
        notes: line.notes,
        subtotal_cents: line.subtotal_cents,
        // issue #260 — quién cargó la línea.
        //
        // Esto no se escribía nunca, y de ahí colgaba una cadena: sin
        // `loaded_by` y sin mesa, `deriveAttributedMozo` no encuentra a nadie y
        // el cobro queda con `attributed_mozo_id` en NULL. Consecuencias: el
        // pedido no entra en «Ventas y propinas por mozo» (que filtra por esa
        // columna), y —lo caro— si se cobró en efectivo el que lo cobró **no
        // aparece en «deben rendir»**: tiene la plata encima y el sistema no se
        // la reclama.
        //
        // El propio contrato del módulo ya decía cuál era la respuesta
        // (`atribucion-mozo.ts`): «lo que no tiene mesa sigue cayendo en
        // loaded_by, que ahí es la respuesta correcta: la cargó quien la
        // cargó». Faltaba escribirlo.
        //
        // `mozoId` sólo viene por el camino de staff; el checkout público lo
        // omite y queda null, que es lo correcto: ahí no lo cargó nadie del
        // local.
        loaded_by: options?.mozoId ?? null,
        // Spec 069. Los combos no llevan override (el precio vive en el padre),
        // así que van en null por el `kind`.
        ...(line.kind === "product"
          ? {
              price_original_cents: line.price_original_cents,
              price_override_at: line.price_override_at,
              price_override_by: line.price_override_by,
              price_override_reason: line.price_override_reason,
            }
          : {}),
      })
      .select("id")
      .single();
    if (lineErr || !inserted) {
      console.error("order_item insert", lineErr);
      return actionError("No pudimos guardar los productos del pedido.");
    }
    if (line.kind === "product" && line.modifiers.length > 0) {
      const { error: modErr } = await supabase
        .from("order_item_modifiers")
        .insert(
          line.modifiers.map((m) => ({
            order_item_id: inserted.id,
            modifier_id: m.modifier_id,
            modifier_name: m.modifier_name,
            price_delta_cents: m.price_delta_cents,
          })),
        );
      if (modErr) {
        console.error("order_item_modifier insert", modErr);
        return actionError("No pudimos guardar los adicionales.");
      }
    }

    if (line.kind === "daily_menu") {
      const childProductIds = [
        ...line.fixed_product_ids,
        ...line.selected_choices.map((sc) => sc.product_id),
      ];
      if (childProductIds.length > 0) {
        const uniqueChildIds = [...new Set(childProductIds)];
        const missingIds = uniqueChildIds.filter((id) => !productById.has(id));
        if (missingIds.length > 0) {
          const { data: childProducts } = await supabase
            .from("products")
            .select("id, name, price_cents")
            .in("id", missingIds);
          for (const p of childProducts ?? []) {
            productById.set(p.id, {
              id: p.id,
              name: p.name,
              price_cents: Number(p.price_cents),
            });
          }
        }

        for (const childPid of line.fixed_product_ids) {
          const childProduct = productById.get(childPid);
          if (!childProduct) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await supabase.from("order_items").insert({
            order_id: order.id,
            product_id: childPid,
            product_name: childProduct.name,
            unit_price_cents: 0,
            quantity: line.quantity,
            subtotal_cents: 0,
            parent_order_item_id: inserted.id,
            is_combo_component: true,
          } as any);
        }

        for (const sc of line.selected_choices) {
          const childProduct = productById.get(sc.product_id);
          if (!childProduct) continue;
          const { data: childInserted } = await supabase
            .from("order_items")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .insert({
              order_id: order.id,
              product_id: sc.product_id,
              product_name: childProduct.name,
              unit_price_cents: 0,
              quantity: line.quantity,
              subtotal_cents: 0,
              parent_order_item_id: inserted.id,
              is_combo_component: true,
            } as any)
            .select("id")
            .single();

          if (childInserted && sc.modifier_ids.length > 0) {
            const childMods = sc.modifier_ids
              .map((id) => modifierById.get(id))
              .filter((m): m is NonNullable<typeof m> => !!m);
            if (childMods.length > 0) {
              await supabase.from("order_item_modifiers").insert(
                childMods.map((m) => ({
                  order_item_id: childInserted.id,
                  modifier_id: m.id,
                  modifier_name: m.name,
                  price_delta_cents: m.price_delta_cents,
                })),
              );
            }
          }
        }
      }
    }
  }

  // If the customer chose MP, create the preference in their MP account and
  // hand the init_point back to the client so it can redirect. The order is
  // already persisted with payment_status='pending'; the webhook upgrades it
  // to 'paid' / 'failed' once MP reports the outcome.
  let mpInitPoint: string | undefined;
  if (wantsMp && business.mp_access_token) {
    // MP rejects zero-amount preferences. This shouldn't happen in practice
    // (cart validation catches it earlier) but guard anyway.
    if (totalCents <= 0) {
      await supabase
        .from("orders")
        .update({ payment_status: "failed" })
        .eq("id", order.id);
      return actionError("El total del pedido es 0, no se puede pagar online.");
    }
    try {
      const pref = await createPreference({
        accessToken: business.mp_access_token,
        siteUrl: getSiteUrl(),
        businessId: business.id,
        businessSlug: business.slug,
        orderId: order.id,
        orderNumber: order.order_number,
        // issue #269 — la preferencia tiene que cobrar lo que dice la orden.
        //
        // Acá viajaban SÓLO los platos: ni el envío ni el descuento del cupón.
        // El cliente pagaba $10.000 por un pedido de $10.800 y la caja asentaba
        // los $10.800 igual, así que el arqueo cerraba contra sí mismo y el
        // envío se perdía en cada delivery pagado online. Con cupón el error va
        // para el otro lado: el cliente paga de más y no se entera.
        //
        // El envío va como una línea propia y no repartido entre los platos —
        // es lo que hace el checkout y es lo que el cliente espera ver en la
        // pantalla de MP. El descuento va en negativo por la misma razón:
        // prorratearlo escondería de dónde salió.
        items: [
          ...lines.map((l) => ({
            // MP usa el id sólo para categorización — cualquier string lo sirve.
            // Usamos product_id o daily_menu_id según el tipo de línea.
            id: (l.product_id ?? l.daily_menu_id) as string,
            title: l.product_name,
            quantity: l.quantity,
            unit_price: Math.round(
              (l.unit_price_cents +
                l.modifiers.reduce((a, m) => a + m.price_delta_cents, 0)) /
                100,
            ),
          })),
          ...(deliveryFeeCents > 0
            ? [
                {
                  id: "envio",
                  title: "Envío",
                  quantity: 1,
                  unit_price: Math.round(deliveryFeeCents / 100),
                },
              ]
            : []),
          ...(discountCents > 0
            ? [
                {
                  id: "descuento",
                  title: "Descuento",
                  quantity: 1,
                  unit_price: -Math.round(discountCents / 100),
                },
              ]
            : []),
        ],
        payer: {
          name: data.customer_name,
          email: data.customer_email,
          phone: data.customer_phone,
        },
      });
      // Best-effort: if the update fails we still let the customer pay, we
      // just lose the preference_id pointer for reconciliation.
      await supabase
        .from("orders")
        .update({ mp_preference_id: pref.preferenceId })
        .eq("id", order.id);
      mpInitPoint = pref.initPoint;
    } catch (err) {
      console.error("MP createPreference failed", err);
      // Don't block the order — mark payment as failed so the admin sees it.
      await supabase
        .from("orders")
        .update({ payment_status: "failed" })
        .eq("id", order.id);
      return actionError(
        "No pudimos conectar con Mercado Pago. Probá de nuevo o elegí efectivo.",
      );
    }
  }

  // Notif al encargado: hay un pedido nuevo esperando confirmación. Best
  // effort — si falla el insert, el pedido sigue OK; el encargado lo verá
  // igual al recargar la lista de `/admin/pedidos`.
  //
  // La venta de mostrador (`dine_in`, spec 058) no notifica: la carga el propio
  // encargado, nace cobrada y ni siquiera aparece en el board — avisarle de su
  // propia venta es el ruido que el principio "no notificar al actor" (spec 27)
  // viene evitando.
  if (data.delivery_type !== "dine_in") {
    await createNotification({
      businessId: business.id,
      targetRole: "encargado",
      type: "order.pending",
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: data.customer_name,
        deliveryType: data.delivery_type,
        totalCents,
      },
    });

    // Spec 139 — y el acuse al cliente. Hasta acá el primer aviso que recibía
    // era `preparing`: entre que pedía y que el local marchaba, silencio —
    // justo el tramo en el que su pedido está esperando una decisión.
    // Best-effort, como el resto de los avisos.
    await notifyDeliveryStatusChange({ orderId: order.id, toStatus: "pending" });
  }

  // Auto-march (spec 047): ningún pedido marcha a cocina al crearse. Nace en
  // `pending` (columna «Nuevos») con la notif `order.pending` de arriba.
  // - Efectivo: lo marcha el encargado a mano (confirmarPedido → routeOrderToCocina).
  // - MP: marcha el webhook cuando el pago pasa a `paid` (mp/webhook/route.ts).
  // Antes (spec 05) el efectivo marchaba acá; se quitó para no imprimir ni
  // cocinar pedidos remotos sin confirmar ni cobrar. Solo lo pagado imprime
  // directo. Ver specs/047-auto-march-solo-si-pagado.

  return actionOk({
    order_id: order.id,
    order_number: order.order_number,
    daily_number: order.daily_number,
    mp_init_point: mpInitPoint,
  });
}

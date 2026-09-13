"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { menuDisponibleHoy } from "@/lib/daily-menus/disponible-hoy";
import { currentDayOfWeek } from "@/lib/day-of-week";
import {
  getActiveComandas,
  getPrintAgentHealth,
  getStationsForLocal,
  type LocalComanda,
  type LocalStation,
} from "@/lib/admin/local-query";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { getMozosByBusiness, type MozoMember } from "@/lib/mozo/queries";
import { createNotification } from "@/lib/notifications/create";
import { notifyItemCancelled } from "@/lib/notifications/events";
import { isOrderPaid, ORDER_PAID_ERROR } from "@/lib/orders/predicates";
import { recomputeOrderTotals } from "@/lib/orders/totals-recompute";

import {
  encolarReimpresionDeControl,
  encolarReimpresionDeItem,
} from "./reprint";
import {
  canCancelItem,
  canModifyPostEnvio,
  canReimprimirComanda,
} from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { resolveComboUpcharge } from "@/lib/orders/combo-pricing";
import {
  resolveModifiers,
  type ComboModifier,
} from "@/lib/orders/combo-modifiers";

/** El componente `choice` al que corresponde una opción elegida. */
function choiceComponentFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: any[],
  sc: { choice_group_id: string; product_id: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return components.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) =>
      c.kind === "choice" &&
      c.choice_group_id === sc.choice_group_id &&
      c.product_id === sc.product_id,
  );
}

import {
  applyPriceOverride,
  lineSubtotalCents,
  validatePriceOverride,
  type PriceOverride,
  type PriceOverrideInput,
} from "./price-override";
import { soloCambiaElPrecio, type EditarItemComandaPatch } from "./edicion";
import { buildItemLibreRow, validateItemLibre } from "./item-libre";
import { normalizarObservacion } from "./observacion";
import { createComandasForItems } from "./route-items";
import { resolveStations } from "./routing";
import type { ComandaStatus, KitchenItemStatus } from "./types";

type GenericClient = SupabaseClient;

/**
 * Item nuevo a enviar a comandas. Mismo shape que el carrito interno del
 * mozo, sin campos ya calculados (precio, station — se resuelven server).
 */
export type EnviarComandaItem = {
  kind?: "product";
  product_id: string;
  quantity: number;
  notes?: string | null;
  modifier_ids?: string[];
  seat_number?: number | null;
  /** _key estable de la línea del carrito. Idempotencia (spec 42). */
  client_line_key?: string | null;
  /**
   * Precio a cobrar por esta línea, sólo para este pedido (spec 069). Si viene,
   * pisa el precio de catálogo y exige `price_override_reason`. Gateado por
   * `canOverrideItemPrice` — encargado/admin.
   */
  price_override_cents?: number | null;
  price_override_reason?: string | null;
};

/**
 * Renglón libre — el «no existe» de MaxiRest (spec 174): nombre y precio
 * tipeados en el momento, sin producto de catálogo detrás. No va a cocina; va
 * al ticket del cliente. Gate `canCargarItemLibre` (encargado/admin).
 */
export type EnviarComandaFreeItem = {
  kind: "free";
  name: string;
  unit_price_cents: number;
  quantity: number;
  notes?: string | null;
  /** _key estable de la línea del carrito. Idempotencia (spec 42). */
  client_line_key?: string | null;
};

export type EnviarComandaDailyMenuItem = {
  kind: "daily_menu";
  daily_menu_id: string;
  quantity: number;
  notes?: string | null;
  selected_choices?: {
    choice_group_id: string;
    product_id: string;
    modifier_ids?: string[];
  }[];
  /** _key estable de la línea del carrito. Idempotencia (spec 42). */
  client_line_key?: string | null;
};

export type EnviarComandaInput = {
  /**
   * Destino del envío. Uno de los dos, nunca los dos (spec 125).
   *
   * `tableId` es el flujo del salón: si la mesa no tiene orden abierta, este
   * envío la abre. `orderId` es «agregar ítems a un pedido que ya existe» — el
   * encargue telefónico al que el cliente le suma una empanada. Ahí no hay mesa
   * que abrir ni estado de mesa que mover: la orden ya está y lo único que pasa
   * es que sus líneas nuevas salen en una tanda nueva, igual que los postres de
   * una mesa.
   */
  tableId?: string;
  orderId?: string;
  items: (
    | EnviarComandaItem
    | EnviarComandaDailyMenuItem
    | EnviarComandaFreeItem
  )[];
  slug: string;
  /**
   * Cuántas personas se sentaron (spec 111, FR-013/014).
   *
   * Viaja con el envío porque desde la 111 **este envío es el que abre la
   * mesa**: se entra a cargar sin pasar por el walk-in, así que cuando el
   * panel manda la primera comanda todavía no hay orden donde escribirlo.
   * Sólo se aplica al crearla; después la mueve «Datos de la mesa».
   */
  partySize?: number | null;
  /**
   * La observación de la tanda (spec 128): lo que el mozo escribió para **este**
   * envío y sale en las comandas de todos sus sectores.
   *
   * Es del envío y no de la mesa: el próximo arranca en blanco. Si se
   * arrastrara, la tercera tanda repetiría «apuro» cuando el apuro ya pasó, y
   * cocina aprendería a no leer el renglón.
   */
  notes?: string | null;
};

export type EnviarComandaResult = {
  order_id: string;
  comanda_ids: string[];
};

const NEXT_STATUS: Record<ComandaStatus, ComandaStatus> = {
  pendiente: "en_preparacion",
  en_preparacion: "entregado",
  entregado: "entregado",
};

const NEXT_ITEM_STATUS: Record<KitchenItemStatus, KitchenItemStatus> = {
  pending: "preparing",
  preparing: "ready",
  ready: "delivered",
  delivered: "delivered",
};

/** Datos server-side de la tab Comandas (KDS). Mismo set que `loadComandas`. */
export type ComandasTabData = {
  comandas: LocalComanda[];
  stations: LocalStation[];
  mozos: MozoMember[];
  printAgentLastSeenAt: string | null;
};

/**
 * Refetch acotado de la tab Comandas del KDS (kanban).
 *
 * Reemplaza al `router.refresh()` que el kanban disparaba en cada evento de
 * realtime: aquel re-ejecutaba los **6** loaders de `/admin/operacion` (Salón +
 * pedidos + caja + rendición + fichaje además de comandas) + re-render+re-serie
 * de todo el árbol RSC. Acá corremos SOLO las **4 queries de la tab Comandas**
 * (idénticas a `loadComandas`: comandas activas/entregadas + stations + mozos +
 * heartbeat del print agent) y el cliente mergea en su estado local — mismo
 * patrón "cero refresh de ruta" que `orders-realtime-board`.
 *
 * Trae las 4 (no sólo comandas) para no congelar el pill de salud del agente ni
 * los nombres de mozo / sectores nuevos entre turnos: eran refrescados por el
 * `router.refresh()` que se elimina.
 *
 * Multi-tenant: cada query filtra por `business_id` y corre con el server client
 * (RLS `is_business_member`), así que un miembro de varios negocios (House/Golf
 * comparten socios) sólo ve lo del negocio del `slug`.
 */
export async function getComandasTabData(
  slug: string,
): Promise<ActionResult<ComandasTabData>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  // Gate de MEMBRESÍA (mismo que las demás actions del KDS, ej.
  // `marcarComandaEntregada`). No basta con "hay sesión": `getMozosByBusiness`
  // corre con service-role (RLS bypass) filtrando sólo por `business_id`, así
  // que sin este gate un usuario autenticado ajeno al negocio podría leer la
  // nómina del staff (nombres + emails) pasando un slug foráneo. Las otras 3
  // queries ya están scopeadas por RLS, pero mozos no.
  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const [comandas, stations, mozos, printAgentHealth] = await Promise.all([
    getActiveComandas(business.id),
    getStationsForLocal(business.id),
    getMozosByBusiness(business.id),
    getPrintAgentHealth(business.id),
  ]);
  return actionOk({
    comandas,
    stations,
    mozos,
    printAgentLastSeenAt: printAgentHealth.lastSeenAt,
  });
}

/**
 * Crea (o reusa) la orden activa de una mesa, inserta order_items con
 * routing a sector, y crea una comanda por cada sector con batch
 * autoincremental. Snapshots de modificadores.
 */
export async function enviarComanda(
  input: EnviarComandaInput,
): Promise<ActionResult<EnviarComandaResult>> {
  if (input.items.length === 0) return actionError("Sin items para enviar.");

  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  // spec 096 · H-13 — gate de membresía **de entrada**.
  //
  // Ésta era la única action del módulo que no lo tenía: hacía sólo
  // `auth.getUser()` y después usaba el service client, que bypassea RLS. Las
  // otras siete gatean con `requireMozoActionContext` desde la primera línea.
  // El gate existía, pero recién adentro del `if (anyOverride)` — o sea que sólo
  // corría cuando alguien pisaba un precio.
  //
  // Consecuencias: un mozo dado de baja (`disabled_at`) seguía pudiendo cargar
  // consumo en cualquier mesa y disparar impresión en cocina — bloqueado en toda
  // la app **menos** en la acción que mueve plata e imprime papel. Y cualquier
  // usuario logueado (un cliente que entró con Google desde la carta) podía
  // llamarla con un `tableId` real.
  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  if (!input.tableId === !input.orderId) {
    return actionError("Indicá la mesa o el pedido, no los dos.");
  }

  // ── Destino: una mesa ───────────────────────────────────────────────────
  let table: unknown = null;
  if (input.tableId) {
    // Cross-tenant: la mesa debe pertenecer a un floor_plan de este business.
    const { data: tableRow } = await service
      .from("tables")
      .select(
        "id, operational_status, opened_at, mozo_id, floor_plans!inner(business_id)",
      )
      .eq("id", input.tableId)
      .maybeSingle();
    const tableBusinessId = (
      tableRow as { floor_plans?: { business_id: string } } | null
    )?.floor_plans?.business_id;
    if (!tableRow || tableBusinessId !== business.id) {
      return actionError("Mesa no encontrada.");
    }
    table = tableRow;
  }

  // ── Destino: un pedido que ya existe (spec 125) ─────────────────────────
  // Misma frontera que la edición: abierto y no cobrado. Agregarle una línea a
  // un pedido ya saldado dejaría la orden por encima de lo que se cobró.
  let ruteaAhora = true;
  if (input.orderId) {
    const { data: orderRow } = await service
      .from("orders")
      .select("id, business_id, lifecycle_status, payment_status")
      .eq("id", input.orderId)
      .maybeSingle();
    const o = orderRow as {
      business_id: string;
      lifecycle_status: string;
      payment_status: string | null;
    } | null;
    if (!o || o.business_id !== business.id) {
      return actionError("Pedido no encontrado.");
    }
    if (o.lifecycle_status !== "open") {
      return actionError("El pedido ya está cerrado.");
    }
    if (isOrderPaid(o)) return actionError(ORDER_PAID_ERROR);

    // ¿Este pedido ya marchó? Si todavía no tiene una sola comanda está
    // esperando el «Confirmar» del encargado (spec 047), y las líneas nuevas
    // tienen que esperar con él: rutearlas ahora mandaría media cocina a
    // trabajar sobre un pedido que el encargado todavía no avaló, y dejaría el
    // resto sin papel. Cuando confirme, `routeOrderToCocina` las toma a todas
    // —es idempotente a nivel orden, y con cero comandas rutea todo lo vivo—.
    const { count } = await service
      .from("comandas")
      .select("id", { count: "exact", head: true })
      .eq("order_id", input.orderId);
    ruteaAhora = (count ?? 0) > 0;
  }

  const productItems = input.items.filter(
    (i): i is EnviarComandaItem => i.kind !== "daily_menu" && i.kind !== "free",
  );
  const dailyMenuItems = input.items.filter(
    (i): i is EnviarComandaDailyMenuItem => i.kind === "daily_menu",
  );

  // ── Renglones libres (spec 174) ──────────────────────────────────────────
  // Se validan ACÁ, antes de tocar la orden: el rol y la forma del renglón no
  // dependen de nada de la DB, y rechazar después de haber abierto la mesa
  // dejaría una orden vacía por un nombre en blanco.
  const freeItems = input.items.filter(
    (i): i is EnviarComandaFreeItem => i.kind === "free",
  );
  const freeLibres: {
    libre: ReturnType<typeof buildItemLibreRow>;
    key: string | null;
  }[] = [];
  for (const item of freeItems) {
    const validation = validateItemLibre(item, ctx.role);
    if (!validation.ok) return actionError(validation.error);
    freeLibres.push({
      // `orderId` todavía no existe: se completa abajo, cuando se resuelve la
      // orden de la mesa. Acá sólo normalizamos nombre / notas / subtotal.
      libre: buildItemLibreRow(validation.libre, {
        orderId: "",
        userId: ctx.userId,
      }),
      key: item.client_line_key ?? null,
    });
  }

  // ── Precio por ítem (spec 069) ───────────────────────────────────────────
  // Sólo resolvemos el rol si alguna línea trae override: el camino normal no
  // paga el costo del lookup ni cambia de gate.
  const priceOverrideByLine = new Map<number, PriceOverride | null>();
  const anyOverride =
    productItems.some(
      (i) => i.price_override_cents != null || i.price_override_reason != null,
    ) ||
    // El precio de un combo vive en el padre y sus hijos van a $0; overridearlo
    // rompe el desglose. Fuera de alcance en fase 1, igual que la edición de
    // combos del spec 049. Se rechaza por defensa, no sólo ocultando la UI.
    dailyMenuItems.some(
      (i) =>
        (i as unknown as PriceOverrideInput).price_override_cents != null ||
        (i as unknown as PriceOverrideInput).price_override_reason != null,
    );

  if (anyOverride) {
    if (
      dailyMenuItems.some(
        (i) =>
          (i as unknown as PriceOverrideInput).price_override_cents != null ||
          (i as unknown as PriceOverrideInput).price_override_reason != null,
      )
    ) {
      return actionError(
        "El precio de un menú del día no se puede cambiar por ítem.",
      );
    }

    for (const [idx, item] of productItems.entries()) {
      const validation = validatePriceOverride(item, ctx.role);
      if (!validation.ok) return actionError(validation.error);
      priceOverrideByLine.set(idx, validation.override);
    }
  }

  const productIds = [...new Set(productItems.map((i) => i.product_id))];
  const { data: productRows } = await service
    .from("products")
    .select(
      "id, name, price_cents, business_id, is_active, is_available, station_id, extra_station_ids, sin_comanda, track_stock, category:categories(station_id, extra_station_ids)",
    )
    .in("id", productIds);

  type ProductRow = {
    id: string;
    name: string;
    price_cents: number;
    business_id: string;
    is_active: boolean;
    is_available: boolean;
    station_id: string | null;
    /** Spec 180: 2ª y 3ª comandera; null hereda de la categoría. */
    extra_station_ids: string[] | null;
    sin_comanda: boolean;
    track_stock: boolean;
    category: { station_id: string | null; extra_station_ids: string[] | null } | null;
  };
  const products = (productRows ?? []) as unknown as ProductRow[];
  if (products.length !== productIds.length) {
    return actionError("Algún producto no existe.");
  }
  const productById = new Map<string, ProductRow>();
  for (const p of products) {
    if (p.business_id !== business.id) return actionError("Producto inválido.");
    if (!p.is_active || !p.is_available) {
      return actionError(`"${p.name}" no está disponible.`);
    }
    productById.set(p.id, p);
  }

  const allModifierIds = [
    ...new Set(productItems.flatMap((i) => i.modifier_ids ?? [])),
  ];
  type ModifierRow = {
    id: string;
    name: string;
    price_delta_cents: number;
    is_available: boolean;
    group_id: string;
  };
  const modifierById = new Map<string, ModifierRow>();
  if (allModifierIds.length > 0) {
    const { data: modifiers } = await service
      .from("modifiers")
      .select("id, name, price_delta_cents, is_available, group_id")
      .in("id", allModifierIds);
    const rows = (modifiers ?? []) as unknown as ModifierRow[];
    if (rows.length !== allModifierIds.length) {
      return actionError("Algún adicional no existe.");
    }
    for (const m of rows) {
      if (!m.is_available)
        return actionError("Algún adicional no está disponible.");
      modifierById.set(m.id, m);
    }
  }

  // Validación de modifier_groups: si un grupo es required (min_selection > 0)
  // de un producto enviado, los modifier_ids del item deben cubrir el mínimo.
  // Defensa contra clients que se saltan el modal.
  type GroupRow = {
    id: string;
    product_id: string;
    name: string;
    min_selection: number;
    max_selection: number;
  };
  const { data: groups } = await service
    .from("modifier_groups")
    .select("id, product_id, name, min_selection, max_selection")
    .in("product_id", productIds);
  for (const inputItem of productItems) {
    const productGroups = ((groups ?? []) as unknown as GroupRow[]).filter(
      (g) => g.product_id === inputItem.product_id,
    );
    const selected = inputItem.modifier_ids ?? [];
    for (const g of productGroups) {
      const countInGroup = selected.filter(
        (id) => modifierById.get(id)?.group_id === g.id,
      ).length;
      if (countInGroup < g.min_selection) {
        const product = productById.get(inputItem.product_id)!;
        return actionError(
          `"${product.name}": elegí al menos ${g.min_selection} en "${g.name}".`,
        );
      }
      if (countInGroup > g.max_selection) {
        const product = productById.get(inputItem.product_id)!;
        return actionError(
          `"${product.name}": hasta ${g.max_selection} en "${g.name}".`,
        );
      }
    }
  }

  // Resolvemos / creamos la order activa. Una sola por mesa garantizada por
  // el partial unique index `orders_one_open_per_table`. Si el envío va a un
  // pedido que ya existe (spec 125), ya está resuelta y validada arriba.
  const { data: existing } = input.orderId
    ? { data: { id: input.orderId } }
    : await service
        .from("orders")
        .select("id, mozo_id")
        .eq("table_id", input.tableId!)
        .eq("business_id", business.id)
        .eq("lifecycle_status", "open")
        .maybeSingle();

  let orderId: string;
  if (existing) {
    orderId = (existing as { id: string }).id;
  } else {
    // `mozo_id` es snapshot inmutable: el mozo que abrió la orden (primer
    // envío). NO se actualiza en transferencias de mesa (eso lo refleja
    // `tables.mozo_id`, que sí es mutable). La propina al "mozo que
    // atendió" usa `payments.attributed_mozo_id`, derivado del último
    // que cargó items via `order_items.loaded_by`. Ver DT-002 (resuelto)
    // en wiki/deuda-tecnica.md y wiki/casos-de-uso/CU-09-asignacion-mozo.md.
    const { data: created, error: orderErr } = await service
      .from("orders")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        order_number: 0,
        business_id: business.id,
        customer_name: "Mesa",
        customer_phone: "-",
        delivery_type: "dine_in",
        table_id: input.tableId,
        mozo_id: ctx.userId,
        lifecycle_status: "open",
        subtotal_cents: 0,
        delivery_fee_cents: 0,
        total_cents: 0,
        // Spec 111: cuando el envío es el que abre la mesa, es la única
        // oportunidad de guardar las personas (no hubo walk-in).
        party_size:
          input.partySize != null && input.partySize > 0
            ? input.partySize
            : null,
        payment_method: "cash",
      } as any)
      .select("id")
      .single();
    if (orderErr || !created) {
      console.error("enviarComanda · order insert", orderErr);
      return actionError("No pudimos abrir la orden.");
    }
    orderId = (created as { id: string }).id;
  }

  // ── Idempotencia (spec 42) ───────────────────────────────────────────────
  // Cada línea trae un `client_line_key` estable (el `_key` del carrito del
  // mozo). Si ya existe un order_item con ese key en esta orden, la línea ya se
  // envió (doble-tap / reenvío) → la salteamos. Chequeo up-front para el caso
  // secuencial; el índice UNIQUE parcial (order_id, client_line_key) cierra
  // además la carrera concurrente en el propio insert (violación 23505).
  const inputKeys = input.items
    .map((i) => i.client_line_key)
    .filter((k): k is string => !!k);
  const dispatchedKeyToItemId = new Map<string, string>();
  // Líneas ya insertadas que NUNCA llegaron a una comanda (el ruteo falló y se
  // borró la comanda huérfana). Saltearlas por idempotencia dejaría el reintento
  // en un no-op silencioso: respuesta OK, sin comanda, y cocina sin el ticket.
  // Se re-rutean con su id existente en vez de reinsertarlas (el índice UNIQUE
  // sobre (order_id, client_line_key) rechazaría el insert igual).
  const huerfanos: { id: string; station_id: string }[] = [];
  if (inputKeys.length > 0) {
    const { data: existingRows } = await service
      .from("order_items")
      .select("id, client_line_key, station_id, comanda_items(comanda_id)")
      .eq("order_id", orderId)
      .in("client_line_key", inputKeys);
    for (const row of (existingRows ?? []) as {
      id: string;
      client_line_key: string | null;
      station_id: string | null;
      comanda_items: { comanda_id: string }[] | null;
    }[]) {
      if (row.client_line_key)
        dispatchedKeyToItemId.set(row.client_line_key, row.id);
      // `station_id` null (bebidas / stock) nunca genera comanda: no es huérfano.
      if (row.station_id && (row.comanda_items ?? []).length === 0) {
        huerfanos.push({ id: row.id, station_id: row.station_id });
      }
    }
  }

  // Insertamos order_items con station_id resuelto + snapshots de modifiers.
  // Items sin station resoluble (ej: bebidas en negocios sin sector "Barra")
  // se insertan con `station_id=null` y NO generan comanda — el mozo los
  // gestiona directo. Decisión 2026-05-07.
  const itemsByStation = new Map<string, string[]>();

  // Los huérfanos de un ruteo fallido anterior entran primero: este envío es su
  // segunda (y única) oportunidad de llegar a cocina.
  for (const h of huerfanos) {
    const bucket = itemsByStation.get(h.station_id) ?? [];
    bucket.push(h.id);
    itemsByStation.set(h.station_id, bucket);
  }

  for (const [idx, inputItem] of productItems.entries()) {
    // Idempotencia (spec 42): línea ya enviada → saltear (no reinsertar).
    if (
      inputItem.client_line_key &&
      dispatchedKeyToItemId.has(inputItem.client_line_key)
    ) {
      continue;
    }

    const product = productById.get(inputItem.product_id)!;
    // Spec 180 — la primera es el sector principal (va en el ítem y mueve su
    // estado); las demás reciben su propia comanda. «Cocina sale con todo» es
    // que cocina está de 2ª en cada plato.
    const stations = resolveStations(product, null);
    const stationId = stations[0] ?? null;

    const modIds = inputItem.modifier_ids ?? [];
    const mods = modIds.map((id) => modifierById.get(id)!);
    const modsTotal = mods.reduce((a, m) => a + Number(m.price_delta_cents), 0);

    // Spec 069: el precio efectivo puede no ser el de catálogo. `resolvedPrice`
    // trae `unit_price_cents` (lo que se cobra) + las 4 columnas de auditoría.
    const resolvedPrice = applyPriceOverride(
      Number(product.price_cents),
      priceOverrideByLine.get(idx) ?? null,
      ctx.userId,
    );
    const subtotal = lineSubtotalCents(
      resolvedPrice.unit_price_cents,
      modsTotal,
      inputItem.quantity,
    );

    const seatNum =
      inputItem.seat_number != null && inputItem.seat_number >= 1
        ? inputItem.seat_number
        : null;

    // Items con track_stock (bebidas, vinos) se marcan entregados directo
    // — el mozo los sirve sin pasar por cocina. El trigger de stock
    // (fn_stock_descuento_on_order_item) descuenta igual en el insert.
    const isStockItem = product.track_stock;

    const { data: itemRow, error: itemErr } = await service
      .from("order_items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        order_id: orderId,
        product_id: product.id,
        product_name: product.name,
        ...resolvedPrice,
        quantity: inputItem.quantity,
        notes: inputItem.notes ?? null,
        subtotal_cents: subtotal,
        station_id: isStockItem ? null : stationId,
        loaded_by: ctx.userId,
        // Lo que no va a cocina no espera a cocina: sin sector no hay comanda y
        // nadie lo va a marcar nunca. Cubre los de stock (que quedan sin sector
        // por la línea de arriba) y también el plato al que no se le pudo
        // resolver sector, que antes quedaba `pending` para siempre (#189).
        kitchen_status: isStockItem || !stationId ? "delivered" : "pending",
        seat_number: seatNum,
        client_line_key: inputItem.client_line_key ?? null,
      } as any)
      .select("id")
      .single();
    if (itemErr || !itemRow) {
      // 23505 sobre el índice (order_id, client_line_key): carrera concurrente
      // con otro envío de la misma línea → ya está insertada, la salteamos.
      if ((itemErr as { code?: string } | null)?.code === "23505") continue;
      console.error("enviarComanda · item insert", itemErr);
      return actionError("No pudimos guardar los items.");
    }

    if (mods.length > 0) {
      const { error: modErr } = await service
        .from("order_item_modifiers")
        .insert(
          mods.map((m) => ({
            order_item_id: (itemRow as { id: string }).id,
            modifier_id: m.id,
            modifier_name: m.name,
            price_delta_cents: m.price_delta_cents,
          })),
        );
      if (modErr) {
        console.error("enviarComanda · modifier insert", modErr);
        return actionError("No pudimos guardar los adicionales.");
      }
    }

    // Solo agregar a la comanda si no es item de stock (bebidas skip cocina).
    // Spec 180: en CADA sector de la lista — una comanda por sector, todas con
    // el mismo ítem. `comanda_items` lo admite (su PK es el par).
    if (!isStockItem) {
      for (const st of stations) {
        const bucket = itemsByStation.get(st) ?? [];
        bucket.push((itemRow as { id: string }).id);
        itemsByStation.set(st, bucket);
      }
    }
  }

  // ── Renglones libres (spec 174) ─────────────────────────────────────────
  // No pasan por `resolveStation` ni por ningún bucket de sector: el renglón
  // libre es plata, no un plato que alguien tenga que hacer. Sin sector no hay
  // comanda, y sin comanda nadie lo va a marcar nunca → nace `delivered`
  // (misma regla que el issue #189).
  for (const { libre, key } of freeLibres) {
    // Idempotencia (spec 42): línea ya enviada → saltear (no reinsertar).
    if (key && dispatchedKeyToItemId.has(key)) continue;

    const { error: libreErr } = await service.from("order_items").insert({
      ...libre,
      order_id: orderId,
      client_line_key: key,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    if (libreErr) {
      // 23505 sobre (order_id, client_line_key): carrera con otro envío de la
      // misma línea → ya está insertada.
      if ((libreErr as { code?: string } | null)?.code === "23505") continue;
      console.error("enviarComanda · item libre insert", libreErr);
      return actionError("No pudimos guardar el artículo.");
    }
  }

  // ── Daily menu items: crear padre + hijos ──
  for (const menuItem of dailyMenuItems) {
    // Idempotencia (spec 42): combo ya enviado → saltear padre + hijos.
    if (
      menuItem.client_line_key &&
      dispatchedKeyToItemId.has(menuItem.client_line_key)
    ) {
      continue;
    }

    const { data: menuRow } = await service
      .from("daily_menus")
      .select(
        // `products.modifier_groups` es la fuente de verdad del adicional de
        // los modificadores del combo (spec 083): el payload dice qué se
        // eligió, el precio sale de acá.
        "id, name, price_cents, image_url, business_id, is_active, is_available, available_days, daily_menu_choice_groups(id, name, applies_when_group_id, applies_when_product_ids), daily_menu_components(id, label, description, sort_order, kind, product_id, choice_group_id, extra_price_cents, ignored_modifier_group_ids, products(id, name, modifier_groups(id, name, is_required, min_selection, max_selection, sort_order, modifiers(id, name, price_delta_cents, is_available, sort_order))))",
      )
      .eq("id", menuItem.daily_menu_id)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const menu = menuRow as any;
    if (!menu || menu.business_id !== business.id) {
      return actionError("Menú del día no encontrado.");
    }
    if (!menu.is_active || !menu.is_available) {
      return actionError(`"${menu.name}" no está disponible.`);
    }
    // El día habilitado se valida ACÁ, no sólo al listar (spec 109). El
    // catálogo del mozo ya filtra por día, pero eso es la vista: una tablet que
    // quedó abierta desde ayer —o cualquier payload armado a mano— mandaba el
    // menú de otro día y el server lo aceptaba, cobrando el precio del combo en
    // una jornada donde no se ofrece. El pedido online (`persist-order`) ya lo
    // validaba; esto cierra la asimetría.
    //
    // El día se toma en la TZ del **negocio**: con el server en UTC, un sábado
    // a las 21:00 en Argentina ya es domingo, y el menú del domingo entraría
    // (o el del sábado quedaría rechazado) según dónde corra la función.
    if (
      !menuDisponibleHoy(
        menu.available_days as number[] | null,
        currentDayOfWeek(business.timezone),
      )
    ) {
      return actionError(`"${menu.name}" no está disponible hoy.`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const components = (menu.daily_menu_components ?? [])
      .slice()
      .sort((a: any, b: any) => a.sort_order - b.sort_order);

    // Adicional por opción (spec 29): se deriva de la DB, nunca del payload.
    const upcharge = resolveComboUpcharge(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components.map((c: any) => ({
        kind: c.kind ?? "text",
        choice_group_id: c.choice_group_id,
        product_id: c.product_id,
        sort_order: Number(c.sort_order ?? 0),
        extra_price_cents: Number(c.extra_price_cents ?? 0),
        blocks_choice_group_ids: c.blocks_choice_group_ids ?? [],
      })),
      (menuItem.selected_choices ?? []).map((sc) => ({
        choice_group_id: sc.choice_group_id,
        product_id: sc.product_id,
      })),
      // La condición de cada grupo (spec 087): el server resuelve qué grupos
      // aplican con lo mismo que la UI, no con el `blocks` de la opción.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((menu.daily_menu_choice_groups ?? []) as any[]).map((g) => ({
        id: g.id,
        applies_when_group_id: g.applies_when_group_id ?? null,
        applies_when_product_ids: g.applies_when_product_ids ?? [],
      })),
    );
    if (!upcharge.ok) return actionError(upcharge.error);

    // Modificadores del producto elegido en cada grupo (spec 083). Igual que el
    // adicional de la opción: se resuelven contra la DB y suman al PADRE; los
    // hijos siguen en $0 (invariante de `is_combo_component`).
    const modifiersByGroup = new Map<string, ComboModifier[]>();
    let modifiersDelta = 0;
    for (const sc of menuItem.selected_choices ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const comp: any = choiceComponentFor(components, sc);
      const resolved = resolveModifiers(
        comp?.products?.modifier_groups ?? [],
        sc.modifier_ids ?? [],
        comp?.products?.name ?? comp?.label ?? "ese producto",
        // Lo que este menú apagó no se pregunta y tampoco se exige (spec 175 ·
        // D3): si el server siguiera pidiendo el mínimo de un grupo que el
        // asistente nunca mostró, el mozo quedaría trabado sin entender por qué.
        comp?.ignored_modifier_group_ids ?? [],
      );
      if (!resolved.ok) return actionError(resolved.error);
      modifiersDelta += resolved.deltaCents;
      modifiersByGroup.set(sc.choice_group_id, resolved.chosen);
    }

    const menuPrice =
      Number(menu.price_cents) + upcharge.deltaCents + modifiersDelta;
    const menuSubtotal = menuPrice * menuItem.quantity;

    // Desglose de las opciones elegidas para el snapshot (todo de la DB: el
    // payload del mozo no trae labels). `label` de un componente choice es el
    // nombre del producto elegido (lo setea el form).
    const choiceCompByKey = new Map<string, any>(
      components
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter(
          (c: any) => c.kind === "choice" && c.choice_group_id && c.product_id,
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => [`${c.choice_group_id}::${c.product_id}`, c]),
    );
    // El nombre del grupo vive en su fila, no repetido en cada opción (spec 087).
    const nombreDeGrupo = new Map<string, string>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((menu.daily_menu_choice_groups ?? []) as any[]).map((g) => [
        g.id,
        g.name,
      ]),
    );
    const snapshotChoices = (menuItem.selected_choices ?? []).map((sc) => {
      const comp = choiceCompByKey.get(
        `${sc.choice_group_id}::${sc.product_id}`,
      );
      return {
        choice_group_label: nombreDeGrupo.get(sc.choice_group_id) ?? "Opción",
        product_name: comp?.label ?? "",
        extra_price_cents: Number(comp?.extra_price_cents ?? 0),
        // Con nombre y adicional: es lo que después explica en la cuenta por qué
        // el menú salió $28.500 y no $24.000 (spec 083, FR-008).
        modifiers: (modifiersByGroup.get(sc.choice_group_id) ?? []).map(
          (m) => ({
            name: m.name,
            price_delta_cents: Math.max(0, m.price_delta_cents),
          }),
        ),
      };
    });

    const snapshot = {
      name: menu.name,
      image_url: menu.image_url,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components: components.map((c: any) => ({
        label: c.label,
        description: c.description,
        kind: c.kind ?? "text",
        product_id: c.product_id,
      })),
      selected_choices: snapshotChoices,
    };

    const { data: parentRow, error: parentErr } = await service
      .from("order_items")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        order_id: orderId,
        product_id: null,
        daily_menu_id: menu.id,
        daily_menu_snapshot: snapshot,
        product_name: menu.name,
        // Adicional en el PADRE; los hijos van en $0 más abajo.
        unit_price_cents: menuPrice,
        quantity: menuItem.quantity,
        notes: menuItem.notes ?? null,
        subtotal_cents: menuSubtotal,
        loaded_by: ctx.userId,
        kitchen_status: "pending",
        client_line_key: menuItem.client_line_key ?? null,
      } as any)
      .select("id")
      .single();
    if (parentErr || !parentRow) {
      // 23505 (order_id, client_line_key): combo ya enviado → saltear.
      if ((parentErr as { code?: string } | null)?.code === "23505") continue;
      console.error("enviarComanda · daily_menu parent insert", parentErr);
      return actionError("No pudimos guardar el menú del día.");
    }
    const parentId = (parentRow as { id: string }).id;

    const childProductIds: string[] = [];
    for (const c of components) {
      if (c.kind === "product" && c.product_id)
        childProductIds.push(c.product_id);
    }
    // Los modificadores van pegados al hijo de SU opción, así que el product_id
    // no alcanza como clave: el mismo producto puede aparecer en dos grupos.
    const modifiersForChild: (ComboModifier[] | null)[] = components
      .filter(
        (c: { kind?: string; product_id?: string | null }) =>
          c.kind === "product" && c.product_id,
      )
      .map(() => null);
    for (const sc of menuItem.selected_choices ?? []) {
      childProductIds.push(sc.product_id);
      modifiersForChild.push(modifiersByGroup.get(sc.choice_group_id) ?? []);
    }

    if (childProductIds.length > 0) {
      const missingIds = [...new Set(childProductIds)].filter(
        (id) => !productById.has(id),
      );
      if (missingIds.length > 0) {
        const { data: childProds } = await service
          .from("products")
          .select(
            "id, name, price_cents, business_id, is_active, is_available, station_id, extra_station_ids, sin_comanda, category:categories(station_id, extra_station_ids)",
          )
          .in("id", missingIds);
        for (const p of (childProds ?? []) as unknown as ProductRow[]) {
          productById.set(p.id, p);
        }
      }

      // Un hijo por componente (spec 36 · R-E4): NO deduplicar por product_id.
      // El flujo público (persist-order) inserta un order_item hijo por cada
      // componente; si acá deduplicábamos con Set, un combo con el mismo
      // producto repetido descontaba stock/receta 1 vez en el mozo y N en el
      // público. `missingIds` sí puede deduplicar (es solo para fetchear).
      for (const [childIndex, pid] of childProductIds.entries()) {
        const childProduct = productById.get(pid);
        if (!childProduct) continue;
        // Spec 180 — el plato del menú también puede salir por varias.
        const childStations = resolveStations(childProduct, null);
        const childStation = childStations[0] ?? null;

        const { data: childRow } = await service
          .from("order_items")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .insert({
            order_id: orderId,
            product_id: pid,
            product_name: childProduct.name,
            unit_price_cents: 0,
            quantity: menuItem.quantity,
            subtotal_cents: 0,
            parent_order_item_id: parentId,
            is_combo_component: true,
            station_id: childStation,
            loaded_by: ctx.userId,
            kitchen_status: "pending",
          } as any)
          .select("id")
          .single();

        // Los modificadores del hijo (spec 083): con esto la comanda del sector
        // sale «Ñoquis» + «+ Bolognesa» sin tocar el renderer del ticket, que
        // ya los imprime. `modifier_name` es snapshot, como en el flujo suelto.
        const childModifiers = modifiersForChild[childIndex] ?? [];
        if (childRow && childModifiers.length > 0) {
          const { error: modErr } = await service
            .from("order_item_modifiers")
            .insert(
              childModifiers.map((m) => ({
                order_item_id: (childRow as { id: string }).id,
                modifier_id: m.id,
                modifier_name: m.name,
                price_delta_cents: Math.max(0, m.price_delta_cents),
              })),
            );
          if (modErr) {
            console.error(
              "enviarComanda · combo child modifier insert",
              modErr,
            );
          }
        }

        if (childRow) {
          for (const st of childStations) {
            const bucket = itemsByStation.get(st) ?? [];
            bucket.push((childRow as { id: string }).id);
            itemsByStation.set(st, bucket);
          }
        }
      }
    }
  }

  // Una comanda por sector con batch autoincremental dentro de (order, station).
  // `ruteaAhora` en false = pedido online que todavía no marchó: las líneas
  // quedan cargadas y sin comanda, esperando el «Confirmar» como el resto.
  const routeResult = ruteaAhora
    ? await createComandasForItems(service, orderId, itemsByStation, {
        // Normalizada acá y no en el cliente: la action es la frontera, y
        // `enviarComanda` la llaman el panel del mozo y el del salón.
        notes: normalizarObservacion(input.notes),
      })
    : { ok: true as const, comanda_ids: [] as string[] };
  if (!routeResult.ok) {
    // spec 096 · H-38 — el `return` estaba **antes** del recompute de totales,
    // y para este punto los ítems ya están persistidos y el stock ya se
    // descontó. El mozo leía «No pudimos crear la comanda», asumía que no se
    // envió nada y se iba a cobrar: la pantalla de cobro muestra los ítems
    // (recompone el total en TS), pero el ticket impreso, la factura ARCA y el
    // criterio de "saldada" de la RPC salen de `orders.total_cents` — o sea del
    // total **viejo**. Se cobraba y se facturaba de menos, y la orden cerraba
    // igual. Recalcular antes de salir no arregla la comanda, pero deja la
    // orden consistente con lo que efectivamente se cargó.
    await recomputeOrderTotals(service, orderId);
    return actionError(routeResult.error);
  }
  let comandaIds = routeResult.comanda_ids;

  // Idempotencia (spec 42): si hubo líneas ya despachadas (retry), devolvemos
  // también las comandas a las que pertenecen → respuesta estable en el reenvío.
  if (dispatchedKeyToItemId.size > 0) {
    const dupItemIds = [...dispatchedKeyToItemId.values()];
    const { data: dupComandaItems } = await service
      .from("comanda_items")
      .select("comanda_id")
      .in("order_item_id", dupItemIds);
    const dupComandaIds = (
      (dupComandaItems ?? []) as { comanda_id: string }[]
    ).map((r) => r.comanda_id);
    comandaIds = [...new Set([...comandaIds, ...dupComandaIds])];
  }

  // Recalculamos totales de la orden (suma de todos los items, no solo
  // los nuevos — la orden puede tener items previos de tandas anteriores).
  //
  // spec 096 · H-11 — esto escribía `total_cents = newSubtotal`, o sea el
  // subtotal pelado: **borraba el descuento y la propina del total** pero no de
  // sus columnas, dejando la orden internamente contradictoria.
  //
  // Lo que se veía en el local: mesa con 10% de descuento, el cliente pide un
  // café, y al enviarlo el total vuelve al precio de lista. El mozo cobra lo
  // que muestra la pantalla (con descuento), la RPC compara contra el total
  // inflado, **nunca da `fully_paid`, la orden no cierra y la mesa queda
  // ocupada aunque esté pagada**. Si se factura, ARCA recibe de más. Con
  // propina cargada antes es al revés: se cobra de menos.
  //
  // `recomputeOrderTotals` (subtotal + tip + fee − discount) es la función que
  // ya usaban `cancelarItem` y `editarItemComanda`; vivía 500 líneas más abajo
  // en este mismo archivo hasta que la spec 090 la mudó a un módulo común.
  await recomputeOrderTotals(service, orderId);

  // Mesa queda `ocupada` al enviar comanda. Si estaba libre, fijamos
  // opened_at. Si estaba pidio_cuenta y vuelven a pedir, pasa a ocupada
  // y limpiamos bill_requested_at (cliente se arrepintió, quiere más).
  //
  // Nada de esto aplica cuando el destino es un pedido online: no hay mesa que
  // ocupar ni mozo que asignar (spec 125).
  if (input.tableId && table) {
    const tableStatus = (table as { operational_status: string })
      .operational_status;
    const tableOpenedAt = (table as { opened_at: string | null }).opened_at;
    const tablePatch: Record<string, unknown> = {
      operational_status: "ocupada",
      current_order_id: orderId,
    };
    if (tableStatus === "libre" || !tableOpenedAt) {
      tablePatch.opened_at = tableOpenedAt ?? new Date().toISOString();
    }
    // Auto-asignación del mozo (spec 111, FR-012). Es la regla que `openTable`
    // aplica desde siempre al sentar: si la mesa no tenía mozo, queda el que la
    // abrió. Acá faltaba, y no se notaba porque hasta ahora a una mesa se entraba
    // por el walk-in —que pasa por `openTable`— y el envío siempre encontraba la
    // mesa ya abierta y asignada. Desde que tocar una mesa libre entra directo a
    // cargar (FR-010/011), **este envío es el que la abre**: sin esto la mesa
    // quedaría sin mozo en el plano, en la distribución y en la rendición.
    if ((table as { mozo_id: string | null }).mozo_id === null) {
      tablePatch.mozo_id = ctx.userId;
    }
    await service.from("tables").update(tablePatch).eq("id", input.tableId);

    // Si la mesa venía de pidio_cuenta (cliente pidió más), limpiamos el flag.
    if (tableStatus === "pidio_cuenta") {
      await service
        .from("orders")
        .update({ bill_requested_at: null })
        .eq("id", orderId);
    }
  }

  // El control del repartidor quedó viejo: lo que se agregó no está en el papel
  // que ya salió (spec 125, fase C). No-op si el pedido todavía no marchó o si
  // es una mesa, que no lleva control.
  if (input.orderId) {
    await encolarReimpresionDeControl(service, orderId);
  }

  revalidatePath(`/${input.slug}/mozo`);
  revalidatePath(`/${input.slug}/cocina`);
  revalidatePath(`/${input.slug}/admin/operacion`);

  return actionOk({ order_id: orderId, comanda_ids: comandaIds });
}

/**
 * Marca una comanda como `entregado` cuando el mozo levanta el plato.
 * Cualquier rol que opera salón puede hacerlo (mozo+).
 *
 * Acepta como origen `pendiente` o `en_preparacion` (spec-05: un solo
 * gesto operativo). Si ya está `entregado`, no-op.
 */
export async function marcarComandaEntregada(
  comandaId: string,
  slug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: row } = await service
    .from("comandas")
    .select("id, status, station_id, cancelled_at, orders!inner(business_id)")
    .eq("id", comandaId)
    .maybeSingle();
  const ownerBusinessId = (row as { orders?: { business_id: string } } | null)
    ?.orders?.business_id;
  if (!row || ownerBusinessId !== business.id) {
    return actionError("Comanda no encontrada.");
  }
  const stationDeLaComanda = (row as { station_id: string | null }).station_id;
  // spec 095 · H-14 — una comanda anulada no se «entrega». `getComandasByOrder`
  // ni siquiera traía `cancelled_at`, así que en la app del mozo la tanda
  // anulada seguía mostrando el botón verde sin ningún cartel: el mozo lo
  // tocaba y la comanda aparecía en «Entregadas». En el cloud ya existía el
  // estado imposible (`cancelled_at` + `status='entregado'` + `delivered_at`).
  if ((row as { cancelled_at: string | null }).cancelled_at) {
    return actionError("Esta comanda está anulada.");
  }
  const current = (row as { status: ComandaStatus }).status;
  if (current === "entregado") return actionOk(undefined);
  if (current !== "en_preparacion" && current !== "pendiente") {
    return actionError("Estado inesperado de comanda.");
  }

  const nowIso = new Date().toISOString();
  const { error } = await service
    .from("comandas")
    .update({ status: "entregado", delivered_at: nowIso })
    .eq("id", comandaId);
  if (error) {
    console.error("marcarComandaEntregada", error);
    return actionError("No pudimos marcar la comanda.");
  }

  // Espejamos en kitchen_status de los items vinculados (el kanban de Comandas
  // en /admin/operacion los lee; la pantalla /cocina fue eliminada, d3).
  const { data: links } = await service
    .from("comanda_items")
    .select("order_item_id")
    .eq("comanda_id", comandaId);
  const itemIds = ((links ?? []) as { order_item_id: string }[]).map(
    (l) => l.order_item_id,
  );
  // Los platos que se van a servir de verdad: el mozo levanta unidades, no
  // renglones. Con `itemIds.length` una comanda de «2× Milanesa» le avisaba
  // "1 plato para servir" y volvía a la cocina por el segundo (issue #188).
  let platosParaServir = 0;
  if (itemIds.length > 0) {
    const { data: actualizados } = await service
      .from("order_items")
      .update({ kitchen_status: "delivered" })
      .in("id", itemIds)
      // spec 095 · H-50 — el mismo archivo aplicaba dos criterios:
      // `advanceItemKitchenStatus` sí excluye los cancelados. Sin esto, en el
      // kanban un ítem aparece tachado con motivo **y** entregado, y cualquier
      // métrica de tiempos por sector se contamina.
      .is("cancelled_at", null)
      // spec 180 · D2 — la 1ª comandera manda el estado del ítem. La comanda de
      // cocina lleva las papas de fritera «para saber con qué salen»; marcarla
      // entregada no puede dar por servidas papas que fritera no terminó.
      .eq("station_id", stationDeLaComanda)
      .select("quantity");
    platosParaServir = ((actualizados ?? []) as { quantity: number }[]).reduce(
      (n, i) => n + i.quantity,
      0,
    );
  }

  // Notify the mozo that the comanda is ready to serve.
  try {
    const { data: comandaRow } = await service
      .from("comandas")
      .select("station_id, order_id")
      .eq("id", comandaId)
      .maybeSingle();
    const cRow = comandaRow as {
      station_id: string | null;
      order_id: string;
    } | null;
    if (cRow) {
      const { data: orderRow } = await service
        .from("orders")
        .select("table_id")
        .eq("id", cRow.order_id)
        .maybeSingle();
      const tableId = (orderRow as { table_id: string | null } | null)
        ?.table_id;
      if (tableId) {
        const { data: tableRow } = await service
          .from("tables")
          .select("mozo_id, label")
          .eq("id", tableId)
          .maybeSingle();
        const tbl = tableRow as {
          mozo_id: string | null;
          label: string;
        } | null;

        let stationName = "Cocina";
        if (cRow.station_id) {
          const { data: stationRow } = await service
            .from("stations")
            .select("name")
            .eq("id", cRow.station_id)
            .maybeSingle();
          if (stationRow) stationName = (stationRow as { name: string }).name;
        }

        if (tbl?.mozo_id) {
          await createNotification({
            businessId: business.id,
            userId: tbl.mozo_id,
            type: "comanda.entregada",
            payload: {
              tableLabel: tbl.label,
              stationName,
              itemCount: platosParaServir,
            },
          });
        }
      }
    }
  } catch (e) {
    console.error("marcarComandaEntregada notification", e);
  }

  revalidatePath(`/${slug}/mozo`);
  return actionOk(undefined);
}

/**
 * Avanza la comanda al siguiente estado (pendiente → en_preparacion →
 * entregado). Setea timestamps. Cross-tenant via order.business_id.
 *
 * Tras la decisión 2026-05-07 cocina recibe ticket impreso (no pantalla),
 * el estado `listo` no existe — pasamos directo a `entregado` cuando el
 * mozo levanta el plato.
 */
export async function advanceComandaStatus(
  comandaId: string,
  slug: string,
): Promise<ActionResult<{ status: ComandaStatus }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: row } = await service
    .from("comandas")
    .select("id, status, station_id, orders!inner(business_id)")
    .eq("id", comandaId)
    .maybeSingle();
  const ownerBusinessId = (row as { orders?: { business_id: string } } | null)
    ?.orders?.business_id;
  if (!row || ownerBusinessId !== business.id) {
    return actionError("Comanda no encontrada.");
  }
  const current = (row as { status: ComandaStatus }).status;
  const next = NEXT_STATUS[current];
  if (next === current) return actionOk({ status: current });

  const patch: Record<string, unknown> = { status: next };
  if (next === "entregado") patch.delivered_at = new Date().toISOString();

  const { error } = await service
    .from("comandas")
    .update(patch)
    .eq("id", comandaId);
  if (error) {
    console.error("advanceComandaStatus", error);
    return actionError("No pudimos avanzar la comanda.");
  }

  // Espejamos el avance en kitchen_status de los items. `kitchen_status`
  // mantiene el set de 4 valores legacy (el kanban de Comandas los usa; la
  // pantalla /cocina fue eliminada, d3) —
  // mapeamos los 3 estados de comanda a los 3 que sí movemos.
  const itemKitchen: KitchenItemStatus =
    next === "pendiente"
      ? "pending"
      : next === "en_preparacion"
        ? "preparing"
        : "delivered";

  const { data: links } = await service
    .from("comanda_items")
    .select("order_item_id")
    .eq("comanda_id", comandaId);
  const itemIds = ((links ?? []) as { order_item_id: string }[]).map(
    (l) => l.order_item_id,
  );
  if (itemIds.length > 0) {
    await service
      .from("order_items")
      .update({ kitchen_status: itemKitchen })
      .in("id", itemIds)
      // spec 180 · D2 — sólo los ítems cuyo sector principal es éste: la
      // comanda de cocina no mueve el estado de lo que cocina fritera.
      .eq("station_id", (row as { station_id: string | null }).station_id);
  }

  revalidatePath(`/${slug}/cocina`);
  revalidatePath(`/${slug}/mozo`);
  return actionOk({ status: next });
}

/**
 * Avanza el kitchen_status de un solo item (granularidad por item dentro de
 * la comanda — D-CU00-5). Si todos los items de la comanda quedan en
 * 'delivered', la comanda se promueve a 'entregado'.
 */
export async function advanceItemKitchenStatus(
  orderItemId: string,
  slug: string,
): Promise<ActionResult<{ kitchen_status: KitchenItemStatus }>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: item } = await service
    .from("order_items")
    .select("id, kitchen_status, orders!inner(business_id)")
    .eq("id", orderItemId)
    .maybeSingle();
  const itemBusinessId = (item as { orders?: { business_id: string } } | null)
    ?.orders?.business_id;
  if (!item || itemBusinessId !== business.id) {
    return actionError("Item no encontrado.");
  }
  const current = (item as { kitchen_status: KitchenItemStatus })
    .kitchen_status;
  const next = NEXT_ITEM_STATUS[current];
  if (next === current) return actionOk({ kitchen_status: current });

  const { error } = await service
    .from("order_items")
    .update({ kitchen_status: next })
    .eq("id", orderItemId);
  if (error) {
    console.error("advanceItemKitchenStatus", error);
    return actionError("No pudimos avanzar el item.");
  }

  // Si el item ahora es 'delivered', chequeamos si todos los items de cada
  // comanda que lo contiene también lo están. Si sí, promovemos la comanda.
  if (next === "delivered") {
    const { data: links } = await service
      .from("comanda_items")
      .select("comanda_id")
      .eq("order_item_id", orderItemId);
    const comandaIds = [
      ...new Set(
        ((links ?? []) as { comanda_id: string }[]).map((l) => l.comanda_id),
      ),
    ];
    for (const cid of comandaIds) {
      const { data: siblings } = await service
        .from("comanda_items")
        .select("order_items!inner(kitchen_status, cancelled_at)")
        .eq("comanda_id", cid);
      type Sibling = {
        order_items: {
          kitchen_status: KitchenItemStatus;
          cancelled_at: string | null;
        };
      };
      const live = ((siblings ?? []) as unknown as Sibling[]).filter(
        (s) => !s.order_items.cancelled_at,
      );
      const allDelivered =
        live.length > 0 &&
        live.every((s) => s.order_items.kitchen_status === "delivered");
      if (allDelivered) {
        await service
          .from("comandas")
          .update({
            status: "entregado",
            delivered_at: new Date().toISOString(),
          })
          .eq("id", cid);
      }
    }
  }

  revalidatePath(`/${slug}/cocina`);
  revalidatePath(`/${slug}/mozo`);
  // La tab Comandas del back-office (operación) también lee estos estados —
  // sin esto, el avance por item no se propaga al kanban. Igual que el fix
  // ya aplicado a las acciones de mesa.
  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk({ kitchen_status: next });
}

/**
 * Cancela un item (flow de "86" / rotura). Marca cancelled_at + reason; la
 * comanda no se mueve por sí sola, pero la cocina ve el flag.
 */
export async function cancelarItem(
  orderItemId: string,
  motivo: string,
  slug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");
  const trimmed = motivo.trim();
  if (!trimmed) return actionError("Indicá un motivo.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCancelItem(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden cancelar un item.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: item } = await service
    .from("order_items")
    .select(
      "id, cancelled_at, orders!inner(id, business_id, lifecycle_status, payment_status)",
    )
    .eq("id", orderItemId)
    .maybeSingle();
  const itemOrder = (
    item as {
      orders?: {
        business_id: string;
        lifecycle_status: string;
        payment_status: string | null;
      };
    } | null
  )?.orders;
  if (!item || itemOrder?.business_id !== business.id) {
    return actionError("Item no encontrado.");
  }
  if ((item as { cancelled_at: string | null }).cancelled_at) {
    return actionError("El item ya estaba cancelado.");
  }
  // spec 092 · H-48 — este `cancelarItem` (el del kanban) no validaba el estado
  // de la cuenta; su gemelo de la pantalla de cuenta sí. Y el kanban muestra
  // comandas filtrando sólo por `comandas.status`, así que la comanda del
  // postre de una mesa **ya cobrada** sigue en pantalla: el encargado la
  // limpiaba con «86 · se acabó» y la orden bajaba a $18.000 cuando en caja
  // habían entrado $22.000 y la factura decía $22.000. Tres números distintos.
  if (itemOrder.lifecycle_status !== "open") {
    return actionError(
      "La cuenta ya está cerrada — no se puede cancelar un ítem.",
    );
  }
  if (isOrderPaid(itemOrder)) {
    return actionError(ORDER_PAID_ERROR);
  }

  const { error } = await service
    .from("order_items")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_reason: trimmed,
      cancelled_by: ctxResult.data.userId, // spec 34 — responsable de la anulación
    })
    .eq("id", orderItemId);
  if (error) {
    console.error("cancelarItem", error);
    return actionError("No pudimos cancelar el item.");
  }

  // Recalcular subtotal de la order excluyendo cancelados.
  const orderId = (item as unknown as { orders: { id: string } }).orders.id;
  const { data: items } = await service
    .from("order_items")
    .select("subtotal_cents, cancelled_at")
    .eq("order_id", orderId);
  const newSubtotal = (
    (items ?? []) as { subtotal_cents: number; cancelled_at: string | null }[]
  )
    .filter((it) => !it.cancelled_at)
    .reduce((a, it) => a + Number(it.subtotal_cents), 0);

  // Leer tip/discount actuales para no pisar el total si ya se aplicaron.
  const { data: orderRow } = await service
    .from("orders")
    .select("tip_cents, discount_cents, delivery_fee_cents")
    .eq("id", orderId)
    .single();
  const tip = Number(
    (orderRow as { tip_cents: number } | null)?.tip_cents ?? 0,
  );
  const discount = Number(
    (orderRow as { discount_cents: number } | null)?.discount_cents ?? 0,
  );
  const fee = Number(
    (orderRow as { delivery_fee_cents: number } | null)?.delivery_fee_cents ??
      0,
  );
  const newTotal = Math.max(0, newSubtotal + tip + fee - discount);

  await service
    .from("orders")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ subtotal_cents: newSubtotal, total_cents: newTotal } as any)
    .eq("id", orderId);

  // spec 095 · H-36 — avisarle a la comandera. Encolar la reimpresión era un
  // gesto de **UI**: sólo el modal «Editar comanda» del kanban encadenaba
  // `solicitarReimpresion` después de cancelar. Desde la app del mozo o desde
  // la pantalla de cuenta no se tocaba `reprint_requested_at`, así que cocina
  // se quedaba con el papel colgado, preparaba el plato y lo mandaba: plato
  // regalado, merma real y discusión sobre quién avisó qué. `cancelarComanda`
  // sí lo encolaba desde la action — esto lo empareja.
  await encolarReimpresionDeItem(service, orderItemId);
  // Y el papel del repartidor, que también quedó viejo (spec 125). No-op en una
  // mesa, que no tiene control.
  await encolarReimpresionDeControl(service, orderId);

  // spec 27 — avisar al mozo de la mesa que se anuló un ítem (el actor
  // encargado/admin no se autoavisa; resuelve mesa + destinatario en el helper).
  await notifyItemCancelled({
    businessId: business.id,
    orderId,
    reason: trimmed,
    actorUserId: ctxResult.data.userId,
    actorRole: ctxResult.data.role,
  });

  revalidatePath(`/${slug}/cocina`);
  revalidatePath(`/${slug}/mozo`);
  // La tab Comandas del back-office (operación) muestra los items cancelados
  // en vivo — sin esto, el "86" no se refleja en el kanban hasta un refresh
  // manual. Igual que el fix ya aplicado a las acciones de mesa.
  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk(undefined);
}

/**
 * Pide reimprimir una comanda desde operación (spec 35). Setea
 * `reprint_requested_at = now()` y limpia `print_failed_at`:
 *
 * - El `GET /api/print-agent` incluye las comandas con `reprint_requested_at`
 *   seteado aunque ya hayan avanzado → el agente la (re)imprime sin cambios.
 * - Limpiar `print_failed_at` resetea el dedup del aviso del spec 33: si el
 *   reintento vuelve a fallar, puede volver a notificar.
 *
 * NO toca la máquina de estados de la comanda (reimpresión = flag lateral).
 * Sirve tanto para "Reimprimir" (comanda avanzada) como para "Reintentar"
 * (comanda fallada) — ambos terminan en el mismo lugar. Gate encargado/admin
 * + scope por `business_id`.
 */
export async function solicitarReimpresion(
  slug: string,
  comandaId: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canReimprimirComanda(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden reimprimir una comanda.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: row } = await service
    .from("comandas")
    .select("id, orders!inner(business_id)")
    .eq("id", comandaId)
    .maybeSingle();
  const ownerBusinessId = (row as { orders?: { business_id: string } } | null)
    ?.orders?.business_id;
  if (!row || ownerBusinessId !== business.id) {
    return actionError("Comanda no encontrada.");
  }

  const { error } = await service
    .from("comandas")
    .update({
      reprint_requested_at: new Date().toISOString(),
      print_failed_at: null,
    })
    .eq("id", comandaId);
  if (error) {
    console.error("solicitarReimpresion", error);
    return actionError("No pudimos pedir la reimpresión.");
  }

  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk(undefined);
}

/**
 * Anula una comanda entera (spec 049). Cancela todos sus ítems vivos, marca la
 * comanda como anulada, recalcula el total de la orden y encola la reimpresión
 * de un ticket «ANULADA» en la comandera del sector (reusa el canal del spec
 * 35: `reprint_requested_at`). Avisa al mozo de la mesa.
 *
 * Gate encargado/admin (reusa `canCancelItem`). No toca la máquina de estados
 * (anulación = flag lateral). La card sale sola del kanban: al quedar todos sus
 * ítems cancelados, la comanda es "fantasma" y ya se oculta. Cubre el "que no
 * molesten" sin borrar nada (auditoría intacta).
 */
export async function cancelarComanda(
  slug: string,
  comandaId: string,
  motivo: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");
  const trimmed = motivo.trim();
  if (!trimmed) return actionError("Indicá un motivo.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canCancelItem(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden anular una comanda.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: row } = await service
    .from("comandas")
    .select("id, status, cancelled_at, order_id, orders!inner(business_id)")
    .eq("id", comandaId)
    .maybeSingle();
  const ownerBusinessId = (row as { orders?: { business_id: string } } | null)
    ?.orders?.business_id;
  if (!row || ownerBusinessId !== business.id) {
    return actionError("Comanda no encontrada.");
  }
  if ((row as { cancelled_at: string | null }).cancelled_at) {
    return actionError("La comanda ya estaba anulada.");
  }
  if ((row as { status: ComandaStatus }).status === "entregado") {
    return actionError("No se puede anular una comanda ya entregada.");
  }

  const orderId = (row as { order_id: string }).order_id;
  const nowIso = new Date().toISOString();

  // Ítems vivos de la comanda → cancelarlos con el mismo motivo.
  const { data: links } = await service
    .from("comanda_items")
    .select("order_item_id")
    .eq("comanda_id", comandaId);
  const itemIds = ((links ?? []) as { order_item_id: string }[]).map(
    (l) => l.order_item_id,
  );
  if (itemIds.length > 0) {
    await service
      .from("order_items")
      .update({
        cancelled_at: nowIso,
        cancelled_reason: trimmed,
        cancelled_by: ctxResult.data.userId,
      })
      .in("id", itemIds)
      .is("cancelled_at", null);
  }

  // Marca la comanda anulada + encola la reimpresión del ticket ANULADA (spec
  // 35). Limpiar `print_failed_at` resetea el dedup del aviso de fallo.
  const { error } = await service
    .from("comandas")
    .update({
      cancelled_at: nowIso,
      cancelled_reason: trimmed,
      cancelled_by: ctxResult.data.userId,
      reprint_requested_at: nowIso,
      print_failed_at: null,
    })
    .eq("id", comandaId);
  if (error) {
    console.error("cancelarComanda", error);
    return actionError("No pudimos anular la comanda.");
  }

  await recomputeOrderTotals(service, orderId);

  // Avisar al mozo de la mesa (reusa el helper del spec 27; no autoavisa al
  // actor). Best-effort — no bloquea la anulación.
  await notifyItemCancelled({
    businessId: business.id,
    orderId,
    reason: `Comanda anulada: ${trimmed}`,
    actorUserId: ctxResult.data.userId,
    actorRole: ctxResult.data.role,
  });

  revalidatePath(`/${slug}/cocina`);
  revalidatePath(`/${slug}/mozo`);
  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk(undefined);
}

// `EditarItemComandaPatch` y la regla de «esto sólo mueve plata» viven en
// `edicion.ts`, para poder probarse sin arrastrar este módulo. Y se importan
// **desde ahí**: un archivo `"use server"` no puede reexportar el tipo —ni
// `export type { X }` ni `export type { X } from …`—, porque el loader de
// server actions arma la lista de exports antes de que el tipo se borre y
// rebota con «Only async functions are allowed to be exported».

/**
 * Edita un ítem de una comanda ya impresa (spec 049): cambia cantidad, nota o el
 * producto. Re-snapshotea nombre + precio del producto nuevo, conserva el sector
 * (el ticket físico ya está en esa comandera) y limpia los modificadores del
 * producto viejo. Recalcula subtotal del ítem + total de la orden.
 *
 * Gate encargado/admin (reusa `canModifyPostEnvio`). Rechaza ítems cancelados o
 * de combo/menú del día (su precio vive en el padre — fase 2). La reimpresión
 * del ticket corregido la compone la UI (llama `solicitarReimpresion` después).
 * Quitar un ítem = `cancelarItem` (no se duplica).
 */
export async function editarItemComanda(
  slug: string,
  orderItemId: string,
  patch: EditarItemComandaPatch,
): Promise<ActionResult<void>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canModifyPostEnvio(ctxResult.data.role)) {
    return actionError("Solo encargado o admin pueden modificar una comanda.");
  }

  // Precio por ítem (spec 069). `null` explícito = revertir, no necesita
  // motivo ni gate de precio (deshacer es más débil que cambiar). Un número sí
  // pasa por `validatePriceOverride`, que exige rol + motivo.
  const revertPrice = patch.priceOverrideCents === null;
  const priceValidation = revertPrice
    ? ({ ok: true, override: null } as const)
    : validatePriceOverride(
        {
          price_override_cents: patch.priceOverrideCents,
          price_override_reason: patch.priceOverrideReason,
        },
        ctxResult.data.role,
      );
  if (!priceValidation.ok) return actionError(priceValidation.error);

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: item } = await service
    .from("order_items")
    .select(
      "id, order_id, product_id, product_name, unit_price_cents, quantity, notes, station_id, cancelled_at, is_combo_component, parent_order_item_id, daily_menu_id, price_original_cents, orders!inner(business_id, lifecycle_status, payment_status)",
    )
    .eq("id", orderItemId)
    .maybeSingle();
  const itemOrder = (
    item as {
      orders?: {
        business_id: string;
        lifecycle_status: string;
        payment_status: string | null;
      };
    } | null
  )?.orders;
  if (!item || itemOrder?.business_id !== business.id) {
    return actionError("Item no encontrado.");
  }
  // La plata ya cobrada no se reescribe: una orden cerrada puede tener pagos,
  // arqueo y rendición apoyados en ese total (spec 069, US2 escenario 5).
  if (itemOrder.lifecycle_status !== "open") {
    return actionError("La orden ya está cerrada.");
  }
  if (isOrderPaid(itemOrder)) {
    return actionError(ORDER_PAID_ERROR);
  }
  const it = item as unknown as {
    order_id: string;
    product_id: string | null;
    product_name: string;
    unit_price_cents: number;
    quantity: number;
    notes: string | null;
    station_id: string | null;
    cancelled_at: string | null;
    is_combo_component: boolean | null;
    parent_order_item_id: string | null;
    daily_menu_id: string | null;
    price_original_cents: number | null;
  };
  if (it.cancelled_at) return actionError("El ítem está cancelado.");
  if (it.is_combo_component || it.parent_order_item_id || it.daily_menu_id) {
    return actionError("No se puede editar un ítem de combo o menú del día.");
  }

  // Cantidad (opcional): entero ≥ 1.
  let quantity = it.quantity;
  if (patch.quantity !== undefined) {
    if (!Number.isInteger(patch.quantity) || patch.quantity < 1) {
      return actionError("La cantidad debe ser un entero de al menos 1.");
    }
    quantity = patch.quantity;
  }

  // Cambio de producto (opcional): re-snapshot nombre/precio, conserva sector,
  // limpia modifiers del viejo.
  let productId = it.product_id;
  let productName = it.product_name;
  let clearedModifiers = false;
  let productChanged = false;
  // Precio de CATÁLOGO de referencia de la línea. Si la línea ya tiene un
  // override, el de catálogo está en `price_original_cents` — `unit_price_cents`
  // es lo que se cobra, no lo que vale.
  let catalogPrice =
    it.price_original_cents != null
      ? Number(it.price_original_cents)
      : Number(it.unit_price_cents);
  if (patch.productId && patch.productId !== it.product_id) {
    const { data: prod } = await service
      .from("products")
      .select("id, name, price_cents, business_id, is_active, is_available")
      .eq("id", patch.productId)
      .maybeSingle();
    const p = prod as {
      id: string;
      name: string;
      price_cents: number;
      business_id: string;
      is_active: boolean;
      is_available: boolean;
    } | null;
    if (!p || p.business_id !== business.id) {
      return actionError("Producto inválido.");
    }
    if (!p.is_active || !p.is_available) {
      return actionError(`"${p.name}" no está disponible.`);
    }
    productId = p.id;
    productName = p.name;
    catalogPrice = Number(p.price_cents);
    productChanged = true;
    await service
      .from("order_item_modifiers")
      .delete()
      .eq("order_item_id", orderItemId);
    clearedModifiers = true;
  } else if (revertPrice && it.product_id) {
    // FR-012: volver al precio de catálogo **de hoy**, no al snapshot de
    // cuando se pisó — si la carta subió en el medio, deshacer tiene que
    // dejar la línea al precio vigente. Si el producto ya no existe, nos
    // quedamos con el snapshot (`catalogPrice` ya lo tiene).
    const { data: prod } = await service
      .from("products")
      .select("price_cents")
      .eq("id", it.product_id)
      .maybeSingle();
    const p = prod as { price_cents: number } | null;
    if (p) catalogPrice = Number(p.price_cents);
  }

  // Tres estados del precio (ver `EditarItemComandaPatch`):
  //   - no se toca Y no cambió el producto → se conserva el override tal cual
  //     (ni siquiera se escriben las columnas, para no pisar el actor/motivo);
  //   - cambió el producto sin override explícito → se limpia todo, porque el
  //     motivo y el precio de lista eran del producto VIEJO. Sin esto el
  //     reporte de precios modificados lista una fila fantasma;
  //   - override nuevo o revert → se recalcula y se reescriben las 4 columnas.
  const keepExistingPrice =
    patch.priceOverrideCents === undefined && !productChanged;
  const resolvedPrice = keepExistingPrice
    ? null
    : applyPriceOverride(
        catalogPrice,
        priceValidation.override,
        ctxResult.data.userId,
        // Producto nuevo = baseline nuevo: el `price_original_cents` viejo no
        // aplica. Mismo producto = se respeta el original (FR-011).
        productChanged ? null : it.price_original_cents,
      );
  const unitPrice = resolvedPrice
    ? resolvedPrice.unit_price_cents
    : Number(it.unit_price_cents);

  // Σ de modifiers vigentes (0 si se limpiaron por cambio de producto).
  let modsTotal = 0;
  if (!clearedModifiers) {
    const { data: mods } = await service
      .from("order_item_modifiers")
      .select("price_delta_cents")
      .eq("order_item_id", orderItemId);
    modsTotal = ((mods ?? []) as { price_delta_cents: number }[]).reduce(
      (a, m) => a + Number(m.price_delta_cents),
      0,
    );
  }

  const subtotal = lineSubtotalCents(unitPrice, modsTotal, quantity);

  const patchRow: Record<string, unknown> = {
    quantity,
    unit_price_cents: unitPrice,
    subtotal_cents: subtotal,
    product_id: productId,
    product_name: productName,
  };
  if (patch.notes !== undefined) patchRow.notes = patch.notes;
  // Sólo se escriben si el precio se tocó — así una edición de cantidad no
  // pisa el actor ni la fecha del override que ya estaba.
  if (resolvedPrice) {
    patchRow.price_original_cents = resolvedPrice.price_original_cents;
    patchRow.price_override_at = resolvedPrice.price_override_at;
    patchRow.price_override_by = resolvedPrice.price_override_by;
    patchRow.price_override_reason = resolvedPrice.price_override_reason;
  }

  const { error } = await service
    .from("order_items")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patchRow as any)
    .eq("id", orderItemId);
  if (error) {
    console.error("editarItemComanda", error);
    return actionError("No pudimos guardar los cambios.");
  }

  await recomputeOrderTotals(service, it.order_id);

  // El papel corregido (spec 125). Hasta acá la reimpresión era un gesto del
  // **caller**: sólo el modal del kanban encadenaba `solicitarReimpresion` sobre
  // su comanda. Desde que el mismo editor se abre en la mesa y en el pedido
  // online —donde no hay una comanda elegida— eso dejaría a cocina preparando lo
  // viejo. Encolarlo acá cierra el camino para las tres superficies; el kanban
  // sigue pidiendo la suya, que reimprime la comanda entera.
  //
  // Con una salvedad (issue #283): el sector sólo se entera de lo que cambia el
  // plato. La comanda de cocina no lleva importes, así que una cortesía o una
  // media porción no le mandan papel. El control del repartidor sí se reimprime
  // siempre: ése dice cuánto hay que cobrar.
  if (!soloCambiaElPrecio(patch)) {
    await encolarReimpresionDeItem(service, orderItemId);
  }
  await encolarReimpresionDeControl(service, it.order_id);

  revalidatePath(`/${slug}/cocina`);
  revalidatePath(`/${slug}/mozo`);
  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk(undefined);
}

export type SwappableProduct = {
  id: string;
  name: string;
  price_cents: number;
};

/**
 * Productos que rutean a un sector dado (spec 049), para el picker de "cambiar
 * producto" en la edición de comanda. Precedencia igual a `resolveStation`:
 * `products.station_id` (override) > `categories.station_id` (default). Solo se
 * ofrecen productos del mismo sector para no romper el mapeo comandera↔ticket.
 * Gate encargado/admin.
 */
export async function getSwappableProducts(
  slug: string,
  stationId: string,
): Promise<ActionResult<SwappableProduct[]>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  if (!canModifyPostEnvio(ctxResult.data.role)) {
    return actionError("Sin permiso.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: rows } = await service
    .from("products")
    .select(
      "id, name, price_cents, station_id, extra_station_ids, sin_comanda, category:categories(station_id, extra_station_ids)",
    )
    .eq("business_id", business.id)
    .eq("is_active", true)
    .eq("is_available", true)
    .order("name", { ascending: true });

  type Row = {
    id: string;
    name: string;
    price_cents: number;
    station_id: string | null;
    extra_station_ids: string[] | null;
    sin_comanda: boolean;
    category: { station_id: string | null; extra_station_ids: string[] | null } | null;
  };
  // Spec 180 — «rutea a este sector» ahora incluye a los que lo tienen como
  // 2ª o 3ª: en la comanda de cocina se puede cambiar una papa por otra.
  const out = ((rows ?? []) as unknown as Row[])
    .filter((p) => resolveStations(p, null).includes(stationId))
    .map((p) => ({
      id: p.id,
      name: p.name,
      price_cents: Number(p.price_cents),
    }));

  return actionOk(out);
}

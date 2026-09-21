"use client";

import { Ban, Check, MoreVertical, Send, Tag, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ComandaConItems } from "@/lib/comandas/queries";
import type { KitchenItemStatus } from "@/lib/comandas/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import { ObservacionDeLaTanda } from "./observacion-de-la-tanda";
import {
  agruparPorTanda,
  estaAnulado,
  sePuedeRepreciar,
  type LoPedido,
  type LoPedidoItem,
} from "@/lib/mozo/lo-pedido";
import { TZ_AR } from "@/lib/timezone";

/**
 * La columna de **la mesa** (spec 111, fase 5): todo lo que pasa con ella, de
 * un vistazo y en un solo lugar.
 *
 * Reemplaza al `TableDetail` que era un modo aparte del panel: tocar una mesa
 * abierta ya no muestra una pantalla que hay que cerrar para poder cargar —el
 * detalle **es** la mitad izquierda mientras cargás en la derecha.
 *
 * **Sin cabecera propia**: el header del panel ya dice qué mesa es y cómo
 * está. Tenerlo dos veces —«Mesa CUAD» arriba y «CUAD» abajo— gastaba una
 * franja de la columna en repetir lo mismo.
 *
 * Tres bloques, en el orden en que se miran:
 *  1. **Enviado** — lo que ya está en cocina, por tanda, con modificadores,
 *     estado y plata. Es la memoria de la mesa.
 *  2. **Sin enviar** — el carrito, en verde y con borde: lo que se está
 *     armando y todavía no vio nadie. Antes vivía en la otra columna bajo el
 *     título «Tu pedido», que lo dejaba lejos de lo enviado y obligaba a
 *     comparar dos listas en dos lados de la pantalla.
 *  3. **Acciones** — el total y qué hacer: mandar lo pendiente, o cobrar.
 */

const KITCHEN_LABEL: Record<KitchenItemStatus, string> = {
  pending: "Pendiente",
  preparing: "En cocina",
  ready: "Listo",
  delivered: "Entregado",
};

const KITCHEN_PILL: Record<KitchenItemStatus, string> = {
  pending: "bg-muted text-foreground/70",
  preparing: "bg-sky-100 text-sky-800",
  ready: "bg-amber-100 text-amber-800",
  delivered: "bg-emerald-100 text-emerald-800",
};

/** Lo mínimo que la columna necesita de una línea del carrito. */
export type MesaColumnCartItem = {
  _key: string;
  product_name: string;
  quantity: number;
  notes: string | null;
  line_subtotal_cents: number;
  /** Nombres de los modificadores elegidos, para que la línea sin enviar se
   *  lea igual que la enviada. */
  modifiers: string[];
  esMenuDelDia: boolean;
  price_override_cents: number | null;
  price_override_reason: string | null;
  unit_price_cents: number;
};

export type MesaColumnAcciones = {
  onCobrar?: () => void;
  onCargarCliente?: () => void;
  /** Abre el selector de mozo. La misma puerta que la pastilla del header:
   *  asigna si la mesa no tiene mozo, transfiere si lo tiene. */
  onMozo?: () => void;
  /** Cómo se llama esa entrada acá («Asignar mozo» / «Transferir mozo»). */
  mozoLabel?: string;
  onTrasladar?: () => void;
  onAnular?: () => void;
};

function horaDe(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("es-AR", { timeZone: TZ_AR, hour: "2-digit", minute: "2-digit" });
}

export function MesaColumn({
  tableLabel,
  loPedido,
  comandas,
  stationNameById,
  cart,
  cartTotalCents,
  userCanCancel,
  userCanEditPrice,
  enviando,
  onCancelItem,
  onEditPriceEnviado,
  onAdvance,
  onChangeQty,
  onRemoveCartItem,
  onEditPrice,
  onEnviar,
  acciones,
  cartZone,
  observacion,
  onObservacionChange,
  cargando = false,
  className = "",
}: {
  /** Sólo para el `aria-label` de la región: el título lo pone el panel. */
  tableLabel: string;
  /**
   * El estado de la mesa todavía viaja (spec 115). La columna de carga —la
   * derecha— ya se pinta con el catálogo cacheado, así que ésta es la única
   * que espera. Sin esto mostraría "la mesa no tiene nada cargado", que con
   * una mesa ocupada es directamente falso.
   */
  cargando?: boolean;
  loPedido: LoPedido | null;
  /** Sólo para «Entregar» y el estado de la comanda: los ítems salen de
   *  `loPedido`, que también trae los que no fueron a cocina. */
  comandas: ComandaConItems[];
  stationNameById: Record<string, string>;
  cart: MesaColumnCartItem[];
  cartTotalCents: number;
  userCanCancel: boolean;
  userCanEditPrice: boolean;
  /**
   * Hay un envío a cocina en vuelo. **Sólo apaga «Enviar»** (esa sí es una
   * acción que no se puede disparar dos veces).
   *
   * Todo lo demás de la columna sigue vivo: entregar otra tanda, anular un
   * ítem o abrir el ⋯ no tienen nada que ver con el envío, y apagarlos hacía
   * sentir que la mesa entera se congelaba de a ratos.
   */
  enviando: boolean;
  onCancelItem: (orderItemId: string, productName: string) => void;
  /** Repreciar una línea YA enviada (issue #283). Es la misma etiqueta del
   *  carrito, del otro lado del envío. */
  onEditPriceEnviado?: (orderItemId: string) => void;
  onAdvance: (comandaId: string) => void;
  onChangeQty: (key: string, delta: number) => void;
  onRemoveCartItem: (key: string) => void;
  onEditPrice: (key: string) => void;
  onEnviar: () => void;
  acciones?: MesaColumnAcciones;
  /**
   * La zona de teclado del carrito (`useCartZone`, specs 055/075). La cadena
   * buscador → resultados → carrito → enviar no cambia porque el carrito se
   * haya mudado a esta columna: ↓ desde el último resultado sigue cayendo acá.
   * Sin esto, mudarlo lo habría dejado fuera del teclado en silencio.
   */
  cartZone?: {
    handleKeyDown: (e: React.KeyboardEvent) => void;
    itemProps: (i: number) => Record<string, unknown>;
  };
  /**
   * La observación de la tanda (spec 128). Controlada por el padre porque la
   * manda **él** al enviar y la limpia después: la columna sólo la muestra.
   * Sin los dos, el campo no aparece.
   */
  observacion?: string;
  onObservacionChange?: (v: string) => void;
  className?: string;
}) {
  const enviados = loPedido?.items ?? [];
  const tandas = agruparPorTanda(enviados);
  const comandaById = new Map(comandas.map((c) => [c.id, c]));
  const haySinEnviar = cart.length > 0;
  const hayEnviado = enviados.some((i) => !estaAnulado(i));

  const menu = acciones ?? {};
  const menuItems = [
    menu.onCargarCliente && {
      key: "cliente",
      label: "Cargar cliente",
      onClick: menu.onCargarCliente,
    },
    // Cobrar vive en el ⋯ cuando hay algo sin enviar: ahí el botón grande es
    // «Enviar», y cobrar una mesa con líneas sin mandar es casi siempre un
    // error de tap.
    haySinEnviar &&
      hayEnviado &&
      menu.onCobrar && {
        key: "cobrar",
        label: "Cobrar",
        onClick: menu.onCobrar,
      },
    menu.onMozo && {
      key: "mozo",
      label: menu.mozoLabel ?? "Mozo de la mesa",
      onClick: menu.onMozo,
    },
    menu.onTrasladar && {
      key: "trasladar",
      label: "Trasladar mesa",
      onClick: menu.onTrasladar,
    },
  ].filter(Boolean) as { key: string; label: string; onClick: () => void }[];

  return (
    <section
      aria-label={`Mesa ${tableLabel}`}
      className={`flex min-h-0 flex-col border-border @min-[600px]:border-r ${className}`}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {cargando && (
          <div
            role="status"
            aria-label="Cargando lo pedido"
            className="space-y-3"
          >
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"
              >
                <div className="border-b border-border/60 bg-muted/30 px-3 py-2">
                  <Skeleton className="h-3 w-24 rounded" />
                </div>
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-4 w-2/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!cargando && tandas.length === 0 && !haySinEnviar && (
          <p className="px-1 py-8 text-center text-xs text-muted-foreground">
            La mesa todavía no tiene nada cargado. Buscá un producto y agregalo
            con Enter.
          </p>
        )}

        {/* ── Enviado ── */}
        {tandas.map((tanda) => {
          const hora = horaDe(tanda.emitted_at);
          const comandasDeTanda = [
            ...new Set(
              tanda.items
                .map((i) => i.comanda_id)
                .filter((id): id is string => Boolean(id)),
            ),
          ]
            .map((id) => comandaById.get(id))
            .filter((c): c is ComandaConItems => Boolean(c))
            .filter((c) => c.status !== "entregado");

          return (
            <article
              key={tanda.numero ?? "sin-comanda"}
              className="overflow-hidden rounded-2xl bg-card ring-1 ring-border"
            >
              <header className="flex items-baseline justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
                <span className="text-[11px] font-semibold text-foreground/80">
                  {tanda.numero == null
                    ? "Sin comanda"
                    : `Tanda ${tanda.numero}`}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {tanda.numero == null ? "no va a cocina" : (hora ?? "")}
                </span>
              </header>

              <ul className="divide-y divide-border/60">
                {tanda.items.map((item) => (
                  <ItemEnviado
                    key={item.order_item_id}
                    item={item}
                    sector={
                      item.station_id
                        ? (stationNameById[item.station_id] ?? null)
                        : null
                    }
                    userCanCancel={userCanCancel}
                    userCanEditPrice={userCanEditPrice}
                    onCancelItem={onCancelItem}
                    onEditPriceEnviado={onEditPriceEnviado}
                  />
                ))}
              </ul>

              {comandasDeTanda.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-border/60 p-2">
                  {comandasDeTanda.map((c) => (
                    <Button
                      key={c.id}
                      type="button"
                      size="lg"
                      className="flex-1"
                      onClick={() => onAdvance(c.id)}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Entregar
                      {comandasDeTanda.length > 1 && c.station_id && (
                        <span className="font-normal">
                          {stationNameById[c.station_id] ?? "sector"}
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </article>
          );
        })}

        {/* ── Sin enviar ──
            En verde y con borde grueso: es lo único de la columna que todavía
            no vio nadie en cocina, y confundirlo con lo enviado es servir de
            menos o mandar dos veces. */}
        {haySinEnviar && (
          <article className="overflow-hidden rounded-2xl bg-emerald-50/60 ring-2 ring-emerald-400">
            <header className="flex items-baseline justify-between gap-2 border-b border-emerald-200 bg-emerald-100/70 px-3 py-1.5">
              <span className="text-[11px] font-bold text-emerald-800 uppercase">
                Sin enviar
              </span>
              <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                {formatCurrency(cartTotalCents)}
              </span>
            </header>
            <ul
              onKeyDown={cartZone?.handleKeyDown}
              className="divide-y divide-emerald-200/70"
            >
              {cart.map((c, i) => (
                <ItemSinEnviar
                  key={c._key}
                  item={c}
                  rowProps={cartZone?.itemProps(i)}
                  userCanEditPrice={userCanEditPrice}
                  onChangeQty={onChangeQty}
                  onRemove={onRemoveCartItem}
                  onEditPrice={onEditPrice}
                />
              ))}
            </ul>
          </article>
        )}
      </div>

      {/* ── Pie: total + qué hacer ── */}
      <footer className="shrink-0 space-y-2 border-t border-border bg-card px-3 py-3">
        {loPedido && hayEnviado && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {haySinEnviar ? "Enviado hasta ahora" : "Total de la mesa"}
            </span>
            <span className="text-lg font-bold text-foreground tabular-nums">
              {formatCurrency(loPedido.total_cents)}
            </span>
          </div>
        )}

        {/* La observación va pegada a «Enviar» y sólo cuando hay algo que
            enviar: es del envío, no de la mesa. Arriba y no abajo del botón
            porque abajo no se lee — el pulgar ya está en el verde. */}
        {haySinEnviar && observacion != null && onObservacionChange && (
          <ObservacionDeLaTanda
            value={observacion}
            onChange={onObservacionChange}
          />
        )}

        <div className="flex items-stretch gap-2">
          <div className="min-w-0 flex-1">
            {haySinEnviar ? (
              <Button
                type="button"
                size="xl"
                className="w-full"
                onClick={onEnviar}
                disabled={enviando}
              >
                <Send className="h-5 w-5" />
                {enviando
                  ? "Enviando…"
                  : `Enviar ${formatCurrency(cartTotalCents)}`}
                <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">
                  ⌘↵
                </kbd>
              </Button>
            ) : acciones?.onCobrar && hayEnviado ? (
              <Button
                type="button"
                size="xl"
                className="w-full"
                onClick={acciones.onCobrar}
              >
                Cobrar
              </Button>
            ) : null}
          </div>

          {(menuItems.length > 0 || menu.onAnular) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Más acciones de la mesa"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-card text-foreground/70 ring-1 ring-border transition hover:bg-muted/50 disabled:opacity-50"
              >
                <MoreVertical className="size-5" strokeWidth={2.5} />
              </DropdownMenuTrigger>
              {/* Más grande que el `text-sm` que trae el componente (pedido de
                  Juan): este menú se usa de parado y a un brazo de distancia,
                  no es un dropdown de formulario. */}
              <DropdownMenuContent align="end" className="w-56">
                {menuItems.map((it) => (
                  <DropdownMenuItem
                    key={it.key}
                    onClick={it.onClick}
                    className="px-2.5 py-2 text-base"
                  >
                    {it.label}
                  </DropdownMenuItem>
                ))}
                {menu.onAnular && (
                  <>
                    {menuItems.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onClick={menu.onAnular}
                      className="px-2.5 py-2 text-base text-red-600 focus:text-red-600"
                    >
                      Anular mesa
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </footer>
    </section>
  );
}

function ItemEnviado({
  item,
  sector,
  userCanCancel,
  userCanEditPrice,
  onCancelItem,
  onEditPriceEnviado,
}: {
  item: LoPedidoItem;
  sector: string | null;
  userCanCancel: boolean;
  userCanEditPrice: boolean;
  onCancelItem: (orderItemId: string, productName: string) => void;
  onEditPriceEnviado?: (orderItemId: string) => void;
}) {
  if (estaAnulado(item)) {
    return (
      <li className="flex items-start gap-2 bg-muted/50 px-3 py-2 text-muted-foreground/70">
        <span className="text-xs font-semibold tabular-nums line-through">
          {item.quantity}×
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold break-words line-through">
            {item.product_name}
          </p>
          {item.cancelled_reason && (
            <p className="mt-0.5 text-[11px] text-red-500">
              Anulado: {item.cancelled_reason}
            </p>
          )}
        </div>
      </li>
    );
  }

  // Repreciar una línea ya enviada (issue #283). Qué línea lo admite lo dice
  // `sePuedeRepreciar`, que es el espejo de lo que rechaza el server; acá sólo
  // se suma el rol y que la pantalla tenga a dónde llevarlo.
  const puedeRepreciar =
    userCanEditPrice && onEditPriceEnviado != null && sePuedeRepreciar(item);

  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <span className="mt-0.5 text-sm font-bold text-foreground/80 tabular-nums">
        {item.quantity}×
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold break-words text-foreground">
          {item.product_name}
        </p>
        {/* Los modificadores son la mitad del pedido: sin ellos «Milanesa» no
            dice si va con papas o con puré. */}
        {item.modifiers.length > 0 && (
          <p className="mt-0.5 text-xs text-foreground/70">
            {item.modifiers.join(" · ")}
          </p>
        )}
        {item.notes && (
          <p className="mt-0.5 text-xs text-muted-foreground italic">
            &ldquo;{item.notes}&rdquo;
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${KITCHEN_PILL[item.kitchen_status]}`}
          >
            {KITCHEN_LABEL[item.kitchen_status]}
          </span>
          {sector && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
              {sector}
            </span>
          )}
          {item.seat_number != null && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
              Cubierto {item.seat_number}
            </span>
          )}
        </div>
        {/* El precio pisado se lee igual que en el carrito (spec 069): contra
            qué se decidió, qué se cobra y por qué. Sin el motivo a la vista,
            el que llega después no sabe si es una cortesía o un error. */}
        {item.price_original_cents != null && (
          <p className="mt-0.5 text-[11px] font-medium text-amber-700">
            <span className="tabular-nums line-through opacity-60">
              {formatCurrency(item.price_original_cents)}
            </span>
            {" → "}
            <span className="tabular-nums">
              {formatCurrency(item.unit_price_cents)}
            </span>
            {item.price_override_reason
              ? ` · ${item.price_override_reason}`
              : ""}
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs font-semibold text-foreground/80 tabular-nums">
        {formatCurrency(item.subtotal_cents)}
      </span>
      {puedeRepreciar && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={
            item.price_original_cents != null
              ? "shrink-0 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-100"
              : "shrink-0 rounded-full text-muted-foreground/70"
          }
          onClick={() => onEditPriceEnviado?.(item.order_item_id)}
          aria-label={`Cambiar el precio de ${item.product_name}, ya enviado`}
        >
          <Tag className="h-4 w-4" />
        </Button>
      )}
      {userCanCancel && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-full text-muted-foreground/70 hover:bg-red-50 hover:text-red-600"
          onClick={() => onCancelItem(item.order_item_id, item.product_name)}
          aria-label={`Anular ${item.product_name}`}
        >
          <Ban className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}

function ItemSinEnviar({
  item,
  userCanEditPrice,
  onChangeQty,
  onRemove,
  onEditPrice,
  rowProps,
}: {
  item: MesaColumnCartItem;
  userCanEditPrice: boolean;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onEditPrice: (key: string) => void;
  rowProps?: Record<string, unknown>;
}) {
  return (
    <li
      // La línea entera es la parada de teclado (spec 075): parado encima,
      // ←/→ mueven la cantidad y Supr la quita.
      {...rowProps}
      aria-label={`${item.product_name}, cantidad ${item.quantity}. Sin enviar. ← y → cambian la cantidad, Supr la quita.`}
      // `flex-wrap` + un ancho mínimo para el nombre: la fila tiene mucha
      // ferretería fija (precio + hasta cinco botones, ~285 px) y la columna
      // mide 46% del panel. Con una sola línea el nombre se achicaba por
      // debajo del ancho de su propia palabra y —al ser `overflow` visible—
      // se dibujaba ENCIMA del precio: «Milanesa» pisada por «$ 27.500».
      // Ahora, cuando no entra todo, los botones bajan a su propio renglón y
      // el nombre se lee siempre entero.
      className="flex flex-wrap items-start gap-x-2 gap-y-1.5 px-3 py-2 outline-none focus-visible:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset"
    >
      <span className="mt-0.5 text-sm font-bold text-emerald-800 tabular-nums">
        {item.quantity}×
      </span>
      <div className="min-w-[7rem] flex-1 basis-0">
        <p className="text-sm font-semibold break-words text-foreground">
          {item.esMenuDelDia && (
            <span className="mr-1 inline-flex items-center rounded bg-emerald-200 px-1 align-middle text-[9px] font-bold text-emerald-800 uppercase">
              Menú
            </span>
          )}
          {item.product_name}
        </p>
        {item.modifiers.length > 0 && (
          <p className="mt-0.5 text-xs text-foreground/70">
            {item.modifiers.join(" · ")}
          </p>
        )}
        {item.notes && (
          <p className="mt-0.5 text-xs text-muted-foreground italic">
            &ldquo;{item.notes}&rdquo;
          </p>
        )}
        {item.price_override_cents != null && (
          <p className="mt-0.5 text-[11px] font-medium text-amber-700">
            <span className="line-through opacity-60">
              {formatCurrency(item.unit_price_cents)}
            </span>{" "}
            → {formatCurrency(item.price_override_cents)} ·{" "}
            {item.price_override_reason}
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs font-semibold text-emerald-800 tabular-nums">
        {formatCurrency(item.line_subtotal_cents)}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {userCanEditPrice && !item.esMenuDelDia && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={
              item.price_override_cents != null
                ? "rounded-full bg-amber-100 text-amber-700 ring-1 ring-amber-300 hover:bg-amber-100"
                : "rounded-full"
            }
            onClick={() => onEditPrice(item._key)}
            aria-label={`Cambiar el precio de ${item.product_name}`}
          >
            <Tag className="h-4 w-4" />
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          onClick={() => onChangeQty(item._key, -1)}
          disabled={item.quantity <= 1}
          aria-label={`Restar ${item.product_name}`}
        >
          <span aria-hidden className="text-lg leading-none">
            −
          </span>
        </Button>
        <span className="w-6 text-center text-sm font-bold tabular-nums">
          {item.quantity}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          onClick={() => onChangeQty(item._key, 1)}
          disabled={item.quantity >= 99}
          aria-label={`Sumar ${item.product_name}`}
        >
          <span aria-hidden className="text-lg leading-none">
            +
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full text-muted-foreground/70 hover:bg-red-50 hover:text-red-600"
          onClick={() => onRemove(item._key)}
          aria-label={`Quitar ${item.product_name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

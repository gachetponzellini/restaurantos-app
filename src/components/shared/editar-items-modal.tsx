"use client";

/**
 * Editor de ítems de una orden — el mismo para todas las superficies.
 *
 * Nació adentro del kanban de comandas (spec 049) como «editar comanda ya
 * impresa». La spec 125 lo sacó acá porque el gesto no es de la comanda sino de
 * la **orden**: las dos actions que dispara (`editarItemComanda`, `cancelarItem`)
 * resuelven la orden desde el propio `order_item` y nunca supieron de comandas ni
 * de mesas. Con el modal afuera, el detalle del pedido online y el panel de la
 * mesa editan sus ítems con esta misma pantalla en lugar de tener cada uno la
 * suya (spec 110 · issue #169).
 *
 * Quién lo abre decide tres cosas: qué ítems entran, de qué sector salen los
 * productos del «cambiar producto», y qué pasa después de guardar (el kanban
 * reimprime su comanda; el pedido online, su control).
 */

import { useState, useTransition } from "react";
import { Minus, Plus, Printer, Tag, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  cancelarItem,
  editarItemComanda,
  getSwappableProducts,
  type SwappableProduct,
} from "@/lib/comandas/actions";
import type { EditarItemComandaPatch } from "@/lib/comandas/edicion";
import { formatCurrency } from "@/lib/currency";

/** Un ítem vivo de la orden, con lo que el editor necesita para trabajarlo. */
export type ItemEditable = {
  order_item_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  notes: string | null;
  /**
   * De qué menú del día viene la línea, o `null` si es un producto suelto
   * (spec 145). Con nombre = combo / componente de combo: el server no lo deja
   * editar. Antes era un booleano; el nombre sirve para lo mismo y además se
   * puede mostrar.
   */
  combo_name: string | null;
  /**
   * Sector de la línea. `null` (una bebida, un producto de stock) esconde el
   * «cambiar producto»: es la decisión D3 de la spec 125 — cambiarle el
   * producto a una línea sin sector la volvería un ítem con sector y sin
   * comanda, o sea un huérfano que cocina nunca ve.
   */
  station_id: string | null;
  unit_price_cents: number;
  price_original_cents: number | null;
  price_override_reason: string | null;
};

function formatPrice(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-AR")}`;
}

/** Fila de trabajo del modal: copia editable de un ítem vivo + su original. */
type EditRow = {
  itemId: string;
  stationId: string | null;
  productId: string | null;
  productName: string;
  quantity: number;
  notes: string;
  removed: boolean;
  isCombo: boolean;
  origProductId: string | null;
  origQuantity: number;
  origNotes: string;
  // ── Precio por ítem (spec 069) ──
  /** Precio de CATÁLOGO de la línea (lo que dice la carta). */
  catalogPriceCents: number;
  /** Precio pisado, o null si se cobra el de catálogo. */
  overrideCents: number | null;
  overrideReason: string;
  origOverrideCents: number | null;
  origOverrideReason: string;
};

export function EditarItemsModal({
  slug,
  titulo,
  items,
  saveLabel = "Guardar cambios",
  onClose,
  onDone,
  afterSave,
}: {
  slug: string;
  /** Qué se está editando, tal cual va en el encabezado. */
  titulo: string;
  /** Ítems vivos: el caller filtra los cancelados y elige el alcance. */
  items: ItemEditable[];
  saveLabel?: string;
  onClose: () => void;
  onDone: () => void;
  /** Qué hacer con el papel después de guardar (reimprimir, avisar). */
  afterSave?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<EditRow[]>(() =>
    items.map((it) => ({
        itemId: it.order_item_id,
      stationId: it.station_id,
        productId: it.product_id,
        productName: it.product_name,
        quantity: it.quantity,
        notes: it.notes ?? "",
        removed: false,
        isCombo: it.combo_name != null,
        origProductId: it.product_id,
        origQuantity: it.quantity,
        origNotes: it.notes ?? "",
        // `unit_price_cents` es lo COBRADO; el de catálogo vive en
        // `price_original_cents` cuando la línea está pisada (spec 069).
        catalogPriceCents: it.price_original_cents ?? it.unit_price_cents,
        overrideCents:
          it.price_original_cents == null ? null : it.unit_price_cents,
        overrideReason: it.price_override_reason ?? "",
        origOverrideCents:
          it.price_original_cents == null ? null : it.unit_price_cents,
        origOverrideReason: it.price_override_reason ?? "",
      })),
  );
  const [pending, startTransition] = useTransition();
  /**
   * Productos por sector, cacheados. Un pedido online mezcla líneas de la
   * parrilla y de la cocina en la misma pantalla, así que el catálogo del
   * «cambiar producto» es el del sector de **esa** línea, no uno del modal.
   */
  const [productsByStation, setProductsByStation] = useState<
    Record<string, SwappableProduct[]>
  >({});
  const [loadingStation, setLoadingStation] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  // Carga perezosa de los productos del sector (solo al primer "Cambiar producto").
  const ensureProducts = (stationId: string) => {
    if (productsByStation[stationId] || loadingStation === stationId) return;
    setLoadingStation(stationId);
    void getSwappableProducts(slug, stationId).then((r) => {
      if (r.ok) {
        setProductsByStation((prev) => ({ ...prev, [stationId]: r.data }));
      } else {
        toast.error(r.error ?? "No pudimos cargar los productos del sector.");
      }
      setLoadingStation((cur) => (cur === stationId ? null : cur));
    });
  };

  const patchRow = (itemId: string, patch: Partial<EditRow>) =>
    setRows((rs) =>
      rs.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)),
    );

  const rowChanged = (r: EditRow) =>
    r.removed ||
    r.quantity !== r.origQuantity ||
    r.notes.trim() !== r.origNotes.trim() ||
    r.productId !== r.origProductId ||
    r.overrideCents !== r.origOverrideCents ||
    // Corregir SÓLO el motivo (sin mover el precio) también es un cambio: el
    // motivo es el dato que audita el reporte.
    (r.overrideCents !== null &&
      r.overrideReason.trim() !== r.origOverrideReason.trim());

  /**
   * Una fila con precio pisado y motivo vacío no se puede guardar: el server
   * la rechaza igual, pero cortarlo acá evita que el encargado descubra el
   * problema recién después de esperar el round-trip (spec 21).
   */
  const priceIncomplete = (r: EditRow) =>
    !r.removed && r.overrideCents !== null && r.overrideReason.trim() === "";

  const dirty = rows.some(rowChanged);
  const blocked = rows.some(priceIncomplete);

  // Guardar: aplica quitar / editar por ítem y reimprime el ticket corregido.
  // Loading explícito (no optimista): frontera de plata (spec 21).
  const submit = () => {
    startTransition(async () => {
      for (const r of rows) {
        if (r.removed) {
          const res = await cancelarItem(
            r.itemId,
            "Quitado por el encargado",
            slug,
          );
          if (!res.ok) {
            toast.error(res.error ?? "No pudimos quitar un ítem.");
            return;
          }
          continue;
        }
        const patch: EditarItemComandaPatch = {};
        if (r.quantity !== r.origQuantity) patch.quantity = r.quantity;
        if (r.notes.trim() !== r.origNotes.trim())
          patch.notes = r.notes.trim() ? r.notes.trim() : null;
        if (r.productId && r.productId !== r.origProductId)
          patch.productId = r.productId;
        const priceChanged =
          r.overrideCents !== r.origOverrideCents ||
          (r.overrideCents !== null &&
            r.overrideReason.trim() !== r.origOverrideReason.trim());
        if (priceChanged) {
          // `null` = volver al precio de la carta (el server no pide motivo).
          patch.priceOverrideCents = r.overrideCents;
          patch.priceOverrideReason =
            r.overrideCents === null ? null : r.overrideReason.trim();
        }
        if (Object.keys(patch).length === 0) continue;
        const res = await editarItemComanda(slug, r.itemId, patch);
        if (!res.ok) {
          toast.error(res.error ?? "No pudimos guardar un cambio.");
          return;
        }
      }
      if (afterSave) await afterSave();
      else toast.success("Cambios guardados.");
      onDone();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
          {rows.map((r) => (
            <div
              key={r.itemId}
              className={[
                "ring-border/60 flex flex-col gap-2 rounded-xl p-3 ring-1",
                r.removed ? "opacity-50" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={[
                    "text-foreground min-w-0 flex-1 truncate text-sm font-semibold",
                    r.removed ? "line-through" : "",
                  ].join(" ")}
                >
                  {r.productName}
                </span>
                <Button
                  type="button"
                  variant={r.removed ? "outline" : "destructive"}
                  size="sm"
                  onClick={() => patchRow(r.itemId, { removed: !r.removed })}
                  disabled={pending}
                >
                  {r.removed ? (
                    <>
                      <Undo2 className="size-3" strokeWidth={2.5} /> Deshacer
                    </>
                  ) : (
                    <>
                      <Trash2 className="size-3" strokeWidth={2.5} /> Quitar
                    </>
                  )}
                </Button>
              </div>

              {!r.removed && (
                <>
                  <div className="flex items-center gap-3">
                    <div className="ring-border/70 inline-flex items-center rounded-lg ring-1">
                      <button
                        type="button"
                        onClick={() =>
                          patchRow(r.itemId, {
                            quantity: Math.max(1, r.quantity - 1),
                          })
                        }
                        disabled={pending || r.quantity <= 1}
                        className="hover:bg-muted/60 inline-flex size-8 items-center justify-center rounded-l-lg disabled:opacity-40"
                      >
                        <Minus className="size-3.5" strokeWidth={2.5} />
                      </button>
                      <span className="w-8 text-center text-sm font-bold tabular-nums">
                        {r.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patchRow(r.itemId, { quantity: r.quantity + 1 })
                        }
                        disabled={pending}
                        className="hover:bg-muted/60 inline-flex size-8 items-center justify-center rounded-r-lg disabled:opacity-40"
                      >
                        <Plus className="size-3.5" strokeWidth={2.5} />
                      </button>
                    </div>

                    {!r.isCombo && r.stationId && (
                      <button
                        type="button"
                        onClick={() => {
                          ensureProducts(r.stationId!);
                          setPickerFor(
                            pickerFor === r.itemId ? null : r.itemId,
                          );
                        }}
                        disabled={pending}
                        className="text-muted-foreground hover:text-foreground text-xs font-semibold underline underline-offset-2 disabled:opacity-50"
                      >
                        Cambiar producto
                      </button>
                    )}
                  </div>

                  {/* Precio por ítem (spec 069). Inline y no en un modal
                      anidado: este editor es batch — se tocan varias líneas y
                      recién ahí se guarda — así que abrir un modal por línea
                      rompería el gesto. */}
                  {!r.isCombo && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        Precio de la carta{" "}
                        <span className="tabular-nums">
                          {formatCurrency(r.catalogPriceCents)}
                        </span>
                      </span>
                      {r.overrideCents === null ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            patchRow(r.itemId, {
                              overrideCents: r.catalogPriceCents,
                            })
                          }
                          disabled={pending}
                        >
                          <Tag className="size-3" strokeWidth={2.5} />
                          Cambiar el precio
                        </Button>
                      ) : (
                        <div className="flex flex-1 flex-wrap items-center gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="any"
                            value={r.overrideCents / 100}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              patchRow(r.itemId, {
                                overrideCents:
                                  Number.isFinite(v) && v >= 0
                                    ? Math.round(v * 100)
                                    : 0,
                              });
                            }}
                            disabled={pending}
                            aria-label={`Precio a cobrar de ${r.productName}`}
                            className="border-input bg-background focus-visible:ring-ring h-8 w-24 rounded-lg border px-2 text-sm font-semibold tabular-nums outline-none focus-visible:ring-2"
                          />
                          <input
                            type="text"
                            value={r.overrideReason}
                            onChange={(e) =>
                              patchRow(r.itemId, {
                                overrideReason: e.target.value,
                              })
                            }
                            disabled={pending}
                            placeholder="Motivo (obligatorio)"
                            aria-label={`Motivo del cambio de precio de ${r.productName}`}
                            className={[
                              "bg-background focus-visible:ring-ring h-8 min-w-0 flex-1 rounded-lg border px-2 text-xs outline-none focus-visible:ring-2",
                              priceIncomplete(r)
                                ? "border-rose-300"
                                : "border-input",
                            ].join(" ")}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              patchRow(r.itemId, {
                                overrideCents: null,
                                overrideReason: "",
                              })
                            }
                            disabled={pending}
                          >
                            <Undo2 className="size-3" strokeWidth={2.5} />
                            Volver a la carta
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {pickerFor === r.itemId && r.stationId && (
                    <div className="ring-border/60 max-h-40 overflow-y-auto rounded-lg ring-1">
                      {loadingStation === r.stationId && (
                        <p className="text-muted-foreground p-2 text-xs">
                          Cargando productos…
                        </p>
                      )}
                      {loadingStation !== r.stationId &&
                        productsByStation[r.stationId]?.length === 0 && (
                        <p className="text-muted-foreground p-2 text-xs">
                          No hay otros productos en este sector.
                        </p>
                      )}
                      {productsByStation[r.stationId]?.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            patchRow(r.itemId, {
                              productId: p.id,
                              productName: p.name,
                              // El server limpia el override al cambiar de
                              // producto (el motivo y el precio de lista eran
                              // del viejo, FR-013). Si acá no lo espejáramos,
                              // el modal seguiría mostrando el precio anterior
                              // y afirmaría que va a cobrar algo distinto de
                              // lo que realmente se guarda.
                              catalogPriceCents: p.price_cents,
                              overrideCents: null,
                              overrideReason: "",
                            });
                            setPickerFor(null);
                          }}
                          className={[
                            "hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs",
                            p.id === r.productId
                              ? "bg-muted/40 font-semibold"
                              : "",
                          ].join(" ")}
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="text-muted-foreground tabular-nums">
                            {formatPrice(p.price_cents)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <input
                    type="text"
                    value={r.notes}
                    onChange={(e) =>
                      patchRow(r.itemId, { notes: e.target.value })
                    }
                    disabled={pending}
                    placeholder="Aclaración (ej: sin sal, bien cocido)"
                    className="border-input bg-background focus-visible:ring-ring w-full rounded-lg border px-3 py-1.5 text-xs outline-none focus-visible:ring-2 disabled:opacity-50"
                  />
                </>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No hay ítems para editar.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={pending}
          >
            Volver
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={submit}
            disabled={pending || !dirty || blocked}
          >
            <Printer className="size-4" strokeWidth={2.5} />
            {pending ? "Guardando…" : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
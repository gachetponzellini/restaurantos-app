"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Plus, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/currency";
import { etiquetaDePrecio } from "@/lib/catalog/variantes";
import { composeItemNotes } from "@/lib/mozo/item-notes";
import { useEscapeToClose } from "@/lib/ui/use-escape-to-close";
import { indexFromDigit } from "@/lib/ui/roving";
import { useRovingList } from "@/lib/ui/use-roving-list";
import type { CatalogProduct, CatalogModifier } from "@/lib/mozo/catalog-query";

export type AddToCartItem = {
  product_id: string;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  notes: string;
  modifiers: {
    id: string;
    group_id: string;
    name: string;
    price_delta_cents: number;
  }[];
  line_subtotal_cents: number;
};

type Selection = Record<string, string[]>;

function initialSelection(p: CatalogProduct): Selection {
  const sel: Selection = {};
  for (const g of p.modifier_groups) {
    if (
      g.is_required &&
      g.min_selection === 1 &&
      g.max_selection === 1 &&
      g.modifiers[0]
    ) {
      sel[g.id] = [g.modifiers[0].id];
    } else {
      sel[g.id] = [];
    }
  }
  return sel;
}

function validate(p: CatalogProduct, sel: Selection): string | null {
  for (const g of p.modifier_groups) {
    const count = sel[g.id]?.length ?? 0;
    if (count < g.min_selection)
      return `Elegí al menos ${g.min_selection} en "${g.name}".`;
    if (count > g.max_selection)
      return `Hasta ${g.max_selection} en "${g.name}".`;
  }
  return null;
}

export function ProductModal({
  product,
  open,
  onClose,
  onAdd,
  embedded = false,
  permiteComoEntrada = true,
}: {
  product: CatalogProduct | null;
  open: boolean;
  onClose: () => void;
  onAdd: (item: AddToCartItem) => void;
  /** Embebido en un panel: el overlay se scopea al contenedor (`absolute`)
   *  en vez de cubrir todo el viewport (`fixed`). */
  embedded?: boolean;
  /**
   * «Como entrada» ordena los tiempos de una mesa: que ese plato salga antes,
   * con las entradas. En el mostrador no hay tiempos que ordenar —se cobra y se
   * lleva— así que la venta rápida lo apaga (issue #189). El atajo `/` también.
   */
  permiteComoEntrada?: boolean;
}) {
  const [selection, setSelection] = useState<Selection>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [asEntrada, setAsEntrada] = useState(false);
  // ¿Se especificó algo? Decide qué hace Esc (issue #374): si se tocó algo,
  // confirma el ítem; si el modal se abrió y no se tocó nada, cancela.
  const [tocado, setTocado] = useState(false);

  useEffect(() => {
    if (product) {
      setSelection(initialSelection(product));
      setQuantity(1);
      setNotes("");
      setAsEntrada(false);
      setTocado(false);
    }
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Teclado (spec 055) ──
  // Esc cierra; foco inicial al abrir; Tab atrapado dentro del modal. En modo
  // embebido el foco vuelve al buscador al cerrar/agregar (lo hace el padre).
  const panelRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Esc confirma, como en Maxirest (issue #374): la encargada carga sin mouse
  // —Enter en «a punto», `+`, Esc— y Esc tiene que dejar el ítem cargado como
  // lo especificó, no descartarlo. Si no se tocó nada, Esc cancela: cubre el
  // producto abierto por error. Para cancelar después de tocar queda la X o el
  // click afuera. El handler se lee de un ref porque depende del estado del
  // render y `handleAdd` se define después del early return.
  const escapeRef = useRef<() => void>(onClose);
  const onEscape = useCallback(() => escapeRef.current(), []);
  useEscapeToClose(onEscape, open);

  // ── Los modificadores son una zona más del panel (spec 113) ──────────────
  //
  // Hasta acá este modal era la única superficie de carga sin flechas: para
  // llegar a la tercera salsa había que tabular tres veces, y el resto del
  // sidebar —resultados, carrito, filas de mesa, métodos de pago, y el propio
  // wizard del menú del día en su paso de modificadores— se recorre con ↑/↓
  // desde la spec 075. Se cortaba justo en el paso que más se repite.
  //
  // Todos los grupos van en **una sola** zona, aplanados: al que carga no le
  // importa dónde termina "Punto de cocción" y empieza "Guarnición" — baja con
  // ↓ hasta lo que busca, igual que baja del buscador al carrito.
  const opciones = useMemo(
    () =>
      (product?.modifier_groups ?? []).flatMap((g) =>
        g.modifiers.map((m) => ({ group: g, modifier: m })),
      ),
    [product],
  );
  const mods = useRovingList<HTMLButtonElement>({
    length: opciones.length,
    // El borde de abajo entrega el foco a "Agregar", que es a dónde va el que
    // ya eligió: la zona no se come la última flecha.
    onExitDown: () => submitRef.current?.focus(),
  });
  // Índice plano del primer modificador de cada grupo, para numerar sin
  // recalcular en cada opción.
  const offsetDeGrupo = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const g of product?.modifier_groups ?? []) {
      offsets.push(acc);
      acc += g.modifiers.length;
    }
    return offsets;
  }, [product]);

  useEffect(() => {
    if (!open || !product) return;
    // Foco inicial: primer modificador si hay, si no el botón "Agregar". FR-010.
    const t = setTimeout(() => {
      if (opciones.length > 0) mods.focusFirst();
      else submitRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open, product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineTotal = useMemo(() => {
    if (!product) return 0;
    const modsTotal = product.modifier_groups.reduce((acc, g) => {
      const selected = selection[g.id] ?? [];
      return (
        acc +
        g.modifiers
          .filter((m) => selected.includes(m.id))
          .reduce((a, m) => a + m.price_delta_cents, 0)
      );
    }, 0);
    return (product.price_cents + modsTotal) * quantity;
  }, [product, selection, quantity]);

  if (!open || !product) return null;

  /**
   * «Seguir»: el foco pasa al grupo siguiente que tenga opciones, y si no queda
   * ninguno al botón «Agregar» — que es donde termina la cadena de teclado del
   * panel (spec 075). Es lo mismo que hace ↓ en el borde de la zona; la
   * diferencia es que acá se llega decidiendo, no navegando.
   */
  const seguirDesdeGrupo = (gi: number) => {
    // «Seguir» es decidir que lo elegido queda: cuenta como especificar.
    setTocado(true);
    const grupos = product.modifier_groups;
    for (let i = gi + 1; i < grupos.length; i++) {
      if (grupos[i].modifiers.length > 0) {
        mods.focusIndex(offsetDeGrupo[i]);
        return;
      }
    }
    submitRef.current?.focus();
  };

  const toggle = (g: { id: string; max_selection: number }, modId: string) => {
    setTocado(true);
    setSelection((prev) => {
      const current = prev[g.id] ?? [];
      const isOn = current.includes(modId);
      if (isOn) return { ...prev, [g.id]: current.filter((x) => x !== modId) };
      if (g.max_selection === 1) return { ...prev, [g.id]: [modId] };
      if (current.length >= g.max_selection) return prev;
      return { ...prev, [g.id]: [...current, modId] };
    });
  };

  const handleAdd = () => {
    const error = validate(product, selection);
    if (error) {
      toast.error(error);
      return;
    }
    const flatMods: AddToCartItem["modifiers"] = product.modifier_groups
      .flatMap((g) =>
        g.modifiers.filter((m) => selection[g.id]?.includes(m.id)),
      )
      .map((m: CatalogModifier) => ({
        id: m.id,
        group_id: m.group_id,
        name: m.name,
        price_delta_cents: m.price_delta_cents,
      }));
    onAdd({
      product_id: product.id,
      product_name: product.name,
      unit_price_cents: product.price_cents,
      quantity,
      notes: composeItemNotes({ asEntrada, freeText: notes }),
      modifiers: flatMods,
      line_subtotal_cents: lineTotal,
    });
    onClose();
  };

  escapeRef.current = tocado ? handleAdd : onClose;

  const cambiarCantidad = (delta: number) => {
    setTocado(true);
    setQuantity((q) => Math.min(99, Math.max(1, q + delta)));
  };
  const alternarEntrada = () => {
    setTocado(true);
    setAsEntrada((v) => !v);
  };

  return (
    <div
      onClick={onClose}
      className={`${embedded ? "absolute" : "fixed"} inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-sm`}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Cantidad con + / − sin mouse (salvo escribiendo en Observaciones).
          // Spec 055 fast-follow: acelera cargar varias unidades (ej. agua).
          const target = e.target as HTMLElement;
          const typing =
            target.tagName === "TEXTAREA" || target.tagName === "INPUT";
          // `/` marca el ítem como entrada (spec 050 · atajo agregado en la 075).
          // Es la tecla que la mano ya tiene abajo a la derecha, y en Observaciones
          // no aplica: ahí una barra es una barra.
          if (!typing && permiteComoEntrada && e.key === "/") {
            e.preventDefault();
            alternarEntrada();
            return;
          }
          if (!typing && (e.key === "+" || e.key === "=")) {
            e.preventDefault();
            cambiarCantidad(1);
            return;
          }
          if (!typing && e.key === "-") {
            e.preventDefault();
            cambiarCantidad(-1);
            return;
          }
          // Tipear una letra desde cualquier lado del modal escribe en
          // Observaciones (issue #374), igual que «A-Z busca» en el panel: sin
          // esto, para poner «sin sal» había que tabular o ir al mouse.
          if (
            !typing &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            e.key.length === 1 &&
            /\p{L}/u.test(e.key)
          ) {
            e.preventDefault();
            setTocado(true);
            setNotes((n) => (n + e.key).slice(0, 200));
            notesRef.current?.focus();
            return;
          }
          // Focus-trap: Tab/Shift+Tab ciclan dentro del modal. FR-009.
          if (e.key !== "Tab") return;
          const panel = panelRef.current;
          if (!panel) return;
          const items = Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
            ),
          );
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        className={`w-full max-w-md ${embedded ? "max-h-full" : "max-h-[92dvh]"} bg-card overflow-y-auto rounded-t-3xl pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
        >
          {/* Handle */}
          <div className="flex justify-center py-2">
            <span className="bg-border h-1 w-10 rounded-full" />
          </div>

          <div className="flex items-start justify-between gap-3 px-5">
            <div className="min-w-0">
              <h3 className="font-heading text-foreground text-lg leading-tight font-bold">
                {product.name}
              </h3>
              {product.description && (
                <p className="text-foreground/70 mt-1 text-sm">
                  {product.description}
                </p>
              )}
              <p className="mt-1 text-sm font-bold text-emerald-700 tabular-nums">
                {etiquetaDePrecio(product, formatCurrency)}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="-mt-1"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {product.modifier_groups.length > 0 && (
            <div
              className="mt-5 space-y-3 px-5"
              onKeyDown={(e) => {
                // Las flechas primero (la zona las consume y avisa).
                if (mods.handleKeyDown(e)) return;
                // 1-9 elige directo, igual que el paso de modificadores del
                // wizard del menú del día.
                const porDigito = indexFromDigit(e.key, opciones.length);
                if (porDigito !== null) {
                  e.preventDefault();
                  const o = opciones[porDigito];
                  toggle(o.group, o.modifier.id);
                  mods.focusIndex(porDigito);
                }
              }}
            >
              {product.modifier_groups.map((g, gi) => (
                <div
                  key={g.id}
                  className="border-border rounded-2xl border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-foreground text-sm font-bold">
                      {g.name}
                    </h4>
                    <div className="flex items-center gap-1.5">
                      {!g.is_variant &&
                        g.modifiers.every((m) => m.price_delta_cents === 0) && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
                            sin cargo
                          </span>
                        )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                          g.is_required
                            ? "bg-amber-100 text-amber-800"
                            : "bg-muted text-foreground/70"
                        }`}
                      >
                        {g.is_required ? "obligatorio" : "opcional"}
                        {g.max_selection > 1
                          ? ` · hasta ${g.max_selection}`
                          : ""}
                      </span>
                    </div>
                  </div>
                  {/* El contenedor del grupo, igual que el wizard del menú del
                    día: un `role="radio"` sin `radiogroup` arriba es ARIA
                    inválida, y sin él el lector nunca dice "1 de 3" ni de qué
                    grupo es la opción. Importa el doble por la zona aplanada:
                    cruzar de "Punto de cocción" a "Guarnición" con ↓ es
                    invisible salvo que cambie el ancestro con nombre. */}
                  <div
                    role={g.max_selection === 1 ? "radiogroup" : "group"}
                    aria-label={`${g.name}${g.is_required ? " (obligatorio)" : ""}${
                      g.max_selection > 1 ? ` · hasta ${g.max_selection}` : ""
                    }`}
                    className="mt-2 space-y-1.5"
                  >
                    {g.modifiers.map((m, mi) => {
                      const selected = (selection[g.id] ?? []).includes(m.id);
                      return (
                        <button
                          key={m.id}
                          {...mods.itemProps(offsetDeGrupo[gi] + mi)}
                          type="button"
                          role={g.max_selection === 1 ? "radio" : "checkbox"}
                          aria-checked={selected}
                          onClick={() => toggle(g, m.id)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            // Enter sobre lo que YA está elegido = «Seguir»
                            // (misma regla que el asistente del menú del día,
                            // spec 118). Acá pesaba todavía más: los grupos
                            // obligatorios de una sola opción vienen con la
                            // primera **preelegida** (`initialSelection`), así que
                            // el modal abría con el foco puesto sobre algo ya
                            // marcado y el primer Enter lo DESMARCABA. Dos Enter
                            // y volvías a cero: con el teclado no se llegaba nunca
                            // a «Agregar», y la comanda salía sin punto de
                            // cocción. Para desmarcar quedan el dígito y el click.
                            const elegidos = selection[g.id] ?? [];
                            if (
                              selected &&
                              elegidos.length >= g.min_selection
                            ) {
                              seguirDesdeGrupo(gi);
                              return;
                            }
                            toggle(g, m.id);
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm transition active:scale-[0.99] ${
                            selected
                              ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300"
                              : "bg-muted/50 ring-border/60 active:bg-muted ring-1"
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                                g.max_selection === 1
                                  ? "rounded-full"
                                  : "rounded-md"
                              } ${
                                selected
                                  ? "bg-emerald-600 text-white"
                                  : "bg-card ring-foreground/20 ring-1"
                              }`}
                            >
                              {selected && (
                                <Check className="h-3 w-3" strokeWidth={3} />
                              )}
                            </span>
                            <span className="font-semibold">{m.name}</span>
                          </span>
                          {g.is_variant ? (
                            // Spec 207: el gusto se lee con su precio final.
                            <span className="text-foreground/70 text-xs font-semibold tabular-nums">
                              {formatCurrency(
                                product.price_cents + m.price_delta_cents,
                              )}
                            </span>
                          ) : (
                            m.price_delta_cents !== 0 && (
                              <span className="text-foreground/70 text-xs font-semibold tabular-nums">
                                {m.price_delta_cents > 0 ? "+" : ""}
                                {formatCurrency(m.price_delta_cents)}
                              </span>
                            )
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 space-y-1 px-5">
            <label className="text-foreground/80 block text-xs font-bold tracking-wide uppercase">
              Observaciones
            </label>
            {permiteComoEntrada && (
              <button
                type="button"
                onClick={alternarEntrada}
                aria-pressed={asEntrada}
                className={`mb-2 flex w-full items-center gap-2.5 rounded-2xl px-3 py-3 text-left text-sm font-semibold transition active:scale-[0.99] ${
                  asEntrada
                    ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300"
                    : "bg-muted/50 text-foreground/80 ring-border/60 active:bg-muted ring-1"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
                    asEntrada
                      ? "bg-emerald-600 text-white"
                      : "bg-card ring-foreground/20 ring-1"
                  }`}
                >
                  {asEntrada && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <UtensilsCrossed className="h-4 w-4 shrink-0" />
                <span className="flex-1">Como entrada</span>
                <kbd
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    asEntrada
                      ? "bg-emerald-600/15 text-emerald-800"
                      : "bg-card text-muted-foreground ring-border ring-1"
                  }`}
                >
                  /
                </kbd>
              </button>
            )}
            <textarea
              ref={notesRef}
              value={notes}
              onChange={(e) => {
                setTocado(true);
                setNotes(e.target.value.slice(0, 200));
              }}
              onKeyDown={(e) => {
                // Enter agrega, igual que en el resto del modal; el salto de
                // línea queda en Shift+Enter (issue #374).
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                handleAdd();
              }}
              placeholder="ej: sin jamón, sin rúcula, bien cocido"
              className="border-border block w-full rounded-2xl border px-3 py-2.5 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 focus:outline-none"
              rows={2}
            />
            <p className="text-muted-foreground/70 text-right text-[10px]">
              {notes.length}/200
            </p>
          </div>

          <div className="bg-muted/50 ring-border/60 mx-5 mt-4 flex items-center justify-between rounded-2xl p-2 ring-1">
            <span className="text-foreground/80 px-2 text-sm font-semibold">
              Cantidad
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => cambiarCantidad(-1)}
                disabled={quantity <= 1}
                className="bg-card ring-border flex h-12 w-12 items-center justify-center rounded-full shadow-sm ring-1 active:scale-[0.95] disabled:opacity-40"
                aria-label="Restar"
              >
                <Minus className="h-5 w-5" />
              </button>
              <span className="w-10 text-center text-xl font-bold tabular-nums">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => cambiarCantidad(1)}
                disabled={quantity >= 99}
                className="bg-card ring-border flex h-12 w-12 items-center justify-center rounded-full shadow-sm ring-1 active:scale-[0.95] disabled:opacity-40"
                aria-label="Sumar"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mt-4 px-5">
            <Button
              ref={submitRef}
              type="submit"
              size="xl"
              className="w-full justify-between"
            >
              <span className="text-base font-semibold">Agregar al pedido</span>
              <span className="text-base font-bold tabular-nums">
                {formatCurrency(lineTotal)}
              </span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { I, ImageTile } from "@/components/delivery/primitives";
import { AnimatedValue } from "@/components/motion/animated-value";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { formatCurrency } from "@/lib/currency";
import type { MenuProduct } from "@/lib/menu";
import { useCart, type CartModifier } from "@/stores/cart";

type Selection = Record<string, string[]>;

function initialSelection(product: MenuProduct): Selection {
  const sel: Selection = {};
  for (const g of product.modifier_groups) {
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

function validate(product: MenuProduct, selection: Selection): string | null {
  for (const g of product.modifier_groups) {
    const count = selection[g.id]?.length ?? 0;
    if (count < g.min_selection)
      return `Elegí al menos ${g.min_selection} en "${g.name}".`;
    if (count > g.max_selection)
      return `Podés elegir hasta ${g.max_selection} en "${g.name}".`;
  }
  return null;
}

export function ProductSheet({
  slug,
  product,
  open,
  onOpenChange,
}: {
  slug: string;
  product: MenuProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addItem = useCart(slug, (s) => s.addItem);
  const [selection, setSelection] = useState<Selection>({});
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (product) {
      setSelection(initialSelection(product));
      setQuantity(1);
    }
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bloquear el scroll del fondo mientras el sheet está abierto: sin esto, al
  // llegar al tope/fondo del scroll interno el gesto se propaga a la carta de
  // atrás (scroll chaining) y "se bugea". Restaura el valor previo al cerrar.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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

  // Sin el `!open`: el sheet se queda montado para animar la salida; el
  // BottomSheet decide cuándo se ve.
  if (!product) return null;

  const handleAdd = () => {
    const error = validate(product, selection);
    if (error) {
      toast.error(error);
      return;
    }
    const modifiers: CartModifier[] = product.modifier_groups.flatMap((g) =>
      g.modifiers
        .filter((m) => selection[g.id]?.includes(m.id))
        .map((m) => ({
          modifier_id: m.id,
          group_id: g.id,
          name: m.name,
          price_delta_cents: m.price_delta_cents,
        })),
    );
    addItem({
      id: crypto.randomUUID(),
      product_id: product.id,
      product_name: product.name,
      unit_price_cents: product.price_cents,
      quantity,
      image_url: product.image_url,
      modifiers,
    });
    onOpenChange(false);
  };

  const canAdd = validate(product, selection) === null;

  return (
    <BottomSheet open={open} onClose={() => onOpenChange(false)}>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "contain",
          position: "relative",
        }}
      >
        <div style={{ position: "relative" }}>
          {product.image_url && (
            <ImageTile
              src={product.image_url}
              alt={product.name}
              tone="#D9C9A8"
              radius={0}
              sizes="520px"
              style={{ height: 200, marginTop: 10 }}
            />
          )}
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              width: 34,
              height: 34,
              borderRadius: 99,
              border: "none",
              background: "rgba(255,255,255,0.92)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {I.close("var(--ink)", 16)}
          </button>
        </div>

        <div style={{ padding: "16px 16px 8px" }}>
          <div
            className="d-display"
            style={{
              fontSize: 26,
              lineHeight: 1.1,
              color: "var(--ink)",
            }}
          >
            {product.name}
          </div>
          {product.description && (
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-2)",
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              {product.description}
            </div>
          )}
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>
            {formatCurrency(product.price_cents)}
          </div>
        </div>

        {product.modifier_groups.map((g) => {
          const isMulti = g.max_selection > 1 || g.min_selection === 0;
          return (
            <div
              key={g.id}
              style={{
                borderTop: "8px solid #F3EEE4",
                padding: "14px 16px 8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}
                >
                  {g.name}
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    padding: "3px 7px",
                    borderRadius: 4,
                    background: g.is_required ? "var(--ink)" : "#EEE8DC",
                    color: g.is_required ? "#fff" : "#8A7B5E",
                  }}
                >
                  {g.is_required ? "Obligatorio" : "Opcional"}
                </span>
              </div>
              {g.modifiers.map((o) => {
                const current = selection[g.id] ?? [];
                const selected = current.includes(o.id);
                // atMax only applies to multi-select (checkbox) groups. In
                // radio-like groups (max=1), clicking another option should
                // REPLACE the current selection, so we must not disable the
                // other options just because one is already picked.
                const atMax =
                  isMulti && !selected && current.length >= g.max_selection;
                const disabled = !o.is_available || atMax;
                return (
                  <button
                    key={o.id}
                    disabled={disabled}
                    onClick={() => {
                      setSelection((prev) => {
                        const cur = prev[g.id] ?? [];
                        if (isMulti) {
                          return {
                            ...prev,
                            [g.id]: cur.includes(o.id)
                              ? cur.filter((x) => x !== o.id)
                              : [...cur, o.id],
                          };
                        }
                        return { ...prev, [g.id]: [o.id] };
                      });
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      padding: "12px 0",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid var(--hairline)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      textAlign: "left",
                      opacity: disabled && !atMax ? 0.5 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        flexShrink: 0,
                        borderRadius: isMulti ? 4 : 99,
                        border: `1.6px solid ${selected ? "var(--accent)" : "var(--hairline-2)"}`,
                        background: selected ? "var(--accent)" : "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 12,
                      }}
                    >
                      {selected &&
                        (isMulti ? (
                          I.check("#fff", 12)
                        ) : (
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 99,
                              background: "#fff",
                            }}
                          />
                        ))}
                    </div>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 14,
                        color: "var(--ink)",
                      }}
                    >
                      {o.name}
                    </span>
                    {o.price_delta_cents > 0 && (
                      <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                        +{formatCurrency(o.price_delta_cents)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}

        <div style={{ height: 24 }} />
      </div>

      <div
        style={{
          padding: "12px 16px 22px",
          borderTop: "1px solid var(--hairline)",
          background: "var(--bg)",
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 48,
            borderRadius: 99,
            border: "1px solid var(--hairline-2)",
            background: "#fff",
          }}
        >
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            aria-label="Menos"
            style={{
              width: 44,
              height: 46,
              border: "none",
              background: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {I.minus("var(--ink)", 18)}
          </button>
          <span
            style={{
              minWidth: 20,
              textAlign: "center",
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            <AnimatedValue value={quantity} />
          </span>
          <button
            onClick={() => setQuantity(Math.min(99, quantity + 1))}
            aria-label="Más"
            style={{
              width: 44,
              height: 46,
              border: "none",
              background: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {I.plus("var(--ink)", 18)}
          </button>
        </div>
        <button
          className="m-press"
          disabled={!canAdd || !product.is_available}
          onClick={handleAdd}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 99,
            background:
              canAdd && product.is_available ? "var(--accent)" : "#D8CFC0",
            color: "#fff",
            border: "none",
            cursor: canAdd && product.is_available ? "pointer" : "not-allowed",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: -0.1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 18px",
          }}
        >
          <span>Agregar</span>
          <AnimatedValue value={lineTotal}>
            {formatCurrency(lineTotal)}
          </AnimatedValue>
        </button>
      </div>
    </BottomSheet>
  );
}

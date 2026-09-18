"use client";

import { useEffect, useState } from "react";

import { I, ImageTile } from "@/components/delivery/primitives";
import { AnimatedValue } from "@/components/motion/animated-value";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { formatCurrency } from "@/lib/currency";
import type {
  MenuDailyMenu,
  MenuDailyMenuChoiceGroup,
  MenuDailyMenuComponent,
} from "@/lib/menu";
import {
  activeChoiceGroups,
  pruneBlockedSelections,
} from "@/lib/orders/combo-choices";
import { useCart } from "@/stores/cart";
import type { CartSelectedChoice } from "@/stores/cart";

/**
 * Drawer de detalle del menú del día. Muestra todos los componentes + botón
 * "Agregar". El botón construye un CartItem con `kind: 'daily_menu'` y
 * `modifiers: []` (los combos cerrados no se customizan en V1).
 */
export function DailyMenuSheet({
  slug,
  menu,
  open,
  onOpenChange,
  disabled,
}: {
  slug: string;
  menu: MenuDailyMenu | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const addItem = useCart(slug, (s) => s.addItem);
  const [quantity, setQuantity] = useState(1);
  const [selections, setSelections] = useState<Map<string, CartSelectedChoice>>(
    new Map(),
  );

  // Bloquear el scroll del fondo mientras el sheet está abierto (evita el
  // scroll chaining a la carta de atrás). Mismo patrón que ProductSheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Sin el `!open`: queda montado para animar la salida (BottomSheet).
  if (!menu) return null;

  // Adicional de las opciones elegidas (spec 29): se suma al precio base.
  const choicesDelta = [...selections.values()].reduce(
    (acc, sc) => acc + (sc.extra_price_cents ?? 0),
    0,
  );
  const lineTotal = (menu.price_cents + choicesDelta) * quantity;

  // Grupos que aplican con lo elegido hasta ahora (spec 074): el comensal ve el
  // mismo condicionamiento que el mozo — elegir los ravioles hace desaparecer
  // la guarnición. Misma función pura que valida el server (FR-005).
  const visibleGroups = activeChoiceGroups(menu.choice_groups, selections);

  const allChoicesResolved =
    visibleGroups.length === 0 ||
    visibleGroups.every((g) => selections.has(g.choice_group_id));

  const handleSelect = (
    group: MenuDailyMenuChoiceGroup,
    opt: MenuDailyMenuComponent,
  ) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.set(group.choice_group_id, {
        choice_group_id: group.choice_group_id,
        choice_group_label: group.label,
        product_id: opt.product_id!,
        product_name: opt.product_name ?? opt.label,
        extra_price_cents: opt.extra_price_cents ?? 0,
        modifiers: [],
      });
      // FR-004: lo que dejó de aplicar se descarta, así el total no lo cobra y
      // el payload no lleva una opción que el server va a rechazar.
      return pruneBlockedSelections(menu.choice_groups, next);
    });
  };

  const handleAdd = () => {
    if (!allChoicesResolved) return;
    addItem({
      id: crypto.randomUUID(),
      kind: "daily_menu",
      daily_menu_id: menu.id,
      components_snapshot: menu.components.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
      })),
      selected_choices: [...selections.values()],
      product_name: menu.name,
      unit_price_cents: menu.price_cents,
      quantity,
      image_url: menu.image_url,
      modifiers: [],
    });
    setQuantity(1);
    setSelections(new Map());
    onOpenChange(false);
  };

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
          {menu.image_url && (
            <ImageTile
              src={menu.image_url}
              alt={menu.name}
              tone="#E9C88A"
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
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 99,
              background: "#FFF0CF",
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "#8A5E18",
            }}
          >
            Menú del día
          </div>
          <div
            className="d-display"
            style={{
              fontSize: 26,
              lineHeight: 1.1,
              color: "var(--ink)",
              marginTop: 6,
            }}
          >
            {menu.name}
          </div>
          {menu.description && (
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-2)",
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              {menu.description}
            </div>
          )}
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>
            {formatCurrency(menu.price_cents)}
          </div>
        </div>

        <div
          style={{
            borderTop: "8px solid #F3EEE4",
            padding: "14px 16px 18px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--ink-3)",
              marginBottom: 10,
            }}
          >
            Incluye
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {menu.components
              .filter((c) => c.kind !== "choice")
              .map((c, idx) => (
                <li
                  key={c.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    paddingBottom: 12,
                    borderBottom: "1px solid var(--hairline)",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: 99,
                      background: "#FFF0CF",
                      color: "#8A5E18",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {c.kind === "product" ? "✓" : idx + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      {c.kind === "product" && c.product_name
                        ? `${c.label}: ${c.product_name}`
                        : c.label}
                    </div>
                    {c.description && (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "var(--ink-2)",
                          marginTop: 2,
                          lineHeight: 1.4,
                        }}
                      >
                        {c.description}
                      </div>
                    )}
                  </div>
                </li>
              ))}
          </ul>

          {visibleGroups.map((group) => {
            const selected = selections.get(group.choice_group_id);
            return (
              <div key={group.choice_group_id} style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: "#8A5E18",
                    marginBottom: 8,
                  }}
                >
                  {group.label}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {group.options.map((opt) => {
                    const isSelected = selected?.product_id === opt.product_id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelect(group, opt)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: isSelected
                            ? "2px solid var(--accent)"
                            : "1px solid var(--hairline-2)",
                          background: isSelected
                            ? "rgba(var(--accent-rgb, 0,0,0), 0.04)"
                            : "var(--bg)",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 99,
                            border: isSelected
                              ? "6px solid var(--accent)"
                              : "2px solid var(--hairline-2)",
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: isSelected ? 600 : 400,
                            color: "var(--ink)",
                            flex: 1,
                          }}
                        >
                          {opt.product_name ?? opt.label}
                        </span>
                        {opt.extra_price_cents > 0 && (
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--ink-2)",
                              flexShrink: 0,
                            }}
                          >
                            +{formatCurrency(opt.extra_price_cents)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ height: 12 }} />
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
          disabled={disabled || !allChoicesResolved}
          onClick={handleAdd}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 99,
            background:
              disabled || !allChoicesResolved ? "#D8CFC0" : "var(--accent)",
            color: "#fff",
            border: "none",
            cursor: disabled || !allChoicesResolved ? "not-allowed" : "pointer",
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

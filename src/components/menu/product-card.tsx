"use client";

import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

import { I, ImageTile } from "@/components/delivery/primitives";
import { EASE_OUT, springPop, staggerDelay } from "@/components/motion/presets";
import { formatCurrency } from "@/lib/currency";
import type { MenuProduct } from "@/lib/menu";

export function ProductCard({
  product,
  cartQty,
  disabled,
  onSelect,
  index = 0,
  animateIn = false,
}: {
  product: MenuProduct;
  cartQty: number;
  disabled?: boolean;
  onSelect: (product: MenuProduct) => void;
  /** Posición en la lista, para escalonar la entrada. */
  index?: number;
  /** Entrar animada (al cambiar de categoría). La primera carga no anima acá. */
  animateIn?: boolean;
}) {
  const soldOut = !product.is_available;
  const interactive = !soldOut && !disabled;
  return (
    <m.button
      type="button"
      className="m-tap-row"
      onClick={() => interactive && onSelect(product)}
      disabled={!interactive}
      initial={animateIn ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: soldOut ? 0.55 : 1, y: 0 }}
      transition={{
        duration: 0.36,
        ease: EASE_OUT,
        delay: staggerDelay(index),
      }}
      style={{
        width: "100%",
        display: "flex",
        gap: 12,
        padding: "14px 16px",
        background: "none",
        border: "none",
        borderBottom: "1px solid var(--hairline)",
        cursor: interactive ? "pointer" : "not-allowed",
        textAlign: "left",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: -0.1,
            marginBottom: 3,
            textDecoration: soldOut ? "line-through" : "none",
          }}
        >
          {product.name}
        </div>
        {product.description && (
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              marginBottom: 8,
            }}
          >
            {product.description}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 300, color: "var(--ink)" }}>
            {formatCurrency(product.price_cents)}
          </span>
          {soldOut && (
            <span
              style={{
                fontSize: 11,
                padding: "2px 7px",
                borderRadius: 4,
                background: "#EEE8DC",
                color: "#8A7B5E",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              No disponible
            </span>
          )}
        </div>
      </div>
      {(product.image_url || interactive) && (
        <div style={{ position: "relative", flexShrink: 0 }}>
          {product.image_url && (
            <ImageTile
              src={product.image_url}
              alt={product.name}
              tone="#D9C9A8"
              sizes="88px"
              style={{ width: 88, height: 88 }}
            />
          )}
          {interactive && (
            <div
              style={{
                position: product.image_url ? "absolute" : "static",
                right: -6,
                bottom: -6,
                width: 32,
                height: 32,
                borderRadius: 99,
                background: "#fff",
                border: "1px solid var(--hairline-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Al sumar al pedido el «+» se convierte en la cantidad con un
                  pop: la confirmación de que el plato quedó cargado. */}
              <AnimatePresence mode="popLayout" initial={false}>
                <m.span
                  key={cartQty > 0 ? `qty-${cartQty}` : "plus"}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{
                    scale: 0.4,
                    opacity: 0,
                    transition: { duration: 0.12 },
                  }}
                  transition={springPop}
                  style={{
                    display: "flex",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--ink)",
                  }}
                >
                  {cartQty > 0 ? cartQty : I.plus("var(--ink)", 16)}
                </m.span>
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </m.button>
  );
}

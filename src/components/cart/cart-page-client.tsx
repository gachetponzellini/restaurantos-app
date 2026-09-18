"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

import { I, ImageTile } from "@/components/delivery/primitives";
import { AnimatedValue } from "@/components/motion/animated-value";
import { EASE_IN, EASE_OUT } from "@/components/motion/presets";
import { formatCurrency } from "@/lib/currency";
import { copyDeEntrega } from "@/lib/orders/entrega-por-lote";
import { cartItemSubtotal, cartTotal, useCart } from "@/stores/cart";

export function CartPageClient({
  slug,
  businessName,
  deliveryFeeCents,
  minOrderCents,
}: {
  slug: string;
  businessName: string;
  deliveryFeeCents: number;
  minOrderCents: number;
}) {
  const router = useRouter();
  const items = useCart(slug, (s) => s.items);
  const updateQuantity = useCart(slug, (s) => s.updateQuantity);

  // Spec 194 — si el negocio reparte sólo adentro del barrio, se avisa acá
  // también: el que arma el carrito lo lee antes de llegar al checkout.
  const avisoDeEntrega = copyDeEntrega(slug).aviso;

  const subtotal = cartTotal(items);
  const isEmpty = items.length === 0;
  const underMin = !isEmpty && minOrderCents > 0 && subtotal < minOrderCents;
  const missing = Math.max(0, minOrderCents - subtotal);
  const total = subtotal;

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        paddingBottom: isEmpty ? 0 : 110,
      }}
    >
      <div
        style={{
          paddingTop: 16,
          paddingBottom: 10,
          paddingLeft: 8,
          paddingRight: 8,
          display: "flex",
          alignItems: "center",
          gap: 4,
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <button
          onClick={() => router.push(`/${slug}/menu`)}
          aria-label="Volver"
          style={{
            width: 40,
            height: 40,
            border: "none",
            background: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {I.chevLeft("var(--ink)", 22)}
        </button>
        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: -0.1,
            }}
          >
            Mi pedido
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {businessName}
          </div>
        </div>
      </div>

      {isEmpty ? (
        <div
          className="m-rise"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 99,
              background: "#F1EBDF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            {I.bag("var(--ink-3)", 28)}
          </div>
          <div
            className="d-display"
            style={{
              fontSize: 22,
              color: "var(--ink)",
              marginBottom: 6,
            }}
          >
            Todavía no agregaste nada
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              maxWidth: 240,
              lineHeight: 1.4,
            }}
          >
            Volvé al menú y elegí lo que se te antoje.
          </div>
          <Link
            href={`/${slug}/menu`}
            style={{
              marginTop: 24,
              height: 44,
              padding: "0 20px",
              borderRadius: 99,
              background: "var(--ink)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              textDecoration: "none",
            }}
          >
            Ver menú
          </Link>
        </div>
      ) : (
        <>
          <div
            className="m-rise"
            style={{ flex: 1, ["--m-delay" as string]: "60ms" }}
          >
            {/* Quitar un ítem lo pliega en vez de hacerlo desaparecer: el resto
                de la lista sube acompañando, no salta. */}
            <AnimatePresence initial={false}>
              {items.map((it) => (
                <m.div
                  key={it.id}
                  exit={{
                    opacity: 0,
                    height: 0,
                    paddingTop: 0,
                    paddingBottom: 0,
                    transition: {
                      opacity: { duration: 0.14, ease: EASE_IN },
                      default: { duration: 0.3, ease: EASE_OUT },
                    },
                  }}
                  style={{
                    overflow: "hidden",
                    display: "flex",
                    gap: 12,
                    padding: "14px 16px",
                    borderBottom: "1px solid var(--hairline)",
                  }}
                >
                  {it.image_url && (
                    <ImageTile
                      src={it.image_url}
                      alt={it.product_name}
                      tone="#D9C9A8"
                      sizes="56px"
                      style={{ width: 56, height: 56, flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--ink)",
                        }}
                      >
                        {it.product_name}
                      </div>
                      {it.kind === "daily_menu" && (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "#FFF0CF",
                            color: "#8A5E18",
                          }}
                        >
                          Menú del día
                        </span>
                      )}
                    </div>
                    {it.kind === "daily_menu" && it.components_snapshot && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--ink-3)",
                          marginTop: 2,
                          lineHeight: 1.4,
                        }}
                      >
                        {it.components_snapshot.map((c) => c.label).join(" · ")}
                      </div>
                    )}
                    {it.modifiers.length > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ink-3)",
                          marginTop: 2,
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                        }}
                      >
                        {it.modifiers.map((m) => m.name).join(" · ")}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-3)",
                        marginTop: 2,
                      }}
                    >
                      {formatCurrency(
                        it.unit_price_cents +
                          it.modifiers.reduce(
                            (a, m) => a + m.price_delta_cents,
                            0,
                          ),
                      )}{" "}
                      c/u
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        marginTop: 8,
                        height: 30,
                        border: "1px solid var(--hairline-2)",
                        borderRadius: 99,
                        width: "fit-content",
                        background: "#fff",
                      }}
                    >
                      <button
                        onClick={() => updateQuantity(it.id, it.quantity - 1)}
                        aria-label="Menos"
                        style={{
                          width: 32,
                          height: 28,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {I.minus("var(--ink)", 14)}
                      </button>
                      <span
                        style={{
                          minWidth: 18,
                          textAlign: "center",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        <AnimatedValue value={it.quantity} />
                      </span>
                      <button
                        onClick={() => updateQuantity(it.id, it.quantity + 1)}
                        aria-label="Más"
                        style={{
                          width: 32,
                          height: 28,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {I.plus("var(--ink)", 14)}
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    <AnimatedValue value={cartItemSubtotal(it)}>
                      {formatCurrency(cartItemSubtotal(it))}
                    </AnimatedValue>
                  </div>
                </m.div>
              ))}
            </AnimatePresence>

            <Link
              href={`/${slug}/menu`}
              style={{
                width: "100%",
                padding: "14px 16px",
                background: "none",
                borderBottom: "1px solid var(--hairline)",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "var(--accent)",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              {I.plus("var(--accent)", 16)} Agregar más
            </Link>

            <div style={{ padding: "16px 16px 20px" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: "var(--ink-3)",
                  marginBottom: 10,
                }}
              >
                Resumen
              </div>
              <Row label="Subtotal" value={formatCurrency(subtotal)} />
              <Row
                label="Envío (delivery)"
                value={
                  deliveryFeeCents > 0
                    ? formatCurrency(deliveryFeeCents)
                    : "Bonificado"
                }
                muted
              />
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  marginTop: 2,
                  marginBottom: 2,
                }}
              >
                {deliveryFeeCents > 0
                  ? "Retiro en local sin cargo. El envío se suma si elegís delivery."
                  : "Retiro en local o delivery sin cargo."}
                {avisoDeEntrega ? ` ${avisoDeEntrega}` : ""}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  paddingTop: 10,
                  marginTop: 6,
                  borderTop: "1px solid var(--hairline)",
                }}
              >
                <span
                  style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}
                >
                  Total
                </span>
                <AnimatedValue
                  value={total}
                  style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}
                >
                  {formatCurrency(total)}
                </AnimatedValue>
              </div>
            </div>

            {underMin && (
              <div
                style={{
                  margin: "0 16px 16px",
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "#F6EEE4",
                  border: "1px solid #EADFCB",
                  fontSize: 13,
                  color: "#6D5838",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Te faltan {formatCurrency(missing)} para el pedido mínimo
                </div>
                <div
                  style={{
                    height: 6,
                    background: "#EADFCB",
                    borderRadius: 99,
                    overflow: "hidden",
                    marginTop: 8,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, (subtotal / minOrderCents) * 100)}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              position: "fixed",
              left: 12,
              right: 12,
              bottom: 20,
              zIndex: 20,
              maxWidth: 496,
              margin: "0 auto",
            }}
          >
            <Link
              className="m-press"
              href={underMin ? "#" : `/${slug}/checkout`}
              onClick={(e) => underMin && e.preventDefault()}
              aria-disabled={underMin}
              style={{
                width: "100%",
                height: 56,
                borderRadius: 14,
                background: underMin ? "#D8CFC0" : "var(--accent)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 18px",
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: -0.1,
                textDecoration: "none",
                cursor: underMin ? "not-allowed" : "pointer",
              }}
            >
              <span>
                {underMin ? `Faltan ${formatCurrency(missing)}` : "Ir a pagar"}
              </span>
              <AnimatedValue value={total}>
                {formatCurrency(total)}
              </AnimatedValue>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 14,
        color: muted ? "var(--ink-2)" : "var(--ink)",
        padding: "4px 0",
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

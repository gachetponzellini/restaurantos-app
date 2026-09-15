"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import { toast } from "sonner";

import { I } from "@/components/delivery/primitives";
import {
  minutosEstimados,
  ventanaEstimadaLabel,
} from "@/lib/orders/entrega-estimada";
import { formatCurrency } from "@/lib/currency";
import { copyDeEntrega } from "@/lib/orders/entrega-por-lote";
import { createOrder } from "@/lib/orders/create-order";
import {
  filterSlotsByLead,
  localYmd,
  SCHEDULED_MIN_LEAD_MIN,
} from "@/lib/orders/scheduled";
import { previewPromoCode } from "@/lib/promos/preview-action";
import { cartTotal, useCart } from "@/stores/cart";

type PaymentId = "mp" | "cash" | "pickup-cash";
type When = "now" | "scheduled";

export function CheckoutForm({
  slug,
  businessName,
  businessAddress,
  businessTimezone,
  todaySlots = [],
  deliveryFeeCents,
  estimatedMinutes,
  estimatedPickupMinutes = null,
  savedAddresses = [],
  mpEnabled = false,
  initialName = "",
  initialEmail = "",
  initialPhone = "",
  initialPromo,
}: {
  slug: string;
  businessName: string;
  businessAddress: string | null;
  businessTimezone: string;
  /**
   * Horarios (HH:MM) que la grilla de reservas abre HOY — los mismos chips que
   * ve el que reserva (spec 064). Vacío = hoy no se puede programar.
   */
  todaySlots?: string[];
  deliveryFeeCents: number;
  /** Piso del estimado de envío (spec 133). Null = default del producto. */
  estimatedMinutes: number | null;
  /** Piso del estimado de retiro. Null = default del producto. */
  estimatedPickupMinutes?: number | null;
  savedAddresses?: { id: string; street: string }[];
  mpEnabled?: boolean;
  initialName?: string;
  initialEmail?: string;
  initialPhone?: string;
  initialPromo?: {
    code: string;
    discount_cents: number;
    free_shipping: boolean;
  };
}) {
  const router = useRouter();
  const items = useCart(slug, (s) => s.items);
  const clearCart = useCart(slug, (s) => s.clear);
  const [submitting, setSubmitting] = useState(false);

  // Spec 194 — dónde entregar depende del negocio: kcc reparte sólo adentro
  // del barrio y pide el número de lote, no una calle.
  const entrega = copyDeEntrega(slug);

  const [mode, setMode] = useState<"delivery" | "pickup">("delivery");
  const [address, setAddress] = useState("");
  const [apt, setApt] = useState("");
  // Spec 133 — el estimado sale de la config del negocio, y es una ventana:
  // «1 h – 1 h 30», no «40 min» clavados. Tres lugares lo muestran y ahora los
  // tres dicen lo mismo, según lo que el cliente eligió.
  const estimadoEnvio = ventanaEstimadaLabel(
    minutosEstimados("delivery", { estimated_delivery_minutes: estimatedMinutes }),
  );
  const estimadoRetiro = ventanaEstimadaLabel(
    minutosEstimados("pickup", { estimated_pickup_minutes: estimatedPickupMinutes }),
  );
  const estimadoModo = mode === "delivery" ? estimadoEnvio : estimadoRetiro;

  const [notes, setNotes] = useState("");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [email] = useState(initialEmail);
  const [payment, setPayment] = useState<PaymentId>(mpEnabled ? "mp" : "cash");
  // Pedido diferido (spec 31 + 061 + 064): "¿para cuándo?" → ahora / programar.
  // Retiro y delivery, con cualquier método de pago, pero **sólo para hoy** y
  // eligiendo uno de los horarios de la grilla del local.
  const [when, setWhen] = useState<When>("now");
  const [schedSlot, setSchedSlot] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [errors, setErrors] = useState<{
    address?: string;
    phone?: string;
    name?: string;
  }>({});

  // ── Promo code state ────────────────────────────────────────────────────
  // The customer types a code, presses "Aplicar" → server validates and
  // returns the discount preview. The `applied` value is what we send to
  // createOrder; the server re-validates atomically on submit.
  const [promoInput, setPromoInput] = useState(initialPromo?.code ?? "");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discount_cents: number;
    free_shipping: boolean;
  } | null>(initialPromo ?? null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const isPickup = mode === "pickup";
  // Programar ya no depende del método de pago (spec 061): el resguardo contra
  // el pedido fantasma es que el encargado acepte los impagos antes de que
  // entren a cocina, no cobrar por adelantado.
  const isScheduled = when === "scheduled";
  const subtotal = cartTotal(items);
  const baseDeliveryFee = isPickup ? 0 : deliveryFeeCents;
  // free_shipping: el descuento se "absorbe" haciendo el envío 0
  const deliveryFee =
    appliedPromo?.free_shipping && !isPickup ? 0 : baseDeliveryFee;
  // Para el resto de tipos de descuento, restamos del total
  const discount =
    appliedPromo && !appliedPromo.free_shipping
      ? appliedPromo.discount_cents
      : 0;
  const total = Math.max(0, subtotal + deliveryFee - discount);

  const checkPromo = async () => {
    const code = promoInput.trim();
    if (!code) {
      setPromoError("Ingresá un código.");
      return;
    }
    setPromoChecking(true);
    setPromoError(null);
    const result = await previewPromoCode({
      business_slug: slug,
      code,
      subtotal_cents: subtotal,
      delivery_fee_cents: baseDeliveryFee,
    });
    setPromoChecking(false);
    if (!result.ok) {
      setAppliedPromo(null);
      setPromoError(result.error);
      return;
    }
    setAppliedPromo(result.data);
    setPromoInput(result.data.code);
  };

  const removePromo = () => {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError(null);
  };

  // Re-validate when subtotal/delivery changes (item added/removed) so
  // free_shipping or min_order rules stay correct.
  useEffect(() => {
    if (!appliedPromo) return;
    let cancelled = false;
    (async () => {
      const result = await previewPromoCode({
        business_slug: slug,
        code: appliedPromo.code,
        subtotal_cents: subtotal,
        delivery_fee_cents: baseDeliveryFee,
      });
      if (cancelled) return;
      if (!result.ok) {
        setAppliedPromo(null);
        setPromoError(result.error);
      } else {
        setAppliedPromo(result.data);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, baseDeliveryFee]);

  useEffect(() => {
    if (isPickup && payment === "cash") setPayment("pickup-cash");
    else if (!isPickup && payment === "pickup-cash") setPayment("cash");
  }, [isPickup, payment]);

  // Chips de horario: los de hoy que todavía cumplen la anticipación mínima.
  // Se calculan en el cliente (dependen de "ahora"), pero sólo se renderizan
  // después de que el usuario toca "Programar" → sin riesgo de mismatch de
  // hidratación. El server revalida en persist-order.
  const availableSlots = useMemo(
    () => filterSlotsByLead(todaySlots, businessTimezone),
    [todaySlots, businessTimezone],
  );
  const canSchedule = todaySlots.length > 0;

  // Programar ya no restringe el método de pago (spec 061): las opciones son
  // siempre las mismas.
  const paymentOptions: { id: PaymentId; label: string; sub: string }[] = [
    ...(mpEnabled
      ? [
          {
            id: "mp" as const,
            label: "Mercado Pago",
            sub: "Pagás ahora desde la app",
          },
        ]
      : []),
    isPickup
      ? {
          id: "pickup-cash" as const,
          label: "Efectivo al retirar",
          sub: "Pagás en el local",
        }
      : {
          id: "cash" as const,
          label: "Efectivo al recibir",
          sub: "Indicá con cuánto abonás",
        },
  ];

  const phoneOk = /^\+?[\d\s-]{8,}$/.test(phone);

  const submit = async () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Ingresá tu nombre.";
    if (!phoneOk) next.phone = "Teléfono inválido.";
    if (!isPickup && address.trim().length < entrega.minChars) {
      next.address = entrega.error;
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    if (items.length === 0) {
      toast.error("Tu carrito está vacío.");
      return;
    }

    // Pedido diferido (spec 31 + 064): el horario es un chip de la grilla de
    // hoy. Armamos el instante en el TZ del local; persist-order revalida.
    let scheduledAtIso: string | undefined;
    if (isScheduled) {
      if (!schedSlot) {
        toast.error(
          isPickup
            ? "Elegí la hora del retiro."
            : "Elegí la hora de la entrega.",
        );
        return;
      }
      // El chip pudo quedar viejo si el cliente tardó: revalidamos contra la
      // anticipación mínima antes de mandar.
      if (!filterSlotsByLead(todaySlots, businessTimezone).includes(schedSlot)) {
        setSchedSlot(null);
        toast.error("Ese horario ya no está disponible. Elegí otro.");
        return;
      }
      const dt = fromZonedTime(
        `${localYmd(new Date(), businessTimezone)}T${schedSlot}:00`,
        businessTimezone,
      );
      scheduledAtIso = dt.toISOString();
    }

    setSubmitting(true);
    const result = await createOrder({
      business_slug: slug,
      delivery_type: mode,
      customer_name: name.trim(),
      customer_phone: phone.trim(),
      customer_email: email.trim() || undefined,
      delivery_address: isPickup
        ? undefined
        : `${address.trim()}${apt.trim() ? ` · ${apt.trim()}` : ""}`,
      delivery_notes: notes.trim() || undefined,
      payment_method: payment === "mp" ? "mp" : "cash",
      scheduled_at: scheduledAtIso,
      promo_code: appliedPromo?.code,
      items: items.map((i) =>
        i.kind === "daily_menu" && i.daily_menu_id
          ? {
              kind: "daily_menu" as const,
              daily_menu_id: i.daily_menu_id,
              quantity: i.quantity,
              notes: i.notes,
              // Opciones elegidas del combo. El server deriva el adicional
              // (spec 29) desde la DB; acá sólo informamos QUÉ se eligió.
              selected_choices: (i.selected_choices ?? []).map((sc) => ({
                choice_group_id: sc.choice_group_id,
                choice_group_label: sc.choice_group_label,
                product_id: sc.product_id,
                product_name: sc.product_name,
                modifier_ids: sc.modifiers.map((m) => m.modifier_id),
              })),
            }
          : {
              // Back-compat: ítems sin kind se tratan como producto normal.
              product_id: i.product_id as string,
              quantity: i.quantity,
              notes: i.notes,
              modifier_ids: i.modifiers.map((m) => m.modifier_id),
            },
      ),
    });
    if (!result.ok) {
      toast.error(result.error);
      setSubmitting(false);
      return;
    }
    // Success: keep `submitting` true so the transitional UI (spinner) stays
    // visible until navigation completes. Otherwise clearing the cart would
    // flip items to empty and briefly show the "carrito vacío" state.
    clearCart();
    if (result.data.mp_init_point) {
      window.location.href = result.data.mp_init_point;
      return;
    }
    router.push(`/${slug}/confirmacion/${result.data.order_id}`);
  };

  if (items.length === 0) {
    // Transitional state after a successful order: cart was just cleared but
    // navigation to /confirmacion or MP is still in flight. Show a spinner
    // instead of the "carrito vacío" emptiness — it reads as progress.
    if (submitting) {
      return (
        <div
          style={{
            maxWidth: 520,
            margin: "0 auto",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink-2)",
            padding: 32,
            gap: 16,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              border: "3px solid var(--hairline)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <div style={{ fontSize: 14 }}>Procesando tu pedido…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      );
    }
    // True empty state — user landed on /checkout with nothing in cart.
    return (
      <div
        style={{
          maxWidth: 520,
          margin: "0 auto",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 18,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 99,
            background: "var(--hairline)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {I.bag("var(--ink-2)", 24)}
        </div>
        <div>
          <div
            className="d-display"
            style={{ fontSize: 24, color: "var(--ink)", lineHeight: 1.1 }}
          >
            Nada en el carrito
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              marginTop: 6,
              maxWidth: 260,
            }}
          >
            Volvé al menú para elegir qué pedir.
          </div>
        </div>
        <Link
          href={`/${slug}/menu`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 44,
            padding: "0 20px",
            borderRadius: 12,
            background: "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Ver el menú
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        paddingBottom: 110,
      }}
    >
      {/* Header */}
      <div
        style={{
          paddingTop: 16,
          paddingBottom: 10,
          paddingLeft: 8,
          paddingRight: 16,
          display: "flex",
          alignItems: "center",
          gap: 4,
          borderBottom: "1px solid var(--hairline)",
          background: "var(--bg)",
        }}
      >
        <button
          onClick={() => router.back()}
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
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.1 }}>
          Finalizar pedido
        </div>
      </div>

      {/* Collapsible summary */}
      <button
        onClick={() => setSummaryOpen(!summaryOpen)}
        style={{
          width: "100%",
          padding: "14px 16px",
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--hairline)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 99,
              background: "#F1EBDF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {I.bag("var(--ink-2)", 14)}
          </span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            {items.length} ítems · {formatCurrency(total)}
          </span>
        </span>
        <span
          style={{
            transform: summaryOpen ? "rotate(180deg)" : "none",
            transition: "transform 200ms",
          }}
        >
          {I.chevDown("var(--ink-3)", 16)}
        </span>
      </button>
      {summaryOpen && (
        <div
          style={{
            padding: "4px 16px 16px",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          {items.map((it) => (
            <div
              key={it.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 0",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <span>
                {it.quantity}× {it.product_name}
              </span>
              <span>
                {formatCurrency(
                  (it.unit_price_cents +
                    it.modifiers.reduce((a, m) => a + m.price_delta_cents, 0)) *
                    it.quantity,
                )}
              </span>
            </div>
          ))}
          <SummaryRow label="Subtotal" value={formatCurrency(subtotal)} muted />
          <SummaryRow
            label={isPickup ? "Retiro" : "Envío"}
            value={
              isPickup
                ? "Gratis"
                : appliedPromo?.free_shipping
                  ? "Gratis"
                  : deliveryFee === 0
                    ? "Bonificado"
                    : formatCurrency(deliveryFee)
            }
            muted
          />
          {appliedPromo && !appliedPromo.free_shipping && discount > 0 && (
            <SummaryRow
              label={`Cupón ${appliedPromo.code}`}
              value={`-${formatCurrency(discount)}`}
              muted
            />
          )}
          <SummaryRow label="Total" value={formatCurrency(total)} />
        </div>
      )}

      {/* Mode */}
      <Section title="¿Cómo lo recibís?">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 14,
          }}
        >
          {(
            [
              {
                id: "delivery",
                label: "Envío a domicilio",
                sub: estimadoEnvio,
              },
              { id: "pickup", label: "Retiro en el local", sub: estimadoRetiro },
            ] as const
          ).map((o) => {
            const sel = mode === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setMode(o.id)}
                style={{
                  padding: "14px 12px",
                  borderRadius: 12,
                  border: `1.5px solid ${sel ? "var(--accent)" : "var(--hairline-2)"}`,
                  background: sel ? "var(--accent-soft)" : "#fff",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
                >
                  {o.label}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}
                >
                  {o.sub}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      {!isPickup ? (
        <Section title="Entrega">
          {savedAddresses.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-2)",
                  marginBottom: 6,
                }}
              >
                {entrega.guardadasLabel}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                {savedAddresses.map((a) => {
                  const sel = address === a.street;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setAddress(a.street);
                        setApt("");
                      }}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 99,
                        border: `1px solid ${sel ? "var(--accent)" : "var(--hairline-2)"}`,
                        background: sel ? "var(--accent-soft)" : "#fff",
                        color: "var(--ink)",
                        fontSize: 12,
                        cursor: "pointer",
                        maxWidth: "100%",
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={a.street}
                    >
                      {a.street}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {entrega.aviso && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "10px 12px",
                marginBottom: 14,
                borderRadius: 10,
                background: "var(--accent-soft)",
                border: "1px solid var(--hairline-2)",
                fontSize: 12,
                lineHeight: 1.4,
                color: "var(--ink-2)",
              }}
            >
              <span aria-hidden>📍</span>
              <span>{entrega.aviso}</span>
            </div>
          )}
          <Field label={entrega.label} error={errors.address}>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={entrega.placeholder}
              autoComplete={entrega.porLote ? "off" : "street-address"}
              inputMode={entrega.porLote ? "numeric" : undefined}
              style={inputStyle(!!errors.address)}
            />
          </Field>
          {entrega.pidePisoDepto && (
            <Field label="Piso / depto (opcional)">
              <input
                value={apt}
                onChange={(e) => setApt(e.target.value)}
                placeholder="3° B"
                style={inputStyle()}
              />
            </Field>
          )}
          <Field label="Notas para el repartidor">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: timbre no funciona, llamar al celu"
              style={inputStyle()}
            />
          </Field>
        </Section>
      ) : (
        <Section title="Retirá en">
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              padding: "4px 0 14px",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                flexShrink: 0,
                background: "#E8D9BA",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {I.store("var(--ink)", 20)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {businessName}
              </div>
              {businessAddress && (
                <div
                  style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2 }}
                >
                  {businessAddress}
                </div>
              )}
              <div
                style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}
              >
                Listo en {estimadoRetiro}
              </div>
            </div>
          </div>
          <Field label="Notas (opcional)">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: pasame la cuenta cuando llegue"
              style={inputStyle()}
            />
          </Field>
        </Section>
      )}

      <Section title="¿Para cuándo?">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: isScheduled ? 14 : 4,
          }}
        >
          {(
            [
              { id: "now", label: "Lo antes posible", sub: estimadoModo },
              {
                id: "scheduled",
                label: "Programar",
                sub: canSchedule ? "Elegí una hora de hoy" : "No disponible hoy",
              },
            ] as const
          ).map((o) => {
            const sel = when === o.id;
            const disabled = o.id === "scheduled" && !canSchedule;
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => setWhen(o.id)}
                style={{
                  padding: "14px 12px",
                  borderRadius: 12,
                  border: `1.5px solid ${sel ? "var(--accent)" : "var(--hairline-2)"}`,
                  background: sel ? "var(--accent-soft)" : "#fff",
                  cursor: disabled ? "not-allowed" : "pointer",
                  textAlign: "left",
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
                >
                  {o.label}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}
                >
                  {o.sub}
                </div>
              </button>
            );
          })}
        </div>
        {isScheduled && (
          <>
            {availableSlots.length === 0 ? (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink-3)",
                  lineHeight: 1.4,
                }}
              >
                Ya no quedan horarios para hoy. Pedí «Lo antes posible».
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                  }}
                >
                  {availableSlots.map((slot) => {
                    const active = schedSlot === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setSchedSlot(slot)}
                        style={{
                          height: 48,
                          borderRadius: 12,
                          border: `1px solid ${active ? "var(--accent)" : "var(--hairline-2)"}`,
                          background: active ? "var(--accent)" : "#fff",
                          color: active ? "#fff" : "var(--ink)",
                          fontSize: 15,
                          fontWeight: 600,
                          letterSpacing: -0.1,
                          cursor: "pointer",
                          transition: "all 180ms",
                          fontFamily: "inherit",
                        }}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    lineHeight: 1.4,
                    marginTop: 10,
                  }}
                >
                  Solo para hoy, con al menos {SCHEDULED_MIN_LEAD_MIN} min de
                  anticipación.
                </div>
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Contacto">
        <Field label="Nombre" error={errors.name}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            style={inputStyle(!!errors.name)}
          />
        </Field>
        <Field label="Teléfono" error={errors.phone}>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="11 5555 5555"
            inputMode="tel"
            autoComplete="tel"
            style={inputStyle(!!errors.phone)}
          />
        </Field>
      </Section>

      <Section title="Cupón de descuento">
        {appliedPromo ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              background: "rgba(34, 197, 94, 0.08)",
              border: "1px solid rgba(34, 197, 94, 0.25)",
              borderRadius: 12,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: 999,
                background: "#16A34A",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
              }}
              aria-hidden
            >
              ✓
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#15803D",
                  fontFamily: "ui-monospace, monospace",
                  letterSpacing: 0.5,
                }}
              >
                {appliedPromo.code}
              </div>
              <div style={{ fontSize: 11, color: "#15803D", marginTop: 1 }}>
                {appliedPromo.free_shipping
                  ? "Envío gratis aplicado"
                  : `Te ahorrás ${formatCurrency(appliedPromo.discount_cents)}`}
              </div>
            </div>
            <button
              type="button"
              onClick={removePromo}
              style={{
                background: "none",
                border: "none",
                color: "#15803D",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              Quitar
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={promoInput}
                onChange={(e) =>
                  setPromoInput(e.target.value.toUpperCase().slice(0, 30))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    checkPromo();
                  }
                }}
                placeholder="Ej: VUELVE10"
                style={{
                  flex: 1,
                  height: 44,
                  padding: "0 14px",
                  border: "1px solid var(--hairline-2)",
                  borderRadius: 12,
                  fontSize: 14,
                  fontFamily: "ui-monospace, monospace",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  background: "#fff",
                  color: "var(--ink)",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={checkPromo}
                disabled={promoChecking || !promoInput.trim()}
                style={{
                  height: 44,
                  padding: "0 18px",
                  background: "var(--ink)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor:
                    promoChecking || !promoInput.trim()
                      ? "not-allowed"
                      : "pointer",
                  opacity: promoChecking || !promoInput.trim() ? 0.5 : 1,
                }}
              >
                {promoChecking ? "…" : "Aplicar"}
              </button>
            </div>
            {promoError && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "#DC2626",
                }}
              >
                {promoError}
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Método de pago">
        {paymentOptions.map((p) => (
          <button
            key={p.id}
            onClick={() => setPayment(p.id)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 0",
              background: "none",
              border: "none",
              borderBottom: "1px solid var(--hairline)",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 99,
                flexShrink: 0,
                border: `1.6px solid ${payment === p.id ? "var(--accent)" : "var(--hairline-2)"}`,
                background: payment === p.id ? "var(--accent)" : "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {payment === p.id && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: "#fff",
                  }}
                />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}
              >
                {p.label}
              </div>
              <div
                style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 1 }}
              >
                {p.sub}
              </div>
            </div>
          </button>
        ))}
      </Section>

      <div
        style={{
          padding: "12px 16px",
          fontSize: 11,
          color: "var(--ink-3)",
          textAlign: "center",
        }}
      >
        {isPickup ? `Retirás en ${businessName}` : `Pedido de ${businessName}`}
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
        <button
          disabled={submitting}
          onClick={submit}
          style={{
            width: "100%",
            height: 56,
            borderRadius: 14,
            background: submitting ? "#C7BBA6" : "var(--accent)",
            color: "#fff",
            border: "none",
            cursor: submitting ? "wait" : "pointer",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: -0.1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 18px",
          }}
        >
          <span>{submitting ? "Procesando…" : "Confirmar pedido"}</span>
          <span>{formatCurrency(total)}</span>
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "18px 16px 4px",
        borderBottom: "8px solid #F3EEE4",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 6 }}>
        {label}
      </div>
      {children}
      {error && (
        <div style={{ fontSize: 12, color: "#B94A2A", marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function SummaryRow({
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

function inputStyle(err?: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 14px",
    borderRadius: 10,
    border: `1px solid ${err ? "#E0A898" : "var(--hairline-2)"}`,
    background: "#fff",
    fontSize: 15,
    color: "var(--ink)",
    outline: "none",
    boxSizing: "border-box",
  };
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { I } from "@/components/delivery/primitives";
import { confirmReservationFromIntent } from "@/lib/reservations/chatbot-confirm-action";

type Intent = {
  date: string;
  slot: string;
  party_size: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  notes?: string | null;
};

type Props = {
  slug: string;
  token: string;
  businessName: string;
  logoUrl: string | null;
  intent: Intent;
  /** «mié 7 de oct · 21:00 hs», ya en la TZ del negocio (H-30). */
  whenLabel: string;
  /** «mié 7 de oct». */
  dayLabel: string;
  prefillName: string | null;
  prefillPhone: string | null;
};

/**
 * Confirmation screen reached after the chatbot generated a reservation
 * intent token. The customer logged in upstream (page.tsx), so here we
 * only show the suggested reservation, let them tweak name/phone/notes,
 * and submit through the canonical reservation creator via the server
 * action `confirmReservationFromIntent`.
 *
 * Visual language mirrors the order-tracking / reservation confirmation
 * screens (see wiki/features/reservas.md): big display headline, divider,
 * tonal sticky footer with the CTA.
 */
export function ConfirmReservationFromIntent({
  slug,
  token,
  businessName,
  logoUrl,
  intent,
  whenLabel,
  dayLabel,
  prefillName,
  prefillPhone,
  // notes are intentionally re-shown editable even if the chatbot pre-filled
  // them — the customer is the final author here.
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(prefillName ?? "");
  const [phone, setPhone] = useState(prefillPhone ?? "");
  const [notes, setNotes] = useState(intent.notes ?? "");
  const [pending, startTransition] = useTransition();

  const timeLabel = intent.slot;

  function onSubmit() {
    if (!name.trim() || !phone.trim()) {
      toast.error("Necesitamos nombre y teléfono.");
      return;
    }
    startTransition(async () => {
      const result = await confirmReservationFromIntent({
        business_slug: slug,
        token,
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        notes: notes.trim() || undefined,
      });
      if (result.ok) {
        router.push(`/${slug}/reservar/confirmacion?id=${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
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
      {/* Header con back + título */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <Link
          href={`/${slug}`}
          aria-label="Volver"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "1px solid var(--hairline-2)",
            color: "var(--ink)",
            textDecoration: "none",
          }}
        >
          {I.chevLeft("var(--ink)", 22)}
        </Link>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ink)",
            flex: 1,
          }}
        >
          Confirmá tu reserva
        </div>
      </div>

      {/* Headline display (estilo order-tracking) */}
      <div
        style={{
          padding: "20px 16px 22px",
          borderBottom: "8px solid var(--hairline)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--primary)",
            marginBottom: 6,
          }}
        >
          Sugerida por el chat
        </div>
        <div
          className="d-display"
          style={{ fontSize: 38, lineHeight: 1.05, color: "var(--ink)" }}
        >
          {whenLabel}
        </div>
        <div style={{ marginTop: 6, fontSize: 14, color: "var(--ink-2)" }}>
          {intent.party_size}{" "}
          {intent.party_size === 1 ? "persona" : "personas"} en {businessName}
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          padding: "14px 16px",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <Stat label="Día" value={dayLabel} />
        <Stat label="Hora" value={timeLabel} />
        <Stat label="Personas" value={String(intent.party_size)} />
      </div>

      {/* Datos editables */}
      <Section label="Tus datos">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field
            id="r-name"
            label="Nombre"
            value={name}
            onChange={setName}
            maxLength={80}
            placeholder="Nombre completo"
            autoComplete="name"
          />
          <Field
            id="r-phone"
            label="Teléfono"
            value={phone}
            onChange={setPhone}
            maxLength={40}
            placeholder="+54 9 11 …"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
          <Field
            id="r-notes"
            label="Notas (opcional)"
            value={notes}
            onChange={setNotes}
            maxLength={500}
            multiline
            placeholder="Cumpleaños, alergias, preferencias…"
          />
        </div>
      </Section>

      {logoUrl ? null : null}

      {/* Sticky CTA */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 30,
          background: "var(--bg)",
          borderTop: "1px solid var(--hairline)",
        }}
      >
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "12px 16px" }}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending || !name.trim() || !phone.trim()}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 14,
              border: "none",
              background:
                pending || !name.trim() || !phone.trim()
                  ? "var(--hairline-2)"
                  : "var(--primary)",
              color:
                pending || !name.trim() || !phone.trim()
                  ? "var(--ink-3)"
                  : "var(--primary-foreground)",
              fontSize: 15,
              fontWeight: 600,
              cursor:
                pending || !name.trim() || !phone.trim() ? "default" : "pointer",
            }}
          >
            {pending ? "Confirmando…" : "Confirmar reserva"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "var(--ink-3)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 14, color: "var(--ink)" }}>{value}</span>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "16px 16px 18px",
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--ink-3)",
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  multiline,
  type,
  inputMode,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
  multiline?: boolean;
  type?: "text" | "tel";
  inputMode?: "tel";
  autoComplete?: string;
}) {
  const baseStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--hairline-2)",
    background: "var(--bg)",
    color: "var(--ink)",
    // H-23: ≥16px para que iOS no haga zoom al enfocar.
    fontSize: 16,
    outline: "none",
    fontFamily: "inherit",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={id}
        style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          rows={3}
          placeholder={placeholder}
          style={{ ...baseStyle, resize: "vertical" }}
        />
      ) : (
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          style={baseStyle}
        />
      )}
    </div>
  );
}

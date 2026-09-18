"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { toast } from "sonner";

import { I, ImageTile } from "@/components/delivery/primitives";
import { AnimatedValue } from "@/components/motion/animated-value";
import { EASE_DRAWER, EASE_IN } from "@/components/motion/presets";
import { GuestPolicyNotice } from "@/components/reservations/guest-policy-notice";
import {
  fetchAvailability,
  fetchFlexibleAvailability,
} from "@/lib/reservations/availability-actions";
import { arrivalSlots } from "@/lib/reservations/flexible-availability";
import { buildLargeGroupWhatsappLink } from "@/lib/reservations/whatsapp-link";
import {
  createFlexibleReservation,
  createReservationFromCustomer,
} from "@/lib/reservations/booking-actions";
import type {
  ReservationMode,
  ReservationService,
  ReservationSettings,
} from "@/lib/reservations/types";

type Slot = { slot: string; starts_at: string; ends_at: string };

type Salon = { id: string; name: string };

type Props = {
  slug: string;
  businessName: string;
  tagline: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  settings: Pick<
    ReservationSettings,
    "advance_days_max" | "max_party_size" | "slot_duration_min" | "schedule"
  >;
  salones: Salon[];
  mode: ReservationMode;
  services: ReservationService[];
  /** Spec 080 — `businesses.phone`, para el botón del aviso de invitados. */
  businessPhone: string | null;
  user: {
    isLoggedIn: boolean;
    name: string | null;
    phone: string | null;
    email: string | null;
  };
};

/* ─── helpers ─────────────────────────────────────────────────────────── */

function todayInTz(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function maxDate(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function buildDateStrip(min: string, maxDays: number) {
  const out: { iso: string; weekday: string; day: number; month: string }[] =
    [];
  const [y, m, d] = min.split("-").map(Number);
  for (let i = 0; i < Math.min(maxDays + 1, 14); i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const iso = dt.toISOString().slice(0, 10);
    const weekday = new Intl.DateTimeFormat("es-AR", {
      weekday: "short",
      timeZone: "UTC",
    }).format(dt);
    const month = new Intl.DateTimeFormat("es-AR", {
      month: "short",
      timeZone: "UTC",
    }).format(dt);
    out.push({
      iso,
      weekday: weekday.replace(".", ""),
      day: dt.getUTCDate(),
      month: month.replace(".", ""),
    });
  }
  return out;
}

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dt);
}

function groupSlotsByService(slots: Slot[]) {
  const lunch: Slot[] = [];
  const dinner: Slot[] = [];
  for (const s of slots) {
    const hour = Number(s.slot.slice(0, 2));
    if (hour < 17) lunch.push(s);
    else dinner.push(s);
  }
  return { lunch, dinner };
}

function getInitial(user: Props["user"]): string {
  const src = user.name ?? user.email ?? "";
  return (
    src
      .split(/\s+|[@.]/)
      .filter(Boolean)
      .slice(0, 1)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function getFirstName(user: Props["user"]): string {
  if (user.name) return user.name.split(" ")[0];
  if (user.email) return user.email.split("@")[0];
  return "Cuenta";
}

/* ─── component ───────────────────────────────────────────────────────── */

export function ReservarFlow({
  slug,
  businessName,
  tagline,
  coverImageUrl,
  logoUrl,
  settings,
  salones,
  mode,
  services,
  businessPhone,
  user,
}: Props) {
  const router = useRouter();
  const isFlexible = mode === "flexible";
  const multiSalon = salones.length > 1;
  // Con un único salón (o ninguno), el flujo legacy se mantiene: no se
  // muestra picker y el server filtra por el primer floor_plan del negocio.
  // Con más de un salón forzamos al cliente a elegir antes de ver horarios.
  const [salonId, setSalonId] = useState<string | null>(
    multiSalon ? null : (salones[0]?.id ?? null),
  );
  const [date, setDate] = useState<string>(todayInTz());
  const [partySize, setPartySize] = useState<number>(2);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [, startSlotsTransition] = useTransition();
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  // Flexible (spec 059): servicio + hora de llegada opcional + mesa opcional.
  const [service, setService] = useState<string>("");
  const [arrivalTime, setArrivalTime] = useState<string>("");
  // Spec 077: veredicto de cupo del servicio (null = todavía sin consultar).
  const [flexAvail, setFlexAvail] = useState<{
    available: boolean;
    reason?: string;
  } | null>(null);
  const [loadingFlex, setLoadingFlex] = useState(false);
  // Se incrementa tras un rechazo del server para re-consultar el cupo.
  const [availReloadKey, setAvailReloadKey] = useState(0);
  const [name, setName] = useState(user.name ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);

  /**
   * Grupo grande: pasa el máximo que el negocio cierra solo. El flujo web se
   * corta acá — ni horarios ni formulario — y la reserva se coordina por
   * WhatsApp, que es lo que el local hace igual para juntar mesas.
   */
  const isLargeGroup = partySize > settings.max_party_size;

  const minDate = todayInTz();
  const maxDateStr = useMemo(
    () => maxDate(settings.advance_days_max),
    [settings.advance_days_max],
  );
  const dateStrip = useMemo(
    () => buildDateStrip(minDate, settings.advance_days_max),
    [minDate, settings.advance_days_max],
  );

  // Flexible: servicios aplicables a la fecha (día exacto o "todos los días").
  const serviceNames = useMemo(() => {
    if (!isFlexible) return [];
    const [y, m, d] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
    const applicable = services.filter(
      (s) => s.day_of_week == null || s.day_of_week === dow,
    );
    return Array.from(new Set(applicable.map((s) => s.name)));
  }, [isFlexible, services, date]);

  // Fila del servicio elegido (para su ventana horaria) + horarios de llegada.
  const selectedServiceRow = useMemo(() => {
    if (!isFlexible || !service) return null;
    const [y, m, d] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
    const matches = services.filter((s) => s.name === service);
    return (
      matches.find((s) => s.day_of_week === dow) ??
      matches.find((s) => s.day_of_week == null) ??
      matches[0] ??
      null
    );
  }, [isFlexible, services, service, date]);

  const arrivalOptions = useMemo(
    () =>
      selectedServiceRow
        ? arrivalSlots(
            selectedServiceRow.opens_at,
            selectedServiceRow.closes_at,
          )
        : [],
    [selectedServiceRow],
  );

  // Oculta los horarios ya pasados cuando la fecha elegida es hoy.
  const shownArrivalOptions = useMemo(() => {
    if (date !== todayInTz()) return arrivalOptions;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return arrivalOptions.filter((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m >= nowMin;
    });
  }, [arrivalOptions, date]);

  useEffect(() => {
    if (isFlexible) return;
    setSelectedSlot(null);
    // Sin salón elegido en modo multi-salón, no tiene sentido pegarle al
    // server: dejamos slots=null para mostrar el placeholder de "elegí salón".
    if ((multiSalon && !salonId) || isLargeGroup) {
      setSlots(null);
      setLoadingSlots(false);
      return;
    }
    setSlots(null);
    setLoadingSlots(true);
    const t = setTimeout(() => {
      startSlotsTransition(async () => {
        const result = await fetchAvailability({
          business_slug: slug,
          date,
          party_size: partySize,
          ...(salonId ? { floor_plan_id: salonId } : {}),
        });
        if (result.ok) setSlots(result.data);
        else setSlots([]);
        setLoadingSlots(false);
      });
    }, 120);
    return () => clearTimeout(t);
  }, [isFlexible, date, partySize, slug, salonId, multiSalon, isLargeGroup]);

  // Flexible: elegir el primer servicio disponible cuando cambia la lista.
  useEffect(() => {
    if (!isFlexible) return;
    if (serviceNames.length > 0 && !serviceNames.includes(service)) {
      setService(serviceNames[0]);
    }
  }, [isFlexible, serviceNames, service]);

  /**
   * Spec 077 — el cupo del servicio ahora frena al cliente. Antes esta pantalla
   * nunca consultaba disponibilidad en flexible: ofrecía toda la ventana del
   * servicio y el server aceptaba siempre, así que el local se enteraba del
   * overbooking cuando la gente llegaba.
   */
  useEffect(() => {
    if (!isFlexible || !service) {
      setFlexAvail(null);
      return;
    }
    if ((multiSalon && !salonId) || isLargeGroup) {
      setFlexAvail(null);
      setLoadingFlex(false);
      return;
    }
    setFlexAvail(null);
    setLoadingFlex(true);
    const t = setTimeout(() => {
      void (async () => {
        const result = await fetchFlexibleAvailability({
          business_slug: slug,
          date,
          service,
          party_size: partySize,
          enforce_capacity: true,
          ...(salonId ? { floor_plan_id: salonId } : {}),
        });
        setFlexAvail(
          result.ok
            ? { available: result.data.available, reason: result.data.reason }
            : // Servicio inexistente ese día (o error): tratarlo como sin lugar
              // es lo seguro — antes de 077 se ofrecía igual.
              { available: false },
        );
        setLoadingFlex(false);
      })();
    }, 120);
    return () => clearTimeout(t);
  }, [
    isFlexible,
    service,
    date,
    partySize,
    slug,
    salonId,
    multiSalon,
    isLargeGroup,
    availReloadKey,
  ]);

  useEffect(() => {
    if (!selectedSlot) return;
    const id = window.setTimeout(() => {
      detailsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);
    return () => window.clearTimeout(id);
  }, [selectedSlot]);

  function onConfirm() {
    // Grupo grande: el CTA es un link a WhatsApp, no este submit.
    if (isLargeGroup) return;
    const done = isFlexible ? service.length > 0 : selectedSlot !== null;
    if (!done) return;
    // Spec 077 — el servicio se llenó (o se llenó mientras miraba la pantalla).
    if (isFlexible && servicioSinLugar) return;

    if (isFlexible && !arrivalTime) {
      toast.error("Elegí un horario de llegada.");
      return;
    }

    if (!user.isLoggedIn) {
      const q = isFlexible
        ? `date=${date}&party=${partySize}&service=${encodeURIComponent(service)}`
        : `date=${date}&party=${partySize}&slot=${selectedSlot!.slot}`;
      router.push(
        `/${slug}/login?next=${encodeURIComponent(`/${slug}/reservar?${q}`)}`,
      );
      return;
    }

    if (!name.trim() || !phone.trim()) {
      toast.error("Necesitamos nombre y teléfono.");
      return;
    }

    setSubmitting(true);
    (async () => {
      const result = isFlexible
        ? await createFlexibleReservation({
            business_slug: slug,
            date,
            service,
            party_size: partySize,
            customer_name: name.trim(),
            customer_phone: phone.trim(),
            notes,
            source: "web",
            ...(arrivalTime ? { arrival_time: arrivalTime } : {}),
            ...(salonId ? { floor_plan_id: salonId } : {}),
          })
        : await createReservationFromCustomer({
            business_slug: slug,
            date,
            slot: selectedSlot!.slot,
            party_size: partySize,
            customer_name: name.trim(),
            customer_phone: phone.trim(),
            notes,
            ...(salonId ? { floor_plan_id: salonId } : {}),
          });
      if (result.ok) {
        router.push(`/${slug}/reservar/confirmacion?id=${result.data.id}`);
      } else {
        toast.error(result.error);
        // Puede haber sido el cupo: re-consultamos para que la pantalla refleje
        // el estado real en vez de dejar al cliente reintentando a ciegas.
        if (isFlexible) setAvailReloadKey((k) => k + 1);
        setSubmitting(false);
      }
    })();
  }

  const grouped = slots ? groupSlotsByService(slots) : null;
  // Spec 077 — servicio sin lugar: ni horarios ni formulario ni CTA.
  const servicioSinLugar =
    isFlexible && flexAvail !== null && !flexAvail.available;
  const selectionDone =
    !isLargeGroup &&
    (isFlexible ? service.length > 0 && !servicioSinLugar : !!selectedSlot);
  const largeGroupHref = isLargeGroup
    ? buildLargeGroupWhatsappLink({
        phone: businessPhone,
        maxPartySize: settings.max_party_size,
        dayLabel: formatLongDate(date),
      })
    : null;
  const hasFooter = selectionDone || !!largeGroupHref;
  const ctaDisabled =
    submitting || (isFlexible && (!arrivalTime || servicioSinLugar));
  const initials = getInitial(user);
  const firstName = getFirstName(user);

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        paddingBottom: hasFooter ? 110 : 32,
      }}
    >
      {/* ── Hero (mirrors menu-client) ─────────────────────────────────── */}
      <div style={{ position: "relative", overflow: "hidden" }}>
        <ImageTile
          className="m-settle"
          src={coverImageUrl}
          alt={businessName}
          tone="#C9B792"
          radius={0}
          sizes="520px"
          priority
          style={{ height: 160 }}
        />
        {/* Back button (top-left) */}
        <Link
          href={`/${slug}/menu`}
          aria-label="Volver al menú"
          style={{
            position: "absolute",
            top: 16,
            left: 12,
            width: 40,
            height: 40,
            borderRadius: 99,
            background: "rgba(255,255,255,0.95)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textDecoration: "none",
          }}
        >
          {I.chevLeft("var(--ink)", 22)}
        </Link>
        {/* Account pill (top-right) */}
        {user.isLoggedIn ? (
          <Link
            href={`/${slug}/perfil`}
            style={{
              position: "absolute",
              top: 20,
              right: 16,
              height: 40,
              paddingLeft: 4,
              paddingRight: 14,
              borderRadius: 99,
              background: "rgba(255,255,255,0.95)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
              color: "var(--ink)",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 99,
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {initials}
            </span>
            <span
              style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.1 }}
            >
              {firstName}
            </span>
          </Link>
        ) : (
          <Link
            href={`/${slug}/login?next=${encodeURIComponent(`/${slug}/reservar`)}`}
            style={{
              position: "absolute",
              top: 20,
              right: 16,
              height: 40,
              padding: "0 16px",
              borderRadius: 99,
              background: "var(--ink)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: -0.1,
              display: "flex",
              alignItems: "center",
              textDecoration: "none",
            }}
          >
            Ingresar
          </Link>
        )}
      </div>

      {/* Tenant info */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.8,
            color: "var(--primary)",
            marginBottom: 8,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          Reservar una mesa
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {logoUrl && (
            <div
              style={{
                position: "relative",
                width: 40,
                height: 40,
                borderRadius: 999,
                overflow: "hidden",
                flexShrink: 0,
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                border: "1px solid var(--hairline)",
              }}
            >
              <Image
                src={logoUrl}
                alt={businessName}
                fill
                sizes="40px"
                style={{ objectFit: "cover" }}
              />
            </div>
          )}
          <div
            className="d-display"
            style={{ fontSize: 32, lineHeight: 1.05, color: "var(--ink)" }}
          >
            {businessName}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 6,
            flexWrap: "wrap",
          }}
        >
          {tagline ? (
            <>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                {tagline}
              </span>
              <span style={{ color: "var(--hairline-2)" }}>·</span>
            </>
          ) : null}
          {/* Un punto más grande que el tagline: es la otra cosa que el cliente
              puede venir a hacer, pero sigue en el mismo renglón. */}
          <Link
            href={`/${slug}/menu`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--primary)",
              textDecoration: "none",
              letterSpacing: -0.1,
            }}
          >
            {I.moto("var(--primary)", 16)}
            Hacer un pedido
            {I.chevRight("var(--primary)", 13)}
          </Link>
        </div>
      </div>

      {/* Section: ¿Cuándo? */}
      <Section label="¿Cuándo?" delay={60}>
        <div
          className="no-scrollbar"
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            margin: "0 -16px",
            padding: "0 16px 4px",
          }}
        >
          {dateStrip.map((d) => {
            const active = d.iso === date;
            return (
              <button
                key={d.iso}
                type="button"
                onClick={() => setDate(d.iso)}
                style={{
                  flexShrink: 0,
                  width: 60,
                  padding: "10px 4px 8px",
                  borderRadius: 12,
                  border: `1px solid ${active ? "var(--primary)" : "var(--hairline-2)"}`,
                  background: active ? "var(--primary)" : "var(--bg)",
                  color: active ? "var(--primary-foreground)" : "var(--ink)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  cursor: "pointer",
                  transition: "all 200ms",
                  fontFamily: "inherit",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    opacity: 0.75,
                  }}
                >
                  {d.weekday}
                </span>
                <span
                  className="d-display"
                  style={{ fontSize: 22, lineHeight: 1 }}
                >
                  {d.day}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    opacity: 0.75,
                  }}
                >
                  {d.month}
                </span>
              </button>
            );
          })}
          <label
            style={{
              position: "relative",
              flexShrink: 0,
              width: 60,
              padding: "10px 4px",
              borderRadius: 12,
              border: "1px dashed var(--hairline-2)",
              color: "var(--ink-3)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              cursor: "pointer",
            }}
          >
            Otra
            <input
              type="date"
              min={minDate}
              max={maxDateStr}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                cursor: "pointer",
              }}
            />
          </label>
        </div>
      </Section>

      {/* Section: ¿Cuántos? */}
      <Section label="¿Cuántos son?" delay={110}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Un escalón por encima del máximo para poder decir "somos más":
              ahí el flujo se corta y pasa a WhatsApp. */}
          <Stepper
            value={partySize}
            min={1}
            max={settings.max_party_size + 1}
            display={isLargeGroup ? `${settings.max_party_size}+` : undefined}
            onChange={setPartySize}
          />
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>
            {isLargeGroup
              ? `Más de ${settings.max_party_size} personas: la mesa la armamos a mano.`
              : `Hasta ${settings.max_party_size} personas. Para más, escribinos.`}
          </div>
        </div>

        {/* Grupo grande: mismo botón verde que el aviso de invitados. Reemplaza
            a todo el flujo — no hay horarios que ofrecer para 13 personas. */}
        {isLargeGroup ? (
          <LargeGroupNotice
            maxPartySize={settings.max_party_size}
            href={largeGroupHref}
          />
        ) : null}
      </Section>

      {/* Section: Salón (solo si hay más de uno) */}
      {multiSalon && !isLargeGroup ? (
        <Section label="Salón" delay={160}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {salones.map((s) => {
              const active = salonId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSalonId(s.id)}
                  style={{
                    height: 44,
                    padding: "0 16px",
                    borderRadius: 12,
                    border: `1px solid ${active ? "var(--primary)" : "var(--hairline-2)"}`,
                    background: active ? "var(--primary)" : "var(--bg)",
                    color: active ? "var(--primary-foreground)" : "var(--ink)",
                    fontSize: 14,
                    fontWeight: 600,
                    letterSpacing: -0.1,
                    cursor: "pointer",
                    transition: "all 180ms",
                    fontFamily: "inherit",
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </Section>
      ) : null}

      {/* Section: Servicio (flexible) / Horarios (estricto) */}
      {isLargeGroup ? null : isFlexible ? (
        <Section label={`Servicio — ${formatLongDate(date)}`} delay={210}>
          {multiSalon && !salonId ? (
            <PickSalonHint />
          ) : serviceNames.length === 0 ? (
            <EmptySlots />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {serviceNames.map((s) => {
                  const active = service === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setService(s);
                        setArrivalTime("");
                      }}
                      style={{
                        height: 44,
                        padding: "0 18px",
                        borderRadius: 12,
                        border: active ? "none" : "1px solid var(--hairline-2)",
                        background: active ? "var(--primary)" : "var(--bg)",
                        color: active
                          ? "var(--primary-foreground)"
                          : "var(--ink)",
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>

              {/* Spec 080 — clubes: cuántos invitados entran por socio y cómo
                  se registran. Va atado al servicio (en el Golf, sólo la cena);
                  en negocios sin política no renderiza nada. */}
              <GuestPolicyNotice
                slug={slug}
                phone={businessPhone}
                service={service}
              />

              {loadingFlex ? (
                <SlotsSkeleton />
              ) : servicioSinLugar ? (
                <FullService reason={flexAvail?.reason} />
              ) : shownArrivalOptions.length > 0 ? (
                <div className="m-rise">
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-2)",
                      marginBottom: 8,
                    }}
                  >
                    Horario
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 6,
                    }}
                  >
                    {shownArrivalOptions.map((t) => {
                      const active = arrivalTime === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setArrivalTime(t)}
                          style={{
                            height: 44,
                            borderRadius: 10,
                            border: active
                              ? "none"
                              : "1px solid var(--hairline-2)",
                            background: active ? "var(--primary)" : "var(--bg)",
                            color: active
                              ? "var(--primary-foreground)"
                              : "var(--ink)",
                            fontSize: 14,
                            fontWeight: 600,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Section>
      ) : (
        <Section label={`Horarios — ${formatLongDate(date)}`} delay={210}>
          {multiSalon && !salonId ? (
            <PickSalonHint />
          ) : loadingSlots ? (
            <SlotsSkeleton />
          ) : slots && slots.length === 0 ? (
            <EmptySlots />
          ) : grouped ? (
            <div
              className="m-rise"
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              {grouped.lunch.length > 0 && (
                <SlotGroup
                  label="Almuerzo"
                  slots={grouped.lunch}
                  selectedSlot={selectedSlot}
                  onSelect={setSelectedSlot}
                />
              )}
              {grouped.dinner.length > 0 && (
                <SlotGroup
                  label="Cena"
                  slots={grouped.dinner}
                  selectedSlot={selectedSlot}
                  onSelect={setSelectedSlot}
                />
              )}
            </div>
          ) : null}
        </Section>
      )}

      {/* Section: Datos (only when selection done) */}
      {selectionDone ? (
        <Section label="Tus datos" refEl={detailsRef}>
          {user.isLoggedIn ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field
                id="r-name"
                label="Nombre"
                value={name}
                onChange={setName}
                maxLength={80}
              />
              <Field
                id="r-phone"
                label="Teléfono"
                value={phone}
                onChange={setPhone}
                maxLength={40}
                placeholder="+54 9 11 …"
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
          ) : (
            <div
              style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}
            >
              Iniciá sesión para confirmar la reserva. Guardamos tus datos para
              que el local pueda contactarte si hace falta.
            </div>
          )}
        </Section>
      ) : null}

      {/* Sticky bottom CTA */}
      {/* Aparece desde abajo cuando ya hay algo para confirmar. */}
      <AnimatePresence>
        {hasFooter ? (
          <m.div
            key="reservar-footer"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { duration: 0.2, ease: EASE_IN } }}
            transition={{ duration: 0.46, ease: EASE_DRAWER }}
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 30,
              background: "var(--bg)",
              borderTop: "1px solid var(--hairline)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            <div
              style={{
                maxWidth: 520,
                margin: "0 auto",
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {formatLongDate(date)}
                  {isLargeGroup ? "" : ` · ${partySize}p`}
                </div>
                <div
                  className="d-display"
                  style={{ fontSize: 20, lineHeight: 1.1, color: "var(--ink)" }}
                >
                  {(() => {
                    const resumen = isLargeGroup
                      ? `Más de ${settings.max_party_size}`
                      : isFlexible
                        ? arrivalTime
                          ? `${service} · ${arrivalTime} hs`
                          : service
                        : `${selectedSlot!.slot} hs`;
                    return <AnimatedValue value={resumen} />;
                  })()}
                </div>
              </div>
              {isLargeGroup ? (
                <a
                  href={largeGroupHref!}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    height: 48,
                    padding: "0 22px",
                    borderRadius: 12,
                    background: "var(--primary)",
                    color: "var(--primary-foreground)",
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: -0.1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                  }}
                >
                  {I.whatsapp("currentColor", 18)} Hablar por WhatsApp
                </a>
              ) : (
                <button
                  type="button"
                  className="m-press"
                  onClick={onConfirm}
                  disabled={ctaDisabled}
                  style={{
                    height: 48,
                    padding: "0 22px",
                    borderRadius: 12,
                    background: "var(--primary)",
                    color: "var(--primary-foreground)",
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: -0.1,
                    border: "none",
                    cursor: ctaDisabled ? "default" : "pointer",
                    opacity: ctaDisabled ? 0.6 : 1,
                    whiteSpace: "nowrap",
                    fontFamily: "inherit",
                  }}
                >
                  {/* Spec 131 — el cliente pide; confirma el local. El botón no
                    promete lo que todavía no pasó. */}
                  {user.isLoggedIn
                    ? submitting
                      ? "Enviando…"
                      : "Pedir reserva"
                    : "Ingresar y pedir reserva"}
                </button>
              )}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ─── primitives ──────────────────────────────────────────────────────── */

/**
 * Aviso de grupo grande. Mismo formato que el aviso de invitados por socio
 * (spec 080): explica por qué el flujo se corta y ofrece el botón de WhatsApp.
 * Sin teléfono cargado se muestra el texto sin botón, nunca un `wa.me` roto.
 */
function LargeGroupNotice({
  maxPartySize,
  href,
}: {
  maxPartySize: number;
  href: string | null;
}) {
  return (
    <div
      style={{
        marginTop: 14,
        borderRadius: 12,
        border: "1px solid var(--hairline-2)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        Grupo grande
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink-2)",
        }}
      >
        Para más de{" "}
        <strong style={{ color: "var(--ink)" }}>{maxPartySize} personas</strong>{" "}
        armamos la mesa a mano. Escribinos y lo coordinamos.
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          style={{
            width: "100%",
            height: 44,
            borderRadius: 12,
            background: "#fff",
            border: "1px solid var(--hairline-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            textDecoration: "none",
          }}
        >
          {I.whatsapp("#1FAF53", 18)} Hablar por WhatsApp
        </a>
      ) : null}
    </div>
  );
}

function Section({
  label,
  children,
  refEl,
  delay = 0,
}: {
  label: string;
  children: React.ReactNode;
  refEl?: React.RefObject<HTMLDivElement | null>;
  /** ms de retraso de la entrada, para escalonar las secciones iniciales. */
  delay?: number;
}) {
  return (
    <div
      ref={refEl}
      className="m-rise"
      style={{
        ["--m-delay" as string]: `${delay}ms`,
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

function Stepper({
  value,
  min,
  max,
  display,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  /** Qué mostrar en vez del número (el último escalón es "12+", no 13). */
  display?: string;
  onChange: (n: number) => void;
}) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  const btn: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 12,
    border: "1px solid var(--hairline-2)",
    background: "var(--bg)",
    color: "var(--ink)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={dec}
        disabled={value <= min}
        style={{ ...btn, opacity: value <= min ? 0.4 : 1 }}
        aria-label="Restar"
      >
        {I.minus("var(--ink)", 16)}
      </button>
      <div
        className="d-display"
        style={{
          minWidth: 56,
          textAlign: "center",
          fontSize: 26,
          lineHeight: 1,
          color: "var(--ink)",
        }}
      >
        {display ?? value}
      </div>
      <button
        type="button"
        onClick={inc}
        disabled={value >= max}
        style={{ ...btn, opacity: value >= max ? 0.4 : 1 }}
        aria-label="Sumar"
      >
        {I.plus("var(--ink)", 16)}
      </button>
    </div>
  );
}

function SlotGroup({
  label,
  slots,
  selectedSlot,
  onSelect,
}: {
  label: string;
  slots: Slot[];
  selectedSlot: Slot | null;
  onSelect: (s: Slot) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ink-2)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
        }}
      >
        {slots.map((s) => {
          const active = selectedSlot?.slot === s.slot;
          return (
            <button
              key={s.slot}
              type="button"
              onClick={() => onSelect(s)}
              style={{
                height: 48,
                borderRadius: 12,
                border: `1px solid ${active ? "var(--primary)" : "var(--hairline-2)"}`,
                background: active ? "var(--primary)" : "var(--bg)",
                color: active ? "var(--primary-foreground)" : "var(--ink)",
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: -0.1,
                cursor: "pointer",
                transition: "all 180ms",
                fontFamily: "inherit",
              }}
            >
              {s.slot}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotsSkeleton() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 48,
            borderRadius: 12,
            background: "var(--hairline)",
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Spec 077 — el servicio elegido no tiene lugar: se agotaron los cubiertos del
 * cupo o no queda mesa para esa cantidad de personas. Antes de 077 esta
 * pantalla ofrecía el servicio igual y el "no" llegaba recién en el salón.
 */
function FullService({ reason }: { reason?: string }) {
  const sinMesas = reason === "sin-mesas";
  return (
    <div
      style={{
        padding: "20px 16px",
        textAlign: "center",
        borderRadius: 12,
        border: "1px dashed var(--hairline-2)",
        color: "var(--ink-2)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {sinMesas
        ? "No nos queda mesa para esa cantidad de personas."
        : "Ese servicio ya está completo."}
      <br />
      <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
        {sinMesas
          ? "Probá otro servicio, otra fecha o menos personas."
          : "Probá otro servicio, otra fecha u otro salón."}
      </span>
    </div>
  );
}

function EmptySlots() {
  return (
    <div
      style={{
        padding: "20px 16px",
        textAlign: "center",
        borderRadius: 12,
        border: "1px dashed var(--hairline-2)",
        color: "var(--ink-2)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      No quedan lugares para esa combinación.
      <br />
      <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
        Probá otra fecha o ajustá la cantidad.
      </span>
    </div>
  );
}

function PickSalonHint() {
  return (
    <div
      style={{
        padding: "20px 16px",
        textAlign: "center",
        borderRadius: 12,
        border: "1px dashed var(--hairline-2)",
        color: "var(--ink-2)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      Elegí un salón para ver los horarios disponibles.
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
  multiline?: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--hairline-2)",
    background: "var(--bg)",
    color: "var(--ink)",
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        htmlFor={id}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ink-2)",
        }}
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

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarPlus, Check, Clock, Pencil, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { NewReservationModal } from "@/components/admin/local/new-reservation-modal";
import { Button } from "@/components/ui/button";
import { matchesSalonReserva } from "@/lib/admin/salon-filter";
import { proximaReserva, reservationDayStats } from "@/lib/reservations/day-stats";
import {
  decideReservation,
  sentarReserva,
  updateReservationDetails,
  updateReservationStatus,
} from "@/lib/reservations/booking-actions";
import { OVERBOOK_HINT } from "@/lib/reservations/edit-window";
import type {
  DayServiceOption,
  FloorTable,
  Reservation,
  ReservationMode,
  ReservationStatus,
} from "@/lib/reservations/types";
import {
  ReservationEditPanel,
  type EditCallbacks,
  type EditPatch,
} from "@/components/reservations/reservation-edit-panel";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AdminRow = Reservation & {
  tables: {
    label: string;
    floor_plans: { id: string; name: string } | null;
  } | null;
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "Pendiente",
  rejected: "Rechazada",
  expired: "Vencida",
  confirmed: "Confirmada",
  seated: "En mesa",
  completed: "Completada",
  no_show: "No vino",
  cancelled: "Cancelada",
};

const STATUS_DOT: Record<ReservationStatus, string> = {
  pending: "bg-amber-500",
  rejected: "bg-rose-500",
  expired: "bg-muted-foreground",
  confirmed: "bg-blue-500",
  seated: "bg-emerald-500",
  completed: "bg-muted-foreground",
  no_show: "bg-amber-500",
  cancelled: "bg-rose-500",
};

const STATUS_RING: Record<ReservationStatus, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  expired: "bg-muted text-foreground/70 ring-border",
  confirmed: "bg-blue-50 text-blue-700 ring-blue-200",
  seated: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  completed: "bg-muted text-foreground/70 ring-border",
  no_show: "bg-amber-50 text-amber-700 ring-amber-200",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
};

type Filter = "all" | "upcoming" | "seated" | "past";

/* ─── inline icons (kept from original) ─────────────────────────────────── */

const Ic = {
  chevL: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  chevR: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  square: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  ),
  cog: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  phone: () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  user: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  globe: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" />
    </svg>
  ),
};

/* ─── helpers ────────────────────────────────────────────────────────────── */

function buildDateStrip(centerIso: string) {
  const [y, m, d] = centerIso.split("-").map(Number);
  const out: { iso: string; weekday: string; day: number }[] = [];
  for (let i = -3; i <= 6; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const iso = dt.toISOString().slice(0, 10);
    const weekday = new Intl.DateTimeFormat("es-AR", {
      weekday: "short",
      timeZone: "UTC",
    }).format(dt);
    out.push({
      iso,
      weekday: weekday.replace(".", ""),
      day: dt.getUTCDate(),
    });
  }
  return out;
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "recién";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const CARD_SHADOW =
  "0 1px 0 rgba(24, 24, 27, 0.02), 0 6px 14px -8px rgba(24, 24, 27, 0.06)";
const ROW_SHADOW =
  "0 1px 0 rgba(24, 24, 27, 0.02), 0 4px 10px -6px rgba(24, 24, 27, 0.05)";

/* ─── main component ─────────────────────────────────────────────────────── */

export function AdminDayList({
  slug,
  date,
  rows: allRows,
  timezone,
  floorPlans,
  activeTables,
  mode = "estricto",
  services = [],
  salonIds = [],
  datePath,
  diasConSolicitudes = [],
  plano,
  vista: vistaControlada,
  onVistaChange,
  onChanged,
}: {
  slug: string;
  date: string;
  rows: AdminRow[];
  timezone: string;
  floorPlans: Array<{ id: string; name: string }>;
  activeTables: FloorTable[];
  /** Spec 097 — el editor de reservas cambia según el modo del negocio. */
  mode?: ReservationMode;
  /** Servicios elegibles de `date` (sólo modo flexible). */
  services?: DayServiceOption[];
  /**
   * Spec 065: salones elegidos en `/admin/operacion`. Vacío = sin filtro (es lo
   * que usa la página `/admin/reservas`, que no tiene selector propio).
   */
  salonIds?: string[];
  /**
   * Spec 136 — días (YYYY-MM-DD local) con solicitudes sin responder. El
   * navegador de fechas los marca: es el único lugar donde el estado de otro
   * día cabe sin ruido.
   */
  diasConSolicitudes?: string[];
  /**
   * Spec 137 — el plano del día. Cuando viene, la columna ofrece el toggle
   * «Lista / Plano»; sin él la pantalla queda como estaba (es lo que hace la
   * tab de Operación, que tiene su propio salón en vivo al lado).
   */
  plano?: React.ReactNode;
  /**
   * Spec 138 — la vista puede venir de afuera: encender «asignar mesa» desde la
   * bandeja tiene que traer el plano a la vista, o el modo se prende donde
   * nadie lo ve.
   */
  vista?: "lista" | "plano";
  onVistaChange?: (v: "lista" | "plano") => void;
  /**
   * Spec 103: cómo re-sincronizarse tras mutar o cambiar de día. Recibe el día
   * pedido. Sin esto se cae al comportamiento histórico —`router.push` para la
   * fecha, `router.refresh()` para las mutaciones—, que es lo que sigue usando
   * la página `/admin/reservas`. Embebida en el operativo hace falta: cada
   * flecha del navegador de fechas re-corría las **7** tabs para pintar otra
   * lista, y el panel ya no lee los props que traía ese refresh.
   */
  onChanged?: (date: string) => void;
  /**
   * Ruta a la que apunta el navegador de fechas. Default: la página
   * `/admin/reservas`. La tab de Operación pasa `/admin/operacion` para que
   * cambiar de día no la expulse del operativo (`?tab` se preserva solo).
   */
  datePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const [filter, setFilter] = useState<Filter>("all");
  // Spec 189 — el plano es la vista de entrada cuando hay plano que mostrar.
  const [vistaInterna, setVistaInterna] = useState<"lista" | "plano">(
    plano ? "plano" : "lista",
  );
  const vista = vistaControlada ?? vistaInterna;
  const setVista = (v: "lista" | "plano") =>
    onVistaChange ? onVistaChange(v) : setVistaInterna(v);
  const [search, setSearch] = useState("");
  /** #158 — las canceladas arrancan ocultas; el toggle vive al pie de la lista. */
  const [showCancelled, setShowCancelled] = useState(false);
  const [showNewReservation, setShowNewReservation] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    status: "no_show" | "cancelled";
    customerName: string;
  } | null>(null);
  /** Spec 131 — rechazar una solicitud pide (opcionalmente) un motivo. */
  const [rejectDialog, setRejectDialog] = useState<{
    id: string;
    customerName: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const multiSalon = floorPlans.length > 1;

  // Spec 065: el filtro por salón se aplica una sola vez, arriba de todo. De
  // acá para abajo `rows` YA es lo del salón elegido, así que los totales de la
  // cabecera, los chips de estado y la lista no pueden discrepar entre sí.
  // #155: la reserva sin mesa ni zona pasa cualquier filtro — todavía no es de
  // ningún salón, y es justo la que hay que sentar.
  const rows = useMemo(
    () => allRows.filter((r) => matchesSalonReserva(salonIds, r)),
    [allRows, salonIds],
  );

  function setDate(next: string) {
    if (onChanged) {
      // Sin navegar: la URL se escribe con la History API (igual que la tab en
      // la spec 101) y el día nuevo se pide con la action de la tab.
      const params = new URLSearchParams(window.location.search);
      params.set("date", next);
      window.history.replaceState(null, "", `?${params.toString()}`);
      onChanged(next);
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.set("date", next);
    const base = datePath ?? `/${slug}/admin/reservas`;
    router.push(`${base}?${params.toString()}`);
  }

  /** Re-sincroniza el día que se está mirando. */
  const resincronizar = () => (onChanged ? onChanged(date) : router.refresh());

  // ── Actions ──

  function handleSentar(reservationId: string) {
    start(async () => {
      const result = await sentarReserva({
        business_slug: slug,
        reservation_id: reservationId,
      });
      if (result.ok) {
        toast.success("Mesa abierta con reserva.");
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  /** Spec 131 — la decisión del local sobre una solicitud pendiente. */
  function handleDecide(id: string, decision: "confirm" | "reject", reason?: string) {
    start(async () => {
      const result = await decideReservation({
        business_slug: slug,
        id,
        decision,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      if (result.ok) {
        toast.success(
          decision === "confirm" ? "Reserva confirmada." : "Reserva rechazada.",
        );
        setRejectDialog(null);
        setRejectReason("");
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleChangeStatus(id: string, status: ReservationStatus) {
    start(async () => {
      const result = await updateReservationStatus({
        business_slug: slug,
        id,
        status,
      });
      if (result.ok) {
        toast.success("Estado actualizado.");
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleUpdateDetails(
    reservationId: string,
    patch: EditPatch,
    callbacks: EditCallbacks,
  ) {
    start(async () => {
      const result = await updateReservationDetails({
        business_slug: slug,
        reservation_id: reservationId,
        ...patch,
      });
      if (result.ok) {
        toast.success("Reserva actualizada.");
        callbacks.onDone();
        resincronizar();
        return;
      }
      // Sobrecupo: no es un "no", es un "confirmá" (spec 077).
      if (result.error.endsWith(OVERBOOK_HINT)) {
        callbacks.onOverbook(result.error);
        return;
      }
      toast.error(result.error);
    });
  }

  function handleConfirmAction() {
    if (!confirmAction) return;
    handleChangeStatus(confirmAction.id, confirmAction.status);
    setConfirmAction(null);
  }

  // ── Computed ──

  // #156: `total` y `guests` salen del MISMO conjunto (ni canceladas ni
  // no-shows) — antes el primero contaba todo y el segundo sólo las vivas, y
  // los dos KPI grandes se contradecían. Cálculo puro en `day-stats.ts`.
  const stats = useMemo(() => {
    const counts = reservationDayStats(rows);
    const upcoming = proximaReserva(rows, Date.now());
    const nextLabel = upcoming
      ? formatInTimeZone(new Date(upcoming.starts_at), timezone, "HH:mm")
      : "—";
    return { ...counts, nextLabel };
  }, [rows, timezone]);

  // Filas que pasan tab + búsqueda, canceladas incluidas. De acá salen las dos
  // cosas que hacen falta: lo que se muestra y cuántas canceladas se ocultaron.
  const matchingRows = useMemo(() => {
    const now = Date.now();
    let filtered = rows.filter((r) => {
      switch (filter) {
        case "upcoming":
          return (
            r.status === "confirmed" &&
            new Date(r.starts_at).getTime() > now - 5 * 60_000
          );
        case "seated":
          return r.status === "seated";
        case "past":
          return ["completed", "no_show", "cancelled", "rejected", "expired"].includes(
            r.status,
          );
        default:
          return true;
      }
    });
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.customer_name.toLowerCase().includes(q) ||
          (r.customer_phone && r.customer_phone.toLowerCase().includes(q)),
      );
    }
    return filtered;
  }, [rows, filter, search]);

  // #158: la cancelada se esconde por defecto — en una noche con varias, el
  // encargado las saltea una por una para leer lo que le importa (quién falta
  // sentar). Los `no_show` siguen a la vista: que alguien no haya venido es
  // información operativa, no ruido.
  const filteredRows = useMemo(
    () =>
      showCancelled
        ? matchingRows
        : matchingRows.filter((r) => r.status !== "cancelled"),
    [matchingRows, showCancelled],
  );
  const hiddenCancelled = matchingRows.length - filteredRows.length;
  /** Cuántas canceladas hay para mostrar/ocultar con el toggle. */
  const cancelledInView = showCancelled
    ? matchingRows.filter((r) => r.status === "cancelled").length
    : hiddenCancelled;

  const solicitudesPorDia = useMemo(
    () => new Set(diasConSolicitudes),
    [diasConSolicitudes],
  );

  const dateStrip = buildDateStrip(date);

  return (
    <div className="space-y-6">
      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      {/* Spec 136 — tres KPI: lo que la pantalla no dice en otro lado. Las
          reservas y los cubiertos son el mismo número mirado de dos formas, así
          que van juntos; lo pendiente salió de acá porque tiene su bandeja. */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label="Reservas"
          value={String(stats.total)}
          sub={
            [
              `${stats.guests} cubiertos`,
              stats.pending > 0 ? `${stats.pending} sin responder` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          }
        />
        <KpiCard
          label="En mesa"
          value={String(stats.seated)}
          accent={stats.seated > 0}
        />
        <KpiCard label="Próxima" value={stats.nextLabel} mono />
      </div>

      {/* Secondary stats: no-show + cancelled (solo si hubo) */}
      {(stats.noShow > 0 || stats.cancelled > 0 || stats.completed > 0) && (
        <div className="flex flex-wrap gap-3 px-1 text-xs text-muted-foreground">
          {stats.completed > 0 && (
            <span>
              ✓ {stats.completed} completada{stats.completed > 1 ? "s" : ""}
            </span>
          )}
          {stats.noShow > 0 && (
            <span className="text-amber-700">
              ⚠ {stats.noShow} no vino
            </span>
          )}
          {stats.cancelled > 0 && (
            <span className="text-rose-600">
              ✕ {stats.cancelled} cancelada{stats.cancelled > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* ── Date navigator + search + actions ────────────────────────────── */}
      <div
        className="rounded-2xl bg-card p-4 ring-1 ring-border/70"
        style={{ boxShadow: CARD_SHADOW }}
      >
        {/* Row 1: date nav + links */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setDate(shiftDate(date, -1))}
              className="rounded-full"
              aria-label="Día anterior"
            >
              <Ic.chevL />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setDate(shiftDate(date, 1))}
              className="rounded-full"
              aria-label="Día siguiente"
            >
              <Ic.chevR />
            </Button>
          </div>

          <div className="no-scrollbar -mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1">
            {dateStrip.map((d) => {
              const active = d.iso === date;
              return (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => setDate(d.iso)}
                  className={cn(
                    "relative my-1 flex min-w-[52px] flex-col items-center rounded-xl px-2.5 py-2 ring-1 transition active:scale-[0.97]",
                    active
                      ? "bg-primary text-white ring-primary"
                      : "bg-card text-foreground/80 ring-border hover:bg-muted/50",
                  )}
                >
                  <span className="text-[10px] uppercase tracking-[0.14em] opacity-70">
                    {d.weekday}
                  </span>
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {d.day}
                  </span>
                  {/* Spec 136 — este día tiene solicitudes sin responder. */}
                  {solicitudesPorDia.has(d.iso) && (
                    <span
                      className={cn(
                        "absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full",
                        active ? "bg-amber-300" : "bg-amber-500",
                      )}
                      aria-label="Tiene solicitudes sin responder"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <label className="relative">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <span className="inline-flex h-8 cursor-pointer items-center rounded-full bg-muted px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/70 hover:bg-border">
              Saltar
            </span>
          </label>

          <div className="hidden h-6 w-px bg-border sm:block" />

          <Button
            type="button"
            size="lg"
            onClick={() => setShowNewReservation(true)}
          >
            <CalendarPlus className="h-4 w-4" />
            Nueva reserva
          </Button>

          <Link
            href={`/${slug}/admin/reservas/configuracion`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/80 ring-1 ring-border transition hover:bg-muted/50"
          >
            <Ic.cog /> Config
          </Link>
        </div>

        {/* Row 2: search + filter tabs */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o teléfono…"
              className="h-8 w-56 rounded-full border-0 bg-muted pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-foreground/20"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          {/* Spec 137 — Lista o Plano: los mismos datos, otra pregunta. */}
          {plano && (
            <div
              className="inline-flex rounded-full bg-muted/80 p-1 ring-1 ring-border/60"
              role="tablist"
            >
              {(["lista", "plano"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={vista === v}
                  onClick={() => setVista(v)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition",
                    vista === v
                      ? "bg-card text-foreground shadow-[0_1px_2px_rgba(24,24,27,0.06)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {/* Filter tabs */}
          <div
            className={cn(
              "inline-flex rounded-full bg-muted/80 p-1 ring-1 ring-border/60",
              vista === "plano" && "hidden",
            )}
            role="tablist"
          >
            {(
              [
                // #158: cuenta lo que se ve — con las canceladas ocultas, un
                // "Todas (12)" sobre una lista de 8 filas es una contradicción.
                {
                  v: "all",
                  l: `Todas (${showCancelled ? rows.length : rows.filter((r) => r.status !== "cancelled").length})`,
                },
                { v: "upcoming", l: "Próximas" },
                { v: "seated", l: "En mesa" },
                { v: "past", l: "Pasadas" },
              ] as { v: Filter; l: string }[]
            ).map((opt) => {
              const active = filter === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(opt.v)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-medium transition",
                    active
                      ? "bg-card text-foreground shadow-[0_1px_2px_rgba(24,24,27,0.06),0_4px_10px_-6px_rgba(24,24,27,0.18)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Cuerpo: el plano del día, o la lista ─────────────────────────── */}
      {vista === "plano" && plano ? (
        plano
      ) : filteredRows.length === 0 ? (
        <EmptyState filter={filter} search={search} />
      ) : (
        <ul className="space-y-2.5">
          {filteredRows.map((r) => (
            <ReservationRow
              key={r.id}
              row={r}
              timezone={timezone}
              pending={pending}
              multiSalon={multiSalon}
              activeTables={activeTables}
              floorPlans={floorPlans}
              mode={mode}
              services={services}
              onSentar={() => handleSentar(r.id)}
              onComplete={() => handleChangeStatus(r.id, "completed")}
              onNoShow={() =>
                setConfirmAction({
                  id: r.id,
                  status: "no_show",
                  customerName: r.customer_name,
                })
              }
              onCancel={() =>
                setConfirmAction({
                  id: r.id,
                  status: "cancelled",
                  customerName: r.customer_name,
                })
              }
              onConfirmarSolicitud={() => handleDecide(r.id, "confirm")}
              onRechazarSolicitud={() => {
                setRejectReason("");
                setRejectDialog({ id: r.id, customerName: r.customer_name });
              }}
              onUpdateDetails={(patch, callbacks) =>
                handleUpdateDetails(r.id, patch, callbacks)
              }
            />
          ))}
        </ul>
      )}

      {/* #158 — toggle de canceladas, al pie. Fuera del condicional de la lista
          a propósito: un día enteramente cancelado tiene que poder abrirse, y si
          el botón viviera adentro se vería como un día sin reservas. */}
      {vista === "lista" && cancelledInView > 0 && (
        <div className="flex justify-center pt-1">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => setShowCancelled((v) => !v)}
            aria-expanded={showCancelled}
          >
            <X className="h-3 w-3 text-rose-500" />
            {showCancelled
              ? "Ocultar canceladas"
              : `Mostrar ${cancelledInView} cancelada${cancelledInView > 1 ? "s" : ""}`}
          </Button>
        </div>
      )}

      {/* ── Modales ──────────────────────────────────────────────────────── */}
      {showNewReservation && (
        <NewReservationModal
          slug={slug}
          tables={activeTables}
          floorPlanId={null}
          // Spec 144 — la hoja no está parada en ningún salón: se elige adentro.
          // Si la tab de Operación está filtrada por uno solo, ése viene puesto.
          floorPlans={floorPlans}
          defaultFloorPlanId={salonIds.length === 1 ? salonIds[0] : null}
          onClose={() => setShowNewReservation(false)}
          onChanged={onChanged ? () => onChanged(date) : undefined}
        />
      )}

      {/* Spec 131 — rechazar una solicitud: el motivo es opcional y viaja al
          cliente en el aviso, así "no pudimos tomarla" puede tener una razón. */}
      {rejectDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => setRejectDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-foreground">
              ¿Rechazar la reserva?
            </h3>
            <p className="mt-1.5 text-sm text-foreground/70">
              Le avisamos a{" "}
              <span className="font-semibold">{rejectDialog.customerName}</span>{" "}
              que no pudimos tomarla y el lugar queda libre.
            </p>
            <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={200}
              placeholder="Ej: esa noche tenemos un evento privado"
              className="mt-1.5 h-10 w-full rounded-xl border-0 bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xl"
                className="flex-1"
                onClick={() => setRejectDialog(null)}
                disabled={pending}
              >
                Volver
              </Button>
              <Button
                type="button"
                variant="destructive-solid"
                size="xl"
                className="flex-1"
                onClick={() => handleDecide(rejectDialog.id, "reject", rejectReason)}
                disabled={pending}
              >
                Rechazar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog para acciones destructivas */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => setConfirmAction(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-foreground">
              {confirmAction.status === "no_show"
                ? "¿Marcar como no vino?"
                : "¿Cancelar reserva?"}
            </h3>
            <p className="mt-1.5 text-sm text-foreground/70">
              {confirmAction.status === "no_show" ? (
                <>
                  La reserva de{" "}
                  <span className="font-semibold">{confirmAction.customerName}</span>{" "}
                  se marcará como no vino. La mesa queda disponible.
                </>
              ) : (
                <>
                  La reserva de{" "}
                  <span className="font-semibold">{confirmAction.customerName}</span>{" "}
                  se cancelará. Esta acción no se puede deshacer.
                </>
              )}
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xl"
                className="flex-1"
                onClick={() => setConfirmAction(null)}
                disabled={pending}
              >
                Volver
              </Button>
              <Button
                type="button"
                variant={
                  confirmAction.status === "no_show" ? "default" : "destructive-solid"
                }
                size="xl"
                className="flex-1"
                onClick={handleConfirmAction}
                disabled={pending}
              >
                {confirmAction.status === "no_show" ? "No vino" : "Cancelar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── KPI Card ───────────────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  sub,
  mono,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-card p-4 ring-1 ring-border/70"
      style={{ boxShadow: CARD_SHADOW }}
    >
      {accent ? (
        <span className="absolute right-3 top-3 grid h-2 w-2 place-items-center">
          <span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-500/40" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
      ) : null}
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-3xl font-semibold tracking-tight text-foreground",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[10px] font-medium text-muted-foreground/70">{sub}</p>
      )}
    </div>
  );
}

/* ─── Reservation Row ────────────────────────────────────────────────────── */

function ReservationRow({
  row,
  timezone,
  pending,
  multiSalon,
  activeTables,
  floorPlans,
  mode,
  services,
  onSentar,
  onComplete,
  onNoShow,
  onCancel,
  onConfirmarSolicitud,
  onRechazarSolicitud,
  onUpdateDetails,
}: {
  row: AdminRow;
  timezone: string;
  pending: boolean;
  multiSalon: boolean;
  activeTables: FloorTable[];
  floorPlans: Array<{ id: string; name: string }>;
  mode: ReservationMode;
  services: DayServiceOption[];
  onSentar: () => void;
  onComplete: () => void;
  onNoShow: () => void;
  onCancel: () => void;
  /** Spec 131 — decisión del local sobre una solicitud pendiente. */
  onConfirmarSolicitud: () => void;
  onRechazarSolicitud: () => void;
  onUpdateDetails: (patch: EditPatch, callbacks: EditCallbacks) => void;
}) {
  const timeStart = formatInTimeZone(
    new Date(row.starts_at),
    timezone,
    "HH:mm",
  );
  const timeEnd = formatInTimeZone(
    new Date(row.ends_at),
    timezone,
    "HH:mm",
  );
  const isSoftClosed = [
    "completed",
    "no_show",
    "cancelled",
    "rejected",
    "expired",
  ].includes(row.status);
  const salonName = row.tables?.floor_plans?.name ?? null;
  const ago = timeAgo(row.created_at);

  const [editing, setEditing] = useState(false);
  const openEdit = () => setEditing(true);

  return (
    <li
      className={cn(
        "group relative rounded-2xl bg-card p-4 ring-1 ring-border/70 transition hover:ring-foreground/20",
        isSoftClosed && "opacity-65 hover:opacity-90",
      )}
      style={{ boxShadow: ROW_SHADOW }}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* Time range */}
        <div className="flex w-24 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            Hora
          </span>
          <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {timeStart}
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
            → {timeEnd}
          </span>
        </div>

        <div className="h-10 w-px bg-border/80" />

        {/* Customer + meta */}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
            <Ic.user />
            <span className="truncate">{row.customer_name}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">
              {row.party_size}p
              {row.tables ? ` · ${row.tables.label}` : ""}
              {multiSalon && salonName ? ` · ${salonName}` : ""}
            </span>
            {row.customer_phone ? (
              <a
                href={`tel:${row.customer_phone}`}
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <Ic.phone />
                {row.customer_phone}
              </a>
            ) : null}
          </p>
          {/* Notes + source + created */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {row.notes ? (
              <span className="max-w-[260px] truncate text-[11px] italic text-muted-foreground">
                &ldquo;{row.notes}&rdquo;
              </span>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1",
                row.source === "web"
                  ? "bg-sky-50 text-sky-700 ring-sky-200"
                  : "bg-muted text-foreground/70 ring-border",
              )}
            >
              {row.source === "web" ? <Ic.globe /> : <Ic.user />}
              {row.source === "web" ? "Web" : "Admin"}
            </span>
            <span className="text-[10px] text-muted-foreground/70" title={row.created_at}>
              {ago}
            </span>
          </div>
        </div>

        {/* Status */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
            STATUS_RING[row.status],
          )}
        >
          <span
            className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[row.status])}
          />
          {STATUS_LABEL[row.status]}
        </span>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Spec 131 — una solicitud se decide: Confirmar o Rechazar.
              Spec 132 — y se puede ajustar antes de decidirla, porque «te la
              tomo, pero a las 21:30» es una sola decisión. Sentar y completar
              siguen llegando recién cuando es una reserva de verdad. */}
          {row.status === "pending" && !editing && (
            <>
              <Button type="button" size="lg" onClick={onConfirmarSolicitud} disabled={pending}>
                <Check className="h-3.5 w-3.5" />
                Confirmar
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={openEdit} disabled={pending}>
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="lg"
                onClick={onRechazarSolicitud}
                disabled={pending}
              >
                <X className="h-3.5 w-3.5" />
                Rechazar
              </Button>
            </>
          )}
          {row.status === "confirmed" && !editing && (
            <>
              <Button type="button" size="lg" onClick={onSentar} disabled={pending}>
                <UserPlus className="h-3.5 w-3.5" />
                Sentar
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={openEdit} disabled={pending}>
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="lg"
                onClick={onNoShow}
                disabled={pending}
              >
                <Clock className="h-3.5 w-3.5" />
                No vino
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="lg"
                onClick={onCancel}
                disabled={pending}
              >
                <X className="h-3.5 w-3.5" />
                Cancelar
              </Button>
            </>
          )}
          {row.status === "seated" && (
            <Button type="button" size="lg" onClick={onComplete} disabled={pending}>
              <Check className="h-3.5 w-3.5" />
              Completar
            </Button>
          )}
        </div>
      </div>

      {/* Spec 097 — el panel de edición, ahora compartido con la bandeja
          de solicitudes (spec 135). */}
      {editing && (
        <ReservationEditPanel
          row={row}
          timezone={timezone}
          mode={mode}
          services={services}
          activeTables={activeTables}
          floorPlans={floorPlans}
          multiSalon={multiSalon}
          pending={pending}
          onSave={onUpdateDetails}
          onClose={() => setEditing(false)}
          className="mt-3"
        />
      )}
    </li>
  );
}

/* ─── Empty State ────────────────────────────────────────────────────────── */

function EmptyState({ filter, search }: { filter: Filter; search: string }) {
  const message = search
    ? `Sin resultados para "${search}".`
    : filter === "all"
      ? "No hay reservas para esta fecha."
      : filter === "upcoming"
        ? "No hay reservas próximas."
        : filter === "seated"
          ? "Nadie sentado en este momento."
          : "Sin reservas pasadas hoy.";
  return (
    <div
      className="rounded-2xl bg-card p-12 text-center ring-1 ring-dashed ring-foreground/20"
      style={{ boxShadow: "0 1px 0 rgba(24, 24, 27, 0.02)" }}
    >
      <div
        className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground/70 ring-1 ring-border"
        aria-hidden
      >
        {search ? (
          <Search className="h-5 w-5" />
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        )}
      </div>
      <p className="mt-4 text-sm font-medium text-foreground/80">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {search
          ? "Probá con otro nombre o teléfono."
          : "Probá saltar a otra fecha o cambiar el filtro."}
      </p>
    </div>
  );
}

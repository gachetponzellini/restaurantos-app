"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Clock,
  MapPin,
  MoreVertical,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sentarReserva } from "@/lib/reservations/booking-actions";
import { updateReservationStatus } from "@/lib/reservations/booking-actions";

import type { SalonReservationRef, SalonRowProps } from "./salon-desktop";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReservationsPanel({
  reservations,
  slug,
  tableLabelById,
  rowProps,
  pickingForId = null,
  onAsignarMesa,
  onNewReservation,
  onChanged,
}: {
  reservations: SalonReservationRef[];
  slug: string;
  tableLabelById: Record<string, string>;
  /**
   * Cómo se re-sincroniza el que me renderiza (spec 102). Sin esto se cae al
   * `router.refresh()` histórico, que en el operativo re-corre las 7 promesas
   * de tab para mover una reserva — y encima el salón ya no lee esos props.
   */
  onChanged?: () => void;
  /** Props de teclado de la fila (spec 075): las reservas son un tramo de la
   *  zona única del panel, entre las demoras y las mesas. */
  rowProps: SalonRowProps;
  /** Reserva que está esperando que toquen una mesa en el plano (spec 059). */
  pickingForId?: string | null;
  /** Pone el plano del salón en modo "elegí una mesa" para esta reserva.
   *  `intent: "seat"` = elegir la mesa Y sentar en el mismo gesto. */
  onAsignarMesa?: (
    reservation: SalonReservationRef,
    intent: "assign" | "seat",
  ) => void;
  onNewReservation?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const resincronizar = () => (onChanged ? onChanged() : router.refresh());
  const confirmed = reservations.filter((r) => r.status === "confirmed");
  // Un ref por fila para poder abrir su menú desde el teclado sin controlar el
  // `open` del DropdownMenu a mano.
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  if (confirmed.length === 0 && !onNewReservation) return null;

  const handleSentar = (reservationId: string) => {
    startTransition(async () => {
      const result = await sentarReserva({
        business_slug: slug,
        reservation_id: reservationId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reserva sentada.");
      resincronizar();
    });
  };

  const handleNoShow = (reservationId: string) => {
    startTransition(async () => {
      const result = await updateReservationStatus({
        business_slug: slug,
        id: reservationId,
        status: "no_show",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Marcada como no vino.");
      resincronizar();
    });
  };

  const handleCancel = (reservationId: string) => {
    startTransition(async () => {
      const result = await updateReservationStatus({
        business_slug: slug,
        id: reservationId,
        status: "cancelled",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Reserva cancelada.");
      resincronizar();
    });
  };

  return (
    <div className="border-border/60 border-b">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Clock className="h-4 w-4 text-muted-foreground/70" />
        <span className="text-sm font-semibold text-foreground/80">Reservas hoy</span>
        {confirmed.length > 0 && (
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
            {confirmed.length}
          </span>
        )}
        <div className="flex-1" />
        {onNewReservation && (
          <Button type="button" size="sm" onClick={onNewReservation}>
            <CalendarPlus className="h-3.5 w-3.5" />
            Nueva reserva
          </Button>
        )}
      </div>

      {/* Lista — una fila por reserva, compacta */}
      {confirmed.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground/70">
          No hay reservas pendientes de sentar.
        </p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto px-3 pb-3">
          {confirmed.map((r) => {
            const tableLabel = r.table_id ? tableLabelById[r.table_id] : null;
            const canPickOnPlan = !!onAsignarMesa;
            const picking = pickingForId === r.id;
            return (
              /* La fila entera es la parada de teclado (spec 075).
                 No el botón «Sentar»: la lista del panel es un solo camino de ↓
                 y para llegar a las mesas se pasa por encima de cada reserva —
                 con el foco ahí, un Enter de más sentaba gente. Tampoco el ⋯:
                 un menú se abre con ↓, así que se comía la navegación.
                 Parado en la fila, Enter abre sus acciones (con «Sentar»
                 primero, así sentar sigue siendo Enter-Enter) y de paso
                 reasignar / no vino / cancelar dejan de necesitar mouse. */
              <div
                key={r.id}
                {...rowProps(`reserva:${r.id}`)}
                role="group"
                aria-label={`Reserva de ${r.customer_name}, ${formatTime(r.starts_at)}, ${r.party_size} personas`}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  if (e.target !== e.currentTarget) return;
                  e.preventDefault();
                  triggerRefs.current[r.id]?.click();
                }}
                className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-1.5 outline-none ring-1 ring-border/60 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {/* Info en una sola línea */}
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="text-sm font-bold tabular-nums text-foreground/90">
                    {formatTime(r.starts_at)}
                  </span>
                  <span className="truncate text-sm text-foreground/70">{r.customer_name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/70">
                    · {r.party_size}p
                    {tableLabel ? ` · Mesa ${tableLabel}` : ""}
                  </span>
                </div>

                {/* Acción primaria: SIEMPRE sentar. Sin mesa (reserva genérica
                    del modo flexible) la mesa se elige en el plano y se sienta
                    en el mismo gesto — antes había que asignar y después sentar. */}
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    r.table_id ? handleSentar(r.id) : onAsignarMesa?.(r, "seat")
                  }
                  disabled={pending || (!r.table_id && !canPickOnPlan)}
                  className={picking ? "ring-2 ring-ring" : ""}
                >
                  {picking ? (
                    <MapPin className="h-3.5 w-3.5" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5" />
                  )}
                  {picking ? "Elegí en el plano…" : "Sentar"}
                </Button>

                {/* Resto de acciones.
                    El teclado para **acá**, no en «Sentar» (spec 075): la lista
                    del panel es un solo camino de ↓ y para llegar a las mesas se
                    pasa por encima de cada reserva — con el foco en «Sentar», un
                    Enter de más sentaba gente. Un menú es inerte hasta que lo
                    abrís, y adentro «Sentar» es lo primero, así que sentar sigue
                    siendo Enter-Enter. De paso, reasignar / no vino / cancelar
                    dejan de ser inalcanzables sin mouse. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    ref={(el) => {
                      triggerRefs.current[r.id] = el;
                    }}
                    aria-label="Más acciones"
                    disabled={pending}
                    tabIndex={-1}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition hover:bg-border hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      disabled={pending || (!r.table_id && !canPickOnPlan)}
                      onClick={() =>
                        r.table_id ? handleSentar(r.id) : onAsignarMesa?.(r, "seat")
                      }
                    >
                      <UserCheck className="h-4 w-4" />
                      Sentar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {canPickOnPlan ? (
                      <>
                        <DropdownMenuItem onClick={() => onAsignarMesa?.(r, "assign")}>
                          <MapPin className="h-4 w-4" />
                          {r.table_id ? "Reasignar mesa" : "Asignar mesa (sin sentar)"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    <DropdownMenuItem onClick={() => handleNoShow(r.id)}>
                      <UserX className="h-4 w-4" />
                      No vino
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleCancel(r.id)}
                    >
                      <X className="h-4 w-4" />
                      Cancelar reserva
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

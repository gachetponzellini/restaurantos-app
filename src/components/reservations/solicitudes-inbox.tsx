"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Check, Inbox, MapPin, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { ReservationEditPanel } from "@/components/reservations/reservation-edit-panel";
import { Button } from "@/components/ui/button";
import {
  decideReservation,
  updateReservationDetails,
} from "@/lib/reservations/booking-actions";
import { OVERBOOK_HINT } from "@/lib/reservations/edit-window";
import { useReservationsRealtime } from "@/lib/reservations/use-reservations-realtime";
import {
  agruparPorDia,
  esUrgente,
  labelDeVencimiento,
  type SolicitudEnBandeja,
} from "@/lib/reservations/pending-inbox";
import type {
  DayServiceOption,
  FloorTable,
  ReservationMode,
} from "@/lib/reservations/types";
import { cn } from "@/lib/utils";

/**
 * La bandeja de solicitudes (spec 135).
 *
 * Todas las que esperan respuesta, de cualquier día — que es lo que la 131 no
 * podía mostrar: su bandeja era una tab dentro de un día, y la que nadie miraba
 * vencía sola.
 *
 * Cada tarjeta trae con qué decidir sin salir: cuándo, quién, cuántos, por
 * dónde entró, y las dos cosas que hoy no estaban en ninguna pantalla — **cómo
 * viene ese servicio** y **cuánto le queda antes de vencer**.
 */
export function SolicitudesInbox({
  slug,
  businessId,
  solicitudes,
  timezone,
  ahoraIso,
  mode = "estricto",
  services = [],
  activeTables = [],
  floorPlans = [],
  onChanged,
  onAsignarMesa,
  className,
}: {
  slug: string;
  /** Para la suscripción en vivo: una solicitud nueva aparece sin recargar. */
  businessId: string;
  solicitudes: SolicitudEnBandeja[];
  timezone: string;
  /**
   * El reloj del server. El «vence en …» y los títulos «Hoy»/«Mañana» dependen
   * de la hora, y si el cliente usara la suya el primer render no coincidiría
   * con el HTML que llegó — que es exactamente el error de hidratación que esto
   * evita. Después de montar se pasa al reloj del navegador.
   */
  ahoraIso?: string;
  mode?: ReservationMode;
  /** Servicios del negocio (modo flexible), para el panel de edición. */
  services?: DayServiceOption[];
  activeTables?: FloorTable[];
  floorPlans?: Array<{ id: string; name: string }>;
  /** Cómo re-sincronizar después de resolver una. */
  onChanged?: () => void;
  /**
   * Spec 138 — encender el modo «elegir mesa» en el plano. Sin esto el botón no
   * aparece (la tab de Operación no tiene plano al lado).
   */
  onAsignarMesa?: (solicitud: {
    id: string;
    nombre: string;
    partySize: number;
  }) => void;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Sin `onChanged` (la página server-side) se recarga sola, igual que la lista
  // del día: resolver una solicitud tiene que verse sin apretar nada más.
  const resincronizar = () => (onChanged ? onChanged() : router.refresh());

  // Spec 135 · D6 — la bandeja no espera un F5: una solicitud que entra por la
  // web aparece sola, y la que otro encargado resolvió desaparece.
  useReservationsRealtime({ businessId, onChange: resincronizar });
  const [rechazando, setRechazando] = useState<{ id: string; nombre: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [editando, setEditando] = useState<string | null>(null);

  // Arranca con el reloj del server (hidratación) y pasa al del cliente una vez
  // montado. Congelado a propósito: si se recalculara en cada render, los
  // «vence en» saltarían solos y la lista se reordenaría bajo el dedo.
  const [now, setNow] = useState(() =>
    ahoraIso ? new Date(ahoraIso) : new Date(0),
  );
  useEffect(() => {
    setNow(new Date());
  }, []);
  const dias = useMemo(
    () => agruparPorDia(solicitudes, timezone, now),
    [solicitudes, timezone, now],
  );

  function decidir(id: string, decision: "confirm" | "reject", reason?: string) {
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
        setRechazando(null);
        setMotivo("");
        resincronizar();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (solicitudes.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl bg-card p-6 text-center ring-1 ring-border/70",
          className,
        )}
      >
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground/70">
          <Inbox className="h-5 w-5" />
        </div>
        <p className="mt-2.5 text-sm font-medium text-foreground/80">
          No hay solicitudes esperando
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Las reservas de la web y del chatbot aparecen acá para que las
          confirmes.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {dias.map((dia) => (
        <div key={dia.date}>
          <p className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
            {dia.label}
          </p>
          <ul className="space-y-2">
            {dia.solicitudes.map((s) => {
              const urgente = esUrgente(s.venceEn, now);
              const hora = formatInTimeZone(
                new Date(s.reserva.starts_at),
                timezone,
                "HH:mm",
              );
              const salon =
                s.reserva.tables?.floor_plans?.name ?? null;
              const mesa = s.reserva.tables?.label ?? null;
              const contexto = [
                s.reserva.service,
                salon,
                mesa ? `mesa ${mesa}` : "sin mesa",
                s.reserva.source === "chatbot" ? "por el chatbot" : "por la web",
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <li
                  key={s.reserva.id}
                  className={cn(
                    "rounded-2xl bg-card p-3.5 ring-1 transition",
                    urgente ? "ring-amber-300" : "ring-border/70",
                    pending && "opacity-60",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
                          {hora}
                        </span>
                        <span className="truncate text-sm font-medium text-foreground">
                          {s.reserva.customer_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          · {s.reserva.party_size}p
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {contexto}
                      </p>
                      {s.reserva.notes && (
                        <p className="mt-1 line-clamp-2 text-[11px] italic text-muted-foreground">
                          «{s.reserva.notes}»
                        </p>
                      )}
                      <p
                        className={cn(
                          "mt-1.5 text-[11px] font-medium",
                          urgente ? "text-amber-700" : "text-muted-foreground/70",
                        )}
                      >
                        {labelDeVencimiento(s.venceEn, now)}
                      </p>
                    </div>

                    {s.ocupacion && (
                      <div className="w-24 shrink-0 text-right">
                        <p className="text-[11px] leading-tight text-muted-foreground">
                          {s.ocupacion.label}
                        </p>
                        {s.ocupacion.ratio != null && (
                          <div className="ml-auto mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                s.ocupacion.ratio >= 0.9
                                  ? "bg-amber-500"
                                  : "bg-emerald-500",
                              )}
                              style={{
                                width: `${Math.round(s.ocupacion.ratio * 100)}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {editando !== s.reserva.id && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => decidir(s.reserva.id, "confirm")}
                        disabled={pending}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Confirmar
                      </Button>
                      {/* Spec 138 — sólo si le falta mesa y hay un plano al
                          lado donde elegirla. */}
                      {onAsignarMesa && !s.reserva.table_id && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            onAsignarMesa({
                              id: s.reserva.id,
                              nombre: s.reserva.customer_name,
                              partySize: s.reserva.party_size,
                            })
                          }
                          disabled={pending}
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          Asignar mesa
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditando(s.reserva.id)}
                        disabled={pending}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() =>
                          setRechazando({
                            id: s.reserva.id,
                            nombre: s.reserva.customer_name,
                          })
                        }
                        disabled={pending}
                      >
                        <X className="h-3.5 w-3.5" />
                        Rechazar
                      </Button>
                    </div>
                  )}

                  {editando === s.reserva.id && (
                    <ReservationEditPanel
                      row={s.reserva}
                      timezone={timezone}
                      mode={mode}
                      services={services}
                      activeTables={activeTables}
                      floorPlans={floorPlans}
                      multiSalon={floorPlans.length > 1}
                      pending={pending}
                      onSave={(patch, callbacks) =>
                        start(async () => {
                          const result = await updateReservationDetails({
                            business_slug: slug,
                            reservation_id: s.reserva.id,
                            ...patch,
                          });
                          if (result.ok) {
                            toast.success("Solicitud actualizada.");
                            callbacks.onDone();
                            resincronizar();
                            return;
                          }
                          if (result.error.endsWith(OVERBOOK_HINT)) {
                            callbacks.onOverbook(result.error);
                            return;
                          }
                          toast.error(result.error);
                        })
                      }
                      onClose={() => setEditando(null)}
                      className="mt-2.5"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* Rechazar pide un motivo opcional que viaja al cliente (spec 131). */}
      {rechazando && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => setRechazando(null)}
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
              <span className="font-semibold">{rechazando.nombre}</span> que no
              pudimos tomarla y el lugar queda libre.
            </p>
            <label className="mt-4 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
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
                onClick={() => setRechazando(null)}
                disabled={pending}
              >
                Volver
              </Button>
              <Button
                type="button"
                variant="destructive-solid"
                size="xl"
                className="flex-1"
                onClick={() => decidir(rechazando.id, "reject", motivo)}
                disabled={pending}
              >
                Rechazar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TimeField24 } from "@/components/ui/time-field-24";
import { arrivalSlots } from "@/lib/reservations/flexible-availability";
import type {
  DayServiceOption,
  FloorTable,
  ReservationMode,
} from "@/lib/reservations/types";
import { cn } from "@/lib/utils";

/** Spec 097 — lo que manda el panel de edición (lo ausente no se toca). */
export type EditPatch = {
  table_id: string | null;
  party_size: number;
  time?: string;
  service?: string;
  allow_overbook?: boolean;
};

export type EditCallbacks = {
  onDone: () => void;
  /** Spec 077 — el server avisó que se pasa del cupo; no es un no. */
  onOverbook: (message: string) => void;
};

/** Lo mínimo que el panel necesita saber de la reserva que edita. */
export type EditableReservation = {
  id: string;
  party_size: number;
  table_id: string | null;
  service?: string | null;
  starts_at: string;
};

/**
 * El panel de edición de una reserva (spec 097), compartido.
 *
 * Vivía dentro de la fila de la lista del día. La bandeja de solicitudes
 * (spec 135) necesita exactamente el mismo formulario —comensales, servicio,
 * hora y mesa, con el aviso de sobrecupo— y dos copias del mismo panel se
 * separan al primer cambio, así que se extrajo tal cual.
 *
 * El estado del formulario vive acá: quien lo monta sólo dice cuándo abrirlo y
 * qué hacer al guardar.
 */
export function ReservationEditPanel({
  row,
  timezone,
  mode,
  services,
  activeTables,
  floorPlans,
  multiSalon,
  pending,
  onSave,
  onClose,
  className,
}: {
  row: EditableReservation;
  timezone: string;
  mode: ReservationMode;
  services: DayServiceOption[];
  activeTables: FloorTable[];
  floorPlans: Array<{ id: string; name: string }>;
  multiSalon: boolean;
  pending: boolean;
  onSave: (patch: EditPatch, callbacks: EditCallbacks) => void;
  onClose: () => void;
  className?: string;
}) {
  const timeStart = formatInTimeZone(new Date(row.starts_at), timezone, "HH:mm");
  const isFlexible = mode === "flexible";

  const [editPartySize, setEditPartySize] = useState(row.party_size);
  const [editTableId, setEditTableId] = useState(row.table_id ?? "");
  const [editTime, setEditTime] = useState(timeStart);
  const [editService, setEditService] = useState(
    row.service ?? services[0]?.name ?? "",
  );
  // Spec 077/097 — el cupo es blando para el encargado: el server rechaza una
  // vez con el aviso y recién entonces aparece "Guardar igual".
  const [overbookAsk, setOverbookAsk] = useState<string | null>(null);

  const floorPlanMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const fp of floorPlans) map.set(fp.id, fp.name);
    return map;
  }, [floorPlans]);

  /** Horarios de llegada del servicio elegido (modo flexible). */
  const serviceSlots = useMemo(() => {
    if (!isFlexible) return [];
    const svc = services.find((s) => s.name === editService) ?? services[0];
    if (!svc) return [];
    return arrivalSlots(svc.opens_at, svc.closes_at);
  }, [isFlexible, services, editService]);

  function save(allowOverbook: boolean) {
    // En estricto la mesa es obligatoria; en flexible "" = genérica (sin mesa).
    if (!isFlexible && !editTableId) return;
    onSave(
      {
        table_id: editTableId || null,
        party_size: editPartySize,
        ...(editTime && editTime !== timeStart ? { time: editTime } : {}),
        ...(isFlexible && editService && editService !== row.service
          ? { service: editService }
          : {}),
        ...(allowOverbook ? { allow_overbook: true } : {}),
      },
      {
        onDone: () => {
          setOverbookAsk(null);
          onClose();
        },
        onOverbook: (message) => setOverbookAsk(message),
      },
    );
  }

  return (
      <div className={cn("flex flex-wrap items-end gap-3 rounded-xl bg-muted/50 p-3 ring-1 ring-border/60", className)}>
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Comensales
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={editPartySize}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v) && v >= 1) setEditPartySize(v);
            }}
            className="h-9 w-16 rounded-xl border-0 bg-card px-2 text-center text-sm font-semibold tabular-nums text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>
        {/* Spec 097 — servicio (sólo flexible: es donde "el horario" se
            elige por servicio y no por slot de grilla). */}
        {isFlexible && services.length > 0 && (
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Servicio
            </label>
            <select
              value={editService}
              onChange={(e) => {
                setEditService(e.target.value);
                setOverbookAsk(null);
              }}
              className="h-9 rounded-xl border-0 bg-card px-2.5 text-sm font-medium text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              {!services.some((s) => s.name === editService) && (
                <option value={editService}>{editService || "—"}</option>
              )}
              {services.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.opens_at}–{s.closes_at})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {isFlexible ? "Llegada" : "Hora"}
          </label>
          {isFlexible && serviceSlots.length > 0 ? (
            <select
              value={serviceSlots.includes(editTime) ? editTime : ""}
              onChange={(e) => {
                setEditTime(e.target.value);
                setOverbookAsk(null);
              }}
              className="h-9 rounded-xl border-0 bg-card px-2.5 text-sm font-semibold tabular-nums text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              {!serviceSlots.includes(editTime) && (
                <option value="" disabled>
                  Elegir hora…
                </option>
              )}
              {serviceSlots.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : (
            <TimeField24
              value={editTime}
              onChange={(v) => {
                setEditTime(v);
                setOverbookAsk(null);
              }}
              className="h-9 w-20 rounded-xl border-0 bg-card px-2 text-center text-sm font-semibold text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Mesa
          </label>
          <select
            value={editTableId}
            onChange={(e) => {
              setEditTableId(e.target.value);
              setOverbookAsk(null);
            }}
            className="h-9 w-full max-w-[240px] rounded-xl border-0 bg-card px-2.5 text-sm font-medium text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            {/* Flexible: la mesa se puede decidir al llegar (spec 059), así que
                "sin mesa" es un estado válido y no un formulario incompleto. */}
            {isFlexible ? (
              <option value="">Sin mesa (se define al llegar)</option>
            ) : (
              !editTableId && (
                <option value="" disabled>
                  Elegir mesa…
                </option>
              )
            )}
            {activeTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({t.seats}p)
                {multiSalon
                  ? ` — ${floorPlanMap.get(t.floor_plan_id) ?? ""}`
                  : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="lg"
            onClick={() => save(false)}
            disabled={pending || (!isFlexible && !editTableId)}
          >
            <Check className="h-3.5 w-3.5" />
            Guardar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              setOverbookAsk(null);
              onClose();
            }}
            disabled={pending}
          >
            Cancelar
          </Button>
        </div>
        {overbookAsk && (
          <div className="w-full rounded-xl bg-amber-50 p-2.5 ring-1 ring-amber-200">
            <p className="text-xs font-medium text-amber-900">{overbookAsk}</p>
            <Button
              type="button"
              className="mt-2"
              onClick={() => save(true)}
              disabled={pending}
            >
              <Check className="h-3.5 w-3.5" />
              Guardar igual
            </Button>
          </div>
        )}
      </div>
  );
}

"use client";

import { useState } from "react";

import { AdminDayList, type AdminRow } from "@/components/reservations/admin-day-list";
import { PlanoDelDia } from "@/components/reservations/plano-del-dia";
import { SolicitudesInbox } from "@/components/reservations/solicitudes-inbox";
import type { SolicitudEnBandeja } from "@/lib/reservations/pending-inbox";
import type {
  DayServiceOption,
  FloorTable,
  ReservationMode,
} from "@/lib/reservations/types";

/**
 * La pantalla de reservas: el día y la bandeja, juntos (spec 136).
 *
 * Es un client component porque las dos columnas comparten un estado — la
 * solicitud que está esperando mesa (spec 138). El botón vive en la bandeja y
 * el tap que resuelve vive en el plano, así que el modo tiene que estar arriba
 * de los dos.
 *
 * Spec 192 — lo monta **`/admin/reservas` y también la tab «Reservas» del
 * operativo**. La tab tenía su propia copia del layout, y quedó sin plano
 * cuando el plano se volvió la vista de entrada: dos copias de la misma
 * pantalla se separan al primer cambio. Lo propio de la tab entra por props
 * opcionales — se re-pide el día con su action en vez de recargar la ruta
 * (`onChanged`), el navegador de fechas se queda en `?tab=reservas`
 * (`datePath`) y el filtro de salón del operativo la alcanza (`salonIds`).
 */
export function ReservasWorkspace({
  slug,
  businessId,
  date,
  rows,
  timezone,
  floorPlans,
  activeTables,
  mode,
  services,
  solicitudes,
  diasConSolicitudes,
  ahoraIso,
  onChanged,
  datePath,
  salonIds,
}: {
  slug: string;
  businessId: string;
  date: string;
  rows: AdminRow[];
  timezone: string;
  floorPlans: Array<{ id: string; name: string }>;
  activeTables: FloorTable[];
  mode: ReservationMode;
  services: DayServiceOption[];
  solicitudes: SolicitudEnBandeja[];
  diasConSolicitudes: string[];
  /** Reloj del server, para que la bandeja hidrate sin diferencias. */
  ahoraIso: string;
  /**
   * Cómo re-pedir el día después de mutar. Sin esto —la página server-side— los
   * hijos hacen `router.refresh()`; la tab del operativo pasa su propio refetch,
   * que no re-corre la ruta entera (spec 103).
   */
  onChanged?: (date: string) => void;
  /** Dónde escribe el navegador de fechas. Default: `/admin/reservas`. */
  datePath?: string;
  /** Filtro de salón del operativo, si está puesto. */
  salonIds?: string[];
}) {
  const [asignando, setAsignando] = useState<{
    id: string;
    nombre: string;
    partySize: number;
  } | null>(null);
  /** Spec 189 — se abre en el plano: la primera pregunta del encargado es
   *  «cómo queda el salón», y la lista sigue a un tap. */
  const [vista, setVista] = useState<"lista" | "plano">("plano");

  /** Spec 138 — pedir mesa trae el plano al frente: el modo se prende donde se
   *  resuelve, no donde quedó la vista. */
  function empezarAsignacion(solicitud: {
    id: string;
    nombre: string;
    partySize: number;
  }) {
    setAsignando(solicitud);
    setVista("plano");
  }

  // Spec 136 — el mismo grid en lista y en plano: el día a la izquierda, la
  // bandeja «A confirmar» a la derecha. (La 189 bajaba la bandeja en el plano
  // para ganar ancho; Juan prefirió que las dos vistas tengan el mismo layout.)
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="order-2 min-w-0 flex-1 lg:order-1">
        <AdminDayList
          slug={slug}
          date={date}
          rows={rows}
          timezone={timezone}
          floorPlans={floorPlans}
          activeTables={activeTables}
          mode={mode}
          services={services}
          salonIds={salonIds}
          datePath={datePath}
          diasConSolicitudes={diasConSolicitudes}
          onChanged={onChanged}
          vista={vista}
          onVistaChange={(v) => {
            setVista(v);
            // Volver a la lista con el modo prendido dejaría un banner sin
            // plano: se cancela.
            if (v === "lista") setAsignando(null);
          }}
          plano={
            <PlanoDelDia
              slug={slug}
              date={date}
              timezone={timezone}
              reservas={rows}
              mesas={activeTables}
              floorPlans={floorPlans}
              mode={mode}
              services={services}
              asignando={asignando}
              onAsignarFin={() => setAsignando(null)}
              onChanged={onChanged ? () => onChanged(date) : undefined}
            />
          }
        />
      </div>
      <aside className="order-1 w-full lg:order-2 lg:sticky lg:top-6 lg:w-[340px] lg:shrink-0">
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">A confirmar</h2>
          {solicitudes.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {solicitudes.length}
            </span>
          )}
        </div>
        <SolicitudesInbox
          slug={slug}
          businessId={businessId}
          solicitudes={solicitudes}
          timezone={timezone}
          ahoraIso={ahoraIso}
          mode={mode}
          services={services}
          activeTables={activeTables}
          floorPlans={floorPlans}
          onChanged={onChanged ? () => onChanged(date) : undefined}
          onAsignarMesa={empezarAsignacion}
        />
      </aside>
    </div>
  );
}

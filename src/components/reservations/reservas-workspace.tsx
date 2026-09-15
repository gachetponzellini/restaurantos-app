"use client";

import { useState } from "react";

import { AdminDayList, type AdminRow } from "@/components/reservations/admin-day-list";
import { PlanoDelDia } from "@/components/reservations/plano-del-dia";
import { SolicitudesInbox } from "@/components/reservations/solicitudes-inbox";
import type { SolicitudEnBandeja } from "@/lib/reservations/pending-inbox";
import { cn } from "@/lib/utils";
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
  horasPlano,
  ahoraIso,
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
  horasPlano: string[];
  /** Reloj del server, para que la bandeja hidrate sin diferencias. */
  ahoraIso: string;
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

  // Spec 189 — en el plano la bandeja baja. Al lado se come 340px y el salón
  // queda dibujado a media escala: el nombre y la hora dentro de la mesa no se
  // leen, que es justo lo que el plano tiene que contestar de un vistazo. En la
  // lista, donde el ancho sobra, la bandeja vuelve a la derecha (spec 136).
  const apilado = vista === "plano";

  return (
    <div
      className={cn(
        "flex flex-col gap-6",
        !apilado && "lg:flex-row lg:items-start",
      )}
    >
      <div className={cn("order-2 min-w-0 flex-1", !apilado && "lg:order-1")}>
        <AdminDayList
          slug={slug}
          date={date}
          rows={rows}
          timezone={timezone}
          floorPlans={floorPlans}
          activeTables={activeTables}
          mode={mode}
          services={services}
          diasConSolicitudes={diasConSolicitudes}
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
              horas={horasPlano}
              reservas={rows}
              mesas={activeTables}
              floorPlans={floorPlans}
              mode={mode}
              services={services}
              asignando={asignando}
              onAsignarFin={() => setAsignando(null)}
            />
          }
        />
      </div>
      <aside
        className={cn(
          "order-1 w-full",
          !apilado && "lg:order-2 lg:sticky lg:top-6 lg:w-[340px] lg:shrink-0",
          // Apilada, la bandeja va DEBAJO del plano: arriba empujaría el salón
          // fuera de pantalla cada vez que entra una solicitud.
          apilado && "order-3",
        )}
      >
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">A confirmar</h2>
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
          onAsignarMesa={empezarAsignacion}
        />
      </aside>
    </div>
  );
}

import { notFound } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminRow } from "@/components/reservations/admin-day-list";
import { ReservasWorkspace } from "@/components/reservations/reservas-workspace";
import { AyudaChip } from "@/components/admin/ayuda-chip";
import { PageHeader, PageShell } from "@/components/admin/shell/page-shell";
import { ensureAdminAccess } from "@/lib/admin/context";
import { localDate } from "@/lib/reservations/pending-inbox";
import {
  getPendingInbox,
  getReservationEditContext,
  getReservationServices,
  getReservationSettings,
} from "@/lib/reservations/queries";
import type { FloorTable } from "@/lib/reservations/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function todayInTz(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function AdminReservasPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { business_slug } = await params;
  const { date: dateQuery } = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();
  await ensureAdminAccess(business.id, business_slug);

  const date = dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)
    ? dateQuery
    : todayInTz(business.timezone);

  const dayStart = fromZonedTime(`${date}T00:00:00`, business.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const service = createSupabaseServiceClient() as unknown as SupabaseClient;

  // Reservas del día con join a tables y floor_plans para nombre de salón.
  const { data } = await service
    .from("reservations")
    .select("*, tables(label, floor_plans(id, name))")
    .eq("business_id", business.id)
    .gte("starts_at", dayStart.toISOString())
    .lt("starts_at", dayEnd.toISOString())
    .order("starts_at", { ascending: true });
  const rows = (data ?? []) as AdminRow[];

  // Floor plans y mesas activas para el modal "Nueva reserva".
  const { data: fpData } = await service
    .from("floor_plans")
    .select("id, name")
    .eq("business_id", business.id)
    .order("created_at", { ascending: true });
  const floorPlans = (fpData ?? []) as Array<{ id: string; name: string }>;

  const fpIds = floorPlans.map((fp) => fp.id);
  let activeTables: FloorTable[] = [];
  if (fpIds.length > 0) {
    const { data: tablesData } = await service
      .from("tables")
      .select("*")
      .in("floor_plan_id", fpIds)
      .eq("status", "active");
    activeTables = (tablesData ?? []) as FloorTable[];
  }

  // Spec 097 — el editor de la fila cambia según el modo (en flexible el
  // horario se elige por servicio + hora de llegada).
  const { mode, services } = await getReservationEditContext(business.id, date, {
    useService: true,
  });

  // Spec 135 — la bandeja no mira la fecha: son todas las solicitudes futuras
  // sin responder, de cualquier día.
  const solicitudes = await getPendingInbox(business.id, business.timezone, {
    useService: true,
  });

  // Spec 136 — los días que el navegador de fechas marca con el punto.
  const diasConSolicitudes = [
    ...new Set(
      solicitudes.map((s) => localDate(s.reserva.starts_at, business.timezone)),
    ),
  ];

  return (
    <PageShell width="wide" className="space-y-6">
      <PageHeader
        eyebrow="Reservas"
        title="Reservas"
        description="El día a la izquierda, las solicitudes que esperan respuesta a la derecha."
        action={<AyudaChip slug={business_slug} tema="reservas" />}
      />

      <ReservasWorkspace
        slug={business_slug}
        businessId={business.id}
        date={date}
        rows={rows}
        timezone={business.timezone}
        floorPlans={floorPlans}
        activeTables={activeTables}
        mode={mode}
        services={services}
        solicitudes={solicitudes}
        diasConSolicitudes={diasConSolicitudes}
        ahoraIso={new Date().toISOString()}
      />
    </PageShell>
  );
}

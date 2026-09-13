import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import {
  PageHeader,
  PageShell,
} from "@/components/admin/shell/page-shell";
import { RrhhShell, type RrhhTab } from "@/components/admin/rrhh/rrhh-shell";
import { AsistenciaTab } from "@/components/admin/rrhh/asistencia-tab";
import { EquipoTab } from "@/components/admin/rrhh/equipo-tab";
import { ensureAdminAccess } from "@/lib/admin/context";
import { canEditarAsistencia } from "@/lib/permissions/can";
import { canSee, sectionAccess } from "@/lib/permissions/sections";
import { listBusinessMembers } from "@/lib/admin/members-query";
import {
  getClockHistory,
  getMonthlyOverview,
  monthKey,
  parseMonthStart,
} from "@/lib/rrhh/clock-queries";
import { getBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function RrhhPage({
  params,
  searchParams,
}: {
  params: Promise<{ business_slug: string }>;
  searchParams: Promise<{
    tab?: string;
    disabled?: string;
    month?: string;
    day?: string;
  }>;
}) {
  const { business_slug } = await params;
  const { tab, disabled, month, day } = await searchParams;
  const business = await getBusiness(business_slug);
  if (!business) notFound();

  const ctx = await ensureAdminAccess(business.id, business_slug);
  if (!canSee("rrhh", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin })) {
    redirect(`/${business_slug}/admin`);
  }

  // Spec 179 · D4 — `limited` (la encargada) ve Asistencia y nada más: Equipo
  // tiene PINs, roles y altas, que son llaves del negocio y siguen siendo del
  // admin. Pedir `?tab=equipo` a mano cae en Asistencia, sin error.
  const veEquipo =
    sectionAccess("rrhh", ctx.role, { isPlatformAdmin: ctx.isPlatformAdmin }) ===
    "full";
  const activeTab: RrhhTab =
    tab === "equipo" && veEquipo ? "equipo" : "asistencia";
  // El platform admin impersona sin rol de negocio (`role` null): edita igual.
  const puedeEditar =
    ctx.isPlatformAdmin || (ctx.role !== null && canEditarAsistencia(ctx.role));

  // El mes y el día del drill-down se resuelven en la timezone del local, no
  // en la del proceso: en Vercel (UTC) el mes arrancaba el 31 a las 21:00 AR.
  const timezone = business.timezone;
  const monthStart = parseMonthStart(month, timezone);
  const currentMonth = monthKey(monthStart, timezone);

  const [monthly, members, dayEntries] = await Promise.all([
    getMonthlyOverview(business.id, monthStart, timezone),
    // Equipo los lista; Asistencia los necesita para «Agregar fichada» (179).
    activeTab === "equipo" || puedeEditar
      ? listBusinessMembers(business.id, { includeDisabled: disabled === "1" })
      : Promise.resolve([]),
    day
      ? getClockHistory(business.id, {
          from: `${day}T00:00:00`,
          to: `${day}T23:59:59`,
          timezone,
        })
      : Promise.resolve(undefined),
  ]);

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Gestión"
        title="RRHH"
        description="Asistencia, horas trabajadas y equipo."
      />

      <Suspense>
        <RrhhShell activeTab={activeTab} showEquipo={veEquipo}>
          {activeTab === "asistencia" && (
            <AsistenciaTab
              overview={monthly}
              currentMonth={currentMonth}
              dayEntries={dayEntries}
              slug={business_slug}
              timezone={timezone}
              canEdit={puedeEditar}
              empleados={members
                .filter((m) => !m.disabled_at)
                .map((m) => ({ userId: m.user_id, name: m.full_name ?? "—" }))}
            />
          )}
          {activeTab === "equipo" && (
            <EquipoTab
              slug={business_slug}
              businessName={business.name}
              members={members}
              currentUserId={ctx.userId}
              includeDisabled={disabled === "1"}
              employeeClockData={monthly.perEmployee}
            />
          )}
        </RrhhShell>
      </Suspense>
    </PageShell>
  );
}

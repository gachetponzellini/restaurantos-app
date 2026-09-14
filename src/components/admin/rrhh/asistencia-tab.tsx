"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
  X,
} from "lucide-react";

import type {
  ClockEntry,
  MonthlyOverview,
  MonthlySummaryRow,
} from "@/lib/rrhh/clock-queries";
import {
  formatDateShort,
  formatDuration,
  formatHours,
  formatHoursDecimal,
  formatMonthName,
  formatTime,
  relativeDate,
} from "@/lib/rrhh/format-utils";
import {
  AnularFichadaModal,
  FichadaModal,
} from "@/components/admin/rrhh/fichada-modal";
import { RoleFilter } from "@/components/admin/rrhh/role-filter";
import { SearchInput } from "@/components/admin/rrhh/search-input";
import { RoleBadge } from "@/components/shared/role-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KPI_ACCENTS = {
  hours: "bg-emerald-50 text-emerald-600 ring-emerald-100",
  employees: "bg-blue-50 text-blue-600 ring-blue-100",
  average: "bg-violet-50 text-violet-600 ring-violet-100",
  top: "bg-amber-50 text-amber-600 ring-amber-100",
} as const;

export function AsistenciaTab({
  overview,
  currentMonth,
  dayEntries,
  slug,
  timezone = "America/Argentina/Buenos_Aires",
  canEdit = false,
  empleados = [],
}: {
  overview: MonthlyOverview;
  currentMonth: string;
  dayEntries?: ClockEntry[];
  /** Spec 179 — para corregir / agregar / anular desde el detalle del día. */
  slug?: string;
  timezone?: string;
  canEdit?: boolean;
  empleados?: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const selectedDay = searchParams.get("day");

  const monthName = formatMonthName(overview.rangeStart);

  const navigateMonth = (direction: -1 | 1) => {
    const [y, m] = currentMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + direction, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    params.delete("day");
    const now = new Date();
    const isCurrentMonth =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (isCurrentMonth) params.delete("month");
    else params.set("month", next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : `?`, { scroll: false });
  };

  const selectDay = (date: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (date) params.set("day", date);
    else params.delete("day");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : `?`, { scroll: false });
  };

  const isCurrentMonth = useMemo(() => {
    const now = new Date();
    const [y, m] = currentMonth.split("-").map(Number);
    return y === now.getFullYear() && m === now.getMonth() + 1;
  }, [currentMonth]);

  const filteredEmployees = useMemo(() => {
    let rows = overview.perEmployee;
    if (roleFilter) rows = rows.filter((r) => r.role === roleFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }
    return rows;
  }, [overview.perEmployee, roleFilter, search]);

  const filteredStats = useMemo(() => {
    const totalMinutes = filteredEmployees.reduce((s, e) => s + e.totalMinutes, 0);
    const avgMinutes =
      filteredEmployees.length > 0
        ? Math.round(totalMinutes / filteredEmployees.length)
        : 0;
    return { totalMinutes, avgMinutes, count: filteredEmployees.length };
  }, [filteredEmployees]);

  const topPerformer = filteredEmployees[0];

  return (
    <div className="space-y-8">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon-lg"
          onClick={() => navigateMonth(-1)}
          aria-label="Mes anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="min-w-[10rem] text-center text-xl font-bold capitalize text-zinc-900">
          {monthName}
        </h2>
        <Button
          variant="outline"
          size="icon-lg"
          onClick={() => navigateMonth(1)}
          disabled={isCurrentMonth}
          aria-label="Mes siguiente"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Clock className="size-5" />}
          label="Horas trabajadas"
          value={formatHoursDecimal(filteredStats.totalMinutes)}
          sub={`${overview.daysWithActivity} ${overview.daysWithActivity === 1 ? "día" : "días"} con actividad`}
          accent={KPI_ACCENTS.hours}
        />
        <KpiCard
          icon={<Users className="size-5" />}
          label="Empleados activos"
          value={String(filteredStats.count)}
          sub="ficharon al menos una vez"
          accent={KPI_ACCENTS.employees}
        />
        <KpiCard
          icon={<TrendingUp className="size-5" />}
          label="Promedio por persona"
          value={formatHoursDecimal(filteredStats.avgMinutes)}
          sub="horas totales / empleado"
          accent={KPI_ACCENTS.average}
        />
        <KpiCard
          icon={<Trophy className="size-5" />}
          label="Top del mes"
          value={topPerformer?.name ?? "—"}
          sub={
            topPerformer
              ? `${formatHoursDecimal(topPerformer.totalMinutes)} en ${topPerformer.daysWorked} ${topPerformer.daysWorked === 1 ? "día" : "días"}`
              : "sin datos"
          }
          accent={KPI_ACCENTS.top}
          valueSize="lg"
        />
      </div>

      {/* Daily chart — clickable bars */}
      {overview.dailyTotals.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900">
              Actividad diaria
            </h3>
            <p className="text-xs text-zinc-500">
              Hacé clic en un día para ver el detalle
            </p>
          </div>
          <DailyChart
            data={overview.dailyTotals}
            selectedDay={selectedDay}
            onSelectDay={selectDay}
          />
        </section>
      )}

      {/* Day detail panel */}
      {selectedDay && dayEntries && (
        <DayDetailPanel
          date={selectedDay}
          entries={dayEntries}
          onClose={() => selectDay(null)}
          edicion={
            canEdit && slug
              ? { slug, timezone, empleados, onChanged: () => router.refresh() }
              : null
          }
        />
      )}

      {/* Role filters + search */}
      <div className="flex flex-wrap items-center gap-3">
        <RoleFilter value={roleFilter} onChange={setRoleFilter} />
        <SearchInput
          value={search}
          onChange={setSearch}
          aria-label="Buscar empleado"
          className="ml-auto w-full max-w-[12rem]"
        />
      </div>

      {/* Employee table */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          Detalle por empleado
        </h3>
        {filteredEmployees.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/50 p-12 text-center">
            <Calendar className="mx-auto size-8 text-zinc-300" />
            <p className="mt-3 text-sm font-medium text-zinc-600">
              Sin fichadas {roleFilter ? `para ${roleFilter}` : "este mes"}
            </p>
          </div>
        ) : (
          <EmployeeTable rows={filteredEmployees} />
        )}
      </section>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────── */

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
  valueSize = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: string;
  valueSize?: "default" | "lg";
}) {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          {label}
        </p>
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-xl ring-1",
            accent,
          )}
        >
          {icon}
        </span>
      </div>
      <p
        className={cn(
          "mt-3 truncate font-bold tabular-nums text-zinc-900",
          valueSize === "lg" ? "text-xl" : "text-3xl",
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

// `dateStr` acá siempre es `YYYY-MM-DD` (la fecha del gráfico diario, sin
// hora). `new Date(dateStr)` la lee como medianoche UTC, que en AR cae en el
// día anterior — el mismo desfase que tenía el título del panel de detalle
// (ver `DayDetailPanel`, más abajo). Ancla al mediodía para que no se mueva.
function getDayOfWeekLabel(dateStr: string): string {
  const day = new Date(`${dateStr}T12:00:00`).getDay();
  return ["D", "L", "M", "M", "J", "V", "S"][day];
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

function DailyChart({
  data,
  selectedDay,
  onSelectDay,
}: {
  data: { date: string; totalMinutes: number; employeesCount: number }[];
  selectedDay: string | null;
  onSelectDay: (date: string | null) => void;
}) {
  const maxMinutes = Math.max(...data.map((d) => d.totalMinutes), 1);

  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
      <div className="flex h-40 items-end gap-1">
        {data.map((d) => {
          const heightPct = (d.totalMinutes / maxMinutes) * 100;
          const weekend = isWeekend(d.date);
          const isSelected = selectedDay === d.date;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onSelectDay(isSelected ? null : d.date)}
              aria-pressed={isSelected}
              aria-label={`${formatDateShort(d.date)}: ${formatHours(d.totalMinutes)}, ${d.employeesCount} ${d.employeesCount === 1 ? "persona" : "personas"}`}
              className="group relative flex flex-1 flex-col items-center"
            >
              <div
                className={cn(
                  "w-full rounded-t-md transition-all",
                  isSelected
                    ? "bg-zinc-900"
                    : weekend
                      ? "bg-zinc-200 hover:bg-zinc-300"
                      : "bg-gradient-to-t from-emerald-400 to-emerald-300 hover:from-emerald-500 hover:to-emerald-400",
                )}
                style={{ height: `${heightPct}%`, minHeight: "4px" }}
              />
              <div className="pointer-events-none absolute bottom-full mb-2 hidden whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
                <p className="font-semibold">{formatDateShort(d.date)}</p>
                <p className="text-zinc-300">
                  {formatHours(d.totalMinutes)} · {d.employeesCount}{" "}
                  {d.employeesCount === 1 ? "persona" : "personas"}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1">
        {data.map((d) => (
          <div key={d.date} className="flex-1 text-center">
            <span
              className={cn(
                "text-[0.55rem] font-medium",
                selectedDay === d.date
                  ? "font-bold text-zinc-900"
                  : isWeekend(d.date)
                    ? "text-zinc-300"
                    : "text-zinc-400",
              )}
            >
              {getDayOfWeekLabel(d.date)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type Edicion = {
  slug: string;
  timezone: string;
  empleados: { userId: string; name: string }[];
  onChanged: () => void;
};

function DayDetailPanel({
  date,
  entries,
  onClose,
  edicion,
}: {
  date: string;
  entries: ClockEntry[];
  onClose: () => void;
  /** Spec 179 — null cuando el rol no edita: la tabla queda como siempre. */
  edicion: Edicion | null;
}) {
  // `new Date("2026-09-03")` es medianoche UTC, que en AR es el 2 a las 21:00:
  // el panel del día 3 decía «Miércoles, 2 de septiembre». En la pantalla
  // donde se corrigen horas, el día equivocado en el título es corregir el día
  // equivocado. Al mediodía no hay timezone que lo mueva de fecha.
  const dayLabel = new Date(`${date}T12:00:00`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Spec 179 · D6 — las anuladas se muestran tachadas al final y no suman.
  const vivas = entries.filter((e) => !e.cancelledAt);
  const anuladas = entries.filter((e) => e.cancelledAt);
  const present = vivas.filter((e) => !e.clockOut);
  const finished = vivas.filter((e) => e.clockOut);
  const totalMinutes = vivas.reduce(
    (s, e) => s + (e.durationMinutes ?? 0),
    0,
  );

  const [editando, setEditando] = useState<ClockEntry | null | "nueva">(null);
  const [anulando, setAnulando] = useState<ClockEntry | null>(null);

  return (
    <div className="rounded-2xl bg-white ring-1 ring-zinc-200/70">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div>
          <p className="text-sm font-semibold capitalize text-zinc-900">
            {dayLabel}
          </p>
          <p className="text-xs text-zinc-500">
            {vivas.length} {vivas.length === 1 ? "fichada" : "fichadas"} ·{" "}
            {formatHours(totalMinutes)} totales
            {anuladas.length > 0 && ` · ${anuladas.length} anulada${anuladas.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {edicion && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditando("nueva")}
            >
              <Plus className="mr-1.5 size-3.5" />
              Agregar fichada
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Cerrar detalle del día"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="p-8 text-center text-sm text-zinc-500">
          Sin fichadas este día.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/40 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-2.5">Nombre</th>
                <th className="px-5 py-2.5">Rol</th>
                <th className="px-5 py-2.5">Entrada</th>
                <th className="px-5 py-2.5">Salida</th>
                <th className="px-5 py-2.5 text-right">Duración</th>
                {edicion && <th className="px-5 py-2.5" aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {[...present, ...finished, ...anuladas].map((e) => (
                <tr
                  key={e.id}
                  className={cn(
                    "hover:bg-zinc-50/50",
                    e.cancelledAt && "text-zinc-400 line-through",
                  )}
                  title={e.cancelledAt ? `Anulada: ${e.cancelledReason ?? ""}` : undefined}
                >
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      {!e.clockOut && (
                        <span className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                      )}
                      <span className={cn("font-medium", e.cancelledAt ? "text-zinc-400" : "text-zinc-900")}>
                        {e.name}
                      </span>
                      {e.manual && !e.cancelledAt && (
                        <span
                          className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[0.6rem] font-semibold text-amber-800"
                          title="La cargó un encargado, no fichó con el PIN"
                        >
                          manual
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-2.5">
                    <RoleBadge role={e.role} size="xs" />
                  </td>
                  <td className="px-5 py-2.5 tabular-nums text-zinc-600">
                    {formatTime(e.clockIn)}
                  </td>
                  <td className="px-5 py-2.5 tabular-nums text-zinc-600">
                    {e.clockOut ? formatTime(e.clockOut) : "—"}
                  </td>
                  <td className={cn("px-5 py-2.5 text-right tabular-nums font-semibold", e.cancelledAt ? "text-zinc-400" : "text-zinc-900")}>
                    {formatDuration(e.durationMinutes)}
                  </td>
                  {edicion && (
                    <td className="px-5 py-2.5 text-right">
                      {!e.cancelledAt && (
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Corregir fichada de ${e.name}`}
                            onClick={() => setEditando(e)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Anular fichada de ${e.name}`}
                            onClick={() => setAnulando(e)}
                          >
                            <Trash2 className="size-3.5 text-rose-600" />
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edicion && (
        <>
          <FichadaModal
            open={editando !== null}
            onOpenChange={(o) => !o && setEditando(null)}
            slug={edicion.slug}
            timezone={edicion.timezone}
            entry={editando === "nueva" ? null : editando}
            empleados={edicion.empleados}
            defaultDay={date}
            onDone={edicion.onChanged}
          />
          <AnularFichadaModal
            open={anulando !== null}
            onOpenChange={(o) => !o && setAnulando(null)}
            slug={edicion.slug}
            entry={anulando}
            onDone={edicion.onChanged}
          />
        </>
      )}
    </div>
  );
}

function EmployeeTable({ rows }: { rows: MonthlySummaryRow[] }) {
  const maxMinutes = Math.max(...rows.map((r) => r.totalMinutes), 1);

  return (
    <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-zinc-200/70">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50/60 text-left text-[0.7rem] font-semibold uppercase tracking-wider text-zinc-500">
            <th className="px-5 py-3">Empleado</th>
            <th className="px-5 py-3">Rol</th>
            <th className="px-5 py-3 text-right">Horas mes</th>
            <th className="px-5 py-3 text-right">Días</th>
            <th className="hidden px-5 py-3 text-right sm:table-cell">
              Prom/día
            </th>
            <th className="hidden px-5 py-3 text-right sm:table-cell">Última</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row, idx) => {
            const pct = (row.totalMinutes / maxMinutes) * 100;
            const isTop = idx === 0;
            return (
              <tr
                key={row.userId}
                className="group transition-colors hover:bg-zinc-50/60"
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    {isTop && (
                      <Trophy className="size-3.5 shrink-0 text-amber-500" />
                    )}
                    <span className="truncate font-medium text-zinc-900">
                      {row.name}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <RoleBadge role={row.role} size="xs" />
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-zinc-100 sm:block">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-16 tabular-nums font-semibold text-zinc-900">
                      {formatHours(row.totalMinutes)}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-zinc-600">
                  {row.daysWorked}
                </td>
                <td className="hidden px-5 py-3 text-right tabular-nums text-zinc-600 sm:table-cell">
                  {formatHours(row.avgMinutesPerDay)}
                </td>
                <td className="hidden px-5 py-3 text-right text-xs text-zinc-500 sm:table-cell">
                  {row.lastClockIn ? relativeDate(row.lastClockIn) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

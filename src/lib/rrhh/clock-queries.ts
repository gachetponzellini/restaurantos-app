import "server-only";

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const TZ_AR = "America/Argentina/Buenos_Aires";

/**
 * Convierte un borde de rango a instante absoluto.
 *
 * Las fechas del fichaje entraban acá como strings sin offset
 * (`"2026-09-08T00:00:00"`), y tanto `new Date(...)` como Postgres los
 * interpretaban en la timezone del proceso / de la sesión. En la máquina de dev
 * (AR) eso daba la medianoche correcta y el bug quedaba tapado; en Vercel el
 * proceso corre en UTC, así que el día del fichaje arrancaba a las 21:00 de la
 * noche anterior y se comía la cola de la cena.
 *
 * Lo que se pierde: un `from` sin offset ya NO significa «medianoche del
 * proceso». Significa medianoche del local. Es la misma convención que usa el
 * resto del código (`fromZonedTime` en operación, reservas y disponibilidad).
 */
function toInstant(value: string, timezone: string): string {
  const traeOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  return traeOffset ? value : fromZonedTime(value, timezone).toISOString();
}

/**
 * Primer instante del mes `YYYY-MM` en el calendario del local. Sin mes (o con
 * uno inválido) devuelve el mes corriente del local.
 *
 * Vive acá y no en la página de RRHH porque ahí se armaba con
 * `new Date(y, m - 1, 1)` —medianoche del PROCESO—, y en un server UTC eso es
 * el 31 a las 21:00 AR: el panel del mes arrancaba en el mes anterior.
 */
export function parseMonthStart(
  month: string | undefined,
  timezone: string = TZ_AR,
): Date {
  const key =
    month && /^\d{4}-\d{2}$/.test(month)
      ? month
      : formatInTimeZone(new Date(), timezone, "yyyy-MM");
  return fromZonedTime(`${key}-01T00:00:00`, timezone);
}

/** `Date` → `"YYYY-MM"` en el calendario del local. */
export function monthKey(date: Date, timezone: string = TZ_AR): string {
  return formatInTimeZone(date, timezone, "yyyy-MM");
}

/** Fecha calendario del local (no la UTC) para agrupar horas por día. */
function diaLocal(instant: string, timezone: string): string {
  return formatInTimeZone(new Date(instant), timezone, "yyyy-MM-dd");
}

// Post-migration types not yet regenerated; cast to bypass strict table checks.
// Remove after running `pnpm db:types` against a DB with 0045_rrhh applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

export type ClockEntry = {
  id: string;
  userId: string;
  name: string;
  role: string;
  clockIn: string;
  clockOut: string | null;
  durationMinutes: number | null;
  /** Spec 179: anulada. Sólo la trae `getClockHistory`, para mostrarla tachada. */
  cancelledAt?: string | null;
  cancelledReason?: string | null;
  /** Spec 179: la cargó a mano un encargado (no fichó con el PIN). */
  manual?: boolean;
};

export async function getClockHistory(
  businessId: string,
  opts?: {
    from?: string;
    to?: string;
    userId?: string;
    limit?: number;
    timezone?: string;
  },
): Promise<ClockEntry[]> {
  const service = db();
  const timezone = opts?.timezone ?? TZ_AR;

  // Spec 179 · D6 — es la única lectura que trae las anuladas, y las trae
  // marcadas: el detalle del día las muestra tachadas, como el libro de caja.
  // Todas las demás (sumas de horas, «quién está») las filtran.
  let query = service
    .from("clock_entries")
    .select(
      "id, user_id, clock_in, clock_out, duration_minutes, cancelled_at, cancelled_reason, created_by",
    )
    .eq("business_id", businessId)
    .order("clock_in", { ascending: false })
    .limit(opts?.limit ?? 100);

  if (opts?.from) query = query.gte("clock_in", toInstant(opts.from, timezone));
  if (opts?.to) query = query.lte("clock_in", toInstant(opts.to, timezone));
  if (opts?.userId) query = query.eq("user_id", opts.userId);

  const { data: entries } = await query;
  if (!entries || entries.length === 0) return [];

  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .in("user_id", userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m]),
  );

  return entries.map((e) => {
    const m = memberMap.get(e.user_id);
    return {
      id: e.id,
      userId: e.user_id,
      name: m?.full_name ?? "—",
      role: m?.role ?? "personal",
      clockIn: e.clock_in,
      clockOut: e.clock_out,
      durationMinutes: e.duration_minutes,
      cancelledAt: e.cancelled_at,
      cancelledReason: e.cancelled_reason,
      manual: e.created_by !== null,
    };
  });
}

export type TodaySummary = {
  present: ClockEntry[];
  finished: ClockEntry[];
  absent: { userId: string; name: string; role: string }[];
};

export async function getTodaySummary(
  businessId: string,
  timezone: string = TZ_AR,
): Promise<TodaySummary> {
  const service = db();

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = formatter.format(now);
  // `new Date("…T00:00:00")` parseaba en la timezone del proceso: en un server
  // UTC el «hoy» arrancaba tres horas antes, a las 21:00 de ayer.
  const dayStart = fromZonedTime(`${todayStr}T00:00:00`, timezone);

  const { data: entries } = await service
    .from("clock_entries")
    .select("id, user_id, clock_in, clock_out, duration_minutes")
    .eq("business_id", businessId)
    // Spec 179 · D6 — lo anulado no cuenta.
    .is("cancelled_at", null)
    .gte("clock_in", dayStart.toISOString())
    .order("clock_in", { ascending: true });

  const { data: allMembers } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .is("disabled_at", null);

  const memberMap = new Map(
    (allMembers ?? []).map((m) => [m.user_id, m]),
  );

  const present: ClockEntry[] = [];
  const finished: ClockEntry[] = [];
  const clockedUserIds = new Set<string>();

  for (const e of entries ?? []) {
    const m = memberMap.get(e.user_id);
    const entry: ClockEntry = {
      id: e.id,
      userId: e.user_id,
      name: m?.full_name ?? "—",
      role: m?.role ?? "personal",
      clockIn: e.clock_in,
      clockOut: e.clock_out,
      durationMinutes: e.duration_minutes,
    };
    clockedUserIds.add(e.user_id);
    if (!e.clock_out) present.push(entry);
    else finished.push(entry);
  }

  // La `terminal` (spec 140) no ficha: es la PC compartida del salón, no una
  // persona. Listarla en «sin fichar» sería pedirle asistencia a un mueble —
  // los que fichan desde ella son los mozos, cada uno con su PIN.
  const absent = (allMembers ?? [])
    .filter((m) => m.role !== "terminal")
    .filter((m) => !clockedUserIds.has(m.user_id))
    .map((m) => ({
      userId: m.user_id,
      name: m.full_name ?? "—",
      role: m.role ?? "personal",
    }));

  return { present, finished, absent };
}

export type MonthlySummaryRow = {
  userId: string;
  name: string;
  role: string;
  totalMinutes: number;
  daysWorked: number;
  avgMinutesPerDay: number;
  lastClockIn: string | null;
};

export type MonthlyDailyTotal = {
  date: string;
  totalMinutes: number;
  employeesCount: number;
};

export type MonthlyOverview = {
  rangeStart: string;
  rangeEnd: string;
  totalMinutes: number;
  activeEmployees: number;
  daysWithActivity: number;
  perEmployee: MonthlySummaryRow[];
  dailyTotals: MonthlyDailyTotal[];
};

export async function getMonthlyOverview(
  businessId: string,
  monthStart: Date,
  timezone: string = TZ_AR,
): Promise<MonthlyOverview> {
  const service = db();

  // El mes se re-ancla al calendario del local: `monthStart` sólo dice cuál es
  // el mes, y las fronteras se calculan siempre en AR. Antes el `setMonth` (y
  // el `new Date(y, m-1, 1)` de quien llama) corrían en la timezone del
  // proceso, así que en un server UTC el mes empezaba y terminaba a las 21:00
  // del día anterior — y las horas del borde caían en el mes vecino.
  const [year, month] = formatInTimeZone(monthStart, timezone, "yyyy-MM")
    .split("-")
    .map(Number);
  const inicioMes = fromZonedTime(
    `${formatMonthKey(year, month)}-01T00:00:00`,
    timezone,
  );
  const finMes = fromZonedTime(
    `${formatMonthKey(year + (month === 12 ? 1 : 0), month === 12 ? 1 : month + 1)}-01T00:00:00`,
    timezone,
  );

  const { data: entries } = await service
    .from("clock_entries")
    .select("user_id, clock_in, clock_out, duration_minutes")
    .eq("business_id", businessId)
    // Spec 179 · D6 — lo anulado no suma horas.
    .is("cancelled_at", null)
    .gte("clock_in", inicioMes.toISOString())
    .lt("clock_in", finMes.toISOString())
    .order("clock_in", { ascending: true });

  const rangeStart = inicioMes.toISOString();
  const rangeEnd = finMes.toISOString();

  if (!entries || entries.length === 0) {
    return {
      rangeStart,
      rangeEnd,
      totalMinutes: 0,
      activeEmployees: 0,
      daysWithActivity: 0,
      perEmployee: [],
      dailyTotals: [],
    };
  }

  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .in("user_id", userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m]),
  );

  // Per-employee aggregation
  const empAgg = new Map<
    string,
    {
      totalMinutes: number;
      days: Set<string>;
      lastClockIn: string;
    }
  >();
  // Per-day aggregation (across all employees)
  const dayAgg = new Map<
    string,
    { totalMinutes: number; users: Set<string> }
  >();

  let grandTotalMinutes = 0;

  for (const e of entries) {
    // Use clock_in or fallback to wallclock duration (in-progress entries
    // count as zero for monthly view since clock_out is null).
    const minutes = e.duration_minutes ?? 0;
    // Día del LOCAL, no fecha UTC: un fichaje de las 22:00 AR es 01:00Z del día
    // siguiente, y con `slice(0, 10)` sus horas se le acreditaban a mañana.
    const day = diaLocal(e.clock_in, timezone);

    grandTotalMinutes += minutes;

    const empExisting = empAgg.get(e.user_id) ?? {
      totalMinutes: 0,
      days: new Set<string>(),
      lastClockIn: e.clock_in,
    };
    empExisting.totalMinutes += minutes;
    empExisting.days.add(day);
    if (new Date(e.clock_in) > new Date(empExisting.lastClockIn)) {
      empExisting.lastClockIn = e.clock_in;
    }
    empAgg.set(e.user_id, empExisting);

    const dayExisting = dayAgg.get(day) ?? {
      totalMinutes: 0,
      users: new Set<string>(),
    };
    dayExisting.totalMinutes += minutes;
    dayExisting.users.add(e.user_id);
    dayAgg.set(day, dayExisting);
  }

  const perEmployee: MonthlySummaryRow[] = Array.from(empAgg.entries())
    .map(([userId, stats]) => {
      const m = memberMap.get(userId);
      return {
        userId,
        name: m?.full_name ?? "—",
        role: m?.role ?? "personal",
        totalMinutes: stats.totalMinutes,
        daysWorked: stats.days.size,
        avgMinutesPerDay:
          stats.days.size > 0
            ? Math.round(stats.totalMinutes / stats.days.size)
            : 0,
        lastClockIn: stats.lastClockIn,
      };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  const dailyTotals: MonthlyDailyTotal[] = Array.from(dayAgg.entries())
    .map(([date, stats]) => ({
      date,
      totalMinutes: stats.totalMinutes,
      employeesCount: stats.users.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    rangeStart,
    rangeEnd,
    totalMinutes: grandTotalMinutes,
    activeEmployees: empAgg.size,
    daysWithActivity: dayAgg.size,
    perEmployee,
    dailyTotals,
  };
}

export type WeeklySummaryRow = {
  userId: string;
  name: string;
  role: string;
  totalMinutes: number;
  daysWorked: number;
};

export async function getWeeklySummary(
  businessId: string,
  weekStart: Date,
  timezone: string = TZ_AR,
): Promise<WeeklySummaryRow[]> {
  const service = db();

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const { data: entries } = await service
    .from("clock_entries")
    .select("user_id, clock_in, duration_minutes")
    .eq("business_id", businessId)
    // Spec 179 · D6 — lo anulado no suma horas.
    .is("cancelled_at", null)
    .gte("clock_in", weekStart.toISOString())
    .lt("clock_in", weekEnd.toISOString())
    .not("clock_out", "is", null);

  if (!entries || entries.length === 0) return [];

  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const { data: members } = await service
    .from("business_users")
    .select("user_id, full_name, role")
    .eq("business_id", businessId)
    .in("user_id", userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m]),
  );

  const agg = new Map<string, { totalMinutes: number; days: Set<string> }>();

  for (const e of entries) {
    const existing = agg.get(e.user_id) ?? {
      totalMinutes: 0,
      days: new Set<string>(),
    };
    existing.totalMinutes += e.duration_minutes ?? 0;
    existing.days.add(diaLocal(e.clock_in, timezone));
    agg.set(e.user_id, existing);
  }

  return Array.from(agg.entries()).map(([userId, stats]) => {
    const m = memberMap.get(userId);
    return {
      userId,
      name: m?.full_name ?? "—",
      role: m?.role ?? "personal",
      totalMinutes: stats.totalMinutes,
      daysWorked: stats.days.size,
    };
  });
}

/** `2026-9` → `"2026-09"`. */
function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

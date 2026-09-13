import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

type GenericClient = SupabaseClient;

export type MozoMember = {
  user_id: string;
  full_name: string | null;
  role: "admin" | "encargado" | "mozo";
};

/**
 * Miembros activos del business con rol que opera salón.
 * Ordenados por rol (mozo primero, después encargado/admin) y nombre.
 *
 * El nombre se prefiere desde business_users.full_name (membership-scoped).
 * Si está vacío, cae a users.email para no dejar el dropdown vacío.
 */
export async function getMozosByBusiness(
  businessId: string,
): Promise<MozoMember[]> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("business_users")
    .select("user_id, full_name, role, users!inner(email)")
    .eq("business_id", businessId)
    .is("disabled_at", null)
    .in("role", ["admin", "encargado", "mozo"]);

  if (error) {
    console.error("getMozosByBusiness", error);
    return [];
  }

  const rows = (data ?? []) as unknown as Array<{
    user_id: string;
    full_name: string | null;
    role: "admin" | "encargado" | "mozo";
    users: { email: string | null } | { email: string | null }[] | null;
  }>;

  return rows
    .map((r) => {
      const userObj = Array.isArray(r.users) ? r.users[0] : r.users;
      return {
        user_id: r.user_id,
        full_name: r.full_name?.trim() || userObj?.email || null,
        role: r.role,
      };
    })
    .sort((a, b) => {
      const rolePriority = { mozo: 0, encargado: 1, admin: 2 } as const;
      const roleDiff = rolePriority[a.role] - rolePriority[b.role];
      if (roleDiff !== 0) return roleDiff;
      return (a.full_name ?? "").localeCompare(b.full_name ?? "");
    });
}

// ── Propinas hoy ──────────────────────────────────────────────────────

/**
 * Suma tip_cents de payments atribuidos a este mozo creados hoy (UTC).
 * Usa `attributed_mozo_id` (campo de atribución de propina, seteado en
 * cobro-actions) en vez de orders.mozo_id para respetar transferencias.
 */
export async function getTodayTips(
  businessId: string,
  mozoId: string,
): Promise<number> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await service
    .from("payments")
    .select("tip_cents")
    .eq("business_id", businessId)
    .eq("attributed_mozo_id", mozoId)
    .eq("payment_status", "paid")
    .gte("created_at", todayStart.toISOString());

  if (error) {
    console.error("getTodayTips", error);
    return 0;
  }

  return (data ?? []).reduce(
    (sum, row) => sum + (Number(row.tip_cents) || 0),
    0,
  );
}

// ── Horas trabajadas (semana / mes) ──────────────────────────────────

export type MozoAttendance = {
  todayMinutes: number;
  isClockedIn: boolean;
  weeklyMinutes: number;
  weeklyDays: number;
  monthlyMinutes: number;
  monthlyDays: number;
  overtimeMinutes: number;
};

/**
 * Calcula asistencia del mozo: horas esta semana, horas este mes, y
 * horas extra (>8h/día). Usa la tabla clock_entries.
 */
export async function getMozoAttendance(
  businessId: string,
  userId: string,
): Promise<MozoAttendance> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Monday of current week (ISO week starts Monday)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  // First of current month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  // Fetch all entries this month (superset of this week)
  const { data, error } = await service
    .from("clock_entries")
    .select("clock_in, clock_out, duration_minutes")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    // Spec 179 · D6 — lo anulado no suma horas.
    .is("cancelled_at", null)
    .gte("clock_in", monthStart.toISOString())
    .order("clock_in", { ascending: true });

  if (error) {
    console.error("getMozoAttendance", error);
    return {
      todayMinutes: 0,
      isClockedIn: false,
      weeklyMinutes: 0,
      weeklyDays: 0,
      monthlyMinutes: 0,
      monthlyDays: 0,
      overtimeMinutes: 0,
    };
  }

  const entries = data ?? [];
  const todayStr = now.toISOString().slice(0, 10);
  let todayMinutes = 0;
  let isClockedIn = false;
  let weeklyMinutes = 0;
  const weeklyDaysSet = new Set<string>();
  let monthlyMinutes = 0;
  const monthlyDaysSet = new Set<string>();
  let overtimeMinutes = 0;

  // Group minutes by day for overtime calc
  const minutesByDay = new Map<string, number>();

  for (const e of entries) {
    const clockIn = (e as { clock_in: string }).clock_in;
    const clockOut = (e as { clock_out: string | null }).clock_out;
    const storedMinutes = (e as { duration_minutes: number | null }).duration_minutes;

    // Open entries (no clock_out) → compute elapsed from clock_in to now
    const minutes =
      clockOut === null
        ? Math.max(0, Math.floor((now.getTime() - new Date(clockIn).getTime()) / 60_000))
        : (storedMinutes ?? 0);

    const day = clockIn.slice(0, 10);

    // Today
    if (day === todayStr) {
      todayMinutes += minutes;
      if (clockOut === null) isClockedIn = true;
    }

    monthlyMinutes += minutes;
    monthlyDaysSet.add(day);

    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + minutes);

    const clockInDate = new Date(clockIn);
    if (clockInDate >= weekStart) {
      weeklyMinutes += minutes;
      weeklyDaysSet.add(day);
    }
  }

  // Overtime: sum of minutes beyond 480 (8h) per day
  for (const [, dayMinutes] of minutesByDay) {
    if (dayMinutes > 480) {
      overtimeMinutes += dayMinutes - 480;
    }
  }

  return {
    todayMinutes,
    isClockedIn,
    weeklyMinutes,
    weeklyDays: weeklyDaysSet.size,
    monthlyMinutes,
    monthlyDays: monthlyDaysSet.size,
    overtimeMinutes,
  };
}

export type ActiveTable = {
  id: string;
  label: string;
  operational_status: string;
};

/**
 * Mesas activas (no libres) asignadas a un mozo. Útil para la query "mis
 * mesas" del mozo y para dashboards futuros.
 */
export async function getMyTables(
  mozoId: string,
  businessId: string,
): Promise<ActiveTable[]> {
  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("tables")
    .select(
      "id, label, operational_status, floor_plans!inner(business_id)",
    )
    .eq("mozo_id", mozoId)
    .eq("floor_plans.business_id", businessId)
    .neq("operational_status", "libre");

  if (error) {
    console.error("getMyTables", error);
    return [];
  }
  return (data ?? []).map((t) => ({
    id: (t as { id: string }).id,
    label: (t as { label: string }).label,
    operational_status: (t as { operational_status: string })
      .operational_status,
  }));
}

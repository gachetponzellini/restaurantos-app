import type { AdminOrder } from "@/lib/admin/orders-query";
import type { FloorPlanWithTables } from "@/lib/admin/floor-plan/queries";
import { matchesSalon, matchesSalonReserva } from "@/lib/admin/salon-filter";
import type { CajaConEstado } from "@/lib/caja/types";
import type { ReservationStatus } from "@/lib/reservations/types";
import type { PresentEmployee } from "@/lib/rrhh/clock-actions";

/**
 * Predicados puros de los contadores ("pills") de las tabs de `/admin/operacion`
 * (spec 39, FR-012). Se centralizan acá para que la pill y el contenido de la
 * tab deriven del **mismo criterio** sobre el **mismo dato** de su grupo de
 * streaming: así no puede desincronizarse el badge respecto de la tab, y un
 * badge nunca muestra un "0" provisional (mientras la promesa del grupo no
 * resuelve, la pill muestra "—" vía el fallback de Suspense; el número sólo se
 * calcula una vez que hay dato).
 *
 * Son idénticos a los criterios que vivían inline en `local-shell.tsx`.
 */

/**
 * Pedidos online que requieren atención (nuevos / por confirmar).
 *
 * issue #260 — un encargue para el sábado no requiere atención hoy.
 *
 * El contador sumaba todo lo `pending`/`confirmed` que trajera la query, y esa
 * query incluye los programados futuros (`scheduled_at >= hoy`). Cargabas cinco
 * encargues para el sábado y la pill quedaba en 5 toda la semana, apuntando a
 * pedidos que viven en «Próximos» y no piden nada. Un número que nunca baja a
 * cero deja de mirarse — y la noche que significa algo, ya nadie lo ve.
 *
 * Lo mismo que el rojo crónico de una suite de tests: el daño no es el número,
 * es que entrena a ignorarlo.
 *
 * Se cuenta un programado sólo cuando entró en ventana, o sea cuando su hora de
 * marchar ya pasó: ahí sí hay algo que hacer.
 */
export function countPedidosNuevos(
  orders: AdminOrder[],
  now: Date = new Date(),
): number {
  return orders.filter((o) => {
    if (!["pending", "confirmed"].includes(o.status)) return false;
    if (!o.scheduled_at) return true;
    return new Date(o.scheduled_at).getTime() <= now.getTime();
  }).length;
}

/**
 * Mesas ocupadas = mesas activas que NO están libres (ocupada / pidió cuenta).
 * Refleja cuántas mesas requieren atención del encargado.
 */
export function countSalonOcupadas(
  floorPlans: FloorPlanWithTables[],
  salones: readonly string[] = [],
): number {
  return floorPlans
    .filter((fp) => matchesSalon(salones, fp.plan.id))
    .flatMap((fp) => fp.tables.filter((t) => t.status === "active"))
    .filter((t) => (t.operational_status ?? "libre") !== "libre").length;
}

/** Cajas del negocio (abiertas o configuradas). */
export function countCajas(cajas: CajaConEstado[]): number {
  return cajas.length;
}

/**
 * Rendiciones pendientes = mozos sin resolver en alguna caja (spec 211, de
 * `saldos_mozos`): el mismo criterio con el que la base deja cerrar una caja.
 * Un mozo con saldo en dos cajas cuenta una vez. Money-adjacent: un «0» falso
 * puede llevar a cerrar el turno creyendo que no hay nada.
 */
export function countRendicionesPendientes(
  saldos: { mozo_id: string; resuelto: boolean }[],
): number {
  // Spec 210 v2 — cuenta los mozos con plata sin resolver en alguna caja: lo
  // mismo que frena el cierre. Un mozo con plata de dos cajas cuenta una vez.
  return new Set(saldos.filter((m) => !m.resuelto).map((m) => m.mozo_id)).size;
}

/**
 * Reservas del día que todavía esperan mesa = `confirmed` (las `seated` ya están
 * en el salón y las canceladas / no-show no requieren acción). Es el número que
 * le importa al encargado: cuánta gente falta sentar.
 */
export function countReservasPorSentar(
  rows: {
    status: ReservationStatus;
    tables?: { floor_plans?: { id: string } | null } | null;
    floor_plan_id?: string | null;
  }[],
  salones: readonly string[] = [],
): number {
  return rows.filter(
    (r) => r.status === "confirmed" && matchesSalonReserva(salones, r),
  ).length;
}

/** Personal presente ahora (fichados sin salida). */
export function countPresentes(present: PresentEmployee[]): number {
  return present.length;
}

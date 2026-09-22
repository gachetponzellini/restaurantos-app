"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createNotification } from "@/lib/notifications/create";
import {
  notifyReservationCancelledByLocal,
  notifyReservationConfirmed,
  notifyReservationRejected,
  notifyReservationRequested,
  notifyReservationUpdated,
} from "@/lib/notifications/reservation-notify";
import { canDecideReservation, canManageReservations } from "@/lib/permissions/can";
import { customerPhoneKey } from "@/lib/phone";
import { isTableAvailableForReservation, pickTableExcluding } from "@/lib/reservations/assign-table";
import {
  dayOfWeekFromDate,
  getAllReservableTables,
  getBusinessBySlug,
  getBusinessTables,
  getFlexibleAvailability,
  getReservationActor,
  getReservationServiceByName,
  getReservationSettings,
  getReservationsInRange,
} from "@/lib/reservations/queries";
import {
  flexibleServiceWindow,
  serviceDateForStart,
} from "@/lib/reservations/flexible-availability";
import {
  OVERBOOK_HINT,
  estrictoEditWindow,
  flexibleEditWindow,
  localDateOf,
} from "@/lib/reservations/edit-window";
import {
  AdminCreateReservationInputSchema,
  CancelOwnReservationInputSchema,
  DecideReservationInputSchema,
  CreateFlexibleReservationInputSchema,
  CreateReservationInputSchema,
  SentarReservaInputSchema,
  UpdateReservationDetailsInputSchema,
  UpdateReservationStatusInputSchema,
} from "@/lib/reservations/schema";
import { openTable } from "@/lib/mozo/open-table";
import type { Reservation, ReservationSource } from "@/lib/reservations/types";
import { limitCreateReservation } from "@/lib/rate-limit";
import { excedeTopeDeReservas, TOPE_RESERVAS_MSG } from "@/lib/reservations/tope-cliente";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { dentroDelHorizonte } from "@/lib/reservations/horizonte";

type GenericClient = SupabaseClient;

const EXCLUSION_VIOLATION = "23P01";
const MAX_ASSIGN_RETRIES = 5;

/**
 * Spec 131 — con qué estado nace una reserva. La web y el chatbot **piden**:
 * quedan `pending` hasta que el encargado las mire. El mostrador **acepta**:
 * que el local la cargue ya es la confirmación.
 */
function initialStatus(source: ReservationSource): "pending" | "confirmed" {
  return source === "admin" ? "confirmed" : "pending";
}

/**
 * Autoriza gestionar reservas (crear walk-in, sentar, cambiar estado, editar):
 * admin/encargado/mozo o platform admin (spec 22). Centralizado en
 * `canManageReservations` de `lib/permissions/can.ts`.
 */
async function canManage(businessId: string, userId: string): Promise<boolean> {
  const { role, isPlatformAdmin } = await getReservationActor(businessId, userId);
  return isPlatformAdmin || canManageReservations(role);
}

type CreateContext = {
  source: ReservationSource;
  businessId: string;
  timezone: string;
  userId: string | null;
  /** Email del cliente logueado (auth), para el canal email (spec 45). */
  customerEmail: string | null;
  date: string;
  slot: string;
  partySize: number;
  customerName: string;
  customerPhone: string;
  notes: string | null;
  forcedTableId?: string | null;
  /** Restringe el pool de mesas al salón elegido. Si null, comportamiento
   *  legacy (primer floor_plan del negocio). */
  floorPlanId?: string | null;
};

/**
 * Common booking flow used by both the customer-facing /reservar and the
 * admin "+ Nueva reserva" button. Handles:
 *   - Availability re-check (defends against race after the slot listing).
 *   - Smallest-fit table assignment with retry on 23P01 (exclusion violation).
 *   - Validation against settings (party size, lead time, advance horizon).
 */
async function createReservationCommon(
  ctx: CreateContext,
): Promise<ActionResult<{ id: string }>> {
  const settings = await getReservationSettings(ctx.businessId, { useService: true });

  if (ctx.partySize < 1 || ctx.partySize > settings.max_party_size) {
    return actionError(`El máximo es ${settings.max_party_size} comensales.`);
  }

  const start = fromZonedTime(`${ctx.date}T${ctx.slot}:00`, ctx.timezone);
  if (Number.isNaN(start.getTime())) return actionError("Fecha u hora inválida.");
  const end = new Date(start.getTime() + settings.slot_duration_min * 60_000);

  // Validación de cliente final (lead time / horizonte / horario): aplica a
  // la web directa y al chatbot. Los walk-ins de admin la saltean (el local
  // puede cargar reservas fuera de esas reglas).
  if (ctx.source !== "admin") {
    const leadCutoff = new Date(Date.now() + settings.lead_time_min * 60_000);
    if (start < leadCutoff) {
      return actionError("Necesitamos un poco más de antelación para ese horario.");
    }
    // #372 — días calendario del negocio, la misma regla que el calendario.
    if (!dentroDelHorizonte(ctx.date, new Date(), settings.advance_days_max, ctx.timezone)) {
      return actionError(`Solo aceptamos reservas con hasta ${settings.advance_days_max} días de antelación.`);
    }
    const dow = String(new Date(Date.UTC(
      Number(ctx.date.slice(0, 4)),
      Number(ctx.date.slice(5, 7)) - 1,
      Number(ctx.date.slice(8, 10)),
    )).getUTCDay()) as "0" | "1" | "2" | "3" | "4" | "5" | "6";
    const day = settings.schedule[dow];
    if (!day || !day.open || !day.slots.includes(ctx.slot)) {
      return actionError("Ese horario ya no está disponible.");
    }
  }

  const tables = await getBusinessTables(ctx.businessId, {
    useService: true,
    floorPlanId: ctx.floorPlanId ?? null,
    excludeBar: true,
  });
  const bufferMs = settings.buffer_min * 60_000;

  // Window we'll lookup overlapping reservations across — slightly wider than
  // the new slot so the buffer comparison sees adjacent reservations.
  const windowStart = new Date(start.getTime() - bufferMs);
  const windowEnd = new Date(end.getTime() + bufferMs);
  const reservations = await getReservationsInRange(
    ctx.businessId,
    windowStart.toISOString(),
    windowEnd.toISOString(),
    { useService: true },
  );

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const tried = new Set<string>();

  // Admin can pin a specific table. We don't loop in that case — if the
  // exclusion fires we surface the error directly so the operator picks a
  // different table.
  if (ctx.forcedTableId) {
    const target = tables.find((t) => t.id === ctx.forcedTableId);
    if (!target) return actionError("La mesa seleccionada no existe.");
    if (target.status !== "active") return actionError("La mesa está deshabilitada.");
    if (target.seats < ctx.partySize) {
      return actionError(`La mesa "${target.label}" no tiene capacidad para ${ctx.partySize} personas.`);
    }
    const { data, error } = await service
      .from("reservations")
      .insert({
        business_id: ctx.businessId,
        table_id: target.id,
        user_id: ctx.userId,
        customer_name: ctx.customerName,
        customer_phone: ctx.customerPhone,
        customer_email: ctx.customerEmail,
        party_size: ctx.partySize,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: initialStatus(ctx.source),
        notes: ctx.notes,
        source: ctx.source,
      })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
        return actionError("La mesa ya está reservada en ese horario.");
      }
      console.error("createReservation/forced", error);
      return actionError("No pudimos crear la reserva.");
    }
    return actionOk({ id: (data as { id: string }).id });
  }

  for (let attempt = 0; attempt < MAX_ASSIGN_RETRIES; attempt += 1) {
    const candidate = pickTableExcluding(
      {
        tables,
        reservations,
        partySize: ctx.partySize,
        windowStart: start,
        windowEnd: end,
        bufferMs,
      },
      tried,
    );
    if (!candidate) {
      return actionError("Ya no quedan mesas disponibles para ese horario.");
    }

    const { data, error } = await service
      .from("reservations")
      .insert({
        business_id: ctx.businessId,
        table_id: candidate.id,
        user_id: ctx.userId,
        customer_name: ctx.customerName,
        customer_phone: ctx.customerPhone,
        customer_email: ctx.customerEmail,
        party_size: ctx.partySize,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        status: initialStatus(ctx.source),
        notes: ctx.notes,
        source: ctx.source,
      })
      .select("id")
      .single();

    if (!error && data) {
      return actionOk({ id: (data as { id: string }).id });
    }

    if ((error as { code?: string } | null)?.code === EXCLUSION_VIOLATION) {
      tried.add(candidate.id);
      // Re-fetch the conflicting reservation list so the next pickTable sees
      // the reservation that beat us. Cheap because the window is small.
      const refreshed = await getReservationsInRange(
        ctx.businessId,
        windowStart.toISOString(),
        windowEnd.toISOString(),
        { useService: true },
      );
      reservations.length = 0;
      reservations.push(...refreshed);
      continue;
    }
    console.error("createReservation/insert", error);
    return actionError("No pudimos crear la reserva.");
  }

  return actionError("No pudimos asignarte una mesa, probá otro horario.");
}


/**
 * Guardas del alta de reserva del CLIENTE (auditoría de reservas · ALTA):
 * rate-limit por IP y tope de reservas vivas por cuenta y día. El admin no
 * pasa por acá.
 */
async function guardasDeAltaCliente(params: {
  businessId: string;
  timezone: string;
  userId: string;
  fechaLocal: string;
}): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await limitCreateReservation(ip);
  if (!success) return "Demasiados intentos, esperá un minuto.";
  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  if (await excedeTopeDeReservas(service, params)) return TOPE_RESERVAS_MSG;
  return null;
}

export async function createReservationFromCustomer(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("Necesitás iniciar sesión para reservar.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  // issue #261 — el alta estricta era la puerta de atrás del motor flexible.
  //
  // Esta action no miraba el modo del negocio. Un negocio que pasó a `flexible`
  // conserva la grilla vieja (el toggle no la borra), así que bastaba con
  // mandar una fecha y un `slot` de esa grilla para entrar por acá y saltearse
  // el motor entero: sin chequeo de `soft_capacity`, sin `hold_tables`, sin
  // `service` y sin `floor_plan_id`. Y el cupo del flexible es **duro para el
  // cliente** a propósito (spec 077) — que el encargado pueda sobrevender y el
  // cliente no es justamente la asimetría que la spec vino a fijar.
  //
  // La reserva entraba además sin `service`, o sea como una de esas filas
  // `service: null` que después hay que tratar como legado.
  const settings = await getReservationSettings(business.id, { useService: true });
  if (settings.mode === "flexible") {
    return actionError(
      "Este local toma reservas por servicio. Elegí el horario desde la página de reservas.",
    );
  }

  const bloqueo = await guardasDeAltaCliente({
    businessId: business.id,
    timezone: business.timezone,
    userId: user.id,
    fechaLocal: parsed.data.date,
  });
  if (bloqueo) return actionError(bloqueo);

  const result = await createReservationCommon({
    source: parsed.data.source,
    businessId: business.id,
    timezone: business.timezone,
    userId: user.id,
    customerEmail: user.email ?? null,
    date: parsed.data.date,
    slot: parsed.data.slot,
    partySize: parsed.data.party_size,
    customerName: parsed.data.customer_name,
    customerPhone: parsed.data.customer_phone,
    notes: parsed.data.notes,
    floorPlanId: parsed.data.floor_plan_id ?? null,
  });
  if (result.ok) {
    revalidatePath(`/${parsed.data.business_slug}/reservar`);
    revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
    // spec 27 — avisar al encargado que entró una reserva nueva. Spec 131: es
    // una solicitud pendiente de su decisión, y el aviso lo dice.
    await createNotification({
      businessId: business.id,
      targetRole: "encargado",
      type: "reserva.nueva",
      payload: {
        fecha: parsed.data.date,
        hora: parsed.data.slot,
        personas: parsed.data.party_size,
        nombre: parsed.data.customer_name,
        pendiente: true,
      },
    });
    // spec 45 + 131 — acuse de la SOLICITUD al cliente (best-effort). El aviso
    // de confirmación sale recién cuando el encargado la toma.
    await notifyReservationRequested({ reservationId: result.data.id });
  }
  return result;
}

export async function createReservationFromAdmin(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = AdminCreateReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");
  if (!(await canManage(business.id, user.id))) {
    return actionError("Permiso denegado.");
  }

  const result = await createReservationCommon({
    source: "admin",
    businessId: business.id,
    timezone: business.timezone,
    userId: null,
    customerEmail: null,
    date: parsed.data.date,
    slot: parsed.data.slot,
    partySize: parsed.data.party_size,
    customerName: parsed.data.customer_name,
    customerPhone: parsed.data.customer_phone,
    notes: parsed.data.notes,
    forcedTableId: parsed.data.table_id ?? null,
    // Spec 144 — el salón elegido en el formulario. Sin esto el pool de mesas
    // caía al primer `floor_plan` del negocio: auto-asignaba siempre ahí y una
    // mesa de otro salón se rechazaba con «La mesa seleccionada no existe».
    floorPlanId: parsed.data.floor_plan_id ?? null,
  });
  if (result.ok) {
    revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
    // spec 27 — avisar al encargado que se cargó una reserva nueva.
    await createNotification({
      businessId: business.id,
      targetRole: "encargado",
      type: "reserva.nueva",
      payload: {
        fecha: parsed.data.date,
        hora: parsed.data.slot,
        personas: parsed.data.party_size,
        nombre: parsed.data.customer_name,
      },
    });
  }
  return result;
}

/**
 * Spec 059 — crear una reserva en MODO FLEXIBLE (libro de reservas).
 * La mesa es opcional (genérica → se sienta al llegar), la hora es opcional
 * (sin hora → apertura del servicio). Regla dura: una reserva por (mesa,
 * servicio, fecha) — la garantiza el GIST con `ends_at = cierre del servicio`.
 * NO usa `pickTable`. Los 3 canales (web/chatbot/admin) entran acá cuando el
 * negocio está en modo flexible.
 */
export async function createFlexibleReservation(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateFlexibleReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const business = await getBusinessBySlug(data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  // Auth por canal: admin exige permiso de gestión; cliente exige login.
  if (data.source === "admin") {
    if (!user) return actionError("No autenticado.");
    if (!(await canManage(business.id, user.id))) return actionError("Permiso denegado.");
  } else if (!user) {
    return actionError("Necesitás iniciar sesión para reservar.");
  } else {
    const bloqueo = await guardasDeAltaCliente({
      businessId: business.id,
      timezone: business.timezone,
      userId: user.id,
      fechaLocal: data.date,
    });
    if (bloqueo) return actionError(bloqueo);
  }

  const settings = await getReservationSettings(business.id, { useService: true });
  if (settings.mode !== "flexible") {
    return actionError("Este negocio no usa el modo de reservas flexible.");
  }
  if (data.party_size < 1 || data.party_size > settings.max_party_size) {
    return actionError(`El máximo es ${settings.max_party_size} comensales.`);
  }

  // Servicio + ventana [apertura, cierre].
  const dow = new Date(
    Date.UTC(
      Number(data.date.slice(0, 4)),
      Number(data.date.slice(5, 7)) - 1,
      Number(data.date.slice(8, 10)),
    ),
  ).getUTCDay();
  const svc = await getReservationServiceByName(business.id, data.service, dow, {
    useService: true,
    floorPlanId: data.floor_plan_id ?? null,
  });
  if (!svc) return actionError("Ese servicio no está disponible ese día.");
  const window = flexibleServiceWindow(data.date, svc, business.timezone);
  if (!window) return actionError("El horario del servicio es inválido.");

  // starts = llegada (si viene) o apertura del servicio; ends = cierre del servicio.
  //
  // issue #262 — el servicio que cruza la medianoche.
  //
  // Una cena 20:00→00:30 tiene horarios de llegada legítimos DESPUÉS de las
  // doce: la grilla del modal ofrece 23:45, 00:00, 00:15. Pero «00:15» no es de
  // las 00:15 del día en que el servicio abrió, sino de la madrugada siguiente,
  // y esto lo armaba con `${data.date}T00:15` a secas — o sea **24 horas
  // antes**. Con `ends = window.ends` (que sí rueda al día siguiente), la
  // reserva quedaba abarcando más de un día entero y le comía la mesa el
  // almuerzo y la cena del día anterior. El toast decía «Reserva creada.» y en
  // el listado del día se veía bien.
  //
  // La corrección ya existía, escrita en `edit-window.ts` para el camino de
  // edición, con este mismo comentario. Al alta nunca se le puso: es el patrón
  // de siempre —la regla vive en un camino y no en el otro— y por eso se copia
  // el criterio en vez de inventar uno nuevo. Se agrega también la guarda de
  // contención, que la edición tiene y el alta tampoco tenía.
  let starts = data.arrival_time
    ? fromZonedTime(`${data.date}T${data.arrival_time}:00`, business.timezone)
    : window.starts;
  if (Number.isNaN(starts.getTime())) return actionError("Hora inválida.");
  if (data.arrival_time && starts.getTime() < window.starts.getTime()) {
    const nextDay = new Date(starts.getTime() + 24 * 60 * 60 * 1000);
    if (nextDay.getTime() < window.ends.getTime()) starts = nextDay;
  }
  const ends = window.ends;

  // Y que la llegada caiga DENTRO del servicio: sin esto se podía cargar una
  // reserva a un horario en el que el local no está abierto.
  if (
    starts.getTime() < window.starts.getTime() ||
    starts.getTime() >= window.ends.getTime()
  ) {
    return actionError("Ese horario está fuera del servicio.");
  }

  // No se puede reservar para un horario que ya pasó (gracia de 5 min por skew).
  if (starts.getTime() < Date.now() - 5 * 60_000) {
    return actionError("Ese horario ya pasó, elegí uno más tarde.");
  }

  // Mismo criterio que el modo estricto (createReservationCommon): lead time
  // y horizonte de antelación se validan para el cliente final, no para el
  // walk-in de admin.
  if (data.source !== "admin") {
    const leadCutoff = new Date(Date.now() + settings.lead_time_min * 60_000);
    if (starts.getTime() < leadCutoff.getTime()) {
      return actionError("Necesitamos un poco más de antelación para ese horario.");
    }
    // #372 — días calendario del negocio, la misma regla que el calendario.
    if (!dentroDelHorizonte(data.date, new Date(), settings.advance_days_max, business.timezone)) {
      return actionError(`Solo aceptamos reservas con hasta ${settings.advance_days_max} días de antelación.`);
    }
  }

  // Mesa opcional. Con mesa: valida y deriva la zona. Genérica: usa la zona pedida.
  let tableId: string | null = null;
  let floorPlanId: string | null = data.floor_plan_id ?? null;
  if (data.table_id) {
    const tables = await getAllReservableTables(business.id, { useService: true });
    const target = tables.find((t) => t.id === data.table_id);
    if (!target) return actionError("La mesa seleccionada no existe.");
    if (target.status !== "active") return actionError("La mesa está deshabilitada.");
    if (target.seats < data.party_size) {
      return actionError(
        `La mesa "${target.label}" no tiene capacidad para ${data.party_size} personas.`,
      );
    }
    tableId = target.id;
    floorPlanId = target.floor_plan_id;
  }

  // Spec 077 — el cupo es DURO para el cliente (web/chatbot) y BLANDO para el
  // encargado: puede pasarse, pero sólo confirmándolo (`allow_overbook`). Se
  // consulta sin `tableId` a propósito: los motivos de la mesa puntual ya se
  // resolvieron arriba con mensajes propios; acá sólo interesa el cupo.
  const avail = await getFlexibleAvailability(
    business.id,
    business.timezone,
    {
      date: data.date,
      service: data.service,
      partySize: data.party_size,
      floorPlanId,
      enforceCapacity: true,
    },
    { useService: true },
  );
  if (avail && !avail.available) {
    const sinCupo = avail.reason === "sin-cupo";
    if (data.source !== "admin") {
      return actionError(
        sinCupo
          ? "Ese servicio ya está completo. Probá otro horario, otra fecha u otro salón."
          : "No quedan mesas disponibles para ese servicio.",
      );
    }
    if (!data.allow_overbook) {
      return actionError(
        sinCupo
          ? `El servicio está completo (${avail.reservedCovers}/${avail.softCapacity} cubiertos). Confirmá para reservar igual.`
          : "No quedan mesas libres en ese servicio. Confirmá para reservar igual.",
      );
    }
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: inserted, error } = await service
    .from("reservations")
    .insert({
      business_id: business.id,
      table_id: tableId,
      floor_plan_id: floorPlanId,
      service: svc.name,
      user_id: data.source === "admin" ? null : user?.id ?? null,
      customer_name: data.customer_name,
      customer_phone: data.customer_phone,
      customer_email: data.source === "admin" ? null : user?.email ?? null,
      party_size: data.party_size,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      status: initialStatus(data.source),
      notes: data.notes,
      source: data.source,
    })
    .select("id")
    .single();

  if (error) {
    // GIST con ends_at=cierre → dos en la misma mesa/servicio se pisan (23P01).
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      return actionError("La mesa ya está reservada en ese servicio.");
    }
    console.error("createFlexibleReservation", error);
    return actionError("No pudimos crear la reserva.");
  }
  const id = (inserted as { id: string }).id;

  revalidatePath(`/${data.business_slug}/reservar`);
  revalidatePath(`/${data.business_slug}/admin/reservas`);
  await createNotification({
    businessId: business.id,
    targetRole: "encargado",
    type: "reserva.nueva",
    payload: {
      fecha: data.date,
      hora: data.arrival_time ?? svc.name,
      personas: data.party_size,
      nombre: data.customer_name,
      pendiente: data.source !== "admin",
    },
  });
  if (data.source !== "admin") {
    // Spec 131 — nació pendiente: se avisa el pedido, no una confirmación.
    await notifyReservationRequested({ reservationId: id });
  }
  return actionOk({ id });
}

export async function updateReservationStatus(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = UpdateReservationStatusInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");
  if (!(await canManage(business.id, user.id))) {
    return actionError("Permiso denegado.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // issue #261 — esta action era la puerta de atrás de la decisión.
  //
  // `canManage` incluye al mozo y a la terminal, y el enum acepta `confirmed`.
  // O sea que un mozo podía confirmar una solicitud pendiente sin pasar por
  // `decideReservation` —que exige `canDecideReservation`, o sea encargado— y
  // sin que saliera ni un aviso al cliente: el que manda el mail vive allá.
  // La reserva quedaba «confirmada» con `decided_at`/`decided_by` en NULL, el
  // cliente no se enteraba, no venía, y la mesa se guardaba para nadie.
  //
  // Esta action es para los estados del día (sentar, completar, no vino). La
  // decisión sobre una solicitud tiene su propio camino, con su permiso y su
  // aviso.
  const { data: actual } = await service
    .from("reservations")
    .select("status")
    .eq("id", parsed.data.id)
    .eq("business_id", business.id)
    .maybeSingle();
  const estadoActual = (actual as { status: string } | null)?.status;
  if (!estadoActual) return actionError("Reserva no encontrada.");
  if (estadoActual === "pending") {
    return actionError(
      "Esa solicitud todavía no está decidida: confirmala o rechazala desde el libro de reservas.",
    );
  }

  // Guarda en la misma escritura (revisión adversarial): dos cancelaciones
  // simultáneas (doble click, dos encargados) cambian la fila una sola vez,
  // y el aviso al cliente sale sólo para la que la cambió.
  const { data: cambiada, error } = await service
    .from("reservations")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .eq("business_id", business.id)
    .neq("status", parsed.data.status)
    .select("id");
  if (error) {
    console.error("updateReservationStatus", error);
    return actionError("No pudimos actualizar el estado.");
  }
  const laCambioEsta = ((cambiada ?? []) as { id: string }[]).length > 0;
  // Auditoría de reservas · media — el local canceló una reserva tomada: el
  // cliente se entera (antes no salía nada).
  if (parsed.data.status === "cancelled" && laCambioEsta) {
    await notifyReservationCancelledByLocal({ reservationId: parsed.data.id });
  }
  revalidatePath(`/${parsed.data.business_slug}/admin/reservas`);
  return actionOk(null);
}

/**
 * Spec 131 — la decisión del local sobre una solicitud: la toma o la rechaza.
 *
 * Sólo opera sobre `pending`, y sólo la puede llamar admin/encargado (el mozo
 * gestiona reservas pero no decide cuáles entran: `canDecideReservation`).
 *
 * No re-chequea cupo al confirmar: la pendiente ya venía ocupando el lugar
 * desde que entró (D2), así que confirmarla no mueve la ocupación ni un
 * cubierto. Lo que cambia es que el cliente ahora sí tiene reserva.
 */
export async function decideReservation(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = DecideReservationInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { business_slug, id, decision, reason } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(business_slug);
  if (!business) return actionError("Negocio no encontrado.");

  const { role, isPlatformAdmin } = await getReservationActor(business.id, user.id);
  if (!isPlatformAdmin && !canDecideReservation(role)) {
    return actionError("Sólo el encargado puede confirmar o rechazar reservas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: found } = await service
    .from("reservations")
    .select("id, status")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  const reservation = found as Pick<Reservation, "id" | "status"> | null;
  if (!reservation) return actionError("Reserva no encontrada.");
  if (reservation.status !== "pending") {
    return actionError("Esa reserva ya no está pendiente.");
  }

  const motivo = reason?.trim() || null;
  const { data: decidida, error } = await service
    .from("reservations")
    .update({
      status: decision === "confirm" ? "confirmed" : "rejected",
      rejection_reason: decision === "reject" ? motivo : null,
      decided_at: new Date().toISOString(),
      decided_by: user.id,
    })
    .eq("id", reservation.id)
    .eq("business_id", business.id)
    .eq("status", "pending")
    // issue #261 — el `.eq("status","pending")` de arriba es el candado contra
    // la carrera, pero nadie miraba si había cerrado. Dos encargados decidiendo
    // la misma solicitud —o el cron venciéndola entre el read y el write—
    // hacían que el segundo UPDATE tocara **cero filas** y el aviso al cliente
    // saliera igual: recibía «confirmada» y «no se pudo» por la misma reserva.
    // El log de deduplicación no lo tapa, porque son eventos distintos.
    .select("id");
  if (error) {
    console.error("decideReservation", error);
    return actionError("No pudimos guardar la decisión.");
  }
  if (((decidida ?? []) as { id: string }[]).length === 0) {
    return actionError(
      "Esa reserva ya la resolvió otra persona. Refrescá para ver cómo quedó.",
    );
  }

  // spec 45 + 131 — recién acá el cliente lee "confirmada".
  if (decision === "confirm") {
    await notifyReservationConfirmed({ reservationId: reservation.id });
  } else {
    await notifyReservationRejected({ reservationId: reservation.id, reason: motivo });
  }

  revalidatePath(`/${business_slug}/admin/reservas`);
  revalidatePath(`/${business_slug}/admin/operacion`);
  return actionOk(null);
}

/**
 * Sentar una reserva confirmada: marca la mesa como ocupada, crea la order
 * dine_in y actualiza la reserva a "seated". Conecta los dos sistemas
 * (reservas ↔ operación de mesas) usando openTable() compartido.
 */
export async function sentarReserva(
  input: unknown,
): Promise<ActionResult<{ orderId: string | null }>> {
  const parsed = SentarReservaInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");
  if (!(await canManage(business.id, user.id))) {
    return actionError("Permiso denegado.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Fetch reserva + validar.
  const { data: reservationRow } = await service
    .from("reservations")
    .select("id, table_id, customer_name, customer_phone, party_size, status, notes")
    .eq("id", parsed.data.reservation_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!reservationRow) return actionError("Reserva no encontrada.");
  const reservation = reservationRow as {
    id: string; table_id: string | null; customer_name: string;
    customer_phone: string; party_size: number; status: string; notes: string | null;
  };
  if (reservation.status !== "confirmed") {
    // Spec 131 — la solicitud todavía no es una reserva: primero se decide.
    return actionError(
      reservation.status === "pending"
        ? "Confirmá la reserva antes de sentarla."
        : "Solo se pueden sentar reservas confirmadas.",
    );
  }
  // Spec 059 — reserva GENÉRICA (sin mesa fija, modo flexible): el encargado
  // elige la mesa al sentar (`parsed.data.table_id`). Con mesa fija usa la suya.
  const seatTableId = reservation.table_id ?? parsed.data.table_id ?? null;
  if (!seatTableId) {
    return actionError("Elegí una mesa para sentar la reserva.");
  }

  // Fetch table con cross-tenant validation.
  const { data: tableRow } = await service
    .from("tables")
    .select("id, operational_status, opened_at, mozo_id, floor_plans!inner(business_id)")
    .eq("id", seatTableId)
    .maybeSingle();
  if (!tableRow) return actionError("Mesa no encontrada.");
  const fpRaw = (tableRow as unknown as { floor_plans: unknown }).floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null);
  if (!fp || fp.business_id !== business.id) {
    return actionError("Mesa no encontrada.");
  }
  const table = tableRow as {
    id: string; operational_status: string; opened_at: string | null; mozo_id: string | null;
  };

  // Customer upsert por phone (clave normalizada — issue #114).
  const phoneKey = customerPhoneKey(reservation.customer_phone);
  let customerId: string | null = null;
  if (phoneKey) {
    const { data: existing } = await service
      .from("customers")
      .select("id, name")
      .eq("business_id", business.id)
      .eq("phone", phoneKey)
      .maybeSingle();
    const existingRow = existing as { id: string; name: string | null } | null;
    if (existingRow) {
      customerId = existingRow.id;
      if (reservation.customer_name && reservation.customer_name !== existingRow.name) {
        await service.from("customers").update({ name: reservation.customer_name }).eq("id", existingRow.id);
      }
    } else {
      const { data: created } = await service
        .from("customers")
        .insert({ business_id: business.id, phone: phoneKey, name: reservation.customer_name })
        .select("id")
        .single();
      if (created) customerId = (created as { id: string }).id;
    }
  }

  // Abrir la mesa (shared con walk-in).
  const openResult = await openTable({
    service,
    businessId: business.id,
    table,
    actorUserId: user.id,
    customerName: reservation.customer_name,
    customerPhone: reservation.customer_phone,
    customerId,
    notes: reservation.notes,
  });
  if (!openResult.ok) return openResult;

  // Marcar reserva como seated. En genéricas, registra la mesa donde se sentó.
  //
  // issue #262 — este error se tragaba con un `console.error`. En una reserva
  // genérica el `table_id` se escribe recién acá, y si la mesa ya está tomada
  // por otra reserva del mismo servicio el GIST lo rechaza con 23P01: la mesa
  // quedaba abierta (la orden ya se creó arriba, así que el consumo se factura
  // igual) pero la reserva se quedaba en «confirmada» para siempre. La pantalla
  // mostraba el éxito de abrir la mesa y el 23P01 moría en el log del server,
  // que nadie mira. La reserva reaparecía como «no vino» al cierre del día.
  //
  // No se revierte la apertura: el cliente ya está sentado y la mesa tiene que
  // poder cobrarse. Lo que se hace es **avisarlo**, para que el encargado sepa
  // que la reserva quedó sin cerrar y la resuelva a mano.
  const { error: resErr } = await service
    .from("reservations")
    .update({ status: "seated", table_id: seatTableId })
    .eq("id", reservation.id)
    .eq("business_id", business.id);
  if (resErr) {
    console.error("sentarReserva status update", resErr);
    const chocaConOtra = resErr.code === EXCLUSION_VIOLATION;
    return actionError(
      chocaConOtra
        ? "La mesa se abrió, pero esa mesa ya está comprometida por otra reserva del mismo servicio: la reserva quedó sin sentar. Elegí otra mesa o resolvé el cruce."
        : "La mesa se abrió, pero no pudimos marcar la reserva como sentada. Revisala en el libro.",
    );
  }

  const slug = parsed.data.business_slug;
  revalidatePath(`/${slug}/admin/operacion`);
  revalidatePath(`/${slug}/admin/reservas`);
  revalidatePath(`/${slug}/mozo`);
  return actionOk({ orderId: openResult.data.orderId });
}

/**
 * Día local del servicio al que pertenece una reserva flexible (spec 097).
 *
 * Casi siempre es el día local de `starts_at`, pero con un servicio que cruza
 * la medianoche (cena 20:00 → 00:30) la reserva de las 00:15 pertenece al
 * servicio que abrió el día **anterior**. Como el servicio se busca por día de
 * la semana, hay que probar los dos días: sin esto se resolvía la config del
 * día equivocado (o "no existe ese servicio ese día").
 */
async function resolveServiceDate(
  businessId: string,
  serviceName: string,
  startsAt: string,
  timezone: string,
  floorPlanId: string | null,
): Promise<string | null> {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;
  const candidates = [
    localDateOf(start, timezone),
    localDateOf(new Date(start.getTime() - 24 * 60 * 60 * 1000), timezone),
  ];
  for (const date of new Set(candidates)) {
    const dow = dayOfWeekFromDate(date);
    const svc = await getReservationServiceByName(businessId, serviceName, dow, {
      useService: true,
      floorPlanId,
    });
    if (!svc) continue;
    const resolved = serviceDateForStart(startsAt, svc, timezone);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Editar una reserva confirmada — mesa, comensales y horario (spec 097).
 * Solo admin/encargado/plataforma. Valida todo cruzado contra los valores
 * NUEVOS: capacidad de la mesa para el party nuevo, solape en la ventana nueva,
 * cupo del servicio nuevo, cross-tenant.
 *
 * Los dos modos derivan el cierre distinto:
 * - **estricto**: `starts + slot_duration_min`, solape con buffer.
 * - **flexible**: el cierre del servicio, una reserva viva por (mesa, servicio),
 *   cupo blando con confirmación explícita del encargado (specs 059/077/081).
 *
 * Fuente de verdad del solape: el constraint de exclusión de la DB (23P01). El
 * pre-chequeo es para dar un mensaje bueno, no para reemplazarlo.
 */
export async function updateReservationDetails(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = UpdateReservationDetailsInputSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const business = await getBusinessBySlug(parsed.data.business_slug);
  if (!business) return actionError("Negocio no encontrado.");
  if (!(await canManage(business.id, user.id))) {
    return actionError("Permiso denegado.");
  }

  const settings = await getReservationSettings(business.id, { useService: true });
  if (parsed.data.party_size > settings.max_party_size) {
    return actionError(`El máximo es ${settings.max_party_size} comensales.`);
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  // Fetch reservation + validate state.
  const { data: reservationRow } = await service
    .from("reservations")
    .select("id, table_id, party_size, starts_at, ends_at, status, service, floor_plan_id")
    .eq("id", parsed.data.reservation_id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!reservationRow) return actionError("Reserva no encontrada.");
  const reservation = reservationRow as {
    id: string; table_id: string | null; party_size: number;
    starts_at: string; ends_at: string; status: string;
    service: string | null; floor_plan_id: string | null;
  };
  // Spec 132 — la solicitud pendiente se edita como cualquier reserva viva:
  // «te la tomo, pero a las 21:30 y en el salón 2» es UNA decisión, no dos
  // pasos. Editarla NO la decide: sigue `pending` hasta que el encargado
  // confirme o rechace, para que el aviso al cliente salga una sola vez y con
  // los datos finales.
  if (reservation.status !== "confirmed" && reservation.status !== "pending") {
    return actionError("Solo se pueden editar reservas activas.");
  }

  const isFlexible = settings.mode === "flexible";
  const newPartySize = parsed.data.party_size;
  // `undefined` = no se toca la mesa; `null` = pasa a genérica.
  const newTableId =
    parsed.data.table_id === undefined ? reservation.table_id : parsed.data.table_id;
  if (!newTableId && !isFlexible) {
    return actionError("Elegí una mesa para la reserva.");
  }

  // ── Mesa destino ──────────────────────────────────────────────────────────
  let table: { id: string; label: string; seats: number; floor_plan_id: string } | null = null;
  if (newTableId) {
    // Cross-tenant validation via floor_plans.
    const { data: tableRow } = await service
      .from("tables")
      .select("id, label, seats, status, floor_plan_id, floor_plans!inner(business_id)")
      .eq("id", newTableId)
      .maybeSingle();
    if (!tableRow) return actionError("Mesa no encontrada.");
    const fpRaw = (tableRow as unknown as { floor_plans: unknown }).floor_plans;
    const fp = Array.isArray(fpRaw)
      ? (fpRaw[0] as { business_id: string } | undefined)
      : (fpRaw as { business_id: string } | null);
    if (!fp || fp.business_id !== business.id) {
      return actionError("Mesa no encontrada.");
    }
    const row = tableRow as {
      id: string; label: string; seats: number; status: string; floor_plan_id: string;
    };
    if (row.status !== "active") return actionError("La mesa está deshabilitada.");
    // Cross-validate: new party_size against new table capacity.
    if (row.seats < newPartySize) {
      return actionError(
        `La mesa "${row.label}" tiene ${row.seats} lugares para ${newPartySize} comensales.`,
      );
    }
    table = { id: row.id, label: row.label, seats: row.seats, floor_plan_id: row.floor_plan_id };
  }

  const tableChanged = newTableId !== reservation.table_id;
  const floorPlanId = table ? table.floor_plan_id : reservation.floor_plan_id;

  // ── Ventana nueva ─────────────────────────────────────────────────────────
  // No se valida contra el pasado a propósito: en pleno servicio el encargado
  // tiene que poder corregir la hora de una reserva que ya arrancó.
  let starts = new Date(reservation.starts_at);
  let ends = new Date(reservation.ends_at);
  let windowChanged = false;
  let serviceName = reservation.service;
  let serviceDate: string | null = null;

  // Una reserva SIN servicio en un negocio flexible es una fila vieja (creada
  // antes de la 059, o por un canal que todavía no es mode-aware). Se edita por
  // el camino estricto en vez de rebotar: si no, dejaba de ser editable.
  const targetService = parsed.data.service ?? reservation.service;
  const useFlexible = isFlexible && Boolean(targetService);

  if (useFlexible && targetService) {
    const serviceChanged = targetService !== reservation.service;

    // La jornada se ancla en el servicio ACTUAL (el que la reserva tiene hoy),
    // porque cambiar de servicio no cambia de día.
    serviceDate =
      (reservation.service
        ? await resolveServiceDate(
            business.id,
            reservation.service,
            reservation.starts_at,
            business.timezone,
            floorPlanId,
          )
        : null) ?? localDateOf(starts, business.timezone);

    const dow = dayOfWeekFromDate(serviceDate);
    const svc = await getReservationServiceByName(business.id, targetService, dow, {
      useService: true,
      floorPlanId,
    });
    if (!svc) return actionError(`"${targetService}" no está disponible ese día.`);

    if (parsed.data.time || serviceChanged) {
      const result = flexibleEditWindow({
        serviceDate,
        service: svc,
        timezone: business.timezone,
        time: parsed.data.time,
        serviceChanged,
        currentStartsAt: reservation.starts_at,
      });
      if (!result.ok) {
        if (result.reason === "fuera-de-servicio") {
          return actionError(
            `Ese horario está fuera de ${svc.name} (${svc.opens_at.slice(0, 5)} a ${svc.closes_at.slice(0, 5)}).`,
          );
        }
        return actionError("Hora inválida.");
      }
      starts = result.starts;
      ends = result.ends;
      windowChanged = true;
    }
    serviceName = svc.name;
  } else if (parsed.data.time) {
    const result = estrictoEditWindow({
      currentStartsAt: reservation.starts_at,
      time: parsed.data.time,
      timezone: business.timezone,
      slotDurationMin: settings.slot_duration_min,
    });
    if (!result) return actionError("Hora inválida.");
    starts = result.starts;
    ends = result.ends;
    windowChanged = true;
  }

  // ── Solape y cupo ─────────────────────────────────────────────────────────
  if (useFlexible && serviceName && serviceDate) {
    // Una sola consulta resuelve las dos preguntas del modo flexible: si la
    // mesa está libre ESE servicio y si el cupo (cubiertos + mesas) alcanza.
    // Excluyendo la reserva editada, que si no se pisa a sí misma.
    const avail = await getFlexibleAvailability(
      business.id,
      business.timezone,
      {
        date: serviceDate,
        service: serviceName,
        partySize: newPartySize,
        tableId: newTableId,
        floorPlanId,
        enforceCapacity: true,
        excludeReservationId: reservation.id,
      },
      { useService: true },
    );
    if (avail && !avail.available) {
      if (avail.reason === "mesa-ocupada") {
        return actionError("La mesa ya está reservada en ese servicio.");
      }
      if (avail.reason === "mesa-chica" || avail.reason === "mesa-inexistente") {
        return actionError("Esa mesa no sirve para esta reserva.");
      }
      // Spec 077 — el cupo es blando para el encargado: se pasa confirmando.
      if (!parsed.data.allow_overbook) {
        return actionError(
          avail.reason === "sin-cupo"
            ? `El servicio queda completo (${avail.reservedCovers + newPartySize}/${avail.softCapacity} cubiertos). ${OVERBOOK_HINT}`
            : `No quedan mesas libres en ese servicio. ${OVERBOOK_HINT}`,
        );
      }
    }
  } else if (table && (tableChanged || windowChanged)) {
    const bufferMs = settings.buffer_min * 60_000;
    const lookupStart = new Date(starts.getTime() - bufferMs);
    const lookupEnd = new Date(ends.getTime() + bufferMs);
    const reservations = await getReservationsInRange(
      business.id,
      lookupStart.toISOString(),
      lookupEnd.toISOString(),
      { useService: true },
    );

    const available = isTableAvailableForReservation({
      tableId: table.id,
      reservations,
      windowStart: starts,
      windowEnd: ends,
      bufferMs,
      excludeReservationId: reservation.id,
    });
    if (!available) {
      return actionError("La mesa ya está reservada en ese horario.");
    }
  }

  // ── Atomic update ─────────────────────────────────────────────────────────
  const patch: Record<string, unknown> = {
    table_id: newTableId,
    party_size: newPartySize,
  };
  if (windowChanged) {
    patch.starts_at = starts.toISOString();
    patch.ends_at = ends.toISOString();
  }
  if (isFlexible) {
    patch.service = serviceName;
    patch.floor_plan_id = floorPlanId;
  }

  const { error } = await service
    .from("reservations")
    .update(patch)
    .eq("id", reservation.id)
    .eq("business_id", business.id);
  if (error) {
    if ((error as { code?: string }).code === EXCLUSION_VIOLATION) {
      return actionError("La mesa ya está reservada en ese horario.");
    }
    console.error("updateReservationDetails", error);
    return actionError("No pudimos actualizar la reserva.");
  }

  // Auditoría de reservas · media — si cambió el día/hora o las personas, el
  // cliente se entera (antes llegaba a la hora vieja). Cambiar sólo la mesa no
  // le importa: no se avisa. Una solicitud todavía pendiente tampoco: su aviso
  // es el de la decisión.
  const cambioHora = windowChanged && starts.toISOString() !== new Date(reservation.starts_at).toISOString();
  const cambioPersonas = newPartySize !== reservation.party_size;
  if ((cambioHora || cambioPersonas) && reservation.status !== "pending") {
    await notifyReservationUpdated({
      reservationId: reservation.id,
      antes: { starts_at: reservation.starts_at, party_size: reservation.party_size },
    });
  }

  const slug = parsed.data.business_slug;
  revalidatePath(`/${slug}/admin/reservas`);
  revalidatePath(`/${slug}/admin/reservas/plano`);
  revalidatePath(`/${slug}/admin/operacion`);
  return actionOk(null);
}

export async function cancelOwnReservation(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = CancelOwnReservationInputSchema.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return actionError("No autenticado.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data: reservation } = await service
    .from("reservations")
    .select("id, business_id, user_id, starts_at, status, customer_name")
    .eq("id", parsed.data.id)
    .maybeSingle();
  const r = reservation as Pick<Reservation, "id" | "business_id" | "user_id" | "starts_at" | "status" | "customer_name"> | null;
  if (!r) return actionError("Reserva no encontrada.");
  if (r.user_id !== user.id) return actionError("Permiso denegado.");
  // Spec 131 — `pending` SÍ se puede cancelar (el cliente se arrepiente antes
  // de que el local conteste); `rejected` y `expired` son terminales.
  // Auditoría de reservas · baja — `seated` tampoco: el cliente ya está
  // sentado; cancelarla desde el celular dejaba la mesa sin su reserva.
  if (["cancelled", "completed", "no_show", "rejected", "expired", "seated"].includes(r.status)) {
    return actionError("La reserva ya no está activa.");
  }

  const settings = await getReservationSettings(r.business_id, { useService: true });
  const cutoff = new Date(new Date(r.starts_at).getTime() - settings.lead_time_min * 60_000);
  if (Date.now() > cutoff.getTime()) {
    return actionError("Ya pasó la ventana para cancelar online. Avisá al local.");
  }

  const { error } = await service
    .from("reservations")
    .update({ status: "cancelled" })
    .eq("id", r.id)
    .eq("user_id", user.id)
    // Guarda en la escritura: si el local la sentó en el medio, no se cancela.
    .in("status", ["pending", "confirmed"]);
  if (error) return actionError("No pudimos cancelar la reserva.");

  // spec 27 — avisar al encargado que el cliente canceló su reserva.
  await createNotification({
    businessId: r.business_id,
    targetRole: "encargado",
    type: "reserva.cancelada_cliente",
    payload: { nombre: r.customer_name },
  });

  return actionOk(null);
}

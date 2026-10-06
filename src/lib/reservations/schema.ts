import { z } from "zod";

const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// H-20 — mensajes en español rioplatense para los campos que ve el cliente.
// Sin esto, Zod devuelve "Too small: expected number to be >=1".
const DATE_YMD_ES = z
  .string({ error: "Elegí una fecha." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Elegí una fecha válida.");
const SLOT_ES = z
  .string({ error: "Elegí un horario." })
  .regex(TIME_HHMM, "Elegí un horario válido.");
const PARTY_SIZE_ES = z.coerce
  .number({ error: "Indicá cuántas personas son." })
  .int("La cantidad de personas tiene que ser un número entero.")
  .min(1, "Tiene que ser al menos 1 persona.")
  .max(100, "Máximo 100 personas por reserva.");
const CUSTOMER_NAME_ES = z
  .string({ error: "Ingresá tu nombre." })
  .trim()
  .min(1, "Ingresá tu nombre.")
  .max(80, "El nombre puede tener hasta 80 caracteres.");
const CUSTOMER_PHONE_MAX_ES = "El teléfono puede tener hasta 40 caracteres.";
const NOTES_ES = z
  .string()
  .trim()
  .max(500, "Las notas pueden tener hasta 500 caracteres.")
  .optional()
  .transform((v) => (!v ? null : v));

export const TableShapeSchema = z.enum(["circle", "square", "rect"]);
export const TableStatusSchema = z.enum(["active", "disabled"]);

export const FloorTableInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, "El nombre es obligatorio.").max(40),
  seats: z.coerce.number().int().min(1).max(50),
  shape: TableShapeSchema,
  x: z.coerce.number().int(),
  y: z.coerce.number().int(),
  width: z.coerce.number().int().min(20),
  height: z.coerce.number().int().min(20),
  rotation: z.coerce.number().int().min(-360).max(360).default(0),
  status: TableStatusSchema.default("active"),
  // Mesa de barra (spec 08): venta directa, fuera del motor de reservas.
  is_bar: z.boolean().default(false),
});

export const SaveFloorPlanInputSchema = z.object({
  business_slug: z.string().min(1),
  /** Si viene, edita ese floor_plan específico. Si no, comportamiento legacy
   *  (primero existente o crea uno). Necesario para multi-salón. */
  floor_plan_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(60).default("Salón"),
  width: z.coerce.number().int().min(100).max(5000),
  height: z.coerce.number().int().min(100).max(5000),
  background_image_url: z
    .string()
    .url()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  background_opacity: z.coerce.number().int().min(0).max(100).default(60),
  /** Spec 067 — mostrar el nombre del cliente en las mesas ocupadas. */
  show_customer_name: z.coerce.boolean().default(false),
  tables: z.array(FloorTableInputSchema).max(200),
});

export type SaveFloorPlanInput = z.infer<typeof SaveFloorPlanInputSchema>;
export type FloorTableInput = z.infer<typeof FloorTableInputSchema>;

export const DayScheduleSchema = z.object({
  open: z.boolean(),
  slots: z
    .array(z.string().regex(TIME_HHMM, "Formato HH:MM"))
    .max(30),
});

export const WeeklyScheduleSchema = z.record(
  z.enum(["0", "1", "2", "3", "4", "5", "6"]),
  DayScheduleSchema,
);

export const ReservationSettingsInputSchema = z.object({
  business_slug: z.string().min(1),
  slot_duration_min: z.coerce.number().int().min(15).max(600),
  buffer_min: z.coerce.number().int().min(0).max(180),
  lead_time_min: z.coerce.number().int().min(0).max(60 * 24 * 7),
  advance_days_max: z.coerce.number().int().min(1).max(365),
  max_party_size: z.coerce.number().int().min(1).max(100),
  no_show_grace_min: z.coerce.number().int().min(0).max(600),
  schedule: WeeklyScheduleSchema,
  /** Spec 059 — modo de reservas del negocio. Opcional: si no viene, no se toca. */
  mode: z.enum(["estricto", "flexible"]).optional(),
});

export type ReservationSettingsInput = z.infer<typeof ReservationSettingsInputSchema>;

// ── Spec 059 · modo flexible ────────────────────────────────────────────────

/** Cambiar solo el modo de reservas del negocio (toggle en la config). */
export const SetReservationModeInputSchema = z.object({
  business_slug: z.string().min(1),
  mode: z.enum(["estricto", "flexible"]),
});
export type SetReservationModeInput = z.infer<typeof SetReservationModeInputSchema>;

/**
 * Alta/edición de un servicio para VARIOS días de una (spec 059). Reemplaza al
 * alta fila-por-día: el grupo se identifica por (nombre, zona) y se reescribe
 * entero, así editar días o horarios es una sola acción — y de paso limpia
 * duplicados del mismo nombre/zona.
 */
export const ReservationServiceGroupsInputSchema = z
  .object({
    business_slug: z.string().min(1),
    /** Servicios marcados. Cada uno con su propio horario/cupo (Almuerzo y Cena
     *  no comparten horario), pero todos se aplican a los MISMOS días. */
    services: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(40),
          /** Nombre anterior, cuando se renombra un grupo existente. */
          previous_name: z.string().trim().max(40).optional(),
          opens_at: z.string().regex(TIME_HHMM, "Hora inválida"),
          closes_at: z.string().regex(TIME_HHMM, "Hora inválida"),
          soft_capacity: z.coerce.number().int().min(1).max(100000).nullable().optional(),
          /** Spec 081 — mesas que quedan libres para walk-ins. 0 = sin colchón. */
          hold_tables: z.coerce.number().int().min(0).max(1000).nullable().optional(),
        }),
      )
      .min(1, "Marcá al menos un servicio."),
    /** Días 0..6 (0=Domingo). Ignorado si `every_day` es true. */
    days: z.array(z.coerce.number().int().min(0).max(6)).default([]),
    /** true = una sola fila que aplica a todos los días (day_of_week NULL). */
    every_day: z.boolean().default(false),
    /** Zonas marcadas. Vacío = todo el negocio (floor_plan_id NULL). */
    floor_plan_ids: z.array(z.string().uuid()).default([]),
  })
  .refine((v) => v.every_day || v.days.length > 0, {
    message: "Marcá al menos un día.",
    path: ["days"],
  });
export type ReservationServiceGroupsInput = z.infer<typeof ReservationServiceGroupsInputSchema>;

export const DeleteReservationServiceGroupInputSchema = z.object({
  business_slug: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  floor_plan_id: z.string().uuid().nullable().optional(),
});

/**
 * Crear una reserva en modo flexible. La mesa es opcional (genérica → se sienta
 * al llegar), la hora es opcional (sin hora → inicio del servicio). El servicio
 * es obligatorio.
 */
export const CreateFlexibleReservationInputSchema = z
  .object({
  business_slug: z.string().min(1),
  date: DATE_YMD_ES,
  /** Nombre del servicio (matchea reservation_services.name). */
  service: z.string().trim().min(1).max(40),
  /** Hora de llegada (HH:MM). Obligatoria: el local siempre carga la reserva con horario. */
  arrival_time: z
    .string({ error: "Elegí un horario de llegada." })
    .regex(TIME_HHMM, "Hora inválida"),
  party_size: PARTY_SIZE_ES,
  /** Mesa puntual (opcional). Si no viene, la reserva es genérica. */
  table_id: z.string().uuid().optional(),
  /** Zona/salón (para genéricas). */
  floor_plan_id: z.string().uuid().optional(),
  customer_name: CUSTOMER_NAME_ES,
  /** Obligatorio para el cliente (web/chatbot); opcional cuando lo carga el
   *  encargado (`source: "admin"`): el libro del club no siempre lo tiene.
   *  La columna es NOT NULL, así que sin teléfono se guarda "". */
  customer_phone: z
    .string()
    .trim()
    .max(40, CUSTOMER_PHONE_MAX_ES)
    .optional()
    .transform((v) => v ?? ""),
  notes: NOTES_ES,
  source: z.enum(["web", "chatbot", "admin"]).default("web"),
  /**
   * Spec 077 — el encargado confirmó que se pasa del cupo del servicio. Sólo
   * se honra con `source: "admin"`; nunca saltea la regla una-reserva-por-mesa.
   */
  allow_overbook: z.boolean().optional().default(false),
  })
  .refine((v) => v.source === "admin" || v.customer_phone.length >= 4, {
    message: "Ingresá un teléfono válido.",
    path: ["customer_phone"],
  });
export type CreateFlexibleReservationInput = z.infer<typeof CreateFlexibleReservationInputSchema>;

export const CreateReservationInputSchema = z.object({
  business_slug: z.string().min(1),
  date: DATE_YMD_ES,
  slot: SLOT_ES,
  party_size: PARTY_SIZE_ES,
  customer_name: CUSTOMER_NAME_ES,
  customer_phone: z
    .string({ error: "Ingresá un teléfono válido." })
    .trim()
    .min(4, "Ingresá un teléfono válido.")
    .max(40, CUSTOMER_PHONE_MAX_ES),
  notes: NOTES_ES,
  /** Salón elegido cuando el negocio tiene más de uno. Si no viene, el
   *  flujo asume el primer floor_plan (legacy single-salón). */
  floor_plan_id: z.string().uuid().optional(),
  /** Canal de origen del cliente. La web directa no lo manda (default 'web');
   *  el handoff del chatbot lo setea en 'chatbot'. 'admin' no se acepta acá:
   *  los walk-ins van por AdminCreateReservationInputSchema. */
  source: z.enum(["web", "chatbot"]).default("web"),
});

export type CreateReservationInput = z.infer<typeof CreateReservationInputSchema>;

export const AdminCreateReservationInputSchema = CreateReservationInputSchema.extend({
  table_id: z.string().uuid().optional(),
  /** El encargado puede cargar la reserva sin teléfono (a diferencia del
   *  cliente web, que sí lo necesita). Columna NOT NULL → se guarda "". */
  customer_phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v ?? ""),
});

export type AdminCreateReservationInput = z.infer<typeof AdminCreateReservationInputSchema>;

export const UpdateReservationStatusInputSchema = z.object({
  business_slug: z.string().min(1),
  id: z.string().uuid(),
  /**
   * Estados operativos del día. Spec 131: `pending` / `rejected` / `expired`
   * quedan afuera a propósito — a una solicitud se la resuelve con
   * `decideReservation` (o la vence el cron), no cambiándole el estado a mano.
   */
  status: z.enum(["confirmed", "seated", "completed", "no_show", "cancelled"]),
});

/**
 * Spec 131 — la decisión del encargado sobre una solicitud: la toma o no.
 * El motivo sólo tiene sentido al rechazar y viaja al cliente en el aviso.
 */
export const DecideReservationInputSchema = z.object({
  business_slug: z.string().min(1),
  id: z.string().uuid(),
  decision: z.enum(["confirm", "reject"]),
  reason: z.string().trim().max(200).optional(),
});

export type DecideReservationInput = z.infer<typeof DecideReservationInputSchema>;

export const SentarReservaInputSchema = z.object({
  business_slug: z.string().min(1),
  reservation_id: z.string().uuid(),
  /** Spec 059 — mesa elegida al sentar una reserva GENÉRICA (sin mesa fija).
   *  Las reservas con mesa fija la ignoran (usan la suya). */
  table_id: z.string().uuid().optional(),
});

export type UpdateReservationStatusInput = z.infer<typeof UpdateReservationStatusInputSchema>;

export const CancelOwnReservationInputSchema = z.object({
  id: z.string().uuid(),
});

export const UpdateReservationDetailsInputSchema = z.object({
  business_slug: z.string().min(1),
  reservation_id: z.string().uuid(),
  /**
   * Spec 097 — `undefined` deja la mesa como está; `null` la saca (reserva
   * GENÉRICA, sólo válido en modo flexible: en estricto la mesa es obligatoria).
   */
  table_id: z.string().uuid().nullable().optional(),
  party_size: z.coerce.number().int().min(1).max(100),
  /** Spec 097 — hora nueva ("HH:MM" local). Ausente = no se toca el horario. */
  time: z.string().regex(TIME_HHMM, "Hora inválida").optional(),
  /** Spec 097 — servicio destino (modo flexible). Ausente = conserva el suyo. */
  service: z.string().trim().min(1).max(60).optional(),
  /**
   * Spec 077/097 — el encargado confirmó pasarse del cupo del servicio. Nunca
   * saltea la regla una-reserva-por-mesa, sólo el cupo blando.
   */
  allow_overbook: z.boolean().optional().default(false),
});

export type UpdateReservationDetailsInput = z.infer<typeof UpdateReservationDetailsInputSchema>;

export const AvailabilityQuerySchema = z.object({
  business_slug: z.string().min(1),
  date: DATE_YMD_ES,
  party_size: PARTY_SIZE_ES,
  /** Si viene, restringe los horarios a las mesas de ese salón. */
  floor_plan_id: z.string().uuid().optional(),
});

export const ListSalonesQuerySchema = z.object({
  business_slug: z.string().min(1),
});

/** Spec 059 — disponibilidad del modo flexible: mesas libres + cubiertos de un servicio. */
export const FlexibleAvailabilityQuerySchema = z.object({
  business_slug: z.string().min(1),
  date: DATE_YMD_ES,
  service: z.string().trim().min(1).max(40),
  party_size: PARTY_SIZE_ES,
  floor_plan_id: z.string().uuid().optional(),
  /**
   * Spec 077 — el flujo del cliente lo manda en `true` para que el veredicto
   * incluya el tope de cupo. El modal del encargado lo omite (advisory).
   */
  enforce_capacity: z.boolean().optional().default(false),
});

export type ListSalonesQuery = z.infer<typeof ListSalonesQuerySchema>;

export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isValidPrinterHost } from "@/lib/catalog/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAccessMessage } from "@/lib/admin/access-message";
import { findAuthUserByEmail } from "@/lib/admin/auth-user-lookup";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { BUSINESS_ROLES, type BusinessRoleInput } from "@/lib/admin/roles";

// Post-migration types not yet regenerated; cast to bypass strict table checks.
// Remove after running `pnpm db:types` against a DB with 0045_rrhh applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;
const svc = () => createSupabaseServiceClient() as unknown as AnyClient;

const FullNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio.")
  .max(80, "Nombre demasiado largo.");

const PhoneSchema = z
  .string()
  .trim()
  .max(40, "Teléfono demasiado largo.")
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const PinSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" ? undefined : v))
  .refine((v) => !v || /^\d{4}$/.test(v), "El PIN debe ser de 4 dígitos numéricos.");

const InviteInput = z.object({
  business_slug: z.string().min(1),
  email: z.string().email("Email inválido."),
  role: z.enum(BUSINESS_ROLES),
  full_name: FullNameSchema,
  phone: PhoneSchema,
  pin: PinSchema,
});

export type InvitePayload = {
  email: string;
  role: BusinessRoleInput;
  isNewUser: boolean;
  inviteLink: string | null;
};

const CreateWithPasswordInput = z.object({
  business_slug: z.string().min(1),
  email: z.string().email("Email inválido.").optional(),
  password: z.string().min(8, "Contraseña muy corta (mínimo 8).").max(72).optional(),
  role: z.enum(BUSINESS_ROLES),
  full_name: FullNameSchema,
  phone: PhoneSchema,
  pin: PinSchema,
});

export type CreateMemberPayload = {
  email: string;
  password: string;
  role: BusinessRoleInput;
  wasCreated: boolean;
};

const UpdateProfileInput = z.object({
  business_slug: z.string().min(1),
  user_id: z.string().min(1),
  full_name: FullNameSchema.optional(),
  phone: PhoneSchema,
});

const UpdateRoleInput = z.object({
  business_slug: z.string().min(1),
  user_id: z.string().min(1),
  role: z.enum(BUSINESS_ROLES),
});

export type UpdateRolePayload = {
  role: BusinessRoleInput;
  /**
   * `true` cuando el miembro pasa a un rol que entra al sistema con
   * email + contraseña pero su cuenta tiene el email interno que genera el
   * alta de Personal (`personal-XXXX@slug.internal`). No puede loguearse
   * hasta que se le carguen credenciales reales.
   */
  needsCredentials: boolean;
};

async function assertCanManage(businessSlug: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "No autenticado." };

  const service = svc();
  const { data: business } = await service
    .from("businesses")
    .select("id")
    .eq("slug", businessSlug)
    .maybeSingle();
  if (!business) return { ok: false as const, error: "Negocio no encontrado." };

  const [{ data: profile }, { data: membership }] = await Promise.all([
    service
      .from("users")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle(),
    service
      .from("business_users")
      .select("role, disabled_at")
      .eq("business_id", business.id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const isPlatformAdmin = profile?.is_platform_admin ?? false;
  const isAdmin =
    membership?.role === "admin" &&
    (membership as { disabled_at: string | null }).disabled_at === null;
  if (!isPlatformAdmin && !isAdmin) {
    return { ok: false as const, error: "Permiso denegado." };
  }
  return {
    ok: true as const,
    user,
    businessId: business.id,
    isPlatformAdmin,
  };
}

type MiembroExistente = {
  role: BusinessRoleInput;
  pin: string | null;
  full_name: string | null;
  disabled_at: string | null;
};

async function buscarMiembro(
  service: AnyClient,
  businessId: string,
  userId: string,
): Promise<MiembroExistente | null> {
  const { data } = await service
    .from("business_users")
    .select("role, pin, full_name, disabled_at")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as MiembroExistente | null) ?? null;
}

/**
 * Las guardas de `updateMemberRole`, aplicadas al alta.
 *
 * El formulario de alta escribe con `upsert onConflict: business_id,user_id`.
 * Para un email que ya es del equipo eso no da de alta a nadie: cambia el rol
 * del que estaba. Era la misma escritura que `updateMemberRole` rechaza, por
 * otra puerta — y por ahí se llegaba a dejar el negocio en cero admins, que
 * desde la UI no tiene vuelta atrás (no queda nadie que pueda cambiar roles).
 *
 * Lo que se pierde: el alta ya no sirve como atajo para degradar a alguien.
 * Para eso está el cambio de rol de la lista del equipo, con sus mismas reglas.
 */
async function guardaDeCambioDeRol(
  service: AnyClient,
  guard: { businessId: string; user: { id: string }; isPlatformAdmin: boolean },
  userId: string,
  nuevoRol: BusinessRoleInput,
  existente: MiembroExistente | null,
): Promise<string | null> {
  if (!existente) return null;
  if (existente.role === nuevoRol) return null;

  if (userId === guard.user.id && !guard.isPlatformAdmin) {
    return "No podés cambiarte el rol a vos mismo.";
  }

  if (existente.role === "admin" && existente.disabled_at === null) {
    const { count } = await service
      .from("business_users")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", guard.businessId)
      .eq("role", "admin")
      .is("disabled_at", null);
    if ((count ?? 0) <= 1) {
      return "Tiene que quedar al menos un Admin activo en el negocio.";
    }
  }

  return null;
}

/**
 * ¿Quién tiene ese PIN? Mira también a los dados de baja.
 *
 * El índice único de PIN es parcial (sólo filas activas), así que el chequeo de
 * duplicados miraba únicamente a los activos y dejaba reciclar el PIN de un
 * dado de baja. Eso daba verde y armaba una trampa a futuro: el día que alguien
 * quería reactivar al primero, el índice lo rebotaba con un error genérico y no
 * había ninguna pantalla para cambiarle el PIN a nadie.
 *
 * Lo que se pierde: el PIN de alguien dado de baja queda reservado. Para
 * liberarlo hay que reasignárselo a esa persona (el alta sobre su mismo email
 * pisa el PIN) — con 10.000 combinaciones, el costo es barato al lado de un
 * empleado que no puede volver.
 */
async function pinOcupadoPor(
  service: AnyClient,
  businessId: string,
  pin: string,
  exceptUserId?: string,
): Promise<{ nombre: string; deBaja: boolean } | null> {
  const { data } = await service
    .from("business_users")
    .select("user_id, full_name, disabled_at")
    .eq("business_id", businessId)
    .eq("pin", pin);
  type Fila = {
    user_id: string;
    full_name: string | null;
    disabled_at: string | null;
  };
  const otros = ((data ?? []) as Fila[]).filter(
    (m) => m.user_id !== exceptUserId,
  );
  // El activo primero: es el único choque accionable (el índice único sólo
  // cuenta filas activas), y es el nombre que hay que decirle al admin.
  const fila = otros.find((m) => m.disabled_at === null) ?? otros[0];
  if (!fila) return null;
  return {
    nombre: fila.full_name ?? "otro miembro",
    deBaja: fila.disabled_at !== null,
  };
}

function errorDePin(ocupado: { nombre: string; deBaja: boolean }): string {
  return ocupado.deBaja
    ? `Ese PIN es de ${ocupado.nombre}, que está dado de baja. Elegí otro: si lo reciclás, después no vas a poder reactivarlo.`
    : "Ese PIN ya está en uso en este negocio.";
}

function revalidateEmpleados(slug: string) {
  revalidatePath(`/${slug}/admin/empleados`);
  revalidatePath(`/${slug}/admin/usuarios`);
  revalidatePath(`/${slug}/admin/rrhh`);
}

export async function inviteBusinessMemberByAdmin(
  input: unknown,
): Promise<ActionResult<InvitePayload>> {
  const parsed = InviteInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { business_slug, email, role, full_name, phone, pin } = parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = svc();

  let user = await findAuthUserByEmail(service, email);

  // El email puede ser de alguien que ya está en el equipo: entonces esto no
  // es un alta sino una edición, y valen las mismas reglas que el cambio de rol.
  const existente = user
    ? await buscarMiembro(service, guard.businessId, user.id)
    : null;

  const errorDeRol = await guardaDeCambioDeRol(
    service,
    guard,
    user?.id ?? "",
    role,
    existente,
  );
  if (errorDeRol) return actionError(errorDeRol);

  // El PIN que va a quedar: si el formulario no manda uno, se conserva el que
  // ya tenía. El tab de link ni siquiera dibuja el campo, así que un `pin`
  // vacío ahí no es «borrale el PIN», es «no lo toques» — y borrárselo dejaba
  // sin fichar a alguien que fichaba, sin decir una palabra.
  const pinFinal = pin ?? existente?.pin ?? null;

  // El rol Personal entra al sistema sólo por PIN: sin PIN no puede fichar, que
  // es literalmente todo lo que hace en el sistema. La regla ya estaba escrita
  // en los otros dos caminos (alta por contraseña y cambio de rol).
  if (role === "personal" && !pinFinal) {
    return actionError("El rol Personal requiere un PIN de 4 dígitos.");
  }

  if (pinFinal) {
    const ocupado = await pinOcupadoPor(
      service,
      guard.businessId,
      pinFinal,
      user?.id,
    );
    if (ocupado) return actionError(errorDePin(ocupado));
  }

  const siteUrl = getSiteUrl();
  // Usamos /auth/confirm con verifyOtp + token_hash en lugar del action_link
  // crudo que devuelve Supabase, porque los links admin-generados no tienen
  // code_verifier (PKCE) en el navegador del invitado y exchangeCodeForSession
  // fallaría.
  const buildConfirmUrl = (
    tokenHash: string,
    type: "invite" | "magiclink",
    next: string,
  ) =>
    `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(
      tokenHash,
    )}&type=${type}&next=${encodeURIComponent(next)}`;

  let inviteLink: string | null = null;
  let isNewUser = false;

  if (!user) {
    // Usuario nuevo → link de invitación que pide setear contraseña.
    const { data: linkData, error: linkErr } =
      await service.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: `${siteUrl}/${business_slug}/admin/bienvenida` },
      });
    if (linkErr || !linkData.user) {
      console.error("generateLink invite", linkErr);
      return actionError(
        linkErr?.message ?? "No pudimos generar la invitación.",
      );
    }
    user = linkData.user;
    const hashed = linkData.properties?.hashed_token;
    if (hashed) {
      inviteLink = buildConfirmUrl(
        hashed,
        "invite",
        `/${business_slug}/admin/bienvenida`,
      );
    }
    isNewUser = true;
  }

  const { error: userUpsertErr } = await service
    .from("users")
    .upsert({ id: user.id, email }, { onConflict: "id" });
  if (userUpsertErr) return actionError("No pudimos registrar el usuario.");

  const { error: buErr } = await service.from("business_users").upsert(
    {
      business_id: guard.businessId,
      user_id: user.id,
      role,
      full_name,
      phone: phone ?? null,
      pin: pinFinal,
      disabled_at: null,
    },
    { onConflict: "business_id,user_id" },
  );
  if (buErr) {
    console.error("business_users upsert", buErr);
    return actionError("No pudimos asignar al miembro.");
  }

  // Si el usuario ya existía, igual generamos un magic link para que pueda
  // entrar directo sin contraseña — útil si nunca se logueó todavía.
  if (!isNewUser) {
    // Si nunca completó la bienvenida (no tiene welcomed_at), igual lo
    // ruteamos a bienvenida así setea contraseña. Si ya está welcomed,
    // entra derecho al panel.
    const wasWelcomed = Boolean(
      (user!.user_metadata as Record<string, unknown> | null)?.welcomed_at,
    );
    const next = wasWelcomed
      ? `/${business_slug}/admin`
      : `/${business_slug}/admin/bienvenida`;

    const { data: magicData, error: magicErr } =
      await service.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${siteUrl}${next}` },
      });
    if (magicErr) {
      console.error("generateLink magiclink", magicErr);
    } else {
      const hashed = magicData.properties?.hashed_token;
      if (hashed) {
        inviteLink = buildConfirmUrl(hashed, "magiclink", next);
      }
    }

    // Si no había seteado contraseña, marcamos al usuario como "pending welcome"
    // para que la UI lo comunique correctamente.
    if (!wasWelcomed) {
      isNewUser = true;
    }
  }

  revalidateEmpleados(business_slug);
  return actionOk({
    email,
    role,
    isNewUser,
    inviteLink,
  });
}

/**
 * Crea directo el usuario con email + contraseña fija (sin mail, sin link).
 * Pensado para que el admin comparta credenciales por WhatsApp o cualquier
 * canal. El usuario arranca con `welcomed_at` seteado para saltear la
 * pantalla de bienvenida — ya tiene contraseña.
 */
export async function createBusinessMemberWithPassword(
  input: unknown,
): Promise<ActionResult<CreateMemberPayload>> {
  const parsed = CreateWithPasswordInput.safeParse(input);
  if (!parsed.success) {
    return actionError(
      parsed.error.issues[0]?.message ?? "Datos inválidos.",
    );
  }
  const { business_slug, role, full_name, phone, pin } = parsed.data;
  let { email, password } = parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = svc();

  if (role === "personal") {
    if (!pin) return actionError("El rol Personal requiere un PIN de 4 dígitos.");
    email = `personal-${pin}@${business_slug}.internal`;
    password = crypto.randomUUID().slice(0, 16);
  } else {
    if (!email) return actionError("El email es obligatorio.");
    if (!password) return actionError("La contraseña es obligatoria.");
  }

  const existing = await findAuthUserByEmail(service, email!);

  const existente = existing
    ? await buscarMiembro(service, guard.businessId, existing.id)
    : null;

  const errorDeRol = await guardaDeCambioDeRol(
    service,
    guard,
    existing?.id ?? "",
    role,
    existente,
  );
  if (errorDeRol) return actionError(errorDeRol);

  // Personal no tiene email propio: su cuenta se deriva del PIN
  // (`personal-XXXX@slug.internal`). Reciclar el PIN de un Personal dado de
  // baja no daba de alta a nadie nuevo — pisaba SU fila, y las horas fichadas
  // que ya estaban en la base pasaban a figurar con el nombre del reemplazo.
  if (role === "personal" && existente?.disabled_at) {
    return actionError(
      `Ese PIN es de ${existente.full_name ?? "alguien"}, que está dado de baja. Elegí otro PIN, o reactivalo desde el equipo.`,
    );
  }

  const pinFinal = pin ?? existente?.pin ?? null;

  if (pinFinal) {
    const ocupado = await pinOcupadoPor(
      service,
      guard.businessId,
      pinFinal,
      existing?.id,
    );
    if (ocupado) return actionError(errorDePin(ocupado));
  }

  let userId: string;
  let wasCreated = false;

  if (existing) {
    const { error: updErr } = await service.auth.admin.updateUserById(
      existing.id,
      {
        password,
        email_confirm: true,
        user_metadata: {
          ...(existing.user_metadata ?? {}),
          full_name,
          welcomed_at:
            (existing.user_metadata as Record<string, unknown> | null)
              ?.welcomed_at ?? new Date().toISOString(),
        },
      },
    );
    if (updErr) {
      console.error("createBusinessMemberWithPassword update", updErr);
      return actionError(updErr.message || "No pudimos actualizar el usuario.");
    }
    userId = existing.id;
  } else {
    const { data: created, error: createErr } =
      await service.auth.admin.createUser({
        email: email!,
        password: password!,
        email_confirm: true,
        user_metadata: {
          full_name,
          welcomed_at: new Date().toISOString(),
        },
      });
    if (createErr || !created.user) {
      console.error("createBusinessMemberWithPassword create", createErr);
      return actionError(createErr?.message || "No pudimos crear el usuario.");
    }
    userId = created.user.id;
    wasCreated = true;
  }

  const { error: userUpsertErr } = await service
    .from("users")
    .upsert(
      { id: userId, email: email! },
      { onConflict: "id" },
    );
  if (userUpsertErr) {
    console.error("users upsert", userUpsertErr);
    return actionError("No pudimos registrar el usuario.");
  }

  const { error: buErr } = await service.from("business_users").upsert(
    {
      business_id: guard.businessId,
      user_id: userId,
      role,
      full_name,
      phone: phone ?? null,
      pin: pinFinal,
      disabled_at: null,
    },
    { onConflict: "business_id,user_id" },
  );
  if (buErr) {
    console.error("business_users upsert", buErr);
    return actionError("No pudimos asignar al miembro.");
  }

  revalidateEmpleados(business_slug);
  return actionOk({
    email: email!,
    password: password!,
    role,
    wasCreated,
  });
}

/**
 * Soft-delete: setea `disabled_at = now()`. Preserva el histórico
 * (orders.mozo_id, comandas.created_by, etc.). El acceso al panel queda
 * bloqueado en `ensureAdminAccess`.
 *
 * Antes se llamaba `removeBusinessMemberByAdmin` y hacía `delete` físico.
 * Ver: wiki/casos-de-uso/CU-12-alta-empleado.md (D-CU12-2).
 */
export async function disableBusinessMember(
  businessSlug: string,
  userId: string,
): Promise<ActionResult<null>> {
  const guard = await assertCanManage(businessSlug);
  if (!guard.ok) return actionError(guard.error);

  if (userId === guard.user.id && !guard.isPlatformAdmin) {
    return actionError("No podés deshabilitarte a vos mismo.");
  }

  const service = svc();

  const { error } = await service
    .from("business_users")
    .update({ disabled_at: new Date().toISOString() })
    .eq("business_id", guard.businessId)
    .eq("user_id", userId);
  if (error) {
    console.error("disableBusinessMember", error);
    return actionError("No pudimos deshabilitar al miembro.");
  }

  revalidateEmpleados(businessSlug);
  return actionOk(null);
}

export async function enableBusinessMember(
  businessSlug: string,
  userId: string,
): Promise<ActionResult<null>> {
  const guard = await assertCanManage(businessSlug);
  if (!guard.ok) return actionError(guard.error);

  const service = svc();

  // El índice único de PIN sólo cuenta filas activas, así que reactivar a
  // alguien puede chocar contra el PIN que mientras tanto se le dio a otro. El
  // update pelado devolvía "No pudimos reactivar al miembro." y ahí terminaba
  // todo: ni qué pasó, ni cómo salir. Ahora dice quién tiene el PIN, que es lo
  // único accionable (dárselo a otro, o dar de baja al que lo tiene).
  const miembro = await buscarMiembro(service, guard.businessId, userId);
  if (miembro?.pin) {
    const ocupado = await pinOcupadoPor(
      service,
      guard.businessId,
      miembro.pin,
      userId,
    );
    if (ocupado && !ocupado.deBaja) {
      return actionError(
        `No pudimos reactivar a ${miembro.full_name ?? "este miembro"}: su PIN (${miembro.pin}) ahora lo usa ${ocupado.nombre}. Cambiale el PIN a ${ocupado.nombre} —o dalo de baja— y reintentá.`,
      );
    }
  }

  const { error } = await service
    .from("business_users")
    .update({ disabled_at: null })
    .eq("business_id", guard.businessId)
    .eq("user_id", userId);
  if (error) {
    console.error("enableBusinessMember", error);
    return actionError("No pudimos reactivar al miembro.");
  }

  revalidateEmpleados(businessSlug);
  return actionOk(null);
}

export async function updateMemberProfile(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = UpdateProfileInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { business_slug, user_id, full_name, phone } = parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  const patch: { full_name?: string; phone?: string | null } = {};
  if (full_name !== undefined) patch.full_name = full_name;
  if (phone !== undefined) patch.phone = phone ?? null;
  if (Object.keys(patch).length === 0) return actionOk(null);

  const service = svc();
  const { error } = await service
    .from("business_users")
    .update(patch)
    .eq("business_id", guard.businessId)
    .eq("user_id", user_id);
  if (error) {
    console.error("updateMemberProfile", error);
    return actionError("No pudimos actualizar al miembro.");
  }

  revalidateEmpleados(business_slug);
  return actionOk(null);
}

/**
 * La comandera de control de una terminal (spec 181 · D2).
 *
 * Sólo para el rol `terminal`: es un puesto, no una persona, y el control de
 * lo que se manda desde esa compu sale por acá. `null` = la del negocio. El
 * destino admite IP o `local:NOMBRE` (la USB de esa compu, D3).
 */
export async function updateTerminalPrinter(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = z
    .object({
      business_slug: z.string().min(1),
      user_id: z.string().uuid(),
      control_printer_ip: z.string().trim().max(255).nullable(),
      control_printer_port: z.number().int().min(1).max(65535).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { business_slug, user_id, control_printer_ip, control_printer_port } =
    parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  const ip = control_printer_ip?.trim() || null;
  if (ip && !isValidPrinterHost(ip)) {
    return actionError(
      "Destino inválido: una IP privada (192.168.…), un nombre de red, o `local:NOMBRE` para una impresora USB de esa compu.",
    );
  }

  const service = svc();
  const { data: member } = await service
    .from("business_users")
    .select("role")
    .eq("business_id", guard.businessId)
    .eq("user_id", user_id)
    .maybeSingle();
  if (!member) return actionError("Miembro no encontrado.");
  if ((member as { role: string }).role !== "terminal") {
    return actionError("La impresora de control es de una terminal, no de una persona.");
  }

  const { error } = await service
    .from("business_users")
    .update({
      control_printer_ip: ip,
      control_printer_port: ip ? control_printer_port : null,
    })
    .eq("business_id", guard.businessId)
    .eq("user_id", user_id);
  if (error) {
    console.error("updateTerminalPrinter", error);
    return actionError("No pudimos guardar la impresora.");
  }

  revalidateEmpleados(business_slug);
  return actionOk(null);
}

/**
 * Cambia el rol de un miembro dentro del negocio.
 *
 * Guardas:
 * - Solo admin del negocio o platform admin (`assertCanManage`).
 * - Nadie se cambia el rol a sí mismo (evita auto-degradarse y quedar afuera).
 * - Siempre queda al menos un Admin activo en el negocio.
 * - El rol Personal necesita PIN cargado (es como ficha asistencia).
 */
export async function updateMemberRole(
  input: unknown,
): Promise<ActionResult<UpdateRolePayload>> {
  const parsed = UpdateRoleInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const { business_slug, user_id, role } = parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  if (user_id === guard.user.id && !guard.isPlatformAdmin) {
    return actionError("No podés cambiarte el rol a vos mismo.");
  }

  const service = svc();

  const { data: member } = await service
    .from("business_users")
    .select("role, pin, users:user_id(email)")
    .eq("business_id", guard.businessId)
    .eq("user_id", user_id)
    .maybeSingle();
  if (!member) return actionError("Miembro no encontrado.");

  const currentRole = member.role as BusinessRoleInput;
  const email: string | null =
    (member as { users?: { email?: string | null } | null }).users?.email ??
    null;

  if (currentRole === role) {
    return actionOk({ role, needsCredentials: false });
  }

  if (role === "personal" && !member.pin) {
    return actionError(
      "El rol Personal necesita un PIN de 4 dígitos. Cargáselo antes de cambiarlo.",
    );
  }

  // El negocio no puede quedarse sin Admin activo.
  if (currentRole === "admin") {
    const { count } = await service
      .from("business_users")
      .select("user_id", { count: "exact", head: true })
      .eq("business_id", guard.businessId)
      .eq("role", "admin")
      .is("disabled_at", null);
    if ((count ?? 0) <= 1) {
      return actionError(
        "Tiene que quedar al menos un Admin activo en el negocio.",
      );
    }
  }

  const { error } = await service
    .from("business_users")
    .update({ role })
    .eq("business_id", guard.businessId)
    .eq("user_id", user_id);
  if (error) {
    console.error("updateMemberRole", error);
    return actionError("No pudimos cambiar el rol.");
  }

  revalidateEmpleados(business_slug);
  return actionOk({
    role,
    needsCredentials: role !== "personal" && isInternalEmail(email),
  });
}

/**
 * Los usuarios de rol Personal se crean con un email sintético
 * (`personal-XXXX@slug.internal`) porque entran por PIN, no por login.
 */
function isInternalEmail(email: string | null): boolean {
  return Boolean(email && email.toLowerCase().endsWith(".internal"));
}

function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost:3000";
  const proto = rootDomain.includes("localhost") ? "http" : "https";
  return `${proto}://${rootDomain}`;
}

// ─────────────────────────────────────────────────────────────────────
// Spec 142 · D5 — el link de acceso para alguien que YA está dado de alta.
// ─────────────────────────────────────────────────────────────────────

export type AccessLinkPayload = {
  link: string;
  email: string;
  pin: string | null;
  fullName: string | null;
  yaTienePassword: boolean;
  businessName: string;
  /** Ya armado con `buildAccessMessage`: es lo que el admin copia y manda. */
  message: string;
};

/**
 * Genera un magic link para un miembro existente.
 *
 * El flujo completo —link → `/bienvenida` → la persona elige su contraseña— ya
 * existía, pero **sólo al crear** el miembro (`inviteBusinessMemberByAdmin`).
 * Para alguien ya dado de alta no había ningún camino, y es justamente el caso
 * que hace falta para rotar las contraseñas de arranque del padrón migrado de
 * MaxiRest: 38 personas en golf-jcr y 48 en kcc, todas con `<slug><PIN>`.
 *
 * Si nunca pasó por la bienvenida, el link la lleva ahí a elegir contraseña. Si
 * ya tiene, lo deja entrar directo — sirve igual para el que se la olvidó, que
 * es el otro motivo por el que un admin necesita esto.
 */
export async function generateAccessLink(
  input: unknown,
): Promise<ActionResult<AccessLinkPayload>> {
  const parsed = z
    .object({
      business_slug: z.string().min(1),
      user_id: z.string().min(1),
    })
    .safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");
  const { business_slug, user_id } = parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = svc();

  const { data: business } = await service
    .from("businesses")
    .select("name")
    .eq("id", guard.businessId)
    .maybeSingle();

  const { data: member } = await service
    .from("business_users")
    .select("pin, full_name, disabled_at")
    .eq("business_id", guard.businessId)
    .eq("user_id", user_id)
    .maybeSingle();
  if (!member) return actionError("Esa persona no es del equipo.");
  if ((member as { disabled_at: string | null }).disabled_at) {
    return actionError("Esa cuenta está deshabilitada. Reactivala primero.");
  }

  const { data: authUser, error: authErr } =
    await service.auth.admin.getUserById(user_id);
  if (authErr || !authUser.user?.email) {
    return actionError("Esa cuenta no tiene email para generar el link.");
  }
  const email = authUser.user.email;
  const yaTienePassword = Boolean(
    (authUser.user.user_metadata as Record<string, unknown> | null)
      ?.welcomed_at,
  );

  const siteUrl = getSiteUrl();
  // Sin contraseña todavía → a elegirla. Con contraseña → al panel, y que cada
  // page-gate lo mande a lo suyo según el rol.
  const next = yaTienePassword
    ? `/${business_slug}/admin`
    : `/${business_slug}/admin/bienvenida`;

  const { data: linkData, error: linkErr } =
    await service.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${siteUrl}${next}` },
    });
  const hashed = linkData?.properties?.hashed_token;
  if (linkErr || !hashed) {
    console.error("generateAccessLink", linkErr);
    return actionError("No pudimos generar el link. Probá de nuevo.");
  }

  // Mismo `/auth/confirm` + verifyOtp que el resto: el action_link crudo de
  // Supabase no sirve porque no hay code_verifier (PKCE) en el navegador del
  // que lo recibe.
  const link = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(
    hashed,
  )}&type=magiclink&next=${encodeURIComponent(next)}`;

  const pin = (member as { pin: string | null }).pin;
  const businessName =
    (business as { name: string } | null)?.name ?? business_slug;

  return actionOk({
    link,
    email,
    pin,
    fullName: (member as { full_name: string | null }).full_name,
    yaTienePassword,
    businessName,
    message: buildAccessMessage({
      businessName,
      link,
      pin,
      email,
      yaTienePassword,
    }),
  });
}

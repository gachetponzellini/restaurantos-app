"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import {
  DENSITY_SCALE,
  FONT_KEYS,
  ICON_STROKE_SCALE,
  ICON_STYLE_SCALE,
  MODE_SCALE,
  RADIUS_SCALE,
  SHADOW_SCALE,
} from "@/lib/branding/tokens";
import { RESERVED_SLUGS, SLUG_PATTERN } from "@/lib/reserved-slugs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { planPaymentsUpdate } from "./payments-secrets";

const HexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Color inválido.");
const OptionalHex = HexColor.optional();
const OptionalUrl = z
  .string()
  .url()
  .optional()
  .transform((v) => (v === "" ? null : (v ?? null)))
  .nullable();

// ─── Field fragments ─────────────────────────────────────────────────────────
// Reutilizables entre las 3 mutaciones (perfil / marca / pagos) para no repetir
// transforms. Cada mutación compone sólo su slice de columnas: así guardar una
// sección de Ajustes nunca pisa las columnas de otra (spec 40).
const emptyToNull = (v: string | undefined) => (v === "" ? null : (v ?? null));

const slugField = z
  .string()
  .trim()
  .min(2, "Mínimo 2 caracteres.")
  .max(60, "Máximo 60 caracteres.")
  .regex(SLUG_PATTERN, "Sólo minúsculas, números y guiones.");
const nameField = z.string().min(1, "Requerido.").max(120);
const phoneField = z.string().trim().max(40).optional().transform(emptyToNull);
const emailField = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform(emptyToNull)
  .refine((v) => v === null || /^\S+@\S+\.\S+$/.test(v), "Email inválido.");
const addressField = z.string().trim().max(200).optional().transform(emptyToNull);
const timezoneField = z.string().min(1, "Requerido.");
const centsField = z.coerce
  .number()
  .int("Tiene que ser un número entero.")
  .min(0, "No puede ser negativo.");
const minutesField = z
  .union([z.coerce.number().int().min(0), z.null(), z.literal("")])
  .transform((v) => (v === "" || v === null ? null : v));
const mpSecretField = z.string().trim().max(300).optional().transform(emptyToNull);

// ─── Input schemas (uno por sección de Ajustes) ─────────────────────────────

// Negocio: contacto + slug (única que toca la URL pública) + envío.
const ProfileInput = z.object({
  business_slug: z.string().min(1),
  slug: slugField,
  name: nameField,
  phone: phoneField,
  email: emailField,
  address: addressField,
  timezone: timezoneField,
  delivery_fee_cents: centsField,
  min_order_cents: centsField,
  estimated_delivery_minutes: minutesField,
  // Spec 133: el piso del estimado de retiro. Vacío = default del producto.
  estimated_pickup_minutes: minutesField,
  // Spec 061: lead de marcha de los programados. Techo 240 = el check de 0027.
  scheduled_march_lead_pickup_min: z.coerce.number().int().min(0).max(240),
  scheduled_march_lead_delivery_min: z.coerce.number().int().min(0).max(240),
});

// Apariencia: logos + cover (columnas) + paleta/tipografía/forma (settings JSONB).
const BrandingInput = z.object({
  business_slug: z.string().min(1),
  logo_url: OptionalUrl,
  cover_image_url: OptionalUrl,
  primary_color: HexColor,
  primary_foreground: HexColor,
  // Extended brand palette (all optional)
  secondary_color: OptionalHex,
  secondary_foreground: OptionalHex,
  accent_color: OptionalHex,
  accent_foreground: OptionalHex,
  background_color: OptionalHex,
  background_color_dark: OptionalHex,
  surface_color: OptionalHex,
  muted_color: OptionalHex,
  border_color: OptionalHex,
  success_color: OptionalHex,
  warning_color: OptionalHex,
  destructive_color: OptionalHex,
  // Typography
  font_heading: z.enum(FONT_KEYS).optional(),
  font_body: z.enum(FONT_KEYS).optional(),
  // Shape
  radius_scale: z.enum(RADIUS_SCALE).optional(),
  shadow_scale: z.enum(SHADOW_SCALE).optional(),
  density: z.enum(DENSITY_SCALE).optional(),
  // Iconography
  icon_stroke_width: z.enum(ICON_STROKE_SCALE).optional(),
  icon_style: z.enum(ICON_STYLE_SCALE).optional(),
  // Mode
  default_mode: z.enum(MODE_SCALE).optional(),
  // Logo variants
  logo_mark_url: OptionalUrl,
  logo_mono_url: OptionalUrl,
  favicon_url: OptionalUrl,
});

// Cobros: credenciales de Mercado Pago.
const PaymentsInput = z.object({
  business_slug: z.string().min(1),
  mp_access_token: mpSecretField,
  mp_public_key: mpSecretField,
  mp_webhook_secret: mpSecretField,
  mp_accepts_payments: z.coerce.boolean(),
});

async function assertCanManage(businessSlug: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "No autenticado." };

  const service = createSupabaseServiceClient();
  const { data: business } = await service
    .from("businesses")
    .select("id, settings")
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
      .select("role")
      .eq("business_id", business.id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const isPlatformAdmin = profile?.is_platform_admin ?? false;
  const isAdmin = membership?.role === "admin";
  if (!isPlatformAdmin && !isAdmin) {
    return { ok: false as const, error: "Permiso denegado." };
  }
  return {
    ok: true as const,
    businessId: business.id,
    currentSettings: (business.settings as Record<string, unknown>) ?? {},
  };
}

export async function toggleBusinessOpen(
  slug: string,
  open: boolean,
): Promise<ActionResult<null>> {
  const guard = await assertCanManage(slug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("businesses")
    .update({ is_active: open })
    .eq("id", guard.businessId);

  if (error) {
    console.error("toggleBusinessOpen", error);
    return actionError("No pudimos actualizar el estado del negocio.");
  }

  // Invalidate public routes so the menu reflects the new state immediately.
  revalidatePath(`/${slug}`, "layout");
  return actionOk(null);
}

/**
 * Ajustes › Negocio: contacto, URL pública (slug) y envío.
 * Es la única mutación que puede cambiar el slug (y por ende redirigir la URL
 * del admin), así que concentra la validación de slug reservado / colisión.
 */
export async function updateBusinessProfile(
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const {
    business_slug,
    slug: nextSlug,
    name,
    phone,
    email,
    address,
    timezone,
    delivery_fee_cents,
    min_order_cents,
    estimated_delivery_minutes,
    estimated_pickup_minutes,
    scheduled_march_lead_pickup_min,
    scheduled_march_lead_delivery_min,
  } = parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  // Slug change validation — only run if it actually changed.
  const service = createSupabaseServiceClient();
  if (nextSlug !== business_slug) {
    if (RESERVED_SLUGS.has(nextSlug)) {
      return actionError(`"${nextSlug}" está reservado por la plataforma.`);
    }
    const { data: clash } = await service
      .from("businesses")
      .select("id")
      .eq("slug", nextSlug)
      .maybeSingle();
    if (clash && clash.id !== guard.businessId) {
      return actionError(`Ya existe otro negocio con el slug "${nextSlug}".`);
    }
  }

  const { error } = await service
    .from("businesses")
    .update({
      slug: nextSlug,
      name,
      phone,
      email,
      address,
      timezone,
      delivery_fee_cents,
      min_order_cents,
      estimated_delivery_minutes,
      estimated_pickup_minutes,
      scheduled_march_lead_pickup_min,
      scheduled_march_lead_delivery_min,
    })
    .eq("id", guard.businessId);

  if (error) {
    console.error("updateBusinessProfile", error);
    return actionError("No pudimos guardar los cambios.");
  }

  // Contact/name live in the tenant layout too; revalidate. On slug change,
  // invalidate both paths (old so cached pages 404 properly, new so it paints).
  revalidatePath(`/${business_slug}`, "layout");
  if (nextSlug !== business_slug) {
    revalidatePath(`/${nextSlug}`, "layout");
  }
  return actionOk({ slug: nextSlug });
}

/**
 * Ajustes › Apariencia: logos + cover (columnas) y paleta/tipografía/forma
 * (JSONB `settings`, mergeado sobre lo actual para no pisar tokens no tocados).
 */
export async function updateBusinessBranding(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = BrandingInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const {
    business_slug,
    logo_url,
    cover_image_url,
    primary_color,
    primary_foreground,
    secondary_color,
    secondary_foreground,
    accent_color,
    accent_foreground,
    background_color,
    background_color_dark,
    surface_color,
    muted_color,
    border_color,
    success_color,
    warning_color,
    destructive_color,
    font_heading,
    font_body,
    radius_scale,
    shadow_scale,
    density,
    icon_stroke_width,
    icon_style,
    default_mode,
    logo_mark_url,
    logo_mono_url,
    favicon_url,
  } = parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient();
  // Only keep optional branding keys that were provided; undefined values are
  // filtered so the JSONB doesn't accumulate nulls for fields the user didn't
  // touch. The layout reads missing tokens as defaults from BRANDING_DEFAULTS.
  const brandingPatch = Object.fromEntries(
    Object.entries({
      secondary_color,
      secondary_foreground,
      accent_color,
      accent_foreground,
      background_color,
      background_color_dark,
      surface_color,
      muted_color,
      border_color,
      success_color,
      warning_color,
      destructive_color,
      font_heading,
      font_body,
      radius_scale,
      shadow_scale,
      density,
      icon_stroke_width,
      icon_style,
      default_mode,
      logo_mark_url,
      logo_mono_url,
      favicon_url,
    }).filter(([, v]) => v !== undefined),
  );
  const nextSettings = {
    ...guard.currentSettings,
    primary_color,
    primary_foreground,
    // Mirror logo into settings for legacy consumers; column is the source of truth.
    logo_url,
    ...brandingPatch,
  };

  const { error } = await service
    .from("businesses")
    .update({
      logo_url,
      cover_image_url,
      settings: nextSettings,
    })
    .eq("id", guard.businessId);

  if (error) {
    console.error("updateBusinessBranding", error);
    return actionError("No pudimos guardar los cambios.");
  }

  // Theme + logo live in the tenant layout — invalidate everything branded.
  revalidatePath(`/${business_slug}`, "layout");
  return actionOk(null);
}

/**
 * Ajustes › Cobros: credenciales de Mercado Pago.
 */
export async function updateBusinessPayments(
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = PaymentsInput.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
  }
  const {
    business_slug,
    mp_access_token,
    mp_public_key,
    mp_webhook_secret,
    mp_accepts_payments,
  } = parsed.data;

  const guard = await assertCanManage(business_slug);
  if (!guard.ok) return actionError(guard.error);

  const service = createSupabaseServiceClient();

  // #113 · 1: los secretos son de sólo escritura — vacío = «no lo toques».
  // Para validar «MP activo necesita token» hay que saber si ya hay uno.
  const { data: actual } = await service
    .from("businesses")
    .select("mp_access_token")
    .eq("id", guard.businessId)
    .maybeSingle();
  const plan = planPaymentsUpdate(
    { mp_access_token, mp_public_key, mp_webhook_secret, mp_accepts_payments },
    { hasAccessToken: Boolean(actual?.mp_access_token) },
  );
  if (!plan.ok) return actionError(plan.error);

  const { error } = await service
    .from("businesses")
    .update(plan.update)
    .eq("id", guard.businessId);

  if (error) {
    console.error("updateBusinessPayments", error);
    return actionError("No pudimos guardar los cambios.");
  }

  // MP config affects the public checkout — revalidate the tenant.
  revalidatePath(`/${business_slug}`, "layout");
  return actionOk(null);
}

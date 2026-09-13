import { z } from "zod";

import {
  SUPER_CATEGORY_COLORS,
  SUPER_CATEGORY_ICONS,
} from "@/lib/super-categories/visual";

import { MAX_PRICE_CENTS } from "./money-input";

export const CategoryInput = z.object({
  name: z.string().min(1, "Requerido.").max(60),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Sólo minúsculas, números y guiones."),
  sort_order: z.number().int().min(0),
  super_category_id: z.string().uuid().nullable().optional(),
  station_id: z.string().uuid().nullable().optional(),
  /** Spec 180: 2ª y 3ª comandera por default del rubro. */
  extra_station_ids: z.array(z.string().uuid()).max(2).optional(),
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export const StationInput = z.object({
  name: z.string().min(1, "Requerido.").max(60),
  sort_order: z.number().int().min(0),
  is_active: z.boolean(),
});
export type StationInput = z.infer<typeof StationInput>;

/**
 * Valida el destino de impresión de un sector: IPv4 de la LAN ("192.168.10.50")
 * o un hostname (RFC-1123, ej. "comandera-cocina.local"). Lógica pura testeable.
 * Un string que parece dotted-decimal se valida como IPv4 estricto (octetos
 * 0–255) para no aceptar "192.168.10.300" como si fuera un hostname numérico.
 */
export function isValidPrinterHost(host: string): boolean {
  if (/^[\d.]+$/.test(host)) {
    const parts = host.split(".");
    if (
      parts.length !== 4 ||
      !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
    ) {
      return false;
    }
    // Allowlist: la comandera vive en la LAN, así que SOLO aceptamos IPv4 de
    // rangos privados RFC1918 (10/8, 172.16/12, 192.168/16). Esto cierra de una
    // el SSRF cloud→red del print agent (que conecta a la IP que le dicta el
    // cloud): quedan rechazados loopback (127/8), link-local + metadata cloud
    // (169.254/16), unspecified (0/8), multicast (>=224) y TODA IP pública.
    const [a, b] = parts.map(Number);
    const isPrivate =
      a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return isPrivate;
  }

  // Rama hostname. La resolución ocurre en la LAN del agente, así que no podemos
  // saber acá a qué IP apunta un nombre — esa validación (resolver y chequear que
  // la IP resuelta sea privada) debe hacerla el print agent antes de conectar.
  // Igual rechazamos acá lo evidente: nombres de loopback y formas de IP
  // "empaquetada" (hex/octal) que inet_aton resolvería a loopback/metadata
  // (ej. 0x7f.0.0.1 → 127.0.0.1, 0177.0.0.1 → 127.0.0.1).
  const lower = host.toLowerCase();
  if (
    lower === "localhost" ||
    lower === "ip6-localhost" ||
    lower.endsWith(".localhost")
  ) {
    return false;
  }
  const labels = lower.split(".");
  if (labels.every((l) => /^(0x[0-9a-f]+|\d+)$/.test(l))) return false;

  return /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
    host,
  );
}

/**
 * Config de la comandera de un sector (spec 28). La IP no es secreto (LAN), va
 * en columnas de `stations`. IP vacía → null = "sector sin impresora" (el print
 * agent lo saltea). Puerto 1–65535, default 9100 (RAW/JetDirect ESC/POS).
 */
export const StationPrinterInput = z.object({
  printer_ip: z
    .union([z.string(), z.null()])
    .transform((v) => {
      if (v == null) return null;
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    })
    .refine((v) => v === null || isValidPrinterHost(v), {
      message:
        "IP o host inválido (ej: 192.168.10.50 o comandera-cocina.local).",
    }),
  printer_port: z
    .number({ message: "Puerto inválido." })
    .int("El puerto debe ser un número entero.")
    .min(1, "El puerto debe estar entre 1 y 65535.")
    .max(65535, "El puerto debe estar entre 1 y 65535.")
    .default(9100),
  printer_enabled: z.boolean().default(true),
});
export type StationPrinterInput = z.infer<typeof StationPrinterInput>;

export const SuperCategoryInput = z.object({
  name: z.string().min(1, "Requerido.").max(60),
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Sólo minúsculas, números y guiones."),
  sort_order: z.number().int().min(0),
  icon: z.enum(SUPER_CATEGORY_ICONS),
  color: z.enum(SUPER_CATEGORY_COLORS),
  is_active: z.boolean(),
});
export type SuperCategoryInput = z.infer<typeof SuperCategoryInput>;

/**
 * Un importe de catálogo, en CENTAVOS (P14 · hallazgo 3).
 *
 * El techo no estaba y era la mitad simétrica del bug del `parseInt`: el campo
 * truncaba «18.500» a $18 hacia abajo y dejaba pasar el cero de más hacia
 * arriba, porque acá sólo se pedía «entero ≥ 0» y la columna es `bigint` sin
 * CHECK. `MAX_PRICE_CENTS` no es una regla de negocio: es el límite arriba del
 * cual un precio de carta es, con certeza, un tipeo.
 */
const PriceCents = z
  .number({ message: "Ingresá un precio válido, ej: 18.500." })
  .int()
  .min(0)
  .max(MAX_PRICE_CENTS, "Precio demasiado alto. ¿Sobró un cero?");

export const ModifierInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  price_delta_cents: PriceCents,
  is_available: z.boolean(),
  sort_order: z.number().int().min(0),
});
export type ModifierInput = z.infer<typeof ModifierInput>;

export const ModifierGroupInput = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(60),
    min_selection: z.number().int().min(0),
    max_selection: z.number().int().min(1),
    is_required: z.boolean(),
    sort_order: z.number().int().min(0),
    modifiers: z.array(ModifierInput),
  })
  .refine((g) => g.max_selection >= g.min_selection, {
    message: "Máximo debe ser ≥ mínimo.",
    path: ["max_selection"],
  });
export type ModifierGroupInput = z.infer<typeof ModifierGroupInput>;

export const ProductInput = z.object({
  name: z.string().min(1, "Requerido.").max(80),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "Sólo minúsculas, números y guiones."),
  description: z.string().max(500).optional(),
  price_cents: PriceCents,
  image_url: z.string().url().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  station_id: z.string().uuid().nullable().optional(),
  /** Spec 180: 2ª y 3ª comandera. null = hereda de la categoría; [] = ninguna. */
  extra_station_ids: z.array(z.string().uuid()).max(2).nullable().optional(),
  /** Spec 180: no imprime comanda aunque la categoría tenga sector. */
  sin_comanda: z.boolean().optional(),
  is_available: z.boolean(),
  is_active: z.boolean(),
  /**
   * Visible en la carta pública (spec 0021). Es independiente de
   * `is_available`: el mozo ve el producto igual, sólo se oculta en la web.
   * El alta arranca en true (defaultValues del form) para que un producto
   * nuevo aparezca sin tener que acordarse de marcarlo.
   */
  show_online: z.boolean(),
  sort_order: z.number().int().min(0),
  prep_time_minutes: z.number().int().min(1).max(999).nullable().optional(),
  modifier_groups: z.array(ModifierGroupInput),
});
export type ProductInput = z.infer<typeof ProductInput>;

const GARNISH_PATTERN = /^guarnici[oó]n(es)?$/i;

export function warnGarnishModifierGroups(
  groups: ModifierGroupInput[],
): string[] {
  return groups
    .filter((g) => GARNISH_PATTERN.test(g.name.trim()))
    .map(
      (g) =>
        `El grupo "${g.name}" parece una guarnición. Convención: la guarnición se carga como producto aparte, no como adicional del plato.`,
    );
}

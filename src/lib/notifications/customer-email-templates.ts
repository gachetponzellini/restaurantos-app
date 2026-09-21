/**
 * Plantillas de email transaccional al cliente (spec 45) — lógica PURA.
 *
 * Cada evento produce `{ subject, html, text }`. El HTML es un layout email-safe
 * (tablas + estilos inline, un solo documento) **marcado con la identidad del
 * negocio**: color primario en la banda del header, logo, color de acento en el
 * CTA y datos de contacto en el footer. La marca se resuelve una vez por evento
 * con `resolveBusinessBrand` a partir de la fila de `businesses` (columnas +
 * `settings` JSON), así el mismo layout se ve distinto para cada slug.
 *
 * El `text` es el fallback plano. Para los estados de pedido se reusa el mismo
 * cuerpo que WhatsApp (`renderDeliveryBody`): el dueño edita una sola plantilla
 * y sirve para ambos canales.
 */

export type CustomerEmail = { subject: string; html: string; text: string };

/**
 * Tokens de marca ya resueltos y saneados que consume el layout. Colores siempre
 * hex válidos (los saneó `resolveBusinessBrand`), así es seguro interpolarlos en
 * los `style=""` sin escapar.
 */
export type BusinessBrand = {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  /** Banda del header + títulos. */
  primaryColor: string;
  /** Texto sobre el color primario. */
  primaryText: string;
  /** Botón CTA + acentos. */
  accentColor: string;
  /** Texto sobre el color de acento. */
  accentText: string;
  address: string | null;
  phone: string | null;
};

/** Defaults neutros cuando el negocio no configuró marca. */
const BRAND_DEFAULTS = {
  primaryColor: "#111827",
  primaryText: "#FFFFFF",
  accentText: "#FFFFFF",
} as const;

/** Escapa lo mínimo para no romper el HTML con datos del cliente o del negocio. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Devuelve `value` sólo si es un color hex válido (`#rgb` / `#rrggbb`); si no,
 * el `fallback`. Evita que un color mal cargado (o malicioso) del `settings` del
 * negocio se cuele en el atributo `style` y rompa/inyecte HTML.
 */
export function sanitizeColor(value: unknown, fallback: string): string {
  if (
    typeof value === "string" &&
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
  ) {
    return value.trim();
  }
  return fallback;
}

/** Acepta sólo URLs http(s) absolutas (para el `src` del logo). */
function httpUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/** Fila mínima de `businesses` que necesita la marca. `settings` es el JSON crudo. */
export type BusinessBrandRow = {
  name: string;
  logo_url?: string | null;
  address?: string | null;
  phone?: string | null;
  settings?: unknown;
};

/**
 * Resuelve los tokens de marca de un negocio desde su fila de `businesses`.
 * PURA (no toca la DB). Los colores viven en `settings` (mismo set que la carta
 * pública); el logo se toma de la columna `logo_url` y cae a `settings.logo_url`.
 * Todo con defaults neutros para que un negocio sin marca igual reciba un mail
 * prolijo.
 */
export function resolveBusinessBrand(row: BusinessBrandRow): BusinessBrand {
  const settings =
    row.settings && typeof row.settings === "object"
      ? (row.settings as Record<string, unknown>)
      : {};

  const primaryColor = sanitizeColor(
    settings.primary_color,
    BRAND_DEFAULTS.primaryColor,
  );

  return {
    name: row.name,
    tagline: typeof settings.tagline === "string" ? settings.tagline : null,
    logoUrl: httpUrlOrNull(row.logo_url) ?? httpUrlOrNull(settings.logo_url),
    primaryColor,
    primaryText: sanitizeColor(
      settings.primary_foreground,
      BRAND_DEFAULTS.primaryText,
    ),
    // Sin acento configurado, el CTA usa el primario (nunca un color random).
    accentColor: sanitizeColor(settings.accent_color, primaryColor),
    accentText: sanitizeColor(
      settings.accent_foreground,
      BRAND_DEFAULTS.accentText,
    ),
    address: row.address ?? null,
    phone: row.phone ?? null,
  };
}

/** Tinta oscura neutra para texto sobre fondo claro (convención del producto). */
const INK = "#18181B";

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminancia relativa WCAG. Recibe hex ya validado por `sanitizeColor`. */
function luminance(hex: string): number {
  const chan = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Texto legible sobre `bg`: devuelve `preferred` si contrasta lo suficiente; si
 * no, cae a tinta oscura o blanco (el que más contraste). Blinda el layout
 * contra cualquier color de marca (ej: un negocio que elige un primario claro),
 * sin depender de que Outlook respete `opacity`.
 */
function readableText(bg: string, preferred: string, min = 4.5): string {
  if (contrastRatio(preferred, bg) >= min) return preferred;
  return contrastRatio(INK, bg) >= contrastRatio("#FFFFFF", bg)
    ? INK
    : "#FFFFFF";
}

/** Párrafo de cuerpo estándar (texto ya escapado por el caller). */
function paragraph(html: string): string {
  return `<p style="font-size:15px;line-height:1.6;color:#3F3F46;margin:0 0 20px">${html}</p>`;
}

/**
 * Layout email-safe con la marca del negocio. Documento completo (doctype +
 * body con fondo) para máxima compatibilidad (Gmail / Outlook / Apple Mail).
 */
function layout(input: {
  brand: BusinessBrand;
  bodyHtml: string;
  heading?: string;
  cta?: { label: string; url: string };
  footerNote?: string;
  preheader?: string;
}): string {
  const b = input.brand;
  const name = escapeHtml(b.name);

  // Colores derivados por contraste: texto legible sobre la banda / el botón, y
  // una tinta de marca sólo si contrasta sobre fondo blanco (si no, INK).
  const onBand = readableText(b.primaryColor, b.primaryText);
  const onAccent = readableText(b.accentColor, b.accentText);
  const brandInk = readableText("#FFFFFF", b.primaryColor);

  const preheader = input.preheader
    ? `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${escapeHtml(
        input.preheader,
      )}</span>`
    : "";

  const logo = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" width="56" height="56" alt="${name}" style="display:block;width:56px;height:56px;border-radius:50%;border:2px solid rgba(255,255,255,.85);object-fit:cover;margin:0 auto 12px" />`
    : "";

  const tagline = b.tagline
    ? `<div style="font-size:13px;color:${onBand};opacity:.82;margin-top:3px">${escapeHtml(
        b.tagline,
      )}</div>`
    : "";

  const heading = input.heading
    ? `<h1 style="font-size:23px;font-weight:700;color:${brandInk};margin:0 0 14px;line-height:1.25">${escapeHtml(
        input.heading,
      )}</h1>`
    : "";

  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px"><tr><td bgcolor="${b.accentColor}" style="border-radius:9px;background:${b.accentColor}"><a href="${escapeHtml(
        input.cta.url,
      )}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:${onAccent};text-decoration:none">${escapeHtml(
        input.cta.label,
      )}</a></td></tr></table>`
    : "";

  const contactBits = [b.address, b.phone]
    .filter((x): x is string => Boolean(x && x.trim()))
    .map((x) => escapeHtml(x.trim()));
  const contactLine =
    contactBits.length > 0 ? `<br>${contactBits.join(" · ")}` : "";

  const footerNote = input.footerNote
    ? `<p style="font-size:12px;color:#71717A;line-height:1.5;margin:12px 0 0">${escapeHtml(
        input.footerNote,
      )}</p>`
    : "";

  return [
    `<!doctype html><html lang="es"><head>`,
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">`,
    `</head>`,
    `<body style="margin:0;padding:0;background:#F0F0F2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">`,
    preheader,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F0F2;border-collapse:collapse"><tr><td align="center" style="padding:24px 12px 40px">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:14px;overflow:hidden">`,
    // Header con la marca (bgcolor además del style para el motor Word de Outlook)
    `<tr><td align="center" bgcolor="${b.primaryColor}" style="background:${b.primaryColor};padding:28px 24px 24px">`,
    logo,
    `<div style="font-size:17px;font-weight:700;color:${onBand};line-height:1.2;letter-spacing:.01em">${name}</div>`,
    tagline,
    `</td></tr>`,
    // Cuerpo
    `<tr><td style="padding:32px 32px 8px">`,
    heading,
    input.bodyHtml,
    cta,
    `</td></tr>`,
    // Footer
    `<tr><td style="padding:8px 32px 28px"><div style="border-top:1px solid #E4E4E7;padding-top:18px">`,
    `<div style="font-size:13px;color:#52525B;line-height:1.6"><strong style="color:${brandInk}">${name}</strong>${contactLine}</div>`,
    footerNote,
    `<div style="font-size:11px;color:#A1A1AA;margin-top:12px">Recibís este correo por tu actividad en ${name}.</div>`,
    `</div></td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}

/** Aviso de cambio de estado del pedido. `body` ya viene renderizado (delivery). */
export function orderStatusEmail(input: {
  brand: BusinessBrand;
  orderNumber: number;
  body: string;
}): CustomerEmail {
  return {
    subject: `Tu pedido #${input.orderNumber} — ${input.brand.name}`,
    text: input.body,
    html: layout({
      brand: input.brand,
      preheader: input.body,
      bodyHtml: paragraph(escapeHtml(input.body)),
    }),
  };
}

/** Pedido diferido agendado tras aprobarse el pago. */
export function orderScheduledEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  orderNumber: number;
  whenLabel: string;
  /** Auditoría de pedidos · media: el «agendado» también sale para delivery. */
  deliveryType?: string;
}): CustomerEmail {
  const cierre =
    input.deliveryType === "delivery"
      ? "Te avisamos cuando salga para tu casa."
      : "Te avisamos cuando esté para retirar.";
  const text =
    `¡Listo ${input.customerName}! Tu pedido #${input.orderNumber} quedó agendado ` +
    `para el ${input.whenLabel}. ${cierre}`;
  return {
    subject: `Pedido #${input.orderNumber} agendado — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "Tu pedido quedó agendado",
      preheader: text,
      bodyHtml: paragraph(escapeHtml(text)),
    }),
  };
}

/** Acuse de reserva creada. */
export function reservationConfirmedEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  whenLabel: string;
  partySize: number;
  manageUrl?: string;
}): CustomerEmail {
  const text =
    `¡Hola ${input.customerName}! Tu reserva en ${input.brand.name} quedó confirmada ` +
    `para el ${input.whenLabel}, mesa para ${input.partySize}. ¡Te esperamos!`;
  return {
    subject: `Reserva confirmada — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "¡Tu reserva quedó confirmada!",
      preheader: text,
      bodyHtml: paragraph(escapeHtml(text)),
      cta: input.manageUrl
        ? { label: "Ver mi reserva", url: input.manageUrl }
        : undefined,
    }),
  };
}

/**
 * Spec 131 — acuse de la SOLICITUD. Sale al crear una reserva de cliente, que
 * ahora nace pendiente: acá no se promete nada, se avisa que el pedido llegó.
 */
export function reservationRequestedEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  whenLabel: string;
  partySize: number;
  manageUrl?: string;
}): CustomerEmail {
  const text =
    `¡Hola ${input.customerName}! Recibimos tu pedido de reserva en ${input.brand.name} ` +
    `para el ${input.whenLabel}, mesa para ${input.partySize}. ` +
    `Falta que el local la confirme — apenas la respondan te avisamos.`;
  return {
    subject: `Recibimos tu pedido de reserva — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "Recibimos tu pedido de reserva",
      preheader: text,
      bodyHtml: paragraph(escapeHtml(text)),
      cta: input.manageUrl
        ? { label: "Ver mi reserva", url: input.manageUrl }
        : undefined,
    }),
  };
}

/** Spec 131 — el local rechazó la solicitud, con el motivo si lo escribió. */
export function reservationRejectedEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  whenLabel: string;
  reason?: string | null;
}): CustomerEmail {
  const motivo = input.reason?.trim();
  const text =
    `¡Hola ${input.customerName}! No pudimos tomar tu reserva en ${input.brand.name} ` +
    `para el ${input.whenLabel}.` +
    (motivo ? ` Motivo: ${motivo}.` : "") +
    ` Escribinos y buscamos otro día u horario.`;
  return {
    subject: `Sobre tu reserva — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "No pudimos tomar tu reserva",
      preheader: text,
      bodyHtml: paragraph(escapeHtml(text)),
    }),
  };
}

/** Auditoría de reservas · media — el local canceló una reserva tomada. */
export function reservationCancelledByLocalEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  whenLabel: string;
}): CustomerEmail {
  const text =
    `¡Hola ${input.customerName}! ${input.brand.name} canceló tu reserva ` +
    `del ${input.whenLabel}. Si querés, hacé una nueva o escribinos y ` +
    `buscamos otro día u horario.`;
  return {
    subject: `Tu reserva fue cancelada — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "Tu reserva fue cancelada",
      preheader: text,
      bodyHtml: paragraph(escapeHtml(text)),
    }),
  };
}

/**
 * Auditoría de reservas · media — el local cambió el día, la hora o las
 * personas de una reserva: antes el cliente no se enteraba y llegaba a la
 * hora vieja.
 */
export function reservationUpdatedEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  whenLabel: string;
  partySize: number;
  antesWhenLabel: string;
  antesPartySize: number;
}): CustomerEmail {
  const personas = (n: number) => `${n} ${n === 1 ? "persona" : "personas"}`;
  const text =
    `¡Hola ${input.customerName}! ${input.brand.name} actualizó tu reserva: ` +
    `ahora es el ${input.whenLabel} para ${personas(input.partySize)} ` +
    `(antes: ${input.antesWhenLabel}, ${personas(input.antesPartySize)}). ` +
    `Si no te sirve, escribinos.`;
  return {
    subject: `Tu reserva cambió — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "Tu reserva cambió",
      preheader: text,
      bodyHtml: paragraph(escapeHtml(text)),
    }),
  };
}

/** Spec 131 — venció sin que el local la respondiera. */
export function reservationExpiredEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  whenLabel: string;
}): CustomerEmail {
  const text =
    `¡Hola ${input.customerName}! Tu pedido de reserva en ${input.brand.name} ` +
    `para el ${input.whenLabel} venció sin confirmarse, así que no tenés mesa reservada. ` +
    `Si querés venir igual, escribinos o probá con otro horario.`;
  return {
    subject: `Tu pedido de reserva venció — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "Tu pedido de reserva venció",
      preheader: text,
      bodyHtml: paragraph(escapeHtml(text)),
    }),
  };
}

/** Recordatorio antes del turno, con link de confirmación de asistencia (opt-in). */
export function reservationReminderEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  whenLabel: string;
  partySize: number;
  confirmUrl?: string;
}): CustomerEmail {
  const text =
    `¡Hola ${input.customerName}! Te recordamos tu reserva en ${input.brand.name} ` +
    `para el ${input.whenLabel}, mesa para ${input.partySize}. ¡Te esperamos!`;
  return {
    subject: `Recordatorio de tu reserva — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "Te esperamos 👋",
      preheader: text,
      bodyHtml: paragraph(escapeHtml(text)),
      cta: input.confirmUrl
        ? { label: "Confirmar asistencia", url: input.confirmUrl }
        : undefined,
      footerNote: input.confirmUrl
        ? "Si no vas a poder venir, avisanos así liberamos la mesa."
        : undefined,
    }),
  };
}

/** Comprobante fiscal emitido (AFIP/ARCA). */
export function invoiceIssuedEmail(input: {
  brand: BusinessBrand;
  customerName: string;
  orderNumber: number;
  totalLabel: string;
  comprobanteLabel?: string;
}): CustomerEmail {
  const comprobante = input.comprobanteLabel
    ? ` (${input.comprobanteLabel})`
    : "";
  const text =
    `¡Gracias ${input.customerName}! Adjuntamos el comprobante de tu pedido ` +
    `#${input.orderNumber}${comprobante} por ${input.totalLabel} en ${input.brand.name}.`;

  // Resumen tipo "caja" con el nº de pedido y el total.
  const summary =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F5;border-radius:10px;margin:0 0 8px"><tr>` +
    `<td style="padding:14px 16px;font-size:14px;color:#52525B">Pedido #${input.orderNumber}</td>` +
    `<td align="right" style="padding:14px 16px;font-size:15px;font-weight:700;color:${readableText(
      "#F4F4F5",
      input.brand.primaryColor,
    )}">${escapeHtml(input.totalLabel)}</td></tr></table>`;

  const intro = input.comprobanteLabel
    ? `¡Gracias ${escapeHtml(input.customerName)}! Adjuntamos el comprobante de tu pedido <strong>#${input.orderNumber}</strong> (${escapeHtml(
        input.comprobanteLabel,
      )}).`
    : `¡Gracias ${escapeHtml(input.customerName)}! Adjuntamos el comprobante de tu pedido <strong>#${input.orderNumber}</strong>.`;

  return {
    subject: `Comprobante de tu pedido #${input.orderNumber} — ${input.brand.name}`,
    text,
    html: layout({
      brand: input.brand,
      heading: "Tu comprobante está listo",
      preheader: text,
      bodyHtml: paragraph(intro) + summary,
    }),
  };
}

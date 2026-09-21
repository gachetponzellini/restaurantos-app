import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  invoiceIssuedEmail,
  orderScheduledEmail,
  reservationCancelledByLocalEmail,
  reservationUpdatedEmail,
  orderStatusEmail,
  reservationConfirmedEmail,
  reservationExpiredEmail,
  reservationRejectedEmail,
  reservationReminderEmail,
  reservationRequestedEmail,
  resolveBusinessBrand,
  sanitizeColor,
  type BusinessBrand,
} from "./customer-email-templates";

/** Marca de prueba con acento distinto al primario y logo. */
const GOLF: BusinessBrand = {
  name: "Golf",
  tagline: "Cocina de club",
  logoUrl: "https://cdn.test/logo.jpg",
  primaryColor: "#24305A",
  primaryText: "#FFFFFF",
  accentColor: "#E11D48",
  accentText: "#FFFFFF",
  address: "Club JCR Golf, Rosario",
  phone: "+5493416123456",
};

describe("escapeHtml", () => {
  it("neutraliza caracteres peligrosos", () => {
    expect(escapeHtml('<b>"x"</b> & y')).toBe(
      "&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y",
    );
  });
});

describe("sanitizeColor", () => {
  it("acepta hex de 3 y 6 dígitos", () => {
    expect(sanitizeColor("#24305A", "#000")).toBe("#24305A");
    expect(sanitizeColor("#abc", "#000")).toBe("#abc");
    expect(sanitizeColor("  #E11D48  ", "#000")).toBe("#E11D48");
  });

  it("cae al fallback ante valores inválidos o no-string", () => {
    expect(sanitizeColor("red", "#111")).toBe("#111");
    expect(sanitizeColor('#fff;"><script>', "#111")).toBe("#111");
    expect(sanitizeColor(undefined, "#111")).toBe("#111");
    expect(sanitizeColor(123, "#111")).toBe("#111");
  });
});

describe("resolveBusinessBrand", () => {
  it("lee los tokens de settings y prioriza logo_url de columna", () => {
    const brand = resolveBusinessBrand({
      name: "JCR Golf",
      logo_url: "https://cdn.test/col.jpg",
      address: "Rosario",
      phone: "+54341",
      settings: {
        tagline: "Cocina de club",
        primary_color: "#24305A",
        primary_foreground: "#FFFFFF",
        accent_color: "#E11D48",
        accent_foreground: "#FFFFFF",
        logo_url: "https://cdn.test/settings.jpg",
      },
    });
    expect(brand.primaryColor).toBe("#24305A");
    expect(brand.accentColor).toBe("#E11D48");
    expect(brand.tagline).toBe("Cocina de club");
    expect(brand.logoUrl).toBe("https://cdn.test/col.jpg");
    expect(brand.address).toBe("Rosario");
  });

  it("cae a settings.logo_url si no hay columna, y descarta URLs no http", () => {
    expect(
      resolveBusinessBrand({
        name: "X",
        settings: { logo_url: "https://cdn.test/s.jpg" },
      }).logoUrl,
    ).toBe("https://cdn.test/s.jpg");
    expect(
      resolveBusinessBrand({
        name: "X",
        logo_url: "javascript:alert(1)",
      }).logoUrl,
    ).toBeNull();
  });

  it("aplica defaults neutros sin marca y sanea colores maliciosos", () => {
    const brand = resolveBusinessBrand({ name: "Sin Marca" });
    expect(brand.primaryColor).toBe("#111827");
    expect(brand.primaryText).toBe("#FFFFFF");
    // Sin accent_color, el acento hereda el primario (no un color random).
    expect(brand.accentColor).toBe("#111827");
    expect(brand.logoUrl).toBeNull();
    expect(brand.tagline).toBeNull();

    const evil = resolveBusinessBrand({
      name: "Hack",
      settings: { primary_color: 'x;"><script>alert(1)</script>' },
    });
    expect(evil.primaryColor).toBe("#111827");
    // Y el color malicioso no se cuela en el HTML renderizado.
    const html = orderStatusEmail({
      brand: evil,
      orderNumber: 1,
      body: "hola",
    }).html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });
});

describe("legibilidad por contraste (bulletproof)", () => {
  it("primario oscuro: conserva la tinta de marca y agrega bgcolor (Outlook)", () => {
    const mail = reservationConfirmedEmail({
      brand: GOLF,
      customerName: "Ana",
      whenLabel: "hoy",
      partySize: 2,
      manageUrl: "https://x/r",
    });
    expect(mail.html).toContain('bgcolor="#24305A"'); // banda del header
    expect(mail.html).toContain('bgcolor="#E11D48"'); // botón CTA
    // El navy contrasta sobre blanco → el heading mantiene la tinta de marca.
    expect(mail.html).toContain("color:#24305A");
  });

  it("primario claro: cae a tinta oscura legible (no texto claro sobre claro)", () => {
    const light: BusinessBrand = {
      ...GOLF,
      logoUrl: null,
      primaryColor: "#FFEB3B",
      accentColor: "#FFEB3B",
      primaryText: "#FFFFFF",
      accentText: "#FFFFFF",
    };
    const mail = reservationConfirmedEmail({
      brand: light,
      customerName: "Ana",
      whenLabel: "hoy",
      partySize: 2,
      manageUrl: "https://x/r",
    });
    // Banda y botón amarillos → texto oscuro (INK), nunca blanco ilegible.
    expect(mail.html).toContain("#18181B");
    expect(mail.html).not.toContain("color:#FFFFFF");
  });
});

describe("orderStatusEmail", () => {
  it("usa el body de delivery como texto y lo envuelve en HTML con la marca", () => {
    const mail = orderStatusEmail({
      brand: GOLF,
      orderNumber: 42,
      body: "Tu pedido #42 ya está listo. 🙌",
    });
    expect(mail.subject).toContain("#42");
    expect(mail.subject).toContain("Golf");
    expect(mail.text).toBe("Tu pedido #42 ya está listo. 🙌");
    expect(mail.html).toContain("Golf");
    expect(mail.html).toContain("listo");
    // Marca aplicada: color primario en la banda + logo.
    expect(mail.html).toContain("#24305A");
    expect(mail.html).toContain("https://cdn.test/logo.jpg");
  });

  it("escapa el nombre del negocio en el HTML", () => {
    const mail = orderStatusEmail({
      brand: { ...GOLF, name: "Bar <script>" },
      orderNumber: 1,
      body: "hola",
    });
    expect(mail.html).toContain("Bar &lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
  });
});

describe("reservationConfirmedEmail", () => {
  it("incluye datos, CTA de gestión con color de acento y contacto en footer", () => {
    const mail = reservationConfirmedEmail({
      brand: GOLF,
      customerName: "Ana",
      whenLabel: "sáb 19/07 21:00",
      partySize: 4,
      manageUrl: "https://x/perfil/reservas",
    });
    expect(mail.subject).toContain("Reserva confirmada");
    expect(mail.text).toContain("Ana");
    expect(mail.text).toContain("mesa para 4");
    expect(mail.html).toContain("Ver mi reserva");
    expect(mail.html).toContain("https://x/perfil/reservas");
    expect(mail.html).toContain("#E11D48"); // botón de acento
    expect(mail.html).toContain("Rosario"); // footer de contacto
  });

  it("sin manageUrl no rompe ni pone CTA", () => {
    const mail = reservationConfirmedEmail({
      brand: GOLF,
      customerName: "Ana",
      whenLabel: "sáb 19/07 21:00",
      partySize: 2,
    });
    expect(mail.html).not.toContain("Ver mi reserva");
  });

  it("sin logo no rompe (no emite <img)", () => {
    const mail = reservationConfirmedEmail({
      brand: { ...GOLF, logoUrl: null },
      customerName: "Ana",
      whenLabel: "hoy",
      partySize: 2,
    });
    expect(mail.html).not.toContain("<img");
  });
});

describe("avisos de la solicitud (spec 131)", () => {
  it("el acuse del pedido NO dice que quedó confirmada", () => {
    const mail = reservationRequestedEmail({
      brand: GOLF,
      customerName: "Ana",
      whenLabel: "sáb 19/07 21:00",
      partySize: 4,
      manageUrl: "https://x/perfil/reservas",
    });
    expect(mail.subject).toContain("Recibimos tu pedido");
    expect(mail.subject.toLowerCase()).not.toContain("confirmada");
    expect(mail.text).toContain("Falta que el local la confirme");
    expect(mail.html).toContain("Ver mi reserva");
  });

  it("el rechazo lleva el motivo cuando lo hay", () => {
    const mail = reservationRejectedEmail({
      brand: GOLF,
      customerName: "Ana",
      whenLabel: "sáb 19/07 21:00",
      reason: "esa noche tenemos un evento privado",
    });
    expect(mail.text).toContain("evento privado");
    expect(mail.html).toContain("No pudimos tomar tu reserva");
  });

  it("el rechazo sin motivo no deja un 'Motivo:' colgado", () => {
    const mail = reservationRejectedEmail({
      brand: GOLF,
      customerName: "Ana",
      whenLabel: "sáb 19/07 21:00",
      reason: "   ",
    });
    expect(mail.text).not.toContain("Motivo:");
  });

  it("el vencimiento dice explícitamente que no hay mesa reservada", () => {
    const mail = reservationExpiredEmail({
      brand: GOLF,
      customerName: "Ana",
      whenLabel: "sáb 19/07 21:00",
    });
    expect(mail.text).toContain("no tenés mesa reservada");
  });
});

describe("reservationReminderEmail (double opt-in)", () => {
  it("incluye el CTA de confirmar asistencia cuando hay confirmUrl", () => {
    const mail = reservationReminderEmail({
      brand: GOLF,
      customerName: "Leo",
      whenLabel: "hoy 21:00",
      partySize: 3,
      confirmUrl: "https://x/reservar/confirmar/tok",
    });
    expect(mail.html).toContain("Confirmar asistencia");
    expect(mail.html).toContain("https://x/reservar/confirmar/tok");
    expect(mail.html).toContain("liberamos la mesa");
  });
});

describe("orderScheduledEmail / invoiceIssuedEmail", () => {
  it("agendado nombra el pedido y el momento", () => {
    const mail = orderScheduledEmail({
      brand: GOLF,
      customerName: "Sol",
      orderNumber: 7,
      whenLabel: "20/07 a las 13:00 hs",
    });
    expect(mail.text).toContain("#7");
    expect(mail.text).toContain("13:00");
  });

  it("comprobante nombra total y pedido", () => {
    const mail = invoiceIssuedEmail({
      brand: GOLF,
      customerName: "Sol",
      orderNumber: 7,
      totalLabel: "$12.500",
      comprobanteLabel: "Factura B 0001-00000042",
    });
    expect(mail.subject).toContain("#7");
    expect(mail.text).toContain("$12.500");
    expect(mail.text).toContain("Factura B");
    expect(mail.html).toContain("$12.500");
  });
});

// Auditoría de pedidos · MEDIA — el «agendado» también sale para delivery, y no
// le dice a quien espera un envío que lo pase a retirar.
describe("orderScheduledEmail · delivery vs retiro", () => {
  const brand = GOLF;
  it("delivery: te avisamos cuando salga", () => {
    const e = orderScheduledEmail({ brand, customerName: "Ana", orderNumber: 7, whenLabel: "21/09 a las 21:00 hs", deliveryType: "delivery" });
    expect(e.text).toMatch(/cuando salga/);
    expect(e.text).not.toMatch(/retirar/);
  });
  it("retiro: te avisamos cuando esté para retirar", () => {
    const e = orderScheduledEmail({ brand, customerName: "Ana", orderNumber: 7, whenLabel: "21/09 a las 21:00 hs", deliveryType: "pickup" });
    expect(e.text).toMatch(/para retirar/);
  });
});

// Auditoría de reservas · MEDIA — el cliente se entera si el local cancela o
// mueve su reserva (antes: el encargado pasaba de 21:00 a 22:30 y el cliente
// llegaba a las 21:00).
describe("reserva cancelada / cambiada por el local", () => {
  it("cancelada: dice cuál y ofrece otra", () => {
    const e = reservationCancelledByLocalEmail({ brand: GOLF, customerName: "Ana", whenLabel: "26/09 a las 21:00 hs" });
    expect(e.text).toMatch(/cancel/i);
    expect(e.text).toContain("26/09 a las 21:00 hs");
  });

  it("cambiada: muestra el antes y el después", () => {
    const e = reservationUpdatedEmail({
      brand: GOLF,
      customerName: "Ana",
      whenLabel: "26/09 a las 22:30 hs",
      partySize: 4,
      antesWhenLabel: "26/09 a las 21:00 hs",
      antesPartySize: 2,
    });
    expect(e.text).toContain("22:30");
    expect(e.text).toContain("4 personas");
    expect(e.text).toMatch(/antes.*21:00/i);
  });
});

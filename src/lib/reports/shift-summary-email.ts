import type { ShiftSummary } from "./shift-summary";

// ════════════════════════════════════════════════════════════════════════
// Template del mail de cierre (spec 34) — el "panel lindo".
//
// HTML inline-styled (email-safe: tablas + estilos inline, sin <style> ni clases
// externas que los clientes de correo descartan) + texto plano de respaldo.
// Render puro desde el `ShiftSummary` (ya formateado).
// ════════════════════════════════════════════════════════════════════════

const C = {
  ink: "#18181b",
  muted: "#71717a",
  line: "#e4e4e7",
  bg: "#fafafa",
  card: "#ffffff",
  accent: "#16a34a",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kpi(label: string, value: string): string {
  return `
    <td style="padding:12px 16px;border:1px solid ${C.line};border-radius:10px;background:${C.card};">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${C.muted};">${esc(label)}</div>
      <div style="font-size:20px;font-weight:700;color:${C.ink};margin-top:4px;">${esc(value)}</div>
    </td>`;
}

function sectionTitle(title: string): string {
  return `<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:${C.muted};margin:28px 0 10px;">${esc(title)}</h2>`;
}

function rowsTable(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) {
    return `<p style="color:${C.muted};font-size:14px;margin:0;">${esc(empty)}</p>`;
  }
  const th = headers
    .map(
      (h, i) =>
        `<th style="text-align:${i === 0 ? "left" : "right"};font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${C.muted};padding:6px 10px;border-bottom:1px solid ${C.line};">${esc(h)}</th>`,
    )
    .join("");
  const trs = rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (cell, i) =>
              `<td style="text-align:${i === 0 ? "left" : "right"};font-size:14px;color:${C.ink};padding:8px 10px;border-bottom:1px solid ${C.line};">${esc(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

export function renderShiftSummaryEmail(summary: ShiftSummary): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Resumen de cierre · ${summary.businessName} · ${summary.rangeLabel}`;

  const metodoRows = summary.recaudacion.porMetodo.map((m) => [
    m.label,
    m.value,
  ]);
  const corteRows = summary.caja.cortes.map((c) => [
    c.caja,
    c.encargado,
    c.diferencia,
    c.hora,
  ]);
  const mozoRows = summary.porMozo.map((m) => [m.mozo, m.ventas, m.propinas]);
  const anulRows = summary.anulaciones.map((a) => [
    a.detalle,
    a.motivo,
    a.responsable,
    a.hora,
  ]);
  const invitacionRows = summary.invitaciones.map((i) => [
    esc(i.detalle),
    esc(i.motivo),
    esc(i.responsable),
    esc(i.valor),
    esc(i.hora),
  ]);
  const correccionRows = summary.correcciones.map((c) => [
    c.detalle,
    c.cambio,
    c.motivo,
    c.responsable,
    c.hora,
  ]);

  const body = !summary.hasData
    ? `<p style="color:${C.muted};font-size:15px;">No hubo movimiento registrado en el día.</p>`
    : `
    ${sectionTitle("Recaudación")}
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;width:100%;">
      <tr>
        ${kpi("Ventas", summary.recaudacion.total)}
        ${summary.recaudacion.tieneFiado ? kpi("Fiado (no entró)", summary.recaudacion.fiado) : ""}
        ${kpi("Propinas", summary.recaudacion.propinas)}
        ${kpi("Cobros", String(summary.recaudacion.cobros))}
      </tr>
    </table>
    <div style="height:12px;"></div>
    ${rowsTable(["Método", "Monto"], metodoRows, "Sin cobros registrados.")}

    ${sectionTitle("Facturación AFIP")}
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;width:100%;">
      <tr>
        ${kpi("Facturado", summary.facturacion.total)}
        ${kpi("Comprobantes", `${summary.facturacion.comprobantes} (${summary.facturacion.desglose})`)}
        ${kpi("Pendientes / fallidos", `${summary.facturacion.pendientes} / ${summary.facturacion.fallidos}`)}
      </tr>
    </table>

    ${sectionTitle("Operación")}
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;width:100%;">
      <tr>
        ${kpi("Pedidos", String(summary.operacion.pedidos))}
        ${kpi("Ticket promedio", summary.operacion.ticketPromedio)}
        ${kpi("Cancelados", String(summary.operacion.cancelados))}
      </tr>
      <tr><td style="height:8px;"></td></tr>
      <tr>
        ${kpi("Mesas", String(summary.operacion.mesas))}
        ${kpi("Delivery", String(summary.operacion.delivery))}
        ${kpi("Retiro", String(summary.operacion.pickup))}
      </tr>
    </table>

    ${sectionTitle("Caja — cierres")}
    ${rowsTable(["Caja", "Encargado", "Diferencia", "Hora"], corteRows, "No se hicieron cortes de caja.")}
    <p style="color:${C.muted};font-size:13px;margin:8px 0 0;">Diferencia total: <strong style="color:${C.ink};">${esc(summary.caja.diferenciaTotal)}</strong></p>

    ${sectionTitle("Por mozo")}
    ${rowsTable(["Mozo", "Ventas", "Propinas"], mozoRows, "Sin ventas atribuidas a mozos.")}

    ${sectionTitle("Anulaciones")}
    ${rowsTable(["Detalle", "Motivo", "Responsable", "Hora"], anulRows, "Sin anulaciones en el día. ✅")}

    ${
      // Igual que las correcciones: sin invitaciones no hay sección.
      invitacionRows.length > 0
        ? `${sectionTitle(`Invitaciones · ${summary.invitacionesTotal} de carta`)}
    ${rowsTable(["Detalle", "Motivo", "Quién invitó", "Valía", "Hora"], invitacionRows, "")}`
        : ""
    }

    ${
      // Sin correcciones no hay sección: el mail no gana nada diciendo que no
      // pasó nada, y la sección vacía entrenaría a saltearla.
      correccionRows.length > 0
        ? `${sectionTitle("Correcciones de caja")}
    ${rowsTable(["Detalle", "Cambio", "Motivo", "Responsable", "Hora"], correccionRows, "")}`
        : ""
    }
  `;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg};">
  <div style="max-width:640px;margin:0 auto;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="background:${C.card};border:1px solid ${C.line};border-radius:16px;padding:24px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:${C.accent};font-weight:700;">Cierre del día</div>
      <h1 style="font-size:22px;color:${C.ink};margin:4px 0 2px;">${esc(summary.businessName)}</h1>
      <div style="font-size:14px;color:${C.muted};text-transform:capitalize;">${esc(summary.rangeLabel)}</div>
      ${body}
    </div>
    <p style="text-align:center;font-size:12px;color:${C.muted};margin:16px 0;">Resumen automático de RestaurantOS · pedidos.com.ar</p>
  </div>
</body></html>`;

  const text = renderText(summary);
  return { subject, html, text };
}

function renderText(s: ShiftSummary): string {
  const lines: string[] = [];
  lines.push(`CIERRE DEL DÍA — ${s.businessName}`);
  lines.push(s.rangeLabel);
  lines.push("");
  if (!s.hasData) {
    lines.push("No hubo movimiento registrado en el día.");
    return lines.join("\n");
  }
  lines.push("RECAUDACIÓN");
  lines.push(
    `  Ventas: ${s.recaudacion.total}  ·  Propinas: ${s.recaudacion.propinas}  ·  Cobros: ${s.recaudacion.cobros}`,
  );
  // El fiado sólo aparece cuando lo hubo: un renglón «$0» todos los días lo
  // vuelve invisible justo el día que importa.
  if (s.recaudacion.tieneFiado) {
    lines.push(`  Fiado (no entró al cajón): ${s.recaudacion.fiado}`);
  }
  for (const m of s.recaudacion.porMetodo)
    lines.push(`  - ${m.label}: ${m.value}`);
  lines.push("");
  lines.push("FACTURACIÓN AFIP");
  lines.push(
    `  Facturado: ${s.facturacion.total}  ·  Comprobantes: ${s.facturacion.comprobantes} (${s.facturacion.desglose})  ·  Pend/Fallidos: ${s.facturacion.pendientes}/${s.facturacion.fallidos}`,
  );
  lines.push("");
  lines.push("OPERACIÓN");
  lines.push(
    `  Pedidos: ${s.operacion.pedidos}  ·  Ticket prom.: ${s.operacion.ticketPromedio}  ·  Cancelados: ${s.operacion.cancelados}`,
  );
  lines.push(
    `  Mesas: ${s.operacion.mesas}  ·  Delivery: ${s.operacion.delivery}  ·  Retiro: ${s.operacion.pickup}`,
  );
  lines.push("");
  lines.push("CAJA — CIERRES");
  if (s.caja.cortes.length === 0) lines.push("  (sin cortes)");
  for (const c of s.caja.cortes)
    lines.push(
      `  - ${c.caja} · ${c.encargado} · dif ${c.diferencia} · ${c.hora}`,
    );
  lines.push(`  Diferencia total: ${s.caja.diferenciaTotal}`);
  lines.push("");
  lines.push("POR MOZO");
  if (s.porMozo.length === 0) lines.push("  (sin ventas atribuidas)");
  for (const m of s.porMozo)
    lines.push(`  - ${m.mozo}: ventas ${m.ventas} · propinas ${m.propinas}`);
  lines.push("");
  lines.push("ANULACIONES");
  if (s.anulaciones.length === 0) lines.push("  (sin anulaciones)");
  for (const a of s.anulaciones)
    lines.push(`  - ${a.detalle} · ${a.motivo} · ${a.responsable} · ${a.hora}`);
  if (s.invitaciones.length > 0) {
    lines.push("");
    lines.push(`INVITACIONES (${s.invitacionesTotal} de carta)`);
    for (const i of s.invitaciones)
      lines.push(`  - ${i.detalle} · ${i.valor} · ${i.motivo} · ${i.responsable} · ${i.hora}`);
  }
  if (s.correcciones.length > 0) {
    lines.push("");
    lines.push("CORRECCIONES DE CAJA");
    for (const c of s.correcciones)
      lines.push(
        `  - ${c.detalle}: ${c.cambio} · ${c.motivo} · ${c.responsable} · ${c.hora}`,
      );
  }
  return lines.join("\n");
}

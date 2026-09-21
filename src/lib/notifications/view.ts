/**
 * UI helpers compartidos para renderizar notificaciones (drawer admin,
 * AvisosSection del mozo, futuros toasts). Mantener el switch acá hace que
 * sumar tipos nuevos sea un solo punto de cambio.
 */
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  CalendarPlus,
  CalendarX2,
  CheckCircle2,
  MoveRight,
  PackageX,
  Printer,
  ReceiptText,
  ShoppingBag,
  Trash2,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import type { Notification } from "@/lib/notifications/queries";

export type NotiTone = "info" | "warning" | "success" | "danger";

export type NotiView = {
  tone: NotiTone;
  icon: LucideIcon;
  title: string;
  body: string;
};

export const NOTI_TONE_STYLES: Record<
  NotiTone,
  { iconBg: string; iconText: string; ring: string }
> = {
  info: {
    iconBg: "bg-sky-50",
    iconText: "text-sky-700",
    ring: "ring-sky-200/70",
  },
  warning: {
    iconBg: "bg-amber-50",
    iconText: "text-amber-700",
    ring: "ring-amber-200/70",
  },
  success: {
    iconBg: "bg-emerald-50",
    iconText: "text-emerald-700",
    ring: "ring-emerald-200/70",
  },
  danger: {
    iconBg: "bg-rose-50",
    iconText: "text-rose-700",
    ring: "ring-rose-200/70",
  },
};

export function viewForNotification(n: Notification): NotiView {
  const p = (n.payload ?? {}) as Record<string, unknown>;

  if (n.type === "mesa.transferred") {
    const tableLabel = (p.tableLabel as string | undefined) ?? "?";
    const fromName = p.fromName as string | null | undefined;
    const toName = p.toName as string | null | undefined;
    return {
      tone: "info",
      icon: ArrowLeftRight,
      title: `Mesa ${tableLabel} transferida`,
      body: [
        fromName ? `De ${fromName}` : null,
        toName ? `a ${toName}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  if (n.type === "mesa.moved") {
    const fromLabel = (p.fromLabel as string | undefined) ?? "?";
    const toLabel = (p.toLabel as string | undefined) ?? "?";
    const movedByName = p.movedByName as string | null | undefined;
    return {
      tone: "info",
      icon: MoveRight,
      title: `Mesa ${fromLabel} → ${toLabel}`,
      body: movedByName ? `Trasladada por ${movedByName}` : "Mesa trasladada",
    };
  }
  if (n.type === "mesa.cancelled") {
    const tableLabel = (p.tableLabel as string | undefined) ?? "?";
    const reason = p.reason as string | undefined;
    return {
      tone: "danger",
      icon: Ban,
      title: `Mesa ${tableLabel} anulada`,
      body: reason ? `Motivo: ${reason}` : "Sin motivo registrado.",
    };
  }
  if (n.type === "order.pending") {
    const num = (p.orderNumber as number | undefined) ?? "?";
    // El retiro en el local se persiste como `pickup`; `take_away` nunca se
    // escribe (era un valor fantasma que dejaba a todo retiro como "Pedido").
    const tipo =
      p.deliveryType === "delivery"
        ? "Delivery"
        : p.deliveryType === "pickup"
          ? "Take-away"
          : "Pedido";
    const customer = (p.customerName as string | undefined) ?? "cliente";
    return {
      tone: "warning",
      icon: ShoppingBag,
      title: `${tipo} nuevo · #${num}`,
      body: `De ${customer}. Falta confirmar.`,
    };
  }
  if (n.type === "comanda.entregada") {
    const tableLabel = (p.tableLabel as string | undefined) ?? "?";
    const stationName = (p.stationName as string | undefined) ?? "Cocina";
    const itemCount = (p.itemCount as number | undefined) ?? 0;
    return {
      tone: "success",
      icon: CheckCircle2,
      title: `Comanda lista · Mesa ${tableLabel}`,
      body: `${stationName} — ${itemCount} ${itemCount === 1 ? "plato" : "platos"} para servir`,
    };
  }
  // ── spec 27 ───────────────────────────────────────────────────────
  if (n.type === "reserva.nueva") {
    const hora = (p.hora as string | undefined) ?? "";
    const personas = p.personas as number | undefined;
    const nombre = (p.nombre as string | undefined) ?? "cliente";
    // Spec 131 — la que entra por la web o el chatbot espera una decisión, y el
    // aviso lo dice: es lo que separa "enterate" de "andá a resolverlo".
    const pendiente = p.pendiente === true;
    return {
      tone: pendiente ? "warning" : "info",
      icon: CalendarPlus,
      title: pendiente
        ? hora
          ? `Reserva a confirmar · ${hora}`
          : "Reserva a confirmar"
        : hora
          ? `Reserva nueva · ${hora}`
          : "Reserva nueva",
      body: [personas ? `${personas}p` : null, nombre].filter(Boolean).join(" — "),
    };
  }
  if (n.type === "reserva.cancelada_cliente") {
    const nombre = (p.nombre as string | undefined) ?? "El cliente";
    const fecha = (p.fecha as string | undefined) ?? "";
    const hora = (p.hora as string | undefined) ?? "";
    const cuando = [fecha, hora].filter(Boolean).join(" ");
    return {
      tone: "warning",
      icon: CalendarX2,
      title: "Reserva cancelada",
      body: cuando ? `${nombre} canceló ${cuando}` : `${nombre} canceló su reserva`,
    };
  }
  if (n.type === "order.cancelled_by_customer") {
    const num = (p.orderNumber as number | undefined) ?? "?";
    const customer = p.customerName as string | undefined;
    return {
      tone: "warning",
      icon: PackageX,
      title: `Pedido #${num} cancelado`,
      body: customer ? `${customer} canceló el pedido` : "El cliente canceló el pedido",
    };
  }
  if (n.type === "mesa.pidio_cuenta") {
    const tableLabel = (p.tableLabel as string | undefined) ?? "?";
    return {
      tone: "info",
      icon: ReceiptText,
      title: `Mesa ${tableLabel} pidió la cuenta`,
      body: "Pasar a cobrar.",
    };
  }
  if (n.type === "item.cancelado") {
    const tableLabel = (p.tableLabel as string | undefined) ?? "?";
    const itemName = p.itemName as string | undefined;
    const reason = p.reason as string | undefined;
    return {
      tone: "warning",
      icon: Trash2,
      title: `Ítem anulado · Mesa ${tableLabel}`,
      body: [itemName, reason].filter(Boolean).join(" — ") || "Se anuló un ítem.",
    };
  }
  // ── spec 33 ───────────────────────────────────────────────────────
  if (n.type === "comanda.impresion_fallida") {
    const tableLabel = p.tableLabel as string | undefined;
    const orderNumber = p.orderNumber as number | undefined;
    const stationName = (p.stationName as string | undefined) ?? "Cocina";
    const origen = tableLabel
      ? `Mesa ${tableLabel}`
      : orderNumber
        ? `Pedido #${orderNumber}`
        : "Pedido";
    return {
      tone: "danger",
      icon: Printer,
      title: `No se imprimió · ${origen}`,
      body: `${stationName} — revisá la comandera`,
    };
  }

  // ── spec 139 ──────────────────────────────────────────────────────
  if (n.type === "rendicion.pendiente") {
    const mozoName = (p.mozoName as string | undefined) ?? "Un mozo";
    const noEntrego = p.estado === "no_entrego";
    const falta = Math.abs((p.differenceCents as number | undefined) ?? 0);
    const reason = p.reason as string | undefined;
    return {
      tone: "danger",
      icon: Wallet,
      title: noEntrego
        ? `No rindió · ${mozoName}`
        : `Diferencia de rendición · ${mozoName}`,
      body: [formatCurrency(falta), reason].filter(Boolean).join(" — "),
    };
  }

  // ── spec 147 ──────────────────────────────────────────────────────
  if (n.type === "factura.emision_fallida") {
    const tableLabel = p.tableLabel as string | undefined;
    const orderNumber = p.orderNumber as number | undefined;
    const error = p.error as string | undefined;
    const origen = tableLabel
      ? `Mesa ${tableLabel}`
      : orderNumber
        ? `Pedido #${orderNumber}`
        : "Un cobro";
    return {
      tone: "danger",
      icon: ReceiptText,
      title: `Sin comprobante · ${origen}`,
      // El rechazo de ARCA tal cual: «EL PUNTO DE VENTA INFORMADO DEBE ESTAR
      // DADO DE ALTA» es accionable, y traducirlo lo volvería adivinanza.
      body: error ?? "ARCA rechazó la factura — reintentala desde Facturación.",
    };
  }

  // ── #148 · H-20 + H-45 ────────────────────────────────────────────
  //
  // El barrido de pedidos online sin resolver (`vencer-pendientes.ts`) avisa
  // 30 min antes de cancelar un programado en efectivo que nadie aceptó.
  if (n.type === "pedido.programado_por_vencer") {
    const orderNumber = p.orderNumber as number | undefined;
    const customerName = p.customerName as string | undefined;
    return {
      tone: "warning",
      icon: CalendarX2,
      title: `Programado sin confirmar${orderNumber ? ` · #${orderNumber}` : ""}`,
      body: `${
        customerName ? `El pedido de ${customerName}` : "Un pedido programado"
      } pasó su horario y nadie lo aceptó. Si no lo confirmás, se cancela solo en 30 min.`,
    };
  }

  // Entró un pago de MP sobre un pedido ya cancelado (medios offline, o un
  // link abierto): la plata está en la cuenta de MP y hay que devolverla.
  if (n.type === "mp.pago_sobre_cancelado") {
    const orderNumber = p.orderNumber as number | undefined;
    const amountCents = p.amountCents as number | undefined;
    return {
      tone: "danger",
      icon: Wallet,
      title: `Pago sobre pedido cancelado${orderNumber ? ` · #${orderNumber}` : ""}`,
      body: `Mercado Pago acreditó ${
        amountCents ? formatCurrency(amountCents) : "un pago"
      } de un pedido que ya estaba cancelado. No se cocina: hay que devolverle la plata al cliente desde Mercado Pago.`,
    };
  }

  // ── issue #274 ────────────────────────────────────────────────────
  //
  // ARCA autorizó una factura de una venta que ya no existe: la orden se anuló
  // o el cobro se reembolsó. El CAE es un hecho consumado —ante ARCA la venta
  // está declarada— así que la única salida es emitir la nota de crédito, y eso
  // lo hace una persona.
  //
  // Sin esta rama el aviso caía en el fallback del final del archivo y el
  // encargado veía «factura.nc_pendiente» crudo en la campana: se cambió un
  // console.warn que nadie leía por una fila que nadie entiende, que es peor
  // porque además ocupa lugar.
  if (n.type === "factura.nc_pendiente") {
    const motivo = p.motivo as string | undefined;
    const totalCents = p.totalCents as number | undefined;
    const porque =
      motivo === "cobro_reembolsado"
        ? "el cobro se reembolsó"
        : "la orden se anuló";
    return {
      tone: "danger",
      icon: ReceiptText,
      title: "Falta la nota de crédito",
      body: `ARCA autorizó ${
        totalCents ? formatCurrency(totalCents) : "una factura"
      } y ${porque}. Emitila desde Facturación: el IVA sigue declarado hasta entonces.`,
    };
  }

  // ── spec 093 ──────────────────────────────────────────────────────
  if (n.type === "pedido.sin_comanda") {
    const orderNumber = p.orderNumber as number | undefined;
    const sinSector = (p.itemsWithoutStation as number | undefined) ?? 0;
    const origen = orderNumber ? `Pedido #${orderNumber}` : "Pedido";
    return {
      tone: "warning",
      icon: PackageX,
      title: `Marchó sin comanda · ${origen}`,
      body: `${sinSector} ${sinSector === 1 ? "ítem" : "ítems"} sin sector — no salió papel en cocina`,
    };
  }

  return {
    tone: "info",
    icon: AlertTriangle,
    title: n.type,
    body: "Notificación.",
  };
}

/**
 * "ahora", "5 min", "1h 20", "2 h", "3 d" — mismo formato que el salón /
 * comandas kanban / cards para unificar el lenguaje de tiempos.
 */
export function formatNotificationTime(iso: string): string {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours}h ${rest}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} d`;
}

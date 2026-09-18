"use client";

/**
 * Las piezas de métrica de la caja que se leen en dos lugares: el board de la
 * tab y el modal de cierre (spec 130). Viven acá para que el modal no tenga
 * que importar del board —que a su vez importa el modal— ni duplicar el
 * desglose que ya existía.
 */

import {
  Banknote,
  CreditCard,
  Link2,
  MoreHorizontal,
  Package,
  QrCode,
  Truck,
  UtensilsCrossed,
  Wallet,
  Smartphone,
} from "lucide-react";

import type { PaymentMethod, VentaOrigen } from "@/lib/caja/types";
import { formatCurrency } from "@/lib/currency";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  mp_qr: "MercadoPago QR",
  mp_link: "MercadoPago link",
  card_manual: "Tarjeta",
  transfer: "Transferencia",
  mp_manual: "Mercado Pago",
  other: "Otro",
  cuenta_corriente: "Cuenta corriente",
};

/**
 * Un tono por método, **estable en toda la pantalla**: el mismo color significa
 * el mismo medio en la barra de arriba y en la de cada origen, que es lo que
 * hace comparable un origen con otro de un vistazo.
 *
 * El efectivo va primero y más oscuro a propósito: es el único que se cuenta
 * al cerrar.
 */
export const METHOD_COLOR: Record<PaymentMethod, string> = {
  cash: "#18181B",
  mp_qr: "#52525B",
  mp_link: "#71717A",
  card_manual: "#A1A1AA",
  transfer: "#C4C4C8",
  mp_manual: "#71717A",
  other: "#D4D4D8",
  cuenta_corriente: "Cuenta corriente",
};

export function methodIcon(method: PaymentMethod) {
  switch (method) {
    case "cash": return Banknote;
    case "mp_qr": return QrCode;
    case "mp_link": return Link2;
    case "card_manual": return CreditCard;
    case "transfer": return Wallet;
    case "mp_manual": return Smartphone;
    default: return MoreHorizontal;
  }
}

// Orden canónico de métodos para el desglose. Las filas con monto > 0 se
// muestran como barras (ordenadas por monto desc); las que están en $0 se
// colapsan en una sola línea al pie, para no competir con los cobros reales.
const COBRO_METHOD_ORDER: PaymentMethod[] = [
  "cash",
  "mp_qr",
  "mp_link",
  "card_manual",
  "transfer",
  "mp_manual",
  "other",
];

export function CobrosPorMetodo({
  porMetodo,
}: {
  porMetodo: Record<PaymentMethod, number>;
}) {
  const metodos = COBRO_METHOD_ORDER.map((key) => ({
    key,
    label: METHOD_LABEL[key],
    Icon: methodIcon(key),
    amount: porMetodo[key] ?? 0,
  }));
  const total = metodos.reduce((s, m) => s + m.amount, 0);
  const activos = metodos
    .filter((m) => m.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const vacios = metodos.filter((m) => m.amount === 0);

  return (
    <>
      <ul className="mt-4 space-y-3.5">
        {activos.map(({ key, label, Icon, amount }) => {
          const pct = total > 0 ? (amount / total) * 100 : 0;
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="inline-flex items-baseline gap-2 text-foreground/80">
                  <Icon className="size-3.5 shrink-0 translate-y-px text-muted-foreground/70" />
                  <span className="font-medium">{label}</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatCurrency(amount)}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground/70">
                  {pct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(pct, 2)}%`,
                    background: "var(--brand, #18181B)",
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {vacios.length > 0 && (
        <p className="mt-4 border-t border-border/60 pt-3 text-[0.7rem] leading-relaxed text-muted-foreground/70">
          <span className="font-medium text-muted-foreground">Sin movimientos:</span>{" "}
          {vacios.map((m) => m.label).join(", ")}
        </p>
      )}
    </>
  );
}

// Desglose de lo cobrado según de dónde vino el pedido. `otro` solo aparece si
// hay plata ahí: es el balde de valores viejos/desconocidos de `delivery_type`.
const ORIGEN_META: Record<
  VentaOrigen,
  { label: string; Icon: typeof UtensilsCrossed }
> = {
  salon: { label: "Salón", Icon: UtensilsCrossed },
  delivery: { label: "Delivery", Icon: Truck },
  takeaway: { label: "Take away", Icon: Package },
  otro: { label: "Otro", Icon: MoreHorizontal },
};

const ORIGEN_ORDER: VentaOrigen[] = ["salon", "delivery", "takeaway", "otro"];

export function VentasPorOrigen({
  porOrigen,
}: {
  porOrigen: Record<VentaOrigen, number>;
}) {
  const total = ORIGEN_ORDER.reduce((s, k) => s + (porOrigen[k] ?? 0), 0);
  const items = ORIGEN_ORDER.filter(
    (k) => k !== "otro" || (porOrigen[k] ?? 0) > 0,
  );

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Cobrado por origen
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {items.map((key) => {
          const { label, Icon } = ORIGEN_META[key];
          const amount = porOrigen[key] ?? 0;
          const pct = total > 0 ? (amount / total) * 100 : 0;
          return (
            <li
              key={key}
              className="rounded-xl bg-muted/50 px-3.5 py-3 ring-1 ring-border/70"
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-foreground/70">
                <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
                {label}
              </p>
              <p className="mt-1 text-lg font-bold tracking-tight text-foreground tabular-nums">
                {formatCurrency(amount)}
              </p>
              <p className="text-[0.7rem] tabular-nums text-muted-foreground/70">
                {pct.toFixed(0)}% del período
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}


/**
 * Cobrado por método, como bloque propio (pedido de Juan, 2026-09-03).
 *
 * Es el mismo desglose que `CobrosPorMetodo` pero pensado para el lugar donde
 * antes iba el de origen: primero el total de cada medio, con su barra lateral.
 * El color de cada método es el mismo que usa el desglose por origen, así las
 * dos mitades de la pantalla se leen juntas.
 */
export function VentasPorMetodo({
  porMetodo,
}: {
  porMetodo: Record<PaymentMethod, number>;
}) {
  const metodos = COBRO_METHOD_ORDER.map((key) => ({
    key,
    label: METHOD_LABEL[key],
    Icon: methodIcon(key),
    amount: porMetodo[key] ?? 0,
  }));
  const total = metodos.reduce((s, m) => s + m.amount, 0);
  const activos = metodos
    .filter((m) => m.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const vacios = metodos.filter((m) => m.amount === 0);

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-border/70">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Cobrado por método
      </p>

      {activos.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Todavía no se cobró nada.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {activos.map(({ key, label, Icon, amount }) => {
            const pct = total > 0 ? (amount / total) * 100 : 0;
            return (
              <li key={key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="inline-flex items-baseline gap-2 text-sm">
                    <Icon className="size-3.5 shrink-0 translate-y-px text-muted-foreground/70" />
                    <span className="font-medium text-foreground/80">{label}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="text-base font-bold tracking-tight text-foreground tabular-nums">
                      {formatCurrency(amount)}
                    </span>
                    <span className="text-xs font-medium tabular-nums text-muted-foreground/70">
                      {pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      background: METHOD_COLOR[key],
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {vacios.length > 0 && activos.length > 0 && (
        <p className="mt-3.5 border-t border-border/60 pt-2.5 text-[0.7rem] leading-relaxed text-muted-foreground/70">
          <span className="font-medium text-muted-foreground">Sin movimientos:</span>{" "}
          {vacios.map((m) => m.label).join(", ")}
        </p>
      )}
    </section>
  );
}

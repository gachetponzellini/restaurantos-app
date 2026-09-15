import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  Bike,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Mail,
  MapPin,
  Phone,
  Receipt,
  ShoppingBag,
  Timer,
} from "lucide-react";

import { CustomerChatbotSection } from "@/components/admin/customers/customer-chatbot-modal";
import { CuentaCorrienteSection } from "@/components/admin/customers/cuenta-corriente-section";
import type { CuentaDeCliente } from "@/lib/caja/cuenta-corriente-queries";
import { SegmentChip } from "@/components/admin/customers/customers-list-client";
import type {
  CustomerChatbotConversation,
  CustomerDetail,
} from "@/lib/admin/customers-query";
import { formatCurrency } from "@/lib/currency";
import { copyDeEntrega } from "@/lib/orders/entrega-por-lote";
import { STATUS_META } from "@/lib/orders/status-meta";
import { cn } from "@/lib/utils";

export function CustomerDetailView({
  slug,
  timezone,
  customer,
  businessName,
  businessLogoUrl,
  chatbotConversation,
  cuenta,
}: {
  slug: string;
  timezone: string;
  customer: CustomerDetail;
  businessName: string;
  businessLogoUrl: string | null;
  chatbotConversation: CustomerChatbotConversation | null;
  /** spec 141 · US1 — saldo y libro de su cuenta corriente. */
  cuenta: CuentaDeCliente;
}) {
  const initials = getInitials(customer.name ?? customer.phone);
  const createdLabel = formatInTimeZone(
    customer.created_at,
    timezone,
    "d 'de' MMMM yyyy",
    { locale: es },
  );
  const lastOrderLabel = customer.last_order_at
    ? formatInTimeZone(customer.last_order_at, timezone, "d MMM · HH:mm", {
        locale: es,
      })
    : "Nunca";

  // wa.me link to open WhatsApp with this customer's phone pre-filled.
  // Strip non-digits — wa.me doesn't accept "+", spaces or dashes.
  const waPhone = customer.phone.replace(/\D/g, "");
  const waLink = waPhone ? `https://wa.me/${waPhone}` : null;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={`/${slug}/admin/clientes`}
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="size-3.5" /> Volver a clientes
      </Link>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span
            className="flex size-16 shrink-0 items-center justify-center rounded-2xl text-xl font-bold ring-1 ring-black/10"
            style={{
              background: "var(--brand, #2563eb)",
              color: "var(--brand-foreground, white)",
            }}
          >
            {initials}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-900">
              {customer.name || "Sin nombre"}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
              {waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-zinc-900 hover:underline"
                  title="Abrir WhatsApp Web con este contacto"
                >
                  <Phone className="size-3.5" />
                  {customer.phone}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3.5" />
                  {customer.phone}
                </span>
              )}
              {customer.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-3.5" />
                  {customer.email}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-zinc-500">
                <CalendarDays className="size-3.5" />
                Cliente desde {createdLabel}
              </span>
            </div>
            {customer.segments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {customer.segments.map((s) => (
                  <SegmentChip key={s} segment={s} />
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Stat tiles ─────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total gastado"
          value={formatCurrency(customer.total_spent_cents)}
          icon={<CircleDollarSign className="size-4" strokeWidth={1.75} />}
          accent
        />
        <StatTile
          label="Pedidos"
          value={String(customer.order_count)}
          icon={<Receipt className="size-4" strokeWidth={1.75} />}
        />
        <StatTile
          label="Ticket promedio"
          value={
            customer.order_count > 0
              ? formatCurrency(customer.avg_ticket_cents)
              : "—"
          }
          icon={<ShoppingBag className="size-4" strokeWidth={1.75} />}
        />
        <StatTile
          label={
            customer.days_since_last_order === null
              ? "Sin pedidos"
              : "Días desde el último"
          }
          value={
            customer.days_since_last_order === null
              ? "—"
              : customer.days_since_last_order === 0
                ? "Hoy"
                : String(customer.days_since_last_order)
          }
          sub={lastOrderLabel}
          icon={<Timer className="size-4" strokeWidth={1.75} />}
        />
      </section>

      {/* ── Two columns: top products + addresses ──────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* Top products */}
        <div className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
          <h2 className="mb-3 text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            Lo que más pide
          </h2>
          {customer.top_products.length === 0 ? (
            <p className="text-sm text-zinc-500">Sin pedidos todavía.</p>
          ) : (
            <ul className="space-y-2">
              {customer.top_products.map((p) => (
                <li
                  key={p.product_name}
                  className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-sm text-zinc-800">
                    <span className="font-semibold text-zinc-900">
                      {p.quantity}×
                    </span>{" "}
                    {p.product_name}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
                    {formatCurrency(p.total_spent_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Addresses */}
        <div className="rounded-2xl bg-white p-5 ring-1 ring-zinc-200/70">
          <h2 className="mb-3 text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            {copyDeEntrega(slug).porLote
              ? "Lotes guardados"
              : "Direcciones guardadas"}
          </h2>
          {customer.addresses.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {copyDeEntrega(slug).porLote
                ? "No tiene lotes guardados (puede ser cliente de retiro)."
                : "No tiene direcciones guardadas (puede ser cliente de retiro)."}
            </p>
          ) : (
            <ul className="space-y-2">
              {customer.addresses.map((a) => {
                const lines = [
                  a.street + (a.number ? ` ${a.number}` : ""),
                  a.apartment ? `Depto ${a.apartment}` : null,
                  a.notes,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li
                    key={a.id}
                    className="flex items-start gap-2 border-b border-zinc-100 pb-2 last:border-b-0 last:pb-0"
                  >
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-zinc-400" />
                    <div className="min-w-0">
                      {a.label && (
                        <p className="text-[0.65rem] font-semibold tracking-wider text-zinc-500 uppercase">
                          {a.label}
                        </p>
                      )}
                      <p className="text-sm text-zinc-700">{lines}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ── Cuenta corriente (spec 141) ──────────────────────────────────── */}
      <CuentaCorrienteSection
        slug={slug}
        customerId={customer.id}
        habilitadaInicial={customer.credit_enabled}
        saldoCents={cuenta.saldo_cents}
        diasSinPagar={cuenta.dias_sin_pagar}
        libro={cuenta.libro}
      />

      {/* ── Chatbot ─────────────────────────────────────────────────────── */}
      <CustomerChatbotSection
        conversation={chatbotConversation}
        businessName={businessName}
        businessLogoUrl={businessLogoUrl}
        customerName={customer.name}
        customerPhone={customer.phone}
        customerId={customer.id}
        slug={slug}
        timezone={timezone}
      />

      {/* ── Orders ──────────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white ring-1 ring-zinc-200/70">
        <header className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2 className="text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
            Historial de pedidos
          </h2>
          <span className="text-xs text-zinc-500">
            {customer.orders.length === 0
              ? "Sin pedidos"
              : customer.orders.length === 1
                ? "1 pedido"
                : `${customer.orders.length} pedidos`}
          </span>
        </header>
        {customer.orders.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">
            Cuando haga su primer pedido lo vas a ver acá.
          </p>
        ) : (
          <ul>
            {customer.orders.map((o, idx) => (
              <li
                key={o.id}
                style={
                  idx % 2 === 1
                    ? {
                        background:
                          "color-mix(in oklch, var(--brand, #2563eb) 14%, white)",
                      }
                    : undefined
                }
                className="border-b border-zinc-100 last:border-b-0"
              >
                <Link
                  href={`/${slug}/admin/pedidos/${o.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition hover:bg-zinc-100/40"
                >
                  <span className="text-base font-semibold text-zinc-900">
                    #{o.order_number}
                  </span>
                  {o.delivery_type === "delivery" ? (
                    <Bike
                      className="size-3.5 text-zinc-400"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <ShoppingBag
                      className="size-3.5 text-zinc-400"
                      strokeWidth={1.75}
                    />
                  )}
                  <span className="text-sm text-zinc-600 tabular-nums">
                    {formatInTimeZone(o.created_at, timezone, "d MMM · HH:mm", {
                      locale: es,
                    })}
                  </span>
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold",
                      STATUS_META[o.status].tone,
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        STATUS_META[o.status].dot,
                      )}
                    />
                    {STATUS_META[o.status].label}
                  </span>
                  <span className="text-base font-semibold text-zinc-900 tabular-nums">
                    {formatCurrency(o.total_cents)}
                  </span>
                  <ChevronRight className="size-4 text-zinc-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white p-4 ring-1 ring-zinc-200/70",
        accent && "ring-2",
      )}
      style={
        accent
          ? {
              background:
                "color-mix(in oklch, var(--brand, #2563eb) 8%, white)",
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.65rem] font-semibold tracking-[0.14em] text-zinc-500 uppercase">
          {label}
        </p>
        <span className="text-zinc-400">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-zinc-900 tabular-nums">
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs text-zinc-500 tabular-nums">{sub}</p>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(s: string): string {
  return (
    s
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

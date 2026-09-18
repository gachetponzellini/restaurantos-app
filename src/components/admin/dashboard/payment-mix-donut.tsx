"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { formatCurrency } from "@/lib/currency";
import type { PaymentMethodKey, PaymentMix } from "@/lib/admin/dashboard-query";

const METHOD_META: Record<
  PaymentMethodKey,
  { label: string; color: string; dot: string }
> = {
  cash: { label: "Efectivo", color: "#10b981", dot: "bg-emerald-500" },
  mp_qr: { label: "QR Mercado Pago", color: "#18181b", dot: "bg-zinc-900" },
  mp_link: { label: "Link de pago", color: "#6366f1", dot: "bg-indigo-500" },
  card_manual: { label: "Tarjeta (POS)", color: "#f59e0b", dot: "bg-amber-500" },
  transfer: { label: "Transferencia", color: "#0ea5e9", dot: "bg-sky-500" },
  mp_manual: { label: "Mercado Pago", color: "#8b5cf6", dot: "bg-violet-500" },
  other: { label: "Otros", color: "#a1a1aa", dot: "bg-zinc-400" },
};

const ORDER: PaymentMethodKey[] = [
  "cash",
  "mp_qr",
  "mp_link",
  "card_manual",
  "transfer",
  "mp_manual",
  "other",
];

export function PaymentMixDonut({ data }: { data: PaymentMix }) {
  const pieData = useMemo(
    () =>
      ORDER.map((k) => ({
        key: k,
        name: METHOD_META[k].label,
        value: data.byMethod[k].amountCents,
        color: METHOD_META[k].color,
      })).filter((d) => d.value > 0),
    [data],
  );

  const cashPct =
    data.totalCents > 0 ? (data.cashCents / data.totalCents) * 100 : 0;

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-zinc-200/70">
      <header>
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Medios de pago · últimos 30 días
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Cómo te pagan
        </h2>
      </header>

      {data.totalCents === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-6 text-center text-sm text-zinc-600">
          Sin cobros registrados en este período.
        </div>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <div className="relative size-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  innerRadius={58}
                  outerRadius={84}
                  paddingAngle={2}
                  stroke="none"
                  startAngle={90}
                  endAngle={450}
                  isAnimationActive={false}
                >
                  {pieData.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-900">
                {cashPct.toFixed(0)}%
              </span>
              <span className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                efectivo
              </span>
            </div>
          </div>

          <ul className="flex-1 space-y-2.5">
            {ORDER.map((k) => {
              const item = data.byMethod[k];
              if (item.amountCents === 0) return null;
              const pct =
                data.totalCents > 0
                  ? (item.amountCents / data.totalCents) * 100
                  : 0;
              return (
                <li
                  key={k}
                  className="grid grid-cols-[12px_1fr_auto] items-center gap-2.5"
                >
                  <span
                    className={`size-2.5 rounded-full ${METHOD_META[k].dot}`}
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {METHOD_META[k].label}
                    </p>
                    <p className="text-xs tabular-nums text-zinc-500">
                      {item.count} cobros ·{" "}
                      <span className="text-zinc-400">
                        {formatCurrency(item.amountCents)}
                      </span>
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-zinc-900">
                    {pct.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Banknote,
  CreditCard,
  QrCode,
  Link2,
  ArrowRightLeft,
  CircleEllipsis,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { upsertPaymentMethodConfig } from "@/lib/caja/actions";
import type { PaymentMethod, PaymentMethodConfig } from "@/lib/caja/types";
import { cn } from "@/lib/utils";

const METHOD_META: {
  method: PaymentMethod;
  defaultLabel: string;
  icon: React.ReactNode;
}[] = [
  { method: "cash", defaultLabel: "Efectivo", icon: <Banknote className="size-4" /> },
  { method: "card_manual", defaultLabel: "Tarjeta (manual)", icon: <CreditCard className="size-4" /> },
  { method: "mp_link", defaultLabel: "MP Link", icon: <Link2 className="size-4" /> },
  { method: "mp_qr", defaultLabel: "MP QR", icon: <QrCode className="size-4" /> },
  { method: "transfer", defaultLabel: "Transferencia", icon: <ArrowRightLeft className="size-4" /> },
  { method: "mp_manual", defaultLabel: "Mercado Pago", icon: <Smartphone className="size-4" /> },
  { method: "other", defaultLabel: "Otro", icon: <CircleEllipsis className="size-4" /> },
];

type RowState = {
  adjustment_percent: number;
  label: string;
  is_active: boolean;
  dirty: boolean;
};

function buildInitialState(
  configs: PaymentMethodConfig[],
): Record<PaymentMethod, RowState> {
  const byMethod = new Map(configs.map((c) => [c.method, c]));
  const state: Record<string, RowState> = {};
  for (const m of METHOD_META) {
    const existing = byMethod.get(m.method);
    state[m.method] = {
      adjustment_percent: existing?.adjustment_percent ?? 0,
      label: existing?.label ?? "",
      is_active: existing?.is_active ?? true,
      dirty: false,
    };
  }
  return state as Record<PaymentMethod, RowState>;
}

export function PaymentMethodsConfig({
  slug,
  configs,
}: {
  slug: string;
  configs: PaymentMethodConfig[];
}) {
  const [rows, setRows] = useState(() => buildInitialState(configs));
  const [pending, startTransition] = useTransition();

  function updateRow(method: PaymentMethod, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [method]: { ...prev[method], ...patch, dirty: true },
    }));
  }

  function saveRow(method: PaymentMethod) {
    const row = rows[method];
    startTransition(async () => {
      const result = await upsertPaymentMethodConfig(slug, method, {
        adjustment_percent: row.adjustment_percent,
        label: row.label.trim() || null,
        is_active: row.is_active,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRows((prev) => ({
        ...prev,
        [method]: { ...prev[method], dirty: false },
      }));
      toast.success("Guardado");
    });
  }

  return (
    <div className="grid gap-3">
      {METHOD_META.map(({ method, defaultLabel, icon }) => {
        const row = rows[method];
        return (
          <div
            key={method}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1 transition-colors",
              row.is_active
                ? "bg-white ring-zinc-200/70"
                : "bg-zinc-50 ring-zinc-200/50 opacity-60",
            )}
          >
            <button
              type="button"
              onClick={() => updateRow(method, { is_active: !row.is_active })}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                row.is_active
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-zinc-200 text-zinc-400",
              )}
              title={row.is_active ? "Desactivar" : "Activar"}
            >
              {icon}
            </button>

            <div className="min-w-[120px] flex-1">
              <p className="text-sm font-medium text-zinc-900">{defaultLabel}</p>
              <Input
                placeholder="Etiqueta personalizada"
                value={row.label}
                onChange={(e) => updateRow(method, { label: e.target.value })}
                className="mt-1 h-7 text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  value={row.adjustment_percent}
                  onChange={(e) =>
                    updateRow(method, {
                      adjustment_percent: Number(e.target.value) || 0,
                    })
                  }
                  className="h-8 w-20 text-center tabular-nums"
                  min={-100}
                  max={100}
                  step={1}
                />
                <span className="text-sm text-zinc-500">%</span>
              </div>
              {row.dirty && (
                <Button
                  size="sm"
                  onClick={() => saveRow(method)}
                  disabled={pending}
                  className="h-8 px-3 text-xs"
                >
                  Guardar
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-zinc-500">
        Positivo = recargo, negativo = descuento. Ej: -5 para 5% de descuento
        en efectivo. Los métodos desactivados no aparecen al cobrar.
      </p>
    </div>
  );
}

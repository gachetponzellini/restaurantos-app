import * as React from "react";

import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/ui/section-label";

type Tone = "default" | "danger" | "success" | "warning";

const TONE: Record<Tone, { box: string; value: string }> = {
  default: { box: "bg-muted/50 ring-border/70", value: "text-foreground" },
  danger: {
    box: "bg-destructive/5 ring-destructive/25",
    value: "text-destructive",
  },
  success: {
    box: "bg-emerald-500/5 ring-emerald-500/25",
    value: "text-emerald-700 dark:text-emerald-400",
  },
  warning: {
    box: "bg-amber-500/5 ring-amber-500/30",
    value: "text-amber-700 dark:text-amber-400",
  },
};

/**
 * Spec 204 — el recuadro «esperado / a cobrar / saldo» con el monto grande.
 * `value` ya viene formateado (el formato de moneda es del llamador).
 */
export function AmountCard({
  label,
  value,
  hint,
  tone = "default",
  size = "md",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  size?: "md" | "lg";
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="amount-card"
      className={cn("rounded-xl p-4 ring-1", TONE[tone].box, className)}
      {...props}
    >
      <SectionLabel>{label}</SectionLabel>
      <p
        className={cn(
          "mt-1 font-semibold tracking-tight tabular-nums",
          size === "lg" ? "text-3xl" : "text-2xl",
          TONE[tone].value,
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

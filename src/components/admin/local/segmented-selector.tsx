"use client";

import { cn } from "@/lib/utils";

export type SegmentedItem = {
  id: string;
  label: string;
  /**
   * Contador opcional. Si se provee (incluso 0) se muestra un badge; si queda
   * `undefined` no se renderiza. Cada caller decide: Mesas siempre pasa el
   * número (muestra 0), Caja lo omite cuando no hubo cobros.
   */
  count?: number;
};

/**
 * Selector segmentado (pills horizontales) compartido por las subtabs de la
 * pantalla de operación en vivo — Mesas (salones) y Caja (cajas). Una sola
 * fuente de verdad para el estilo; el estado/persistencia vive en cada caller.
 */
export function SegmentedSelector({
  items,
  activeId,
  onSelect,
  ariaLabel,
}: {
  items: SegmentedItem[];
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className="bg-card ring-border/60 -mx-1 overflow-x-auto rounded-2xl px-1 ring-1"
      aria-label={ariaLabel}
    >
      <div className="flex gap-1 p-1.5">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-pressed={isActive}
              className={cn(
                "shrink-0 rounded-xl px-3 py-1.5 text-sm font-semibold transition active:scale-[0.97]",
                isActive
                  ? "bg-primary text-white shadow-sm"
                  : "text-foreground/80 hover:bg-muted",
              )}
            >
              <span>{item.label}</span>
              {item.count != null && (
                <span
                  className={cn(
                    "ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    isActive
                      ? "bg-white/15 text-white"
                      : "bg-border text-foreground/80",
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setPrintingEnabled } from "@/lib/catalog/station-actions";
import { cn } from "@/lib/utils";

/**
 * Interruptor único: apaga TODA la impresión del negocio de un toque (spec
 * 185) — no toca `stations.printer_enabled` ni los demás switches, así que al
 * reactivarlo cada impresora vuelve a su config de siempre. Guarda al toque,
 * sin botón "Guardar" aparte: es un solo control, no un formulario.
 */
export function PrintingToggleForm({
  slug,
  enabled: initialEnabled,
}: {
  slug: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();

  const handleToggle = (next: boolean) => {
    startSave(async () => {
      const r = await setPrintingEnabled(slug, next);
      if (r.ok) {
        toast.success(
          next
            ? "Impresión reactivada."
            : "Impresión desactivada en todo el local.",
        );
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-xl px-4 py-3.5 ring-1",
        initialEnabled ? "ring-zinc-200/60" : "bg-red-50 ring-red-200",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-900">
          {initialEnabled ? "Impresión activa" : "Impresión desactivada"}
        </p>
        <p className="text-xs text-zinc-500">
          {initialEnabled
            ? "Comandas, control, cuentas y facturas salen según la config de cada impresora, abajo."
            : "Nada se imprime en este local: ni comandas de cocina, ni control, ni cuentas, ni facturas. La config de cada impresora sigue guardada."}
        </p>
      </div>

      <label className="flex shrink-0 items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          className="size-5"
          checked={initialEnabled}
          disabled={saving}
          onChange={(e) => handleToggle(e.target.checked)}
          aria-label="Impresión activa en todo el local"
        />
        {saving ? "Guardando…" : initialEnabled ? "Activa" : "Apagada"}
      </label>
    </div>
  );
}

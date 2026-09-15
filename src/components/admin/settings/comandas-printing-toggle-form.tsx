"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setComandasPrintingEnabled } from "@/lib/catalog/station-actions";
import { cn } from "@/lib/utils";

/**
 * Interruptor único: apaga las comandas de cocina de TODOS los sectores de un
 * toque (spec 185) — no toca `stations.printer_enabled` por sector, así que
 * al reactivarlo cada sector vuelve a su config de siempre. No afecta control,
 * cuenta ni factura: esas comanderas se manejan abajo, en sus propias
 * secciones. Guarda al toque, sin botón "Guardar" aparte: es un solo control,
 * no un formulario.
 */
export function ComandasPrintingToggleForm({
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
      const r = await setComandasPrintingEnabled(slug, next);
      if (r.ok) {
        toast.success(
          next
            ? "Comandas de cocina reactivadas."
            : "Comandas de cocina desactivadas en todos los sectores.",
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
          {initialEnabled
            ? "Comandas de cocina activas"
            : "Comandas de cocina desactivadas"}
        </p>
        <p className="text-xs text-zinc-500">
          {initialEnabled
            ? "Cada sector imprime según su propia comandera, abajo. Este switch las apaga a todas juntas."
            : "Ningún sector imprime comanda de cocina, aunque tenga su comandera configurada como activa abajo. Control, cuentas y facturas no se ven afectados."}
        </p>
      </div>

      <label className="flex shrink-0 items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          className="size-5"
          checked={initialEnabled}
          disabled={saving}
          onChange={(e) => handleToggle(e.target.checked)}
          aria-label="Comandas de cocina activas en todos los sectores"
        />
        {saving ? "Guardando…" : initialEnabled ? "Activas" : "Apagadas"}
      </label>
    </div>
  );
}

"use client";

import { CalendarPlus, X } from "lucide-react";

import {
  ReservaForm,
  type TablePickerBridge,
} from "@/components/admin/local/new-reservation-modal";
import { Button } from "@/components/ui/button";
import type { FloorTable } from "@/lib/reservations/types";

/**
 * "Nueva reserva" embebida en el sidebar del salón (spec 059), con el mismo
 * shell que el resto de los paneles (venta rápida / cobro / cargar pedido).
 * La lógica del formulario es la compartida (`ReservaForm`); acá sólo va el
 * chrome del panel y el puente para elegir la mesa **sobre el plano**.
 */
export function NuevaReservaPanel({
  slug,
  tables,
  floorPlanId,
  tablePicker,
  onClose,
}: {
  slug: string;
  tables: FloorTable[];
  floorPlanId: string | null;
  tablePicker: TablePickerBridge;
  onClose: () => void;
}) {
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="border-border/60 flex shrink-0 items-center gap-2.5 border-b px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <CalendarPlus className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Reservas
          </p>
          <h3 className="font-heading text-base font-bold leading-tight text-foreground">
            Nueva reserva
          </h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="rounded-full"
          aria-label="Cerrar nueva reserva"
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      <ReservaForm
        slug={slug}
        tables={tables}
        floorPlanId={floorPlanId}
        onDone={onClose}
        tablePicker={tablePicker}
        footerClassName="border-border/60 shrink-0 border-t bg-card p-3"
      />
    </div>
  );
}

"use client";

import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * La barra de «el plano está esperando un tap» (spec 059, compartida en la 138).
 *
 * Vivía dentro de `salon-desktop`. El plano del día necesita exactamente la
 * misma señal —y tiene que verse igual, porque para el encargado es el mismo
 * gesto—, así que salió a un componente que usan los dos.
 */
export function ElegirMesaBanner({
  texto,
  onCancelar,
}: {
  texto: string;
  onCancelar: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-white shadow-sm">
      <MapPin className="h-4 w-4 shrink-0 animate-pulse" />
      <span className="min-w-0 flex-1 text-sm font-semibold">{texto}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onCancelar}
        className="shrink-0 bg-white/15 text-white hover:bg-white/25 hover:text-white"
      >
        Cancelar
      </Button>
    </div>
  );
}

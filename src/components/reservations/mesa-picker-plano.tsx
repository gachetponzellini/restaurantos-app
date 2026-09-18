"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { MesaFigura } from "@/components/reservations/mesa-figura";
import { Button } from "@/components/ui/button";
import { encuadreDeMesas } from "@/lib/reservations/plano-del-dia";
import type { FloorTable } from "@/lib/reservations/types";
import { cn } from "@/lib/utils";

/**
 * Elegir la mesa de una reserva **tocando el plano**, adentro del formulario
 * (spec 144).
 *
 * En Operación y en el plano del día la mesa ya se toca (specs 059 y 138); acá
 * faltaba, y la lista era un `<select>` de 70 renglones. El plano no puede ser
 * el de la página —el formulario es una hoja modal, y en la tab de Operación no
 * hay plano al lado—, así que viaja adentro del campo.
 *
 * Lo que pinta NO es el `operational_status` (el estado del *ahora*): son las
 * mesas libres que devuelve el motor para el servicio (flexible) o para el slot
 * elegido (estricto, `freeTableIds`).
 */

type EstadoPick = "elegida" | "libre" | "ocupada" | "chica";

const RELLENO: Record<EstadoPick, string> = {
  elegida: "fill-indigo-600 stroke-indigo-700",
  libre: "fill-white stroke-foreground/20",
  ocupada: "fill-blue-50 stroke-blue-300",
  chica: "fill-muted stroke-border",
};

const TEXTO: Record<EstadoPick, string> = {
  elegida: "fill-white",
  libre: "fill-muted-foreground",
  ocupada: "fill-blue-400",
  chica: "fill-muted-foreground/40",
};

const MOTIVO: Record<EstadoPick, string> = {
  elegida: "elegida",
  libre: "libre",
  ocupada: "ocupada",
  chica: "no entran",
};

export function MesaPickerPlano({
  mesas,
  libres,
  partySize,
  elegida,
  onElegir,
  aviso,
}: {
  /** Mesas reservables del salón elegido. */
  mesas: FloorTable[];
  /** Ids que el motor da por libres. */
  libres: string[];
  partySize: number;
  elegida: string | null;
  /** `null` = quitar la mesa (la reserva queda sin mesa). */
  onElegir: (id: string | null) => void;
  /** Qué falta para poder elegir (ej. «Elegí un horario primero»). */
  aviso?: string | null;
}) {
  const libresSet = useMemo(() => new Set(libres), [libres]);

  const estadoDe = (m: FloorTable): EstadoPick => {
    if (m.id === elegida) return "elegida";
    if (libresSet.has(m.id)) return "libre";
    return m.seats < partySize ? "chica" : "ocupada";
  };

  // Recorrido con teclado: sólo las mesas que se pueden elegir, en el orden en
  // que vienen del plano. Un roving tabindex — el formulario entero se teclea
  // (spec 075) y el plano no puede ser el único campo que pida mouse.
  const elegibles = useMemo(
    () => mesas.filter((m) => libresSet.has(m.id) || m.id === elegida),
    [mesas, libresSet, elegida],
  );
  const [foco, setFoco] = useState(0);
  const refs = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    if (foco > elegibles.length - 1) setFoco(0);
  }, [elegibles.length, foco]);

  function moverFoco(delta: number) {
    if (elegibles.length === 0) return;
    const next = Math.min(Math.max(foco + delta, 0), elegibles.length - 1);
    setFoco(next);
    const el = refs.current[next];
    // jsdom no siempre implementa focus() en SVG: el plano tiene que seguir
    // funcionando igual (el foco es una mejora, no la mecánica).
    if (el && typeof el.focus === "function") el.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      moverFoco(1);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      moverFoco(-1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const mesa = elegibles[foco];
      if (!mesa) return;
      e.preventDefault();
      onElegir(mesa.id === elegida ? null : mesa.id);
    }
  }

  if (mesas.length === 0) {
    return (
      <p className="mt-2 rounded-xl bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground/70">
        Este salón todavía no tiene mesas cargadas.
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-muted/50 p-2 ring-1 ring-border">
      {aviso ? (
        <p className="px-1 pb-2 pt-1 text-center text-xs text-muted-foreground">{aviso}</p>
      ) : null}
      <svg
        viewBox={encuadreDeMesas(mesas)}
        className="h-auto w-full"
        // Alto útil: con 27-43 mesas y el sheet a 576px, por debajo de ~460 los
        // números de mesa dejan de leerse.
        style={{ maxHeight: 460 }}
        role="group"
        aria-label="Plano del salón para elegir la mesa"
        onKeyDown={handleKeyDown}
      >
        {mesas.map((mesa) => {
          const estado = estadoDe(mesa);
          const elegible = estado === "libre" || estado === "elegida";
          const indice = elegibles.findIndex((m) => m.id === mesa.id);
          return (
            <MesaFigura
              key={mesa.id}
              mesa={mesa}
              ref={(el: SVGGElement | null) => {
                if (indice >= 0) refs.current[indice] = el;
              }}
              className={cn(
                RELLENO[estado],
                estado === "elegida" ? "stroke-[3]" : "stroke-[1.5]",
                elegible ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                "transition",
              )}
              textClassName={TEXTO[estado]}
              role="button"
              tabIndex={elegible && indice === foco ? 0 : -1}
              aria-label={`Mesa ${mesa.label}, ${mesa.seats} lugares, ${MOTIVO[estado]}`}
              aria-disabled={elegible ? undefined : true}
              onClick={() => {
                if (!elegible) return;
                onElegir(mesa.id === elegida ? null : mesa.id);
              }}
            />
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-0.5 pt-2 text-[11px] text-muted-foreground">
        <Leyenda className="bg-card ring-foreground/20" label="libre" />
        <Leyenda className="bg-blue-50 ring-blue-300" label="ocupada" />
        <Leyenda className="bg-muted ring-border" label="no entran" />
        {elegida ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => onElegir(null)}
          >
            Sin mesa
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Leyenda({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-2.5 rounded ring-1", className)} />
      {label}
    </span>
  );
}

"use client";

import type { FloorTable } from "@/lib/reservations/types";
import { cn } from "@/lib/utils";

/**
 * Una mesa dibujada en el plano (spec 144) — la forma, la rotación y la
 * etiqueta, sin ninguna idea de qué significa el color.
 *
 * La comparten el **plano del día** (spec 137) y el **picker** del formulario
 * de reserva: los dos pintan cosas distintas —uno el estado a una hora, el otro
 * si la mesa se puede elegir— pero el dibujo es el mismo, y dos copias de la
 * misma geometría se separan al primer cambio (spec 138 · D2: se comparte la
 * pieza que de verdad es igual, no el componente).
 */

/** Alto de cada renglón chico bajo la etiqueta, en unidades del plano. */
const LINE_H = 10;

export type MesaDibujable = Pick<
  FloorTable,
  "x" | "y" | "width" | "height" | "rotation" | "shape" | "label"
>;

export function MesaFigura({
  mesa,
  className,
  textClassName,
  lineas,
  lineasClassName,
  children,
  ...props
}: {
  mesa: MesaDibujable;
  /** Clases de la forma (relleno + borde). */
  className?: string;
  /** Clases de la etiqueta. */
  textClassName?: string;
  /**
   * Spec 189 — renglones chicos debajo de la etiqueta (hora, cubiertos, quién).
   * Con el plano como vista de entrada, la mesa tiene que decir de quién es sin
   * que haya que tocarla; el bloque se recentra para que el número de mesa siga
   * cayendo donde el ojo lo busca.
   */
  lineas?: string[];
  lineasClassName?: string;
  children?: React.ReactNode;
} & React.SVGProps<SVGGElement>) {
  const cx = mesa.x + mesa.width / 2;
  const cy = mesa.y + mesa.height / 2;
  const renglones = lineas?.filter(Boolean) ?? [];
  // El bloque entero (etiqueta + renglones) centrado: la etiqueta sube lo que
  // ocupan los renglones de abajo.
  const baseY = cy + 4 - (renglones.length * LINE_H) / 2;

  return (
    <g transform={`rotate(${mesa.rotation} ${cx} ${cy})`} {...props}>
      {mesa.shape === "circle" ? (
        <ellipse
          cx={cx}
          cy={cy}
          rx={mesa.width / 2}
          ry={mesa.height / 2}
          className={className}
        />
      ) : (
        <rect
          x={mesa.x}
          y={mesa.y}
          width={mesa.width}
          height={mesa.height}
          rx={mesa.shape === "square" ? 8 : 10}
          className={className}
        />
      )}
      <text
        x={cx}
        y={baseY}
        textAnchor="middle"
        className={cn(
          "pointer-events-none text-[13px] font-semibold",
          textClassName,
        )}
      >
        {mesa.label}
      </text>
      {renglones.map((linea, i) => (
        <text
          key={i}
          x={cx}
          y={baseY + LINE_H * (i + 1)}
          textAnchor="middle"
          className={cn(
            "pointer-events-none text-[9px] font-medium",
            lineasClassName ?? textClassName,
          )}
        >
          {linea}
        </text>
      ))}
      {children}
    </g>
  );
}

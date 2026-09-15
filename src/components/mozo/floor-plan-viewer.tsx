"use client";

import { useState } from "react";

import { fitNameToTable } from "@/lib/mozo/table-display-name";

import { DELAY_COLORS } from "@/lib/comandas/mesa-demora";
import type {
  FloorPlan,
  FloorTable,
  OperationalStatus,
} from "@/lib/reservations/types";

/**
 * Geometría del globo de demora (spec 193).
 *
 * Vive acá y no adentro de la mesa porque el globo ya no se dibuja con ella:
 * en SVG no hay z-index, y el que vive dentro del `<g>` de su mesa queda tapado
 * por las mesas que se pintan después (y acostado, si la mesa está rotada). Se
 * dibuja en una capa al final del plano, con la posición calculada acá.
 */
function geometriaDelGlobo(
  table: FloorTable,
  lineas: [string, string],
  planWidth: number,
  planHeight: number,
) {
  const labelSize = Math.min(table.width, table.height) * 0.22;
  const font = Math.max(11, Math.max(9, labelSize * 0.62));
  const chars = Math.max(lineas[0].length, lineas[1].length);
  const padX = font * 0.7;
  const w = chars * font * 0.56 + padX * 2 + 6;
  const h = font * 2.6 + 8;
  // El punto vive en la esquina sup-izq; el globo crece hacia el interior y se
  // "flipea" si tocaría el borde del plano (derecha / abajo).
  const dx = table.x + 16 + w > planWidth ? 4 - w : 16;
  const dy = table.y + 16 + h > planHeight ? -h - 2 : 16;
  return { font, padX, w, h, x: table.x + dx, y: table.y + dy };
}

const STATUS_COLORS: Record<
  OperationalStatus,
  { fill: string; stroke: string }
> = {
  libre: { fill: "#f4f4f5", stroke: "#a1a1aa" },
  ocupada: { fill: "#d1fae5", stroke: "#059669" },
  pidio_cuenta: { fill: "#fef3c7", stroke: "#d97706" },
};

export type TableExtra = {
  reservation?: {
    customer_name: string;
    party_size: number;
    starts_at: string; // ISO
  };
  order?: {
    order_number: number;
    daily_number: number;
    total_cents: number;
    delivery_type: string;
  };
  minutesOpen?: number;
  /** Spec 067: nombre del cliente sentado (`tableDisplayName`). Sólo se usa si
   *  el plano tiene `show_customer_name`. `undefined` = walk-in anónimo. */
  customerName?: string;
  /**
   * Cómo se llama el mozo asignado, ya resuelto por `buildMozoShortNames`:
   * «Juan», o «Juan B.» si hay dos Juanes en el equipo. Va escrito DEBAJO de
   * la mesa — antes era un círculo con las iniciales adentro de la mesa, que
   * no se entendía sin mirar la leyenda.
   */
  mozoLabel?: string;
  /** Color determinístico por user_id — tiñe la mesa en modo pintura. */
  mozoColor?: string;
  /** El mismo color, oscuro, para escribir el nombre del mozo. */
  mozoInk?: string;
  /**
   * Demora de cocina (spec 30): la comanda más demorada de la mesa sobre su
   * tiempo esperado. `level 0`/undefined = sin punto. Lo calcula el parent con
   * el `now` del ticker; acá se pinta el punto + el tooltip al hover.
   */
  delay?: {
    /** Nivel 0–4 (escalón cada 10' de exceso). */
    level: number;
    /** Exceso real en minutos (para el "+N min" del tooltip). */
    excessMinutes: number;
    /** Sector de la comanda demorada (cocina, parrilla, …). */
    station: string;
  };
};

type Props = {
  plan: Pick<
    FloorPlan,
    "width" | "height" | "background_image_url" | "background_opacity"
  > &
    // Spec 067: opcional para no romper a los callers que arman un `plan`
    // mínimo a mano (el overlay de distribuir mozos).
    Partial<Pick<FloorPlan, "show_customer_name">>;
  tables: FloorTable[];
  extras?: Record<string, TableExtra>; // keyed by table.id
  onTableClick?: (table: FloorTable) => void;
  /**
   * Tap en el plano PERO fuera de una mesa (el fondo, la imagen, el aire de
   * los márgenes). Sirve para "salir de lo que estoy haciendo" sin ir a
   * buscar la X del panel. Las mesas frenan la propagación, así que tocar una
   * mesa nunca dispara esto.
   */
  onBackgroundClick?: () => void;
  /**
   * Modo "pintura" — cuando está activo, las mesas se tiñen por mozo
   * asignado (en vez de color de estado) y el click llama a `onTableClick`
   * con la intención de asignar (el padre decide qué hacer). Cada mesa
   * mira su `extras[id].mozoColor` para decidir el tinte; sin color =
   * sin asignar = gris.
   */
  paintMode?: boolean;
};

export function FloorPlanViewer({
  plan,
  tables,
  extras = {},
  onTableClick,
  onBackgroundClick,
  paintMode = false,
}: Props) {
  const active = tables.filter((t) => t.status === "active");
  /**
   * Spec 193 — qué mesa está mostrando su globo de demora. El estado vive acá
   * arriba, no en la mesa: el globo se dibuja en una capa posterior a TODAS las
   * mesas, que es la única forma de que no lo tape la de al lado (en SVG manda
   * el orden de pintado, no el z-index).
   */
  const [conGlobo, setConGlobo] = useState<string | null>(null);
  const mesaDelGlobo = active.find((t) => t.id === conGlobo) ?? null;
  const delayDelGlobo = mesaDelGlobo ? extras[mesaDelGlobo.id]?.delay : undefined;

  return (
    // El plano se AJUSTA a la caja que le da el contenedor (ancho y alto), lo
    // más grande posible y centrado, en vez de dimensionarse solo por el ancho.
    // `preserveAspectRatio="xMidYMid meet"` = contain sin deformar → se adapta a
    // cualquier resolución de monitor sin números mágicos (antes: maxHeight 68vh
    // + aspect-ratio, que ignoraba la altura disponible y dejaba el plano chico
    // con márgenes en pantallas anchas).
    <div className="bg-background flex h-full w-full items-center justify-center overflow-hidden">
      <svg
        viewBox={`0 0 ${plan.width} ${plan.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full"
        onClick={onBackgroundClick}
      >
        {plan.background_image_url && (
          <image
            href={plan.background_image_url}
            x={0}
            y={0}
            width={plan.width}
            height={plan.height}
            preserveAspectRatio="xMidYMid slice"
            opacity={plan.background_opacity / 100}
          />
        )}

        {active.map((table) => (
          <ViewerTable
            showCustomerName={plan.show_customer_name ?? false}
            key={table.id}
            table={table}
            extra={extras[table.id]}
            paintMode={paintMode}
            onClick={() => onTableClick?.(table)}
            onDelayHover={(hovering) =>
              setConGlobo((prev) =>
                hovering ? table.id : prev === table.id ? null : prev,
              )
            }
          />
        ))}

        {/* La capa del globo: última, así queda arriba de todas las mesas. */}
        {!paintMode && mesaDelGlobo && delayDelGlobo && delayDelGlobo.level >= 1 && (
          <GloboDeDemora
            table={mesaDelGlobo}
            delay={delayDelGlobo}
            planWidth={plan.width}
            planHeight={plan.height}
          />
        )}
      </svg>
    </div>
  );
}

/**
 * El globo de demora de una mesa (spec 30), dibujado por el plano y no por la
 * mesa (spec 193).
 *
 * Adentro del `<g>` de su mesa quedaba tapado por cualquier mesa pintada
 * después —en SVG no hay z-index, manda el orden del documento— y, si la mesa
 * estaba rotada, salía acostado. Acá arriba no le pasa ninguna de las dos.
 */
function GloboDeDemora({
  table,
  delay,
  planWidth,
  planHeight,
}: {
  table: FloorTable;
  delay: NonNullable<TableExtra["delay"]>;
  planWidth: number;
  planHeight: number;
}) {
  const color = DELAY_COLORS[delay.level];
  const lineas: [string, string] = [
    delay.station ?? "",
    `+${Math.round(delay.excessMinutes)} min de demora`,
  ];
  const g = geometriaDelGlobo(table, lineas, planWidth, planHeight);

  return (
    <g transform={`translate(${g.x} ${g.y})`} style={{ pointerEvents: "none" }}>
      <rect
        x={0}
        y={0}
        width={g.w}
        height={g.h}
        rx={g.font * 0.4}
        fill="#18181b"
        opacity={0.96}
        style={{ filter: "drop-shadow(0 2px 6px rgb(0 0 0 / 0.35))" }}
      />
      <rect x={0} y={0} width={4} height={g.h} rx={2} fill={color} />
      <text
        x={g.padX}
        y={g.font * 1.25}
        fontSize={g.font}
        fontWeight={700}
        fill="#ffffff"
        style={{ userSelect: "none", fontFamily: "inherit" }}
      >
        {lineas[0]}
      </text>
      <text
        x={g.padX}
        y={g.font * 2.25}
        fontSize={g.font * 0.85}
        fill="#e4e4e7"
        style={{ userSelect: "none", fontFamily: "inherit" }}
      >
        {lineas[1]}
      </text>
    </g>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Tiempo abierto, compacto para el label del plano: "45m", "1h30", "3h", "2d".
 * Antes mostrábamos siempre minutos ("95m"), poco legible pasada la hora.
 */
function formatOpenCompact(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) {
    const m = minutes % 60;
    return m === 0 ? `${h}h` : `${h}h${m}`;
  }
  return `${Math.floor(h / 24)}d`;
}

function ViewerTable({
  table,
  extra,
  paintMode,
  showCustomerName,
  onClick,
  onDelayHover,
}: {
  table: FloorTable;
  extra?: TableExtra;
  paintMode: boolean;
  /** Spec 067: este plano rotula las mesas ocupadas con el nombre del cliente. */
  showCustomerName: boolean;
  onClick: () => void;
  /** Spec 193 — el globo lo dibuja el plano, arriba de todas las mesas. */
  onDelayHover?: (hovering: boolean) => void;
}) {
  const cx = table.width / 2;
  const cy = table.height / 2;
  // El translate y el rotate van separados a propósito: el nombre del mozo va
  // en el grupo trasladado pero NO en el rotado, así una mesa girada no lo
  // deja acostado de lado.
  const place = `translate(${table.x} ${table.y})`;
  const spin = `rotate(${table.rotation} ${cx} ${cy})`;
  const opStatus = table.operational_status ?? "libre";

  // En paint mode: ganan los colores del mozo asignado sobre el estado.
  // Sin mozo → gris zinc (señal de "sin asignar" en este modo).
  const statusColors = STATUS_COLORS[opStatus];
  const fill = paintMode
    ? extra?.mozoColor
      ? `${extra.mozoColor}40` // alpha ~25% para que el label se lea
      : "#f4f4f5"
    : statusColors.fill;
  const stroke = paintMode
    ? (extra?.mozoColor ?? "#a1a1aa")
    : statusColors.stroke;
  const strokeWidth = paintMode ? 3 : 2.5;

  const labelSize = Math.min(table.width, table.height) * 0.22;
  const subSize = Math.max(9, labelSize * 0.62);
  // El nombre del mozo se cuelga del tamaño del rótulo de la mesa: es dato
  // secundario, así que va un escalón abajo del número —nunca más grande— pero
  // con un piso, porque en las mesas chicas del plano real (45pt) el
  // proporcional solo quedaba ilegible.
  const mozoNameSize = Math.max(9, Math.min(labelSize * 0.75, 13));

  // Qué mostrar debajo del label
  const hasReservation = !!extra?.reservation;
  // Radio del badge de reserva, escalado para que se lea también en mesas chicas.
  const reservationBadgeR = Math.max(
    6,
    Math.min(9, Math.min(table.width, table.height) * 0.11),
  );
  const minutesOpen = extra?.minutesOpen;

  // Punto de demora de cocina (spec 30). En paint mode no va: el encargado
  // está distribuyendo mozos, no mirando demoras.
  const delay = paintMode ? undefined : extra?.delay;
  const delayColor =
    delay && delay.level >= 1 ? DELAY_COLORS[delay.level] : null;

  // ── Qué dice la mesa (spec 067) ──
  // Con `show_customer_name` y una mesa OCUPADA de la que se conoce el nombre,
  // la mesa muestra SOLO el nombre: ni número ni tiempo abierto (decisión de
  // Juan). Si no hay nombre —walk-in anónimo, que es el default de openTable—
  // cae al rótulo de siempre: la opción cambia qué se muestra, nunca deja una
  // mesa sin etiqueta. En paint mode manda el modo pintura.
  const nameLabel =
    !paintMode &&
    showCustomerName &&
    opStatus !== "libre" &&
    extra?.customerName
      ? fitNameToTable(extra.customerName, table.width / (labelSize * 0.58))
      : null;

  // Línea secundaria bajo el label (oculta en paint mode para no saturar).
  let subLine: string | null = null;
  if (!paintMode && !nameLabel) {
    if (hasReservation && opStatus === "libre") {
      subLine = `${extra!.reservation!.starts_at ? formatTime(extra!.reservation!.starts_at) : ""} · ${extra!.reservation!.party_size}p`;
    } else if (minutesOpen != null && minutesOpen >= 0) {
      subLine = formatOpenCompact(minutesOpen);
    }
  }

  // ── Los renglones de adentro de la mesa ──
  // Hasta tres, centrados en el medio del dibujo: el rótulo (número o nombre
  // del cliente), la sub-línea (hora de la reserva / hace cuánto está abierta)
  // y el nombre del mozo. El del mozo colgaba DEBAJO de la mesa y en un plano
  // apretado se leía mal —quedaba pegado a la mesa de abajo—, así que entró
  // adentro como un renglón más (Juan, 2026-09-14).
  const labelFontSize = nameLabel ? labelSize * 0.86 : labelSize;
  // Recortado al ancho de la mesa, igual que el nombre del cliente: en las
  // mesas de 35 pt del Jardín de KCC "Antonella" no entra ni cerca.
  const mozoLabel = extra?.mozoLabel
    ? fitNameToTable(extra.mozoLabel, table.width / (mozoNameSize * 0.58))
    : null;

  const LINE_GAP = 2;
  const lineSizes = [
    labelFontSize,
    ...(subLine ? [subSize] : []),
    ...(mozoLabel ? [mozoNameSize] : []),
  ];
  const stackHeight =
    lineSizes.reduce((a, b) => a + b, 0) + LINE_GAP * (lineSizes.length - 1);
  // El bloque arranca arriba del centro y cada texto se apoya a ~0.85 de su
  // caja, que es más o menos donde cae la base de una mayúscula.
  let lineTop = cy - stackHeight / 2;
  const baselines = lineSizes.map((size) => {
    const y = lineTop + size * 0.85;
    lineTop += size + LINE_GAP;
    return y;
  });
  const labelY = baselines[0];
  const subLineY = subLine ? baselines[1] : 0;
  const mozoY = mozoLabel ? baselines[subLine ? 2 : 1] : 0;

  return (
    <g
      transform={place}
      // El tap de una mesa no es un tap "al plano": si burbujeara, abrir una
      // mesa y cerrar el panel serían el mismo gesto.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ cursor: "pointer" }}
    >
      <g transform={spin}>
        {/* Mesa */}
        {table.shape === "circle" ? (
          <ellipse
            cx={cx}
            cy={cy}
            rx={table.width / 2}
            ry={table.height / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            style={{ filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.1))" }}
          />
        ) : (
          <rect
            x={0}
            y={0}
            width={table.width}
            height={table.height}
            rx={table.shape === "rect" ? 10 : 6}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            style={{ filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.1))" }}
          />
        )}

        {/* Label central */}
        <text
          x={cx}
          y={labelY}
          textAnchor="middle"
          fontSize={labelFontSize}
          fontWeight="700"
          fill="#18181b"
          style={{
            userSelect: "none",
            pointerEvents: "none",
            fontFamily: "inherit",
          }}
        >
          {nameLabel ?? table.label}
        </text>

        {/* Sub-línea: hora de reserva o tiempo abierta */}
        {subLine && (
          <text
            x={cx}
            y={subLineY}
            textAnchor="middle"
            fontSize={subSize}
            fontWeight="500"
            fill="#52525b"
            style={{
              userSelect: "none",
              pointerEvents: "none",
              fontFamily: "inherit",
            }}
          >
            {subLine}
          </text>
        )}

        {/* Badge reserva (esquina superior derecha). Antes sólo se dibujaba en
          mesas grandes, así que en las chicas la reserva pasaba desapercibida:
          ahora va siempre, escalado al tamaño de la mesa. */}
        {hasReservation && (
          <>
            <circle
              cx={table.width - reservationBadgeR - 2}
              cy={reservationBadgeR + 2}
              r={reservationBadgeR}
              fill="#6366f1"
              stroke="white"
              strokeWidth={1.5}
            />
            <text
              x={table.width - reservationBadgeR - 2}
              y={reservationBadgeR + 2 + reservationBadgeR * 0.5}
              textAnchor="middle"
              fontSize={reservationBadgeR * 1.1}
              fontWeight="700"
              fill="white"
              style={{ userSelect: "none", pointerEvents: "none" }}
            >
              R
            </text>
          </>
        )}

        {/* Punto de demora de cocina (esquina sup-izq). El color encodea cuánto
          se PASÓ del tiempo esperado; no toca el fill. El globo lo dibuja el
          plano en su capa de arriba (spec 193): acá adentro lo tapaba la mesa
          siguiente. */}
        {delayColor && delay && (
          <circle
            cx={10}
            cy={10}
            r={7.5}
            fill={delayColor}
            stroke="white"
            strokeWidth={1.5}
            onMouseEnter={() => onDelayHover?.(true)}
            onMouseLeave={() => onDelayHover?.(false)}
            style={{ cursor: "pointer" }}
          />
        )}
      </g>

      {/* Nombre del mozo: ADENTRO de la mesa, como último renglón, pero
          derecho —fuera del grupo que rota—. Reemplazó al círculo con
          iniciales ("JB" no dice nada sin ir a buscar la leyenda) y antes
          colgaba debajo del dibujo, donde en un plano lleno se confundía con
          la mesa de abajo. El halo blanco queda, finito: en modo pintura el
          relleno es translúcido y atrás puede haber foto del salón. */}
      {mozoLabel && (
        <text
          x={cx}
          y={mozoY}
          textAnchor="middle"
          fontSize={mozoNameSize}
          fontWeight="700"
          fill={extra?.mozoInk ?? "#3f3f46"}
          stroke="#ffffff"
          strokeWidth={mozoNameSize * 0.18}
          strokeLinejoin="round"
          style={{
            paintOrder: "stroke",
            userSelect: "none",
            pointerEvents: "none",
            fontFamily: "inherit",
          }}
        >
          {mozoLabel}
        </text>
      )}
    </g>
  );
}

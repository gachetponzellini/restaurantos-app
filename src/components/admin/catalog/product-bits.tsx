"use client";

import Image from "next/image";

import type { AdminProduct } from "@/lib/admin/catalog-query";
import { cn } from "@/lib/utils";

/** Iniciales para cuando no hay foto: «Bife de chorizo» → «BD». */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * Miniatura de una entidad del catálogo: la foto si hay, si no las iniciales
 * sobre un tono estable derivado de `seed` (la categoría), así los productos
 * de una misma categoría se reconocen de un vistazo.
 */
export function Thumb({
  src,
  label,
  seed,
  size = 34,
  className,
}: {
  src?: string | null;
  label: string;
  seed: string;
  size?: number;
  className?: string;
}) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg text-xs font-semibold",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `hsl(${h} 45% 92%)`,
        color: `hsl(${h} 35% 35%)`,
      }}
    >
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes={`${size}px`}
          className="object-cover"
        />
      ) : (
        initials(label)
      )}
    </span>
  );
}

export function ProductThumb({
  product,
  size,
}: {
  product: AdminProduct;
  size?: number;
}) {
  return (
    <Thumb
      src={product.image_url}
      label={product.name}
      seed={product.category_id ?? "sin"}
      size={size}
    />
  );
}

const PILL = {
  warn: "bg-amber-50 text-amber-800",
  off: "bg-zinc-100 text-zinc-600",
  bad: "bg-rose-50 text-rose-700",
  ok: "bg-emerald-50 text-emerald-700",
  info: "bg-sky-50 text-sky-700",
} as const;

export function Pill({
  tone,
  children,
}: {
  tone: keyof typeof PILL;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-px text-[10.5px] font-semibold tracking-[0.02em] whitespace-nowrap",
        PILL[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Estado del producto en pills (spec 205 · D1). */
export function ProductPills({
  product,
  losesMoney = false,
  withModifiers = false,
}: {
  product: AdminProduct;
  losesMoney?: boolean;
  withModifiers?: boolean;
}) {
  const n = product.modifier_groups.length;
  return (
    <>
      {!product.is_active ? (
        <Pill tone="off">De baja</Pill>
      ) : (
        <>
          {!product.is_available && <Pill tone="warn">Agotado</Pill>}
          {!product.show_online && (
            <Pill tone="off">Fuera de la carta online</Pill>
          )}
        </>
      )}
      {losesMoney && <Pill tone="bad">Pierde plata</Pill>}
      {withModifiers && n > 0 && (
        <Pill tone="off">
          {n} {n === 1 ? "grupo" : "grupos"} de adicionales
        </Pill>
      )}
    </>
  );
}

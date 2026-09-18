"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Search, X } from "lucide-react";

import { useSlashToFocus } from "@/lib/ui/use-slash-to-focus";
import { cn } from "@/lib/utils";

/**
 * Barra de herramientas de las tabs del catálogo (spec 205 · D2): buscador +
 * filtros, pegajosa arriba de la tabla. Publica su alto en
 * `--catalog-sticky-top` para que los headers de grupo de `CatalogTable` se
 * peguen justo debajo y no detrás.
 */
export function CatalogToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      host.style.setProperty("--catalog-sticky-top", `${el.offsetHeight}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={cn(
        "bg-background sticky top-0 z-[2] flex flex-wrap items-center gap-2.5 pb-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Buscador de la tab. `/` lo enfoca desde cualquier lado; Esc lo limpia; ↓ baja
 * a la primera fila de la tabla.
 */
export function CatalogSearch({
  value,
  onChange,
  placeholder,
  onArrowDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onArrowDown?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useSlashToFocus(ref);
  return (
    <div className="relative min-w-0 flex-[1_1_240px]">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          } else if (e.key === "ArrowDown" && onArrowDown) {
            e.preventDefault();
            onArrowDown();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="peer h-[38px] w-full rounded-xl border border-zinc-200 bg-white pr-9 pl-9 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          aria-label="Limpiar búsqueda"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:text-zinc-900"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-[5px] border border-b-2 border-zinc-200 bg-white px-1.5 font-mono text-[11px] text-zinc-500 peer-focus:hidden max-md:hidden"
        >
          /
        </kbd>
      )}
    </div>
  );
}

export type SegmentedOption<V extends string> = {
  value: V;
  label: string;
  count?: number;
  /** El conteo en rojo si es > 0 (ej. «Bajo mínimo»). */
  alert?: boolean;
};

/** Control segmentado con conteos (estado de la lista, sub-tabs de stock). */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
}: {
  value: V;
  onChange: (v: V) => void;
  options: SegmentedOption<V>[];
  "aria-label": string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-zinc-100 p-[3px] [scrollbar-width:none]"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-[5px] text-sm font-medium whitespace-nowrap transition-colors",
              on
                ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]"
                : "text-zinc-500 hover:text-zinc-900",
            )}
          >
            {o.label}
            {o.count != null && (
              <span
                className={cn(
                  "text-[11px] tabular-nums max-sm:hidden",
                  o.alert && o.count > 0
                    ? "font-semibold text-rose-700"
                    : "text-zinc-400",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

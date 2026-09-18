"use client";

import Link from "next/link";
import {
  useId,
  useImperativeHandle,
  useMemo,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { ChevronRight } from "lucide-react";

import { useRovingList } from "@/lib/ui/use-roving-list";
import { cn } from "@/lib/utils";

/**
 * Tabla densa del catálogo (spec 205 · D1/D2). Es la lista de todas las tabs:
 * productos, categorías, insumos, costeo, stock. Filas de ~52px (antes eran
 * tarjetas de ~115px con nombre y precio: entraban 4 por pantalla).
 *
 * - Agrupa por lo que diga `group` (categoría, supercategoría…) con un header
 *   pegajoso. Las filas tienen que venir ya ordenadas por grupo.
 * - Teclado con foco real (`useRovingList`): ↑↓ recorre cruzando grupos,
 *   Home/End, Enter abre.
 * - Click en la fila abre; un control adentro (un switch, un botón) no.
 * - Con `href`, la primera columna es un link de verdad: el click normal abre el
 *   editor, cmd/ctrl-click o «abrir en otra pestaña» van a la página.
 * - En teléfono se esconden las columnas `hideOnMobile`.
 */

export type CatalogColumn<T> = {
  key: string;
  header: ReactNode;
  /** Ancho en la grilla: `"minmax(0,1fr)"`, `"96px"`… */
  width: string;
  align?: "start" | "end";
  hideOnMobile?: boolean;
  cell: (row: T, index: number) => ReactNode;
};

export type CatalogGroup = {
  key: string;
  label: ReactNode;
  /** Texto accesible del grupo si `label` no es texto plano. */
  name?: string;
  /** A la derecha del header. Default: la cantidad de filas del grupo. */
  meta?: ReactNode;
  /** Header clickeable (ej. abre la supercategoría). */
  onClick?: () => void;
};

export type CatalogTableHandle = {
  focusFirst: () => void;
  focusIndex: (i: number) => void;
};

type Props<T> = {
  rows: readonly T[];
  columns: CatalogColumn<T>[];
  getKey: (row: T) => string;
  /** Nombre accesible de la fila (lo que lee el lector de pantalla). */
  rowLabel: (row: T) => string;
  onOpen: (row: T, index: number) => void;
  group?: (row: T) => CatalogGroup;
  href?: (row: T) => string;
  dimmed?: (row: T) => boolean;
  empty: ReactNode;
  /** Chevron al final de la fila (default: `true`). */
  chevron?: boolean;
  "aria-label": string;
  ref?: Ref<CatalogTableHandle>;
  className?: string;
};

type Section<T> = { group: CatalogGroup | null; items: { row: T; index: number }[] };

/** Ignora el click si viene de un control dentro de la fila. */
function fromControl(target: EventTarget | null, row: HTMLElement) {
  const el = (target as HTMLElement | null)?.closest(
    'a,button,input,select,textarea,label,[role="switch"],[role="checkbox"]',
  );
  return !!el && el !== row && row.contains(el);
}

export function CatalogTable<T>({
  rows,
  columns,
  getKey,
  rowLabel,
  onOpen,
  group,
  href,
  dimmed,
  empty,
  chevron = true,
  ref,
  className,
  ...aria
}: Props<T>) {
  const roving = useRovingList<HTMLDivElement>({ length: rows.length });
  const idBase = useId();

  useImperativeHandle(
    ref,
    () => ({ focusFirst: roving.focusFirst, focusIndex: roving.focusIndex }),
    [roving.focusFirst, roving.focusIndex],
  );

  const gridVars = useMemo(() => {
    const all = [...columns.map((c) => c.width), ...(chevron ? ["16px"] : [])];
    const mobile: string[] = columns
      .filter((c) => !c.hideOnMobile)
      .map((_, i) => (i === 0 ? "minmax(0,1fr)" : "auto"));
    if (chevron) mobile.push("16px");
    return {
      "--cols": all.join(" "),
      "--mcols": mobile.join(" "),
    } as CSSProperties;
  }, [columns, chevron]);

  const sections = useMemo(() => {
    const out: Section<T>[] = [];
    rows.forEach((row, index) => {
      const g = group ? group(row) : null;
      const last = out[out.length - 1];
      if (last && (last.group?.key ?? null) === (g?.key ?? null)) {
        last.items.push({ row, index });
      } else {
        out.push({ group: g, items: [{ row, index }] });
      }
    });
    return out;
  }, [rows, group]);

  const gridCls =
    "grid items-center gap-3 px-3.5 [grid-template-columns:var(--mcols)] md:[grid-template-columns:var(--cols)]";

  return (
    <div
      role="grid"
      aria-label={aria["aria-label"]}
      style={gridVars}
      onKeyDown={(e) => {
        if (roving.handleKeyDown(e)) return;
        if (e.key !== "Enter") return;
        const rowEl = e.target as HTMLElement;
        const i = rowEl.dataset.rowIndex;
        if (i == null) return;
        e.preventDefault();
        onOpen(rows[Number(i)], Number(i));
      }}
      className={cn(
        "bg-card overflow-clip rounded-2xl border border-zinc-200/80",
        className,
      )}
    >
      {rows.length === 0 ? (
        <div className="text-muted-foreground px-6 py-10 text-center text-sm">
          {empty}
        </div>
      ) : (
        <>
          <div
            role="row"
            className={cn(
              gridCls,
              "h-[34px] border-b border-zinc-200/80 text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase max-md:hidden",
            )}
          >
            {columns.map((c) => (
              <div
                key={c.key}
                role="columnheader"
                className={cn(c.align === "end" && "justify-self-end text-right")}
              >
                {c.header}
              </div>
            ))}
            {chevron && <div aria-hidden />}
          </div>

          {sections.map((s, si) => {
            const headerId = `${idBase}-g${si}`;
            return (
              <div
                key={s.group?.key ?? `__${si}`}
                role="rowgroup"
                aria-labelledby={s.group ? headerId : undefined}
              >
                {s.group && (
                  <GroupHeader
                    id={headerId}
                    group={s.group}
                    count={s.items.length}
                  />
                )}
                {s.items.map(({ row, index }) => (
                  <div
                    key={getKey(row)}
                    role="row"
                    aria-label={rowLabel(row)}
                    data-row-index={index}
                    {...roving.itemProps(index)}
                    onClick={(e) => {
                      if (fromControl(e.target, e.currentTarget)) return;
                      onOpen(row, index);
                    }}
                    className={cn(
                      gridCls,
                      "min-h-[52px] cursor-pointer border-b border-zinc-100 py-2 outline-none last:border-b-0",
                      "transition-colors hover:bg-zinc-50",
                      "focus-visible:bg-brand-soft focus-visible:shadow-[inset_3px_0_0_var(--brand)]",
                      dimmed?.(row) && "opacity-55",
                    )}
                  >
                    {columns.map((c, ci) => (
                      <div
                        key={c.key}
                        role="gridcell"
                        className={cn(
                          "min-w-0",
                          c.align === "end" && "justify-self-end text-right",
                          c.hideOnMobile && "max-md:hidden",
                        )}
                      >
                        {ci === 0 && href ? (
                          <Link
                            href={href(row)}
                            tabIndex={-1}
                            onClick={(e) => {
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                                return;
                              e.preventDefault();
                              onOpen(row, index);
                            }}
                            className="block min-w-0 text-inherit no-underline"
                          >
                            {c.cell(row, index)}
                          </Link>
                        ) : (
                          c.cell(row, index)
                        )}
                      </div>
                    ))}
                    {chevron && (
                      <ChevronRight
                        aria-hidden
                        className="size-4 justify-self-end text-zinc-300"
                      />
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function GroupHeader({
  id,
  group,
  count,
}: {
  id: string;
  group: CatalogGroup;
  count: number;
}) {
  const inner = (
    <>
      <span id={id} className="flex min-w-0 items-center gap-2 truncate">
        {group.name ? (
          <>
            <span className="sr-only">{group.name}</span>
            <span aria-hidden className="flex min-w-0 items-center gap-2">
              {group.label}
            </span>
          </>
        ) : (
          group.label
        )}
      </span>
      <span className="shrink-0 text-xs font-medium text-zinc-500 tabular-nums">
        {group.meta ?? count}
      </span>
    </>
  );
  const cls =
    "sticky top-[var(--catalog-sticky-top,0px)] z-[1] flex w-full items-center justify-between gap-3 border-b border-zinc-200/80 bg-zinc-100/95 px-3.5 py-1.5 text-left text-[12.5px] font-semibold text-zinc-800 backdrop-blur-sm";
  return group.onClick ? (
    <button type="button" onClick={group.onClick} className={cn(cls, "hover:bg-zinc-200/70")}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}


"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Thumb } from "@/components/admin/catalog/product-bits";
import {
  CatalogTable,
  type CatalogColumn,
  type CatalogTableHandle,
} from "@/components/admin/catalog/ui/catalog-table";
import {
  CatalogSearch,
  CatalogToolbar,
} from "@/components/admin/catalog/ui/catalog-toolbar";
import { CatalogHeaderAction } from "@/components/admin/catalog/ui/header-action";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import { useCatalogEditor } from "@/components/admin/catalog/ui/editor-host";
import { DAY_OPTIONS } from "@/components/admin/daily-menus/daily-menu-fields";
import {
  MenuPills,
  isOnTodaysCarta,
} from "@/components/admin/daily-menus/daily-menu-bits";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";
import { toggleDailyMenuAvailability } from "@/lib/daily-menus/daily-menu-actions";
import { dayOfWeekName } from "@/lib/day-of-week";
import { formatCurrency } from "@/lib/currency";
import { useOptimisticAction } from "@/lib/ui/use-optimistic-action";
import { cn } from "@/lib/utils";

/**
 * Tab Menú del día (spec 205 · D8): banda «Hoy · <día>» con lo que el cliente
 * ve ahora, `CatalogTable` densa y el mismo editor en modal que el resto del
 * catálogo (D6).
 */
export function DailyMenuTab() {
  const { slug, menus, todayDow } = useCatalogData();
  const editor = useCatalogEditor();
  const tableRef = useRef<CatalogTableHandle>(null);
  const [search, setSearch] = useState("");

  const avail = useOptimisticAction(
    menus,
    (state: AdminDailyMenu[], a: { id: string; on: boolean }) =>
      state.map((m) => (m.id === a.id ? { ...m, is_available: a.on } : m)),
  );
  const list = avail.state;

  const hoy = list.filter((m) => isOnTodaysCarta(m, todayDow));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [list, search]);

  const ids = filtered.map((m) => m.id);
  const open = (m: AdminDailyMenu) =>
    editor.open({ kind: "menu", id: m.id }, ids);

  const columns: CatalogColumn<AdminDailyMenu>[] = [
    {
      key: "menu",
      header: "Menú",
      width: "minmax(0,1fr)",
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Thumb src={m.image_url} label={m.name} seed={m.id} />
          <div className="min-w-0">
            <span className="block truncate font-semibold text-zinc-900">
              {m.name}
            </span>
            {m.components.length > 0 && (
              <span className="block truncate text-xs text-zinc-500">
                {m.components.map((c) => c.label || "—").join(" · ")}
              </span>
            )}
            <span className="mt-0.5 flex flex-wrap gap-1 empty:hidden">
              <MenuPills menu={m} todayDow={todayDow} />
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "dias",
      header: "Días",
      width: "170px",
      hideOnMobile: true,
      cell: (m) => {
        const days = new Set(m.available_days);
        return (
          <div
            className="flex gap-1"
            aria-label={`Disponible ${m.available_days.length} días`}
          >
            {DAY_OPTIONS.map((d) => (
              <span
                key={d.dow}
                title={d.label}
                className={cn(
                  "flex size-5 items-center justify-center rounded text-[10.5px] font-semibold",
                  days.has(d.dow)
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-400",
                )}
              >
                {d.label[0]}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: "precio",
      header: "Precio",
      width: "90px",
      align: "end",
      cell: (m) => (
        <span className="font-semibold text-zinc-900 tabular-nums">
          {formatCurrency(m.price_cents)}
        </span>
      ),
    },
    {
      key: "disp",
      header: "Disponible",
      width: "90px",
      align: "end",
      cell: (m) => (
        <Switch
          aria-label={`Disponible: ${m.name}`}
          checked={m.is_available}
          disabled={!m.is_active}
          onCheckedChange={(on) =>
            avail.run({ id: m.id, on }, () =>
              toggleDailyMenuAvailability(slug, m.id, on),
            )
          }
        />
      ),
    },
  ];

  return (
    <>
      <CatalogHeaderAction>
        <Button
          type="button"
          size="xl"
          className="bg-brand text-brand-foreground hover:bg-brand-hover"
          onClick={() => editor.create("menu")}
        >
          <Plus /> Nuevo menú
        </Button>
      </CatalogHeaderAction>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200/70">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-600" />
          </span>
          <div className="min-w-0">
            <p className="text-[0.65rem] font-semibold tracking-[0.12em] text-amber-800/70 uppercase">
              Hoy · {dayOfWeekName(todayDow)}
            </p>
            <p className="truncate text-sm font-semibold text-amber-950">
              {hoy.length === 0
                ? "Ningún menú en la carta hoy"
                : hoy
                    .map((m) => `${m.name} · ${formatCurrency(m.price_cents)}`)
                    .join("  ·  ")}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-xs text-amber-900/70 max-sm:hidden">
          Es lo que ve el cliente arriba de la carta.
        </span>
      </div>

      <CatalogToolbar>
        <CatalogSearch
          value={search}
          onChange={setSearch}
          placeholder="Buscar menú…"
          onArrowDown={() => tableRef.current?.focusFirst()}
        />
      </CatalogToolbar>

      <div className="flex justify-between gap-3 px-0.5 pb-2 text-xs text-zinc-500">
        <span className="tabular-nums">
          {filtered.length} de {list.length} menús
        </span>
      </div>

      <CatalogTable<AdminDailyMenu>
        ref={tableRef}
        aria-label="Menús del día"
        rows={filtered}
        columns={columns}
        getKey={(m) => m.id}
        rowLabel={(m) => m.name}
        dimmed={(m) => !m.is_active}
        onOpen={open}
        empty={
          list.length === 0 ? (
            "Todavía no hay menús del día. Creá el primero."
          ) : (
            <>
              Sin resultados para «{search}».{" "}
              <button
                type="button"
                onClick={() => setSearch("")}
                className="font-medium text-zinc-900 underline underline-offset-4"
              >
                Limpiar búsqueda
              </button>
            </>
          )
        }
      />
    </>
  );
}

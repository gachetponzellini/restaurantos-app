"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Search,
  Settings,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatInvoiceNumber,
  INVOICE_STATUS_META,
  isDemorada,
  tipoLabel,
} from "@/lib/afip/format";
import type { InvoiceKPIs } from "@/lib/afip/queries";
import type { Invoice, InvoiceStatus, TipoComprobante } from "@/lib/afip/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

import { InvoiceDetailSheet } from "./invoice-detail-sheet";
import { InvoiceKpiStrip } from "./invoice-kpi-strip";
import { PedidoFlashDialog } from "./pedido-flash-dialog";
import { TZ_AR } from "@/lib/timezone";

type RangeKey = "today" | "7d" | "30d" | "all";

type Props = {
  slug: string;
  invoices: Invoice[];
  count: number;
  page: number;
  totalPages: number;
  kpis: InvoiceKPIs;
  afipConfigured: boolean;
  currentFilters: {
    range: RangeKey;
    status: InvoiceStatus | "";
    tipo: TipoComprobante | "";
    q: string;
    page: number;
  };
};

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "Todos" },
];

export function FacturacionClient({
  slug,
  invoices,
  count,
  page,
  totalPages,
  kpis,
  afipConfigured,
  currentFilters,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === "all" || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      if (key !== "page") params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const openDetail = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setSheetOpen(true);
  };

  const handleRefresh = () => {
    router.refresh();
    setSheetOpen(false);
  };

  if (!afipConfigured) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-amber-50 p-8 text-center ring-1 ring-amber-200/60">
        <AlertTriangle className="size-8 text-amber-500" />
        <div>
          <p className="text-lg font-semibold text-zinc-900">
            AFIP no configurado
          </p>
          <p className="mt-1 text-sm text-zinc-600">
            Para emitir comprobantes electrónicos, primero configurá CUIT y
            punto de venta.
          </p>
        </div>
        <Link href={`/${slug}/admin/configuracion`}>
          <Button variant="outline" size="sm">
            <Settings className="size-3.5" />
            Ir a Configuración
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* spec 150 — a quién se le factura. Vive en Facturación y no en la
            ficha del cliente: el receptor de una factura y el comensal son
            cosas distintas (7 de 410 coinciden). */}
        <Link href={`/${slug}/admin/facturacion/entidades`}>
          <Button variant="outline" size="sm">
            <Building2 className="size-3.5" />
            Entidades fiscales
          </Button>
        </Link>
        <PedidoFlashDialog slug={slug} />
      </div>

      <InvoiceKpiStrip
        kpis={kpis}
        onFilterFailed={() => updateFilter("status", "failed")}
      />

      {/* ── Filtros ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Buscar por número, CUIT…"
            defaultValue={currentFilters.q}
            className="pl-8"
            onChange={(e) => {
              const value = e.target.value;
              if (value.length === 0 || value.length >= 2) {
                updateFilter("q", value);
              }
            }}
          />
        </div>

        <Select
          value={currentFilters.status || "all"}
          onValueChange={(v) => updateFilter("status", v === "all" ? "" : (v ?? ""))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="authorized">Autorizados</SelectItem>
            <SelectItem value="failed">Fallidos</SelectItem>
            <SelectItem value="pending">Pendientes</SelectItem>
            <SelectItem value="cancelled">Anulados</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={currentFilters.tipo || "all"}
          onValueChange={(v) => updateFilter("tipo", v === "all" ? "" : (v ?? ""))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="factura_b">Factura B</SelectItem>
            <SelectItem value="factura_a">Factura A</SelectItem>
            <SelectItem value="nota_credito_b">NC B</SelectItem>
            <SelectItem value="nota_credito_a">NC A</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex rounded-lg ring-1 ring-zinc-200/70">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => updateFilter("range", opt.key)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition",
                "first:rounded-l-lg last:rounded-r-lg",
                currentFilters.range === opt.key
                  ? "bg-zinc-900 text-white"
                  : "bg-white text-zinc-600 hover:bg-zinc-50",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Lista ──────────────────────────────────────── */}
      {invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-12 text-center ring-1 ring-zinc-200/70">
          <FileText className="size-10 text-zinc-300" />
          <p className="text-lg font-semibold text-zinc-900">
            Sin comprobantes
          </p>
          <p className="text-sm text-zinc-500">
            Los comprobantes aparecen acá al facturar desde el cobro.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200/70">
          <div className="divide-y divide-zinc-100">
            {invoices.map((inv) => {
              const meta = INVOICE_STATUS_META[inv.status];
              const date = new Date(inv.created_at);
              const dateStr = date.toLocaleDateString("es-AR", {
                timeZone: TZ_AR,
                day: "2-digit",
                month: "short",
              });
              const timeStr = date.toLocaleTimeString("es-AR", {
                timeZone: TZ_AR,
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <button
                  key={inv.id}
                  onClick={() => openDetail(inv)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
                >
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[0.65rem] font-semibold ring-1",
                      inv.tipo_comprobante.startsWith("factura")
                        ? "bg-zinc-100 text-zinc-700 ring-zinc-200/70"
                        : "bg-violet-50 text-violet-700 ring-violet-200/60",
                    )}
                  >
                    {tipoLabel(inv.tipo_comprobante)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium tabular-nums text-zinc-900">
                      {formatInvoiceNumber(inv.punto_venta, inv.numero)}
                    </span>
                    {inv.razon_social_receptor && (
                      <span className="block truncate text-xs text-zinc-500">
                        {inv.razon_social_receptor}
                      </span>
                    )}
                  </span>

                  <span className="hidden shrink-0 text-xs text-zinc-500 sm:block">
                    {dateStr} {timeStr}
                  </span>

                  <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900">
                    {formatCurrency(inv.total_cents)}
                  </span>

                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium ring-1",
                      meta.bg,
                      meta.color,
                    )}
                  >
                    {/* Una `pending` con rato encima no está "por salir": el
                        gateway reintenta con backoff hasta 60 min. Decirlo
                        evita que alguien la re-emita creyendo que se colgó
                        (spec 088). */}
                    {inv.status === "pending" && isDemorada(inv.created_at)
                      ? "Demorada"
                      : meta.label}
                  </span>

                  <ChevronRight className="size-4 shrink-0 text-zinc-300" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Paginación ─────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">
            {count} comprobante{count !== 1 && "s"} · pág {page}/{totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => updateFilter("page", String(page - 1))}
            >
              <ChevronLeft className="size-3.5" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => updateFilter("page", String(page + 1))}
            >
              Siguiente
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <InvoiceDetailSheet
        invoice={selectedInvoice}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        slug={slug}
        onRetried={handleRefresh}
      />
    </div>
  );
}

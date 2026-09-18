"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PanelContent,
} from "@/components/ui/modal";
import type { StockMovimiento } from "@/lib/stock/queries";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<string, { label: string; cls: string }> = {
  ingreso: { label: "Ingreso", cls: "bg-emerald-50 text-emerald-700" },
  venta: { label: "Venta", cls: "bg-sky-50 text-sky-700" },
  ajuste: { label: "Ajuste", cls: "bg-amber-50 text-amber-700" },
  merma: { label: "Merma", cls: "bg-rose-50 text-rose-700" },
  reversion: { label: "Reversión", cls: "bg-zinc-100 text-zinc-600" },
};

/** Fecha en AR (America/Argentina/Buenos_Aires) explícita — no la del navegador. */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}

/**
 * Historial de un stock_item, como `PanelContent` lateral (spec 205 · D12).
 * Sólo Bebidas/Bar: viven en `stock_items` y ya tienen esta lectura
 * (`/api/stock/history`, con el chequeo de rol real de la spec de seguridad).
 * Cocina se registra en `ingredient_consumptions`, que hoy no tiene una ruta
 * de lectura para el cliente — agregarla es una query nueva, fuera de
 * alcance de esta spec (D12: "todo sale de las queries que ya trae
 * catalogo/page.tsx").
 */
export function StockHistoryPanel({
  open,
  onOpenChange,
  stockItemId,
  productName,
  currentQty,
  unit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stockItemId: string;
  productName: string;
  currentQty: number;
  unit: string;
}) {
  const [items, setItems] = useState<StockMovimiento[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !stockItemId) return;
    setLoading(true);
    fetch(`/api/stock/history?stockItemId=${stockItemId}`)
      .then((r) => r.json())
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, stockItemId]);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <PanelContent size="md">
        <ModalHeader title="Historial de stock" description={productName} />
        <ModalBody className="px-0">
          {loading ? (
            <p className="text-muted-foreground px-5 py-8 text-center text-sm">
              Cargando…
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-5 py-8 text-center text-sm">
              Sin movimientos
            </p>
          ) : (
            <ul className="divide-border/70 divide-y px-5">
              {items.map((m) => {
                const kind = KIND_LABELS[m.kind] ?? {
                  label: m.kind,
                  cls: "bg-zinc-50 text-zinc-600",
                };
                return (
                  <li
                    key={m.id}
                    className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-2.5 py-2.5"
                  >
                    <time className="text-muted-foreground text-xs">
                      {formatDate(m.createdAt)}
                    </time>
                    <div className="min-w-0">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                          kind.cls,
                        )}
                      >
                        {kind.label}
                      </span>
                      {m.reason && (
                        <span className="text-muted-foreground ml-1.5 truncate text-xs">
                          {m.reason}
                        </span>
                      )}
                      {m.createdByName && (
                        <span className="text-muted-foreground block text-[11px]">
                          {m.createdByName}
                        </span>
                      )}
                    </div>
                    <b
                      className={cn(
                        "text-sm tabular-nums",
                        m.qty > 0 ? "text-emerald-600" : "text-rose-600",
                      )}
                    >
                      {m.qty > 0 ? `+${m.qty}` : m.qty}
                    </b>
                  </li>
                );
              })}
            </ul>
          )}
        </ModalBody>
        <ModalFooter className="sm:justify-between">
          <span className="text-muted-foreground text-sm">
            Stock actual:{" "}
            <b className="text-foreground tabular-nums">
              {currentQty} {unit}
            </b>
          </span>
          <Button
            type="button"
            variant="outline"
            size="xl"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
        </ModalFooter>
      </PanelContent>
    </Modal>
  );
}

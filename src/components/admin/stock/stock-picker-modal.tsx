"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
} from "@/components/ui/modal";
import type { StockRow } from "@/lib/stock/stock-rows";

/**
 * «Ingresar mercadería» del header (spec 205 · D6/D12): la acción principal
 * de la tab, en el mismo lugar que «Nuevo producto» en Productos. Elegís
 * producto o insumo de las tres listas y sigue directo al mismo
 * `StockMovementModal` en modo Ingreso.
 */
export function StockPickerModal({
  open,
  onOpenChange,
  rows,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: StockRow[];
  onPick: (row: StockRow) => void;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? rows.filter((r) => r.name.toLowerCase().includes(s))
      : rows;
    return list.slice(0, 40);
  }, [rows, q]);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ("");
      }}
    >
      <ModalContent size="sm">
        <ModalHeader
          title="Ingresar mercadería"
          description="Elegí el producto o insumo"
        />
        <ModalBody className="grid gap-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar producto o insumo…"
              aria-label="Buscar producto o insumo"
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white pr-3 pl-9 text-sm outline-none focus:border-zinc-400"
            />
          </div>
          <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-100">
            {filtered.length === 0 ? (
              <li className="text-muted-foreground px-3 py-6 text-center text-sm">
                Sin resultados.
              </li>
            ) : (
              filtered.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    onClick={() => onPick(r)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50"
                  >
                    <span className="min-w-0 truncate font-medium text-zinc-900">
                      {r.name}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {r.kind === "ingredient" ? "Insumo" : "Producto"}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

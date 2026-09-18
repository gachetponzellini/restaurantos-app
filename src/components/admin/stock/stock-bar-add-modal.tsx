"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/components/ui/modal";
import { setBarStock, setStockLevels } from "@/lib/stock/actions";
import type { BarStockCandidate } from "@/components/admin/stock/stock-bar-tab";

/**
 * Alta puntual de un producto al stock de bar (spec 10, luego 205 · D12).
 * Misma lógica que la vieja `AddBarProduct` de `stock-bar-tab.tsx`, sobre la
 * cáscara de modal de la 204: buscar → elegir → stock inicial.
 */
export function StockBarAddModal({
  open,
  onOpenChange,
  slug,
  candidates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  candidates: BarStockCandidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BarStockCandidate | null>(null);
  const [qty, setQty] = useState("0");

  const filtered = useMemo(
    () =>
      candidates.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [candidates, search],
  );

  function reset() {
    setSearch("");
    setSelected(null);
    setQty("0");
  }

  function handleAdd() {
    if (!selected) return;
    const initial = parseInt(qty, 10);
    if (isNaN(initial) || initial < 0) {
      toast.error("Ingresá una cantidad válida.");
      return;
    }
    startTransition(async () => {
      const r1 = await setBarStock(selected.id, true, slug);
      if (!r1.ok) {
        toast.error(r1.error);
        return;
      }
      if (initial > 0) {
        const r2 = await setStockLevels(selected.id, initial, 0, slug);
        if (!r2.ok) {
          toast.error(r2.error);
          return;
        }
      }
      toast.success(`Agregado al stock de bar: ${selected.name}`);
      router.refresh();
      onOpenChange(false);
      reset();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <ModalContent size="sm">
        <ModalHeader title="Agregar producto al stock de bar" />
        {!selected ? (
          <ModalBody className="grid gap-3">
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
              />
              <input
                autoFocus
                placeholder="Buscar producto…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar producto"
                className="h-9 w-full rounded-lg border border-zinc-200 bg-white pr-3 pl-9 text-sm outline-none focus:border-zinc-400"
              />
            </div>
            <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-100">
              {filtered.length === 0 ? (
                <li className="text-muted-foreground px-3 py-6 text-center text-sm">
                  No hay productos disponibles para agregar.
                </li>
              ) : (
                filtered.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(c)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-50"
                    >
                      <span className="font-medium text-zinc-900">
                        {c.name}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {c.categoryName ?? "—"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </ModalBody>
        ) : (
          <>
            <ModalBody className="grid gap-4">
              <div className="bg-muted/50 rounded-lg px-3 py-2.5">
                <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
                  Producto
                </p>
                <p className="text-base font-semibold text-zinc-900">
                  {selected.name}
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bar-add-qty">Stock inicial (unidades)</Label>
                <Input
                  id="bar-add-qty"
                  type="number"
                  min={0}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                type="button"
                variant="outline"
                size="xl"
                onClick={() => setSelected(null)}
                disabled={pending}
              >
                Volver
              </Button>
              <Button
                type="button"
                size="xl"
                disabled={pending}
                onClick={handleAdd}
              >
                <Plus /> Agregar
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

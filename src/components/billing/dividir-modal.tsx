"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Banknote, Plus, Scissors, Users, X } from "lucide-react";
import { toast } from "sonner";

import {
  dividirPorComensal,
  dividirPorItems,
  dividirPorMonto,
  dividirPorPersonas,
} from "@/lib/billing/cuenta-actions";
import { expectedByAmounts } from "@/lib/billing/totals";
import type { CuentaState } from "@/lib/billing/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── Banner: división activa ───────────────────────────────────────────────
//
// Compartido por la vista de cuenta (mozo) y el cobro embebido (encargado).

export function SplitsBanner({
  splits,
  onLimpiar,
}: {
  splits: CuentaState["splits"];
  onLimpiar: () => void;
}) {
  // Una sub-cuenta cancelada no está asignada a nadie: su `expected` ya se
  // redistribuyó entre las vivas (spec 36 · R-C4). Contándolas, después de
  // limpiar una división quedaba «Cuenta dividida en 1 sub-cuenta · Total
  // asignado $24.667» sobre una mesa sin dividir (issue #189).
  const vivos = splits.filter((s) => s.status !== "cancelled");
  const totalAsignado = vivos.reduce(
    (acc, s) => acc + s.expected_amount_cents,
    0,
  );
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl p-4"
      style={{ background: "var(--brand-soft, #F4F4F5)" }}
    >
      <div className="flex size-9 items-center justify-center rounded-full bg-card">
        <Scissors className="size-4" style={{ color: "var(--brand, #18181B)" }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          Cuenta dividida en {vivos.length}{" "}
          {vivos.length === 1 ? "sub-cuenta" : "sub-cuentas"}
        </p>
        <p className="text-xs text-foreground/70 tabular-nums">
          Total asignado: {formatCurrency(totalAsignado)}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onLimpiar}>
        <Ban className="size-3" />
        Limpiar
      </Button>
    </div>
  );
}

// ── Modal dividir ─────────────────────────────────────────────────────────

export function DividirModal({
  open,
  onOpenChange,
  items,
  orderId,
  slug,
  totalCents,
  parentStartTransition,
  isPending,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  items: CuentaState["items"];
  orderId: string;
  slug: string;
  /** Total de la cuenta (con propina y descuento) — para calcular el resto en
   *  la tab «Por monto». Es el total que ve el usuario; el server recalcula el
   *  suyo al dividir, así que acá sólo se usa para mostrar. */
  totalCents: number;
  parentStartTransition: (cb: () => void | Promise<void>) => void;
  /** Hay una división (u otro refresh) en vuelo: bloquea re-envíos. */
  isPending: boolean;
  onDone: () => void;
}) {
  const startTransition = parentStartTransition;
  const [tab, setTab] = useState<
    "personas" | "items" | "comensal" | "monto"
  >("personas");
  const [count, setCount] = useState(2);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [numSplits, setNumSplits] = useState(2);
  /** Montos cargados a mano, en centavos. 0 = renglón todavía vacío. */
  const [montos, setMontos] = useState<number[]>([0]);

  const hasSeatNumbers = useMemo(
    () =>
      items.some(
        (it) => (it as { seat_number?: number | null }).seat_number != null,
      ),
    [items],
  );

  useEffect(() => {
    if (!open) {
      setCount(2);
      setMapping({});
      setNumSplits(2);
      setMontos([0]);
      setTab("personas");
    }
  }, [open]);

  const allAssigned = useMemo(
    () => items.every((it) => mapping[it.id]),
    [items, mapping],
  );

  // Los renglones vacíos no cuentan: se puede tener un input a medio tipear sin
  // que la vista previa grite. La validación real (y la del server) corre sobre
  // los montos efectivamente cargados.
  const montosCargados = useMemo(
    () => montos.filter((m) => m > 0),
    [montos],
  );
  const previewMontos = useMemo(
    () => expectedByAmounts(totalCents, montosCargados),
    [totalCents, montosCargados],
  );
  const restoMontos = totalCents - montosCargados.reduce((a, b) => a + b, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dividir cuenta</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList
            className={cn(
              "mb-4 grid",
              hasSeatNumbers ? "grid-cols-4" : "grid-cols-3",
            )}
          >
            <TabsTrigger value="personas">
              <Users className="mr-2 size-4" /> Personas
            </TabsTrigger>
            <TabsTrigger value="monto">
              <Banknote className="mr-2 size-4" /> Monto
            </TabsTrigger>
            <TabsTrigger value="items">
              <Scissors className="mr-2 size-4" /> Por items
            </TabsTrigger>
            {hasSeatNumbers && (
              <TabsTrigger value="comensal">
                <Users className="mr-2 size-4" /> Comensal
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="monto" className="space-y-4">
            <div>
              <Label>¿Cuánto pone cada uno?</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Cargá los montos que ya sabés. Lo que falte para llegar al total
                queda como una sub-cuenta más.
              </p>
              <div className="mt-3 space-y-2">
                {montos.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-sm font-semibold text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground/70">
                        $
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={m === 0 ? "" : m / 100}
                        placeholder="0"
                        onChange={(e) => {
                          const cents = Math.max(
                            0,
                            Math.round(Number(e.target.value) * 100),
                          );
                          setMontos((prev) =>
                            prev.map((v, idx) => (idx === i ? cents : v)),
                          );
                        }}
                        className="h-11 w-full rounded-xl border border-border pl-7 pr-3 text-base font-semibold tabular-nums focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                      />
                    </div>
                    {montos.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-lg"
                        className="shrink-0"
                        aria-label={`Quitar monto ${i + 1}`}
                        onClick={() =>
                          setMontos((prev) => prev.filter((_, idx) => idx !== i))
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setMontos((prev) => [...prev, 0])}
              >
                <Plus className="size-3.5" /> Agregar monto
              </Button>
            </div>

            {/* Vista previa: lo que va a quedar. El resto es la última
                sub-cuenta y es lo que más se mira. */}
            <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Total de la cuenta</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatCurrency(totalCents)}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="text-muted-foreground">
                  {restoMontos > 0 ? "Resto (última sub-cuenta)" : "Resto"}
                </span>
                <span
                  className={cn(
                    "font-bold tabular-nums",
                    restoMontos < 0 ? "text-rose-600" : "text-foreground",
                  )}
                >
                  {formatCurrency(restoMontos)}
                </span>
              </div>
              {previewMontos.ok && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Queda dividida en {previewMontos.expecteds.length}{" "}
                  {previewMontos.expecteds.length === 1
                    ? "sub-cuenta"
                    : "sub-cuentas"}
                  .
                </p>
              )}
            </div>

            {montosCargados.length > 0 && !previewMontos.ok && (
              <p className="text-xs font-semibold text-rose-600">
                {previewMontos.error}
              </p>
            )}

            <Button
              type="button"
              size="xl"
              className="mt-1 w-full"
              disabled={isPending || !previewMontos.ok}
              onClick={() =>
                startTransition(async () => {
                  const r = await dividirPorMonto(
                    orderId,
                    montosCargados,
                    slug,
                  );
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success(`Dividido en ${r.data.splits.length}`);
                    onDone();
                  }
                })
              }
            >
              Dividir por monto
            </Button>
          </TabsContent>
          <TabsContent value="personas" className="space-y-4">
            <div>
              <Label>¿Cuántas personas?</Label>
              <div className="mt-2 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => setCount(Math.max(2, count - 1))}
                  className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground/80 transition hover:bg-border active:scale-95"
                  aria-label="Restar"
                >
                  −
                </button>
                <span className="w-10 text-center text-3xl font-bold tabular-nums">
                  {count}
                </span>
                <button
                  type="button"
                  onClick={() => setCount(Math.min(20, count + 1))}
                  className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground/80 transition hover:bg-border active:scale-95"
                  aria-label="Sumar"
                >
                  +
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                El total se reparte equitativo (2 a 20 personas).
              </p>
            </div>
            <Button
              type="button"
              size="xl"
              className="mt-1 w-full"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const r = await dividirPorPersonas(orderId, count, slug);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success(`Dividido en ${count}`);
                    onDone();
                  }
                })
              }
            >
              {isPending ? "Dividiendo…" : "Confirmar división"}
            </Button>
          </TabsContent>
          <TabsContent value="items" className="space-y-3">
            <div>
              <Label>¿Cuántas sub-cuentas?</Label>
              <div className="mt-2 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    const next = Math.max(2, numSplits - 1);
                    setNumSplits(next);
                    setMapping((prev) => {
                      const out: Record<string, number> = {};
                      for (const [k, v] of Object.entries(prev)) {
                        if (v <= next) out[k] = v;
                      }
                      return out;
                    });
                  }}
                  className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground/80 transition hover:bg-border active:scale-95"
                  aria-label="Restar"
                >
                  −
                </button>
                <span className="w-10 text-center text-3xl font-bold tabular-nums">
                  {numSplits}
                </span>
                <button
                  type="button"
                  onClick={() => setNumSplits(Math.min(20, numSplits + 1))}
                  className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground/80 transition hover:bg-border active:scale-95"
                  aria-label="Sumar"
                >
                  +
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Tocá un número junto a cada item para asignarlo a esa sub-cuenta.
              </p>
            </div>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {it.quantity}× {it.product_name}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatCurrency(it.subtotal_cents)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: numSplits }, (_, i) => i + 1).map(
                      (idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            setMapping({ ...mapping, [it.id]: idx })
                          }
                          className={cn(
                            "size-7 rounded-full text-xs font-semibold ring-1 transition",
                            mapping[it.id] === idx
                              ? "bg-primary text-white ring-primary"
                              : "bg-card text-foreground/80 ring-border hover:bg-muted/50",
                          )}
                        >
                          {idx}
                        </button>
                      ),
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              size="xl"
              className="mt-1 w-full"
              disabled={!allAssigned || isPending}
              onClick={() =>
                startTransition(async () => {
                  const grouped: Record<number, string[]> = {};
                  for (let i = 1; i <= numSplits; i++) grouped[i] = [];
                  for (const [itemId, idx] of Object.entries(mapping)) {
                    grouped[idx].push(itemId);
                  }
                  for (const k of Object.keys(grouped)) {
                    if (grouped[Number(k)].length === 0) delete grouped[Number(k)];
                  }
                  const r = await dividirPorItems(orderId, grouped, slug);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("División por items aplicada");
                    onDone();
                  }
                })
              }
            >
              {isPending
                ? "Dividiendo…"
                : allAssigned
                  ? "Confirmar"
                  : "Asigná todos los items"}
            </Button>
          </TabsContent>
          {hasSeatNumbers && (
            <TabsContent value="comensal" className="space-y-4">
              <div className="rounded-xl bg-violet-50 p-3 ring-1 ring-violet-100">
                <p className="text-sm font-semibold text-violet-900">
                  Dividir por comensal
                </p>
                <p className="mt-1 text-xs text-violet-700">
                  Se agrupan automáticamente los items por número de comensal
                  asignado al pedir.
                </p>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {(() => {
                  const seatMap = new Map<number | null, typeof items>();
                  for (const it of items) {
                    const key =
                      (it as { seat_number?: number | null }).seat_number ??
                      null;
                    const bucket = seatMap.get(key) ?? [];
                    bucket.push(it);
                    seatMap.set(key, bucket);
                  }
                  const entries = Array.from(seatMap.entries()).sort((a, b) => {
                    if (a[0] === null) return 1;
                    if (b[0] === null) return -1;
                    return a[0] - b[0];
                  });
                  return entries.map(([seat, seatItems]) => (
                    <li key={seat ?? "null"} className="rounded-lg bg-muted/50 p-2.5">
                      <p className="text-sm font-semibold text-foreground">
                        {seat != null ? `Comensal ${seat}` : "Sin asignar"}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          · {seatItems.length}{" "}
                          {seatItems.length === 1 ? "item" : "items"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatCurrency(
                          seatItems.reduce((a, it) => a + it.subtotal_cents, 0),
                        )}
                      </p>
                    </li>
                  ));
                })()}
              </ul>
              <Button
                type="button"
                size="xl"
                className="mt-1 w-full"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await dividirPorComensal(orderId, slug);
                    if (!r.ok) toast.error(r.error);
                    else {
                      toast.success("Dividido por comensal");
                      onDone();
                    }
                  })
                }
              >
                {isPending ? "Dividiendo…" : "Confirmar división por comensal"}
              </Button>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

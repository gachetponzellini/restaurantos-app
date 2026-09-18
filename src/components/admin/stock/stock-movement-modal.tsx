"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Segmented } from "@/components/admin/catalog/ui/catalog-toolbar";
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
import {
  ajustarStockCocina,
  ingresarStockCocina,
} from "@/lib/ingredients/actions";
import { ajustarStock, ingresarStock } from "@/lib/stock/actions";
import { formatQty, previewQty, type StockRow } from "@/lib/stock/stock-rows";

type Mode = "ingreso" | "ajuste";

/**
 * Ingreso/Ajuste de stock (spec 205 · D12), un solo `ModalContent size="sm"`
 * para las tres tabs (Bebidas, Cocina, Bar): mismo comportamiento que
 * `stock-movement-sheet.tsx` / `stock-cocina-tab.tsx` (ajuste exige motivo,
 * ingreso de cocina se arma por presentación), sobre la anatomía de la 204.
 *
 * La merma no tiene selector propio: un ajuste negativo ya se guarda como
 * `kind='merma'` en las actions (issue #270), tanto para productos como para
 * insumos — es automático, no una opción más en esta pantalla.
 */
export function StockMovementModal({
  open,
  onOpenChange,
  row,
  mode: initialMode,
  slug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: StockRow | null;
  mode: Mode;
  slug: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [presentationId, setPresentationId] = useState("");
  const [pending, startTransition] = useTransition();

  // Reset al abrir: cada producto/insumo arranca de cero, no arrastra lo que
  // se tipeó para el anterior.
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setQty("");
    setReason("");
    setPresentationId(
      row?.kind === "ingredient"
        ? (row.ingredient.presentations[0]?.id ?? "")
        : "",
    );
  }, [open, initialMode, row]);

  if (!row) return null;

  const isIngredient = row.kind === "ingredient";
  const qtyNum = Number(qty.replace(",", "."));
  const selectedPres =
    row.kind === "ingredient"
      ? row.ingredient.presentations.find((p) => p.id === presentationId)
      : undefined;

  // Cocina en modo ingreso: la cantidad la define envases × neto de la
  // presentación (igual que hoy). El resto entra directo en unidad base.
  const delta =
    isIngredient && mode === "ingreso"
      ? selectedPres && qtyNum > 0
        ? qtyNum * selectedPres.netQuantity
        : 0
      : Number.isFinite(qtyNum)
        ? qtyNum
        : 0;
  const preview = previewQty(row.qty, delta);

  const motivoOk = mode === "ajuste" ? reason.trim().length > 0 : true;
  const qtyOk =
    isIngredient && mode === "ingreso"
      ? !!presentationId && qtyNum > 0
      : mode === "ingreso"
        ? qtyNum > 0
        : Number.isFinite(qtyNum) && qtyNum !== 0;
  const canSubmit = qtyOk && motivoOk && !pending;

  function handleSubmit() {
    if (!canSubmit || !row) return;
    startTransition(async () => {
      const result =
        row.kind === "product"
          ? mode === "ingreso"
            ? await ingresarStock(
                row.productId,
                Math.trunc(qtyNum),
                slug,
                reason.trim() || undefined,
              )
            : await ajustarStock(
                row.productId,
                Math.trunc(qtyNum),
                reason.trim(),
                slug,
              )
          : mode === "ingreso"
            ? await ingresarStockCocina(slug, {
                ingredient_id: row.id,
                presentation_id: presentationId,
                units: qtyNum,
              })
            : await ajustarStockCocina(slug, {
                ingredient_id: row.id,
                quantity: qtyNum,
                reason: reason.trim(),
              });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        mode === "ingreso"
          ? `Stock ingresado: ${row.name}`
          : `Stock ajustado: ${row.name}`,
      );
      router.refresh();
      onOpenChange(false);
    });
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="sm">
        <ModalHeader
          title={mode === "ingreso" ? "Ingresar stock" : "Ajustar stock"}
          description={row.name}
        />
        <ModalBody className="grid gap-4">
          <Segmented<Mode>
            aria-label="Tipo de movimiento"
            value={mode}
            onChange={setMode}
            options={[
              { value: "ingreso", label: "Ingreso" },
              { value: "ajuste", label: "Ajuste" },
            ]}
          />

          {isIngredient && mode === "ingreso" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="mov-pres">Presentación</Label>
                <select
                  id="mov-pres"
                  value={presentationId}
                  onChange={(e) => setPresentationId(e.target.value)}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm outline-none focus:border-zinc-400"
                >
                  {row.kind === "ingredient" &&
                    row.ingredient.presentations.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.netQuantity} {row.unit})
                      </option>
                    ))}
                </select>
                {row.kind === "ingredient" &&
                  row.ingredient.presentations.length === 0 && (
                    <p className="text-xs text-amber-700">
                      Este insumo no tiene presentaciones cargadas.
                    </p>
                  )}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="mov-qty">Cantidad de envases</Label>
                <Input
                  id="mov-qty"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  autoFocus
                  className="h-11 text-center text-lg font-semibold tabular-nums"
                />
              </div>
            </>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="mov-qty">
                {mode === "ingreso"
                  ? "Cantidad que entra"
                  : "Diferencia (+ o −)"}
              </Label>
              <Input
                id="mov-qty"
                type="number"
                inputMode="decimal"
                step={isIngredient ? "any" : 1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={mode === "ingreso" ? "12" : "-2,5"}
                autoFocus
                className="h-11 text-center text-lg font-semibold tabular-nums"
              />
            </div>
          )}

          {mode === "ajuste" && (
            <div className="grid gap-1.5">
              <Label htmlFor="mov-reason">
                Motivo <span className="text-destructive">*</span>
              </Label>
              <Input
                id="mov-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: conteo físico, rotura, vencimiento…"
                maxLength={200}
              />
            </div>
          )}

          <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">Hoy hay</span>
            <span className="font-semibold tabular-nums">
              {formatQty(row.qty, row.unit)}
            </span>
            <span className="text-muted-foreground">→ quedaría</span>
            <span
              className="font-semibold tabular-nums"
              data-testid="mov-preview"
            >
              {delta !== 0 ? formatQty(preview, row.unit) : "—"}
            </span>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="outline"
            size="xl"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="xl"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {mode === "ingreso" ? "Ingresar" : "Ajustar"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

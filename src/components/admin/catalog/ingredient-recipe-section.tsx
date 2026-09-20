"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchSubRecipeLines,
  saveIngredientRecipe,
} from "@/lib/ingredients/actions";
import type { IngredientRecipeLine } from "@/lib/ingredients/types";

type IngredientOption = {
  id: string;
  name: string;
  unit: string;
};

type Props = {
  slug: string;
  ingredientId: string;
  ingredientOptions: IngredientOption[];
};

export function IngredientRecipeSection({
  slug,
  ingredientId,
  ingredientOptions,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);

  // Local state for the sub-recipe lines
  const [lines, setLines] = useState<IngredientRecipeLine[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [dirty, setDirty] = useState(false);

  // Load existing sub-recipe lines on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchSubRecipeLines(ingredientId).then((data) => {
      if (!cancelled) {
        setLines(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [ingredientId]);

  // ── Available ingredients (not already in sub-recipe, not self) ──

  const usedIds = new Set(lines.map((l) => l.childIngredientId));
  const availableIngredients = useMemo(() => {
    const list = ingredientOptions.filter(
      (i) => i.id !== ingredientId && !usedIds.has(i.id),
    );
    if (!pickerSearch) return list;
    const q = pickerSearch.toLowerCase();
    return list.filter((i) => i.name.toLowerCase().includes(q));
  }, [ingredientOptions, ingredientId, usedIds, pickerSearch]);

  // ── Actions ──

  const addIngredient = (ing: IngredientOption) => {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        parentIngredientId: ingredientId,
        childIngredientId: ing.id,
        childIngredientName: ing.name,
        childIngredientUnit: ing.unit as any,
        quantity: 0,
        notes: null,
        costPerUnit: null,
        wastePercent: 0,
      },
    ]);
    setDirty(true);
    setShowPicker(false);
    setPickerSearch("");
  };

  const updateQuantity = (idx: number, value: number) => {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, quantity: value } : l)),
    );
    setDirty(true);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const handleSave = () => {
    startTransition(async () => {
      const payload = lines
        .filter((l) => l.quantity > 0)
        .map((l) => ({
          child_ingredient_id: l.childIngredientId,
          quantity: l.quantity,
          notes: l.notes,
        }));

      const result = await saveIngredientRecipe(slug, ingredientId, payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Sub-receta guardada.");
      setDirty(false);
      router.refresh();
    });
  };

  // ── Cost summary ──

  const totalCostCents = useMemo(() => {
    return lines.reduce((sum, l) => {
      if (l.costPerUnit == null || l.quantity <= 0) return sum;
      return sum + l.quantity * l.costPerUnit * (1 + l.wastePercent / 100);
    }, 0);
  }, [lines]);

  // ── Render ──

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-zinc-400" />
          <p className="text-sm font-semibold text-zinc-500">
            Cargando sub-receta…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-zinc-500" />
          <p className="text-sm font-semibold text-zinc-900">Sub-receta</p>
          {lines.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-600">
              {lines.length}
            </span>
          )}
        </div>
        {dirty && (
          <Button onClick={handleSave} size="sm" disabled={pending}>
            {pending ? "Guardando…" : "Guardar sub-receta"}
          </Button>
        )}
      </div>

      <p className="text-[11px] text-zinc-500">
        Definí los ingredientes que componen este insumo compuesto. Las
        cantidades son <strong>por cada 1 unidad</strong> de este insumo (si se
        mide en kg: lo que lleva 1 kg), no las de la tanda entera — con esas
        cantidades se calcula el costo y se descuenta el stock.
      </p>

      {/* Cost summary */}
      {lines.length > 0 && totalCostCents > 0 && (
        <div className="flex items-center gap-4 rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-100">
          <div>
            <p className="text-[11px] text-zinc-500">Costo sub-receta</p>
            <p className="text-base font-bold text-zinc-900">
              ${(totalCostCents / 100).toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Lines */}
      {lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-4 text-center">
          <FlaskConical className="mx-auto h-5 w-5 text-zinc-400" />
          <p className="mt-1.5 text-xs font-semibold text-zinc-700">
            Sin sub-ingredientes
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Agregá ingredientes para armar la sub-receta.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {lines.map((line, idx) => (
            <div
              key={line.childIngredientId}
              className="flex items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-zinc-200"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {line.childIngredientName}
                </p>
                {line.costPerUnit != null && line.quantity > 0 && (
                  <p className="text-[11px] text-zinc-500">
                    $
                    {(
                      (line.quantity *
                        line.costPerUnit *
                        (1 + line.wastePercent / 100)) /
                      100
                    ).toFixed(2)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  step="0.001"
                  min={0}
                  className="w-20 text-center"
                  value={line.quantity || ""}
                  onChange={(e) =>
                    updateQuantity(idx, parseFloat(e.target.value) || 0)
                  }
                />
                <span className="w-8 text-xs text-zinc-500">
                  {line.childIngredientUnit}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeLine(idx)}
                className="rounded-full p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add ingredient picker */}
      {showPicker ? (
        <div className="space-y-2 rounded-xl bg-white p-2.5 ring-1 ring-zinc-200">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <Input
                autoFocus
                placeholder="Buscar ingrediente…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setShowPicker(false);
                setPickerSearch("");
              }}
              className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {availableIngredients.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-zinc-500">
              {pickerSearch
                ? "Sin resultados."
                : "Todos los insumos ya están en la sub-receta."}
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto">
              {availableIngredients.map((ing) => (
                <button
                  key={ing.id}
                  type="button"
                  onClick={() => addIngredient(ing)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  <span className="flex-1 text-left">{ing.name}</span>
                  <span className="text-[10px] uppercase text-zinc-400">
                    {ing.unit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar ingrediente
        </button>
      )}
    </div>
  );
}

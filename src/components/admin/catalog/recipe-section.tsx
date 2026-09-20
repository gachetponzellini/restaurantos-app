"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChefHat,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRecipe } from "@/lib/ingredients/actions";
import type { FoodCostResult, RecipeLine } from "@/lib/ingredients/types";
import { cn } from "@/lib/utils";
import { factorDeMerma } from "@/lib/ingredients/factor-de-merma";

type IngredientOption = {
  id: string;
  name: string;
  unit: string;
};

type Props = {
  slug: string;
  productId: string;
  priceCents: number;
  recipeLines: RecipeLine[];
  ingredientOptions: IngredientOption[];
  foodCost: FoodCostResult;
};

export function RecipeSection({
  slug,
  productId,
  priceCents,
  recipeLines: initialLines,
  ingredientOptions,
  foodCost: initialFoodCost,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Local state for the recipe lines
  const [lines, setLines] = useState(initialLines);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [dirty, setDirty] = useState(false);

  // Sync from server on refresh
  useEffect(() => {
    setLines(initialLines);
    setDirty(false);
  }, [initialLines]);

  // ── Live food cost calculation ──

  const foodCost = useMemo(() => {
    if (!dirty) return initialFoodCost;

    const costLines = lines.map((line) => {
      const costPerUnit = line.costPerUnit ?? 0;
      const lineCost = line.quantity * costPerUnit * factorDeMerma(line.wastePercent);
      return {
        ingredientId: line.ingredientId,
        ingredientName: line.ingredientName,
        quantity: line.quantity,
        unit: line.ingredientUnit,
        costPerUnit,
        wastePercent: line.wastePercent,
        lineCostCents: Math.round(lineCost),
      };
    });

    const totalCents = costLines.reduce((sum, l) => sum + l.lineCostCents, 0);
    const marginPercent =
      priceCents > 0
        ? ((priceCents - totalCents) / priceCents) * 100
        : null;

    return { totalCents, marginPercent, lines: costLines } satisfies FoodCostResult;
  }, [lines, priceCents, dirty, initialFoodCost]);

  // ── Available ingredients (not already in recipe) ──

  const usedIngredientIds = new Set(lines.map((l) => l.ingredientId));
  const availableIngredients = useMemo(() => {
    const list = ingredientOptions.filter((i) => !usedIngredientIds.has(i.id));
    if (!pickerSearch) return list;
    const q = pickerSearch.toLowerCase();
    return list.filter((i) => i.name.toLowerCase().includes(q));
  }, [ingredientOptions, usedIngredientIds, pickerSearch]);

  // ── Actions ──

  const addIngredient = (ing: IngredientOption) => {
    const matchingLine = initialLines.find((l) => l.ingredientId === ing.id);
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        productId,
        ingredientId: ing.id,
        ingredientName: ing.name,
        ingredientUnit: ing.unit as any,
        quantity: 0,
        notes: null,
        costPerUnit: matchingLine?.costPerUnit ?? null,
        wastePercent: matchingLine?.wastePercent ?? 0,
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
          ingredient_id: l.ingredientId,
          quantity: l.quantity,
          notes: l.notes,
        }));

      const result = await saveRecipe(slug, productId, payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Receta guardada.");
      setDirty(false);
      router.refresh();
    });
  };

  // ── Render ──

  const marginColor =
    foodCost.marginPercent != null
      ? foodCost.marginPercent >= 65
        ? "text-emerald-700"
        : foodCost.marginPercent >= 50
          ? "text-amber-700"
          : "text-red-700"
      : "text-zinc-500";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChefHat className="h-4 w-4 text-zinc-500" />
          <h3 className="text-base font-bold text-zinc-900">Receta</h3>
          {lines.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-600">
              {lines.length}
            </span>
          )}
        </div>
        {dirty && (
          <Button onClick={handleSave} size="sm" disabled={pending}>
            {pending ? "Guardando…" : "Guardar receta"}
          </Button>
        )}
      </div>

      {/* Food cost summary */}
      {lines.length > 0 && (
        <div className="flex items-center gap-4 rounded-xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-100">
          <div>
            <p className="text-xs text-zinc-500">Food cost</p>
            <p className="text-lg font-bold text-zinc-900">
              ${(foodCost.totalCents / 100).toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Precio venta</p>
            <p className="text-lg font-bold text-zinc-900">
              ${(priceCents / 100).toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Margen</p>
            <p className={cn("text-lg font-bold", marginColor)}>
              {foodCost.marginPercent != null
                ? `${foodCost.marginPercent.toFixed(1)}%`
                : "—"}
            </p>
          </div>
          {foodCost.marginPercent != null && foodCost.marginPercent < 50 && (
            <div className="flex items-center gap-1 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-semibold">Margen bajo</span>
            </div>
          )}
        </div>
      )}

      {/* Recipe lines */}
      {lines.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-6 text-center">
          <ChefHat className="mx-auto h-6 w-6 text-zinc-400" />
          <p className="mt-2 text-sm font-semibold text-zinc-700">
            Sin receta
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Agregá ingredientes para calcular el food cost automáticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {lines.map((line, idx) => (
            <div
              key={line.ingredientId}
              className="flex items-center gap-2 rounded-xl bg-white p-2.5 ring-1 ring-zinc-200"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900">
                  {line.ingredientName}
                </p>
                {line.costPerUnit != null && line.quantity > 0 && (
                  <p className="text-[11px] text-zinc-500">
                    $
                    {(
                      (line.quantity *
                        line.costPerUnit *
                        factorDeMerma(line.wastePercent)) /
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
                <span className="w-8 text-xs text-zinc-500">{line.ingredientUnit}</span>
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
        <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-zinc-200">
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
                : "Todos los insumos ya están en la receta."}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
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

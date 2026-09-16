"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FlaskConical, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IngredientRecipeSection } from "@/components/admin/catalog/ingredient-recipe-section";
import { HistorialPrecio } from "./historial-precio";
import {
  createIngredient,
  deleteIngredient,
  fetchPresentations,
  updateIngredient,
  upsertPresentations,
} from "@/lib/ingredients/actions";
import { IngredientInput, type PresentationInput } from "@/lib/ingredients/schema";
import { INGREDIENT_UNITS, type IngredientWithPresentations } from "@/lib/ingredients/types";

type IngredientOption = {
  id: string;
  name: string;
  unit: string;
};

type Props = {
  slug: string;
  ingredient?: IngredientWithPresentations;
  trigger: React.ReactElement;
  /** Available ingredients for the sub-recipe picker (only needed for composite) */
  ingredientOptions?: IngredientOption[];
};

export function IngredientDialog({ slug, ingredient, trigger, ingredientOptions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Presentations (managed outside react-hook-form for simplicity) ──
  const [presentations, setPresentations] = useState<PresentationInput[]>(() =>
    ingredient?.presentations.length
      ? ingredient.presentations.map((p) => ({
          id: p.id,
          name: p.name,
          net_quantity: p.netQuantity,
          cost_cents: p.costCents,
          is_default: p.isDefault,
        }))
      : [{ name: "", net_quantity: 1, cost_cents: 0, is_default: true }],
  );

  const form = useForm<IngredientInput>({
    resolver: zodResolver(IngredientInput),
    defaultValues: ingredient
      ? {
          name: ingredient.name,
          unit: ingredient.unit,
          waste_percent: ingredient.wastePercent,
          stock_min_alert: ingredient.stockMinAlert,
          is_active: ingredient.isActive,
          is_composite: ingredient.isComposite,
        }
      : {
          name: "",
          unit: "kg",
          waste_percent: 0,
          stock_min_alert: null,
          is_active: true,
          is_composite: false,
        },
  });

  const isActive = form.watch("is_active");
  const isComposite = form.watch("is_composite");

  // Load presentations from server when dialog opens (for editing)
  useEffect(() => {
    if (open && ingredient?.id && presentations.length === 0) {
      fetchPresentations(ingredient.id).then((data) => {
        if (data.length > 0) setPresentations(data);
      });
    }
  }, [open, ingredient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Presentation helpers ──

  const addPresentation = () => {
    setPresentations((prev) => [
      ...prev,
      { name: "", net_quantity: 1, cost_cents: 0, is_default: prev.length === 0 },
    ]);
  };

  const removePresentation = (idx: number) => {
    setPresentations((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // If we removed the default, make the first one default
      if (next.length > 0 && !next.some((p) => p.is_default)) {
        next[0] = { ...next[0]!, is_default: true };
      }
      return next;
    });
  };

  const updatePresentation = (
    idx: number,
    field: keyof PresentationInput,
    value: string | number | boolean,
  ) => {
    setPresentations((prev) =>
      prev.map((p, i) => {
        if (i !== idx) {
          // If setting this one as default, unset others
          if (field === "is_default" && value === true) {
            return { ...p, is_default: false };
          }
          return p;
        }
        return { ...p, [field]: value };
      }),
    );
  };

  // ── Submit ──

  const onSubmit = async (values: IngredientInput) => {
    // Los envases son opcionales: un insumo se puede dar de alta sin ninguno.
    let validPresentations = presentations.filter((p) => p.name.trim() !== "");
    if (
      validPresentations.length > 0 &&
      !validPresentations.some((p) => p.is_default)
    ) {
      validPresentations = validPresentations.map((p, i) => ({ ...p, is_default: i === 0 }));
    }

    setSubmitting(true);
    try {
      let ingredientId = ingredient?.id;

      if (ingredient) {
        const result = await updateIngredient(slug, ingredient.id, values);
        if (!result.ok) { toast.error(result.error); return; }
      } else {
        const result = await createIngredient(slug, values);
        if (!result.ok) { toast.error(result.error); return; }
        ingredientId = result.data.id;
      }

      // Save presentations (si no hay y el insumo es nuevo, no hay nada que guardar)
      if (validPresentations.length > 0 || ingredient) {
        const presResult = await upsertPresentations(
          slug,
          ingredientId!,
          validPresentations,
        );
        if (!presResult.ok) { toast.error(presResult.error); return; }
      }

      toast.success(ingredient ? "Ingrediente actualizado." : "Ingrediente creado.");
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete ──

  const onDelete = async () => {
    if (!ingredient) return;
    setSubmitting(true);
    try {
      const result = await deleteIngredient(slug, ingredient.id);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success("Ingrediente borrado.");
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className={`max-h-[90vh] overflow-y-auto ${isComposite ? "max-w-xl" : "max-w-lg"}`}>
        <DialogHeader>
          <DialogTitle>
            {ingredient ? "Editar ingrediente" : "Nuevo ingrediente"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            id="ingredient-form"
          >
            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="ej: Harina 000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Unit + Waste row */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidad base</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {INGREDIENT_UNITS.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label} ({u.value})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="waste_percent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Merma %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        max={99.99}
                        placeholder="0"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Stock min alert */}
            <FormField
              control={form.control}
              name="stock_min_alert"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stock mínimo (alerta)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.001"
                      min={0}
                      placeholder="Opcional"
                      value={field.value ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        field.onChange(v === "" ? null : parseFloat(v));
                      }}
                    />
                  </FormControl>
                  <p className="text-[11px] text-zinc-500">
                    Cuando el stock baje de este valor, se mostrará una alerta.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* is_active toggle */}
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between rounded-2xl bg-zinc-50 p-3 ring-1 ring-zinc-100">
                    <div>
                      <FormLabel className="cursor-pointer">Activo</FormLabel>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Si lo desactivás, no aparece como opción en recetas
                        nuevas.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => field.onChange(!field.value)}
                      role="switch"
                      aria-checked={isActive}
                      className={`relative ml-3 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                        isActive ? "bg-emerald-600" : "bg-zinc-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                          isActive ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* is_composite toggle */}
            <FormField
              control={form.control}
              name="is_composite"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between rounded-2xl bg-violet-50/50 p-3 ring-1 ring-violet-100">
                    <div>
                      <FormLabel className="cursor-pointer">
                        <FlaskConical className="mr-1.5 inline h-3.5 w-3.5" />
                        Compuesto
                      </FormLabel>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Tiene sub-receta propia (ej: salsas, bases). El costo se
                        calcula desde sus sub-ingredientes.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => field.onChange(!field.value)}
                      role="switch"
                      aria-checked={!!isComposite}
                      className={`relative ml-3 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                        isComposite ? "bg-violet-600" : "bg-zinc-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                          isComposite ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* ── Sub-recipe section (only for existing composite ingredients) ── */}
            {isComposite && ingredient?.id && ingredientOptions && (
              <div className="rounded-2xl bg-violet-50/30 p-3 ring-1 ring-violet-100">
                <IngredientRecipeSection
                  slug={slug}
                  ingredientId={ingredient.id}
                  ingredientOptions={ingredientOptions}
                />
              </div>
            )}

            {isComposite && !ingredient?.id && (
              <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-3 text-center text-xs text-zinc-500">
                Guardá el ingrediente primero para agregar la sub-receta.
              </div>
            )}

            {/* spec 172 · el precio que cambió, y con qué compra. El log existe
                desde el baseline y hasta ahora no tenía pantalla. */}
            {ingredient?.id && <HistorialPrecio slug={slug} ingredientId={ingredient.id} />}

            {/* ── Presentations section ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-zinc-900">
                  Presentaciones (envases)
                </p>
                <button
                  type="button"
                  onClick={addPresentation}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-100"
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar
                </button>
              </div>
              <p className="text-[11px] text-zinc-500">
                Cada envase que comprás. Ej: &quot;Bolsa 25kg&quot;, &quot;Paquete
                1kg&quot;. La presentación por defecto se usa para calcular el
                costo unitario.
              </p>

              {presentations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-4 text-center text-xs text-zinc-500">
                  Sin presentaciones. Tocá &quot;Agregar&quot;.
                </div>
              ) : (
                <div className="space-y-2">
                  {presentations.map((pres, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl p-3 ring-1 ${
                        pres.is_default
                          ? "bg-emerald-50/50 ring-emerald-200"
                          : "bg-white ring-zinc-200"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => updatePresentation(idx, "is_default", true)}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            pres.is_default
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                          }`}
                        >
                          {pres.is_default ? "Por defecto" : "Hacer default"}
                        </button>
                        {presentations.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removePresentation(idx)}
                            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[11px] font-medium text-zinc-600">
                            Nombre
                          </label>
                          <Input
                            className="mt-0.5"
                            placeholder="Bolsa 25kg"
                            value={pres.name}
                            onChange={(e) =>
                              updatePresentation(idx, "name", e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-zinc-600">
                            Contenido neto
                          </label>
                          <Input
                            className="mt-0.5"
                            type="number"
                            step="0.001"
                            min={0.001}
                            value={pres.net_quantity}
                            onChange={(e) =>
                              updatePresentation(
                                idx,
                                "net_quantity",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-zinc-600">
                            Costo ($)
                          </label>
                          <Input
                            className="mt-0.5"
                            type="number"
                            step="1"
                            min={0}
                            value={Math.round(pres.cost_cents / 100)}
                            onChange={(e) =>
                              updatePresentation(
                                idx,
                                "cost_cents",
                                Math.round((parseFloat(e.target.value) || 0) * 100),
                              )
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </form>
        </Form>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {ingredient ? (
            confirmDelete ? (
              <div className="flex flex-1 items-center gap-2">
                <span className="text-xs text-red-700">¿Confirmás?</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={submitting}
                >
                  Sí, borrar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={submitting}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDelete(true)}
                disabled={submitting}
                className="text-red-600 hover:bg-red-50"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Borrar
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" form="ingredient-form" disabled={submitting}>
              {submitting ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

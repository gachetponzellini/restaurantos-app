"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FlaskConical, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HistorialPrecio } from "@/components/admin/catalog/historial-precio";
import { IngredientRecipeSection } from "@/components/admin/catalog/ingredient-recipe-section";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import type { CatalogEditorProps } from "@/components/admin/catalog/ui/editor-host";
import {
  EditorLinkList,
  EditorSectionHeading,
  EditorToggle,
  EntityEditor,
} from "@/components/admin/catalog/ui/entity-editor";
import {
  FOOD_COST_TEXT,
  foodCostPercent,
  foodCostTone,
} from "@/lib/catalog/food-cost";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  createIngredient,
  fetchIngredientUsage,
  fetchPresentations,
  updateIngredient,
  upsertPresentations,
} from "@/lib/ingredients/actions";
import {
  IngredientInput,
  type PresentationInput,
} from "@/lib/ingredients/schema";
import { INGREDIENT_UNITS } from "@/lib/ingredients/types";
import type { IngredientOverview } from "@/lib/ingredients/types";

/**
 * Editor de insumo (spec 205 · D10). Reemplaza al `IngredientDialog`: mismos
 * campos, mismo schema, mismas actions (D5); cambia la forma, siguiendo el
 * patrón de `ProductEditor`.
 *
 * Cuatro secciones: Básico (con la sub-receta si es compuesto, como hoy) ·
 * Presentaciones (tabla editable + historial de precio) · Stock y merma
 * (stock de sólo lectura, mínimo, merma%, activo) · Usado en.
 *
 * «Usado en» pide al abrir qué productos usan el insumo (`fetchIngredientUsage`)
 * y los lista con su food cost, enlazados al editor del producto en «Precio y
 * costo».
 */
export function IngredientEditor(props: CatalogEditorProps) {
  const { ingredients } = useCatalogData();
  const ingredient = props.id
    ? ingredients.find((i) => i.id === props.id)
    : undefined;
  if (props.id && !ingredient) {
    return (
      <EntityEditor
        onClose={props.onClose}
        title="Cargando…"
        dirty={false}
        readOnly
        sections={[
          {
            id: "cargando",
            label: "Cargando",
            content: (
              <div
                className="h-40 animate-pulse rounded-xl bg-zinc-100"
                aria-busy
              />
            ),
          },
        ]}
      />
    );
  }
  return <IngredientEditorForm {...props} ingredient={ingredient} />;
}

const BLANK_PRESENTATION: PresentationInput = {
  name: "",
  net_quantity: 1,
  cost_cents: 0,
  is_default: true,
};

function IngredientEditorForm({
  id,
  nav,
  back,
  onClose,
  onCreated,
  openLinked,
  ingredient,
}: CatalogEditorProps & { ingredient: IngredientOverview | undefined }) {
  const { slug, ingredients } = useCatalogData();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [archiving, setArchiving] = useState(false);

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
  const { isDirty } = form.formState;

  // Las presentaciones no viven en react-hook-form (spec 172 ya lo manejaba
  // así): son una tabla propia con su propio "sucio".
  const [presentations, setPresentations] = useState<PresentationInput[]>(() =>
    ingredient ? [] : [BLANK_PRESENTATION],
  );
  const [loadingPres, setLoadingPres] = useState(!!ingredient);
  const [presDirty, setPresDirty] = useState(false);

  useEffect(() => {
    if (!ingredient) return;
    let vivo = true;
    setLoadingPres(true);
    fetchPresentations(ingredient.id).then((data) => {
      if (!vivo) return;
      setPresentations(data.length > 0 ? data : [BLANK_PRESENTATION]);
      setLoadingPres(false);
      setPresDirty(false);
    });
    return () => {
      vivo = false;
    };
  }, [ingredient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addPresentation = () => {
    setPresentations((prev) => [
      ...prev,
      { ...BLANK_PRESENTATION, is_default: prev.length === 0 },
    ]);
    setPresDirty(true);
  };
  const removePresentation = (idx: number) => {
    setPresentations((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length > 0 && !next.some((p) => p.is_default)) {
        next[0] = { ...next[0]!, is_default: true };
      }
      return next;
    });
    setPresDirty(true);
  };
  const updatePresentation = (
    idx: number,
    field: keyof PresentationInput,
    value: string | number | boolean,
  ) => {
    setPresentations((prev) =>
      prev.map((p, i) => {
        if (i !== idx) {
          if (field === "is_default" && value === true)
            return { ...p, is_default: false };
          return p;
        }
        return { ...p, [field]: value };
      }),
    );
    setPresDirty(true);
  };

  const dirty = isDirty || presDirty;
  const formId = `insumo-${id ?? "nuevo"}`;

  const onSubmit = async (values: IngredientInput) => {
    setSaving(true);
    try {
      let ingredientId = ingredient?.id;
      if (ingredient) {
        const result = await updateIngredient(slug, ingredient.id, values);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
      } else {
        const result = await createIngredient(slug, values);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        ingredientId = result.data.id;
      }

      const validPresentations = presentations.filter(
        (p) => p.name.trim() !== "",
      );
      const normalized =
        validPresentations.length > 0 &&
        !validPresentations.some((p) => p.is_default)
          ? validPresentations.map((p, i) => ({ ...p, is_default: i === 0 }))
          : validPresentations;
      if (normalized.length > 0 || ingredient) {
        const presResult = await upsertPresentations(
          slug,
          ingredientId!,
          normalized,
        );
        if (!presResult.ok) {
          toast.error(presResult.error);
          return;
        }
      }

      toast.success(ingredient ? "Actualizado." : "Creado.");
      form.reset(values);
      setPresDirty(false);
      setSaved(true);
      router.refresh();
      if (!id) onCreated(ingredientId!);
    } finally {
      setSaving(false);
    }
  };

  const archivar = async () => {
    if (!ingredient) return;
    setArchiving(true);
    try {
      const values = { ...form.getValues(), is_active: false };
      const result = await updateIngredient(slug, ingredient.id, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Insumo archivado.");
      router.refresh();
      onClose();
    } finally {
      setArchiving(false);
    }
  };

  const name = useWatch({ control: form.control, name: "name" });
  const unit = useWatch({ control: form.control, name: "unit" });
  const isComposite = useWatch({ control: form.control, name: "is_composite" });
  const isActive = useWatch({ control: form.control, name: "is_active" });

  const defaultCostPerUnit = useMemo(() => {
    const def = presentations.find((p) => p.is_default) ?? presentations[0];
    if (!def || def.net_quantity <= 0) return null;
    return def.cost_cents / def.net_quantity;
  }, [presentations]);

  return (
    <Form {...form}>
      <EntityEditor
        onClose={onClose}
        nav={nav}
        back={back}
        eyebrow={ingredient ? "Insumo" : "Catálogo"}
        title={name || ingredient?.name || "Nuevo insumo"}
        meta={
          ingredient ? (
            <>
              <span className="rounded-full bg-zinc-100 px-2 py-px text-[11px] font-semibold text-zinc-700 tabular-nums">
                {ingredient.unit.toUpperCase()}
              </span>
              {!ingredient.isActive && (
                <span className="rounded-full bg-zinc-100 px-2 py-px text-[11px] font-semibold text-zinc-600">
                  Inactivo
                </span>
              )}
              {ingredient.stockStatus === "out" && (
                <span className="rounded-full bg-rose-50 px-2 py-px text-[11px] font-semibold text-rose-700">
                  Sin stock
                </span>
              )}
              {ingredient.stockStatus === "low" && (
                <span className="rounded-full bg-amber-50 px-2 py-px text-[11px] font-semibold text-amber-700">
                  Bajo mínimo
                </span>
              )}
            </>
          ) : undefined
        }
        dirty={dirty}
        saving={saving}
        saved={saved}
        formId={formId}
        saveLabel={ingredient ? "Guardar" : "Crear"}
        destructive={
          ingredient && isActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
              disabled={archiving}
              onClick={archivar}
            >
              <Trash2 className="size-3.5" />
              {archiving ? "Archivando…" : "Archivar"}
            </Button>
          ) : undefined
        }
        sections={[
          {
            id: "basico",
            label: "Básico",
            content: (
              <>
                <EditorSectionHeading
                  title="Básico"
                  description="Nombre y unidad en la que se compra y se descuenta stock."
                />
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre</FormLabel>
                        <FormControl>
                          <Input placeholder="ej: Harina 000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="unit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unidad base</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
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
                  </div>

                  <FormField
                    control={form.control}
                    name="is_composite"
                    render={({ field }) => (
                      <EditorToggle
                        title={
                          <>
                            <FlaskConical className="mr-1.5 inline size-3.5" />
                            Compuesto
                          </>
                        }
                        description="Tiene sub-receta propia (ej: salsas, bases). El costo se calcula desde sus sub-ingredientes."
                        control={
                          <Switch
                            aria-label="Compuesto"
                            checked={!!field.value}
                            onCheckedChange={field.onChange}
                          />
                        }
                      />
                    )}
                  />

                  {isComposite &&
                    (ingredient ? (
                      <div className="rounded-xl bg-violet-50/30 p-3 ring-1 ring-violet-100">
                        <IngredientRecipeSection
                          slug={slug}
                          ingredientId={ingredient.id}
                          ingredientOptions={ingredients.filter(
                            (i) => i.isActive,
                          )}
                        />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/30 p-3 text-center text-xs text-zinc-500">
                        Creá el insumo primero para agregar la sub-receta.
                      </div>
                    ))}
                </div>
              </>
            ),
          },
          {
            id: "presentaciones",
            label: "Presentaciones",
            count:
              presentations.filter((p) => p.name.trim()).length || undefined,
            content: (
              <>
                <EditorSectionHeading
                  title="Presentaciones"
                  description="Cada envase que comprás. La presentación por defecto calcula el costo por unidad."
                  action={
                    <button
                      type="button"
                      onClick={addPresentation}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-100"
                    >
                      <Plus className="size-3.5" /> Agregar
                    </button>
                  }
                />
                {loadingPres ? (
                  <div
                    className="h-24 animate-pulse rounded-xl bg-zinc-100"
                    aria-busy
                  />
                ) : (
                  <div className="space-y-2">
                    {defaultCostPerUnit != null && (
                      <p className="text-[13px] text-zinc-600">
                        Costo por unidad (default):{" "}
                        <span className="font-semibold text-zinc-900">
                          {formatCurrency(defaultCostPerUnit)}/
                          {ingredient?.unit ?? unit}
                        </span>
                      </p>
                    )}
                    {presentations.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-4 text-center text-xs text-zinc-500">
                        Sin presentaciones. Tocá «Agregar».
                      </div>
                    ) : (
                      presentations.map((pres, idx) => (
                        <div
                          key={idx}
                          className={
                            "rounded-xl p-3 ring-1 " +
                            (pres.is_default
                              ? "bg-emerald-50/50 ring-emerald-200"
                              : "bg-white ring-zinc-200")
                          }
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() =>
                                updatePresentation(idx, "is_default", true)
                              }
                              className={
                                "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                                (pres.is_default
                                  ? "bg-emerald-600 text-white"
                                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200")
                              }
                            >
                              {pres.is_default
                                ? "Por defecto"
                                : "Hacer default"}
                            </button>
                            {presentations.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removePresentation(idx)}
                                className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-rose-600"
                                aria-label="Quitar presentación"
                              >
                                <X className="size-3.5" />
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
                                  updatePresentation(
                                    idx,
                                    "name",
                                    e.target.value,
                                  )
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
                                    Math.round(
                                      (parseFloat(e.target.value) || 0) * 100,
                                    ),
                                  )
                                }
                              />
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {ingredient && (
                  <div className="mt-5">
                    <HistorialPrecio slug={slug} ingredientId={ingredient.id} />
                  </div>
                )}
              </>
            ),
          },
          {
            id: "stock",
            label: "Stock y merma",
            content: (
              <>
                <EditorSectionHeading
                  title="Stock y merma"
                  description="El stock lo mueven las compras y las ventas; acá sólo se mira y se define el mínimo."
                />
                <div className="space-y-4">
                  {ingredient && (
                    <div className="rounded-xl bg-zinc-50 px-3.5 py-3 ring-1 ring-zinc-100">
                      <p className="text-[11px] font-semibold tracking-[0.06em] text-zinc-500 uppercase">
                        Stock actual
                      </p>
                      <p className="text-lg font-bold text-zinc-900 tabular-nums">
                        {ingredient.stockQuantity.toFixed(
                          ingredient.unit === "un" ? 0 : 2,
                        )}{" "}
                        {ingredient.unit}
                      </p>
                    </div>
                  )}
                  <div className="grid gap-3.5 sm:grid-cols-2">
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
                              onChange={(e) =>
                                field.onChange(parseFloat(e.target.value) || 0)
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="is_active"
                    render={({ field }) => (
                      <EditorToggle
                        title="Activo"
                        description="Si lo desactivás, no aparece como opción en recetas nuevas."
                        control={
                          <Switch
                            aria-label="Activo"
                            checked={!!field.value}
                            onCheckedChange={field.onChange}
                          />
                        }
                      />
                    )}
                  />
                </div>
              </>
            ),
          },
          {
            id: "usado-en",
            label: "Usado en",
            count: ingredient?.recipeCount || undefined,
            content: (
              <>
                <EditorSectionHeading
                  title="Usado en"
                  description="Productos que lo usan en su receta: si cambia el costo, cambia esto."
                />
                {ingredient ? (
                  <IngredientUsage
                    slug={slug}
                    ingredientId={ingredient.id}
                    expected={ingredient.recipeCount}
                    onOpenProduct={(productId) =>
                      openLinked({
                        kind: "product",
                        id: productId,
                        section: "precio",
                      })
                    }
                  />
                ) : (
                  <p className="text-[13px] text-zinc-500">
                    Se ve después de crear el insumo.
                  </p>
                )}
              </>
            ),
          },
        ]}
      >
        <form id={formId} hidden onSubmit={form.handleSubmit(onSubmit)} />
      </EntityEditor>
    </Form>
  );
}

/**
 * «Usado en»: los productos cuya receta lleva este insumo, con su food cost,
 * enlazados a su editor. Mientras carga muestra el conteo que ya trae la lista.
 */
function IngredientUsage({
  slug,
  ingredientId,
  expected,
  onOpenProduct,
}: {
  slug: string;
  ingredientId: string;
  expected: number;
  onOpenProduct: (productId: string) => void;
}) {
  const { products, costeo } = useCatalogData();
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchIngredientUsage(slug, ingredientId)
      .then((r) => {
        if (!vivo) return;
        if (r) setIds(r);
        else setError(true);
      })
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, [slug, ingredientId]);

  if (error)
    return (
      <p className="text-[13px] text-zinc-500">
        No pudimos cargar dónde se usa.
      </p>
    );
  if (!ids)
    return (
      <p className="text-[13px] text-zinc-500" aria-busy>
        Usado en {expected} {expected === 1 ? "receta" : "recetas"}…
      </p>
    );

  const costById = new Map(costeo.map((c) => [c.productId, c]));
  const items = products
    .filter((p) => ids.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
    .map((p) => {
      const c = costById.get(p.id);
      const pct = c?.hasRecipe
        ? foodCostPercent(p.price_cents, c.foodCostCents)
        : null;
      return {
        key: p.id,
        label: p.name,
        meta:
          pct == null ? (
            formatCurrency(p.price_cents)
          ) : (
            <span
              className={cn("font-semibold", FOOD_COST_TEXT[foodCostTone(pct)])}
            >
              {Math.round(pct)}% food cost
            </span>
          ),
        onOpen: () => onOpenProduct(p.id),
      };
    });

  return (
    <EditorLinkList items={items} empty="Ningún producto lo usa todavía." />
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Form } from "@/components/ui/form";
import { ModifierGroupsEditor } from "@/components/admin/catalog/modifier-groups-editor";
import { ProductDeleteButton } from "@/components/admin/catalog/product-delete-button";
import {
  ProductBasicsFields,
  ProductKitchenFields,
  ProductPriceField,
  ProductVisibilityFields,
  productDefaults,
  useSaveProduct,
} from "@/components/admin/catalog/product-fields";
import { RecipeSection } from "@/components/admin/catalog/recipe-section";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import type { CatalogEditorProps } from "@/components/admin/catalog/ui/editor-host";
import {
  EditorSectionHeading,
  EntityEditor,
  useEditorGuard,
} from "@/components/admin/catalog/ui/entity-editor";
import { formatCurrency } from "@/lib/currency";
import { fetchProductRecipe } from "@/lib/ingredients/actions";
import type { FoodCostResult, RecipeLine } from "@/lib/ingredients/types";
import type { AdminProduct } from "@/lib/admin/catalog-query";
import { ProductInput } from "@/lib/catalog/schemas";

import { ProductPills, ProductThumb } from "./product-bits";

type Receta = { lines: RecipeLine[]; foodCost: FoodCostResult };

/**
 * Editor de producto (spec 205 · D4). Reemplaza al `ProductDialog`: mismos
 * campos, mismo schema, mismas actions; cambia la forma.
 *
 * - Cinco secciones con índice: Básico · Precio y costo · Adicionales · Cocina
 *   e impresión · Visibilidad.
 * - Guardar no cierra: queda «✓ Guardado» y se sigue con ‹ ›.
 * - Crear usa el mismo editor; al crear pasa a editar el producto nuevo (y ahí
 *   aparece la receta, que necesita el id).
 *
 * La lista ya trae el producto entero, así que abrir no espera nada; lo único
 * que se pide al abrir es la receta.
 */
export function ProductEditor(props: CatalogEditorProps) {
  const { products } = useCatalogData();
  // Por id, no por copia: después de guardar, `router.refresh()` trae la fila
  // nueva y el editor tiene que mostrar ESA.
  const product = props.id
    ? products.find((p) => p.id === props.id)
    : undefined;
  // Recién creado: el id llega antes que la fila del refresh. Se espera a la
  // fila en vez de montar el form vacío.
  if (props.id && !product) {
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
  return <ProductEditorForm {...props} product={product} />;
}

function ProductEditorForm({
  id,
  section,
  draft,
  nav,
  back,
  onClose,
  openLinked,
  onCreated,
  product,
}: CatalogEditorProps & { product: AdminProduct | undefined }) {
  const { slug, businessId, categories, stations, ingredients } =
    useCatalogData();
  const save = useSaveProduct(slug, product);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const form = useForm<ProductInput>({
    resolver: zodResolver(ProductInput),
    defaultValues: productDefaults(product, draft as Partial<ProductInput>),
  });
  const { isDirty } = form.formState;

  // Receta: sólo existe para productos ya creados.
  const [receta, setReceta] = useState<Receta | null>(null);
  const [recetaError, setRecetaError] = useState(false);
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    fetchProductRecipe(slug, id)
      .then((r) => {
        if (!vivo) return;
        if (r) setReceta(r);
        else setRecetaError(true);
      })
      .catch(() => vivo && setRecetaError(true));
    return () => {
      vivo = false;
    };
  }, [slug, id]);

  const ingredientOptions = useMemo(
    () =>
      ingredients
        .filter((i) => i.isActive)
        .map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
    [ingredients],
  );

  const formId = `producto-${id ?? "nuevo"}`;
  const onSubmit = async (values: ProductInput) => {
    setSaving(true);
    try {
      const savedId = await save(values);
      if (!savedId) return;
      form.reset(values);
      setSaved(true);
      if (!id) onCreated(savedId);
    } finally {
      setSaving(false);
    }
  };

  // El header refleja lo que se está escribiendo (nombre, precio).
  const name = useWatch({ control: form.control, name: "name" });
  const categoryId = useWatch({ control: form.control, name: "category_id" });
  const category = categories.find((c) => c.id === categoryId) ?? null;
  const groups =
    useWatch({ control: form.control, name: "modifier_groups" }) ?? [];

  return (
    <Form {...form}>
      <EntityEditor
        onClose={onClose}
        nav={nav}
        back={back}
        initialSection={section}
        eyebrow={
          category?.name ?? (product ? "Sin categoría" : "Catálogo")
        }
        title={name || product?.name || "Nuevo producto"}
        thumb={
          product ? <ProductThumb product={product} size={36} /> : undefined
        }
        meta={
          product ? (
            <>
              <span className="rounded-full bg-zinc-100 px-2 py-px text-[11px] font-semibold text-zinc-700 tabular-nums">
                {formatCurrency(product.price_cents)}
              </span>
              <ProductPills product={product} />
            </>
          ) : undefined
        }
        dirty={isDirty}
        saving={saving}
        saved={saved}
        formId={formId}
        saveLabel={product ? "Guardar" : "Crear"}
        destructive={
          product ? (
            <ProductDeleteButton
              slug={slug}
              productId={product.id}
              productName={product.name}
              onDeleted={onClose}
              compact
            />
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
                  description="Cómo aparece en la carta y en la comanda."
                />
                <ProductBasicsFields
                  businessId={businessId}
                  categories={categories}
                  categoryHint={
                    category ? (
                      <CategoryLink
                        name={category.name}
                        onOpen={() =>
                          openLinked({ kind: "category", id: category.id })
                        }
                      />
                    ) : undefined
                  }
                />
              </>
            ),
          },
          {
            id: "precio",
            label: "Precio y costo",
            content: (
              <>
                <EditorSectionHeading
                  title="Precio y costo"
                  description="El precio base, sin adicionales, y lo que cuesta hacerlo."
                />
                <ProductPriceField />
                <div className="mt-5">
                  {!product ? (
                    <p className="text-[13px] text-zinc-500">
                      Creá el producto y después cargale la receta para ver el
                      food cost.
                    </p>
                  ) : receta ? (
                    <RecipeSection
                      slug={slug}
                      productId={product.id}
                      priceCents={product.price_cents}
                      recipeLines={receta.lines}
                      ingredientOptions={ingredientOptions}
                      foodCost={receta.foodCost}
                    />
                  ) : recetaError ? (
                    <p className="text-[13px] text-zinc-500">
                      No pudimos cargar la receta.
                    </p>
                  ) : (
                    <div className="space-y-2" aria-busy>
                      <div className="h-5 w-24 animate-pulse rounded bg-zinc-100" />
                      <div className="h-16 w-full animate-pulse rounded-xl bg-zinc-100" />
                    </div>
                  )}
                </div>
              </>
            ),
          },
          {
            id: "adicionales",
            label: "Adicionales",
            count: groups.length,
            content: <ModifierGroupsEditor />,
          },
          {
            id: "cocina",
            label: "Cocina e impresión",
            content: (
              <>
                <EditorSectionHeading
                  title="Cocina e impresión"
                  description="A qué comandera sale cuando el mozo lo carga."
                />
                <ProductKitchenFields
                  categories={categories}
                  stations={stations}
                />
              </>
            ),
          },
          {
            id: "visibilidad",
            label: "Visibilidad",
            content: (
              <>
                <EditorSectionHeading
                  title="Visibilidad"
                  description="Tres cosas distintas, de más operativa a más definitiva."
                />
                <ProductVisibilityFields />
              </>
            ),
          },
        ]}
      >
        {/* El submit: los campos viven en las secciones, fuera de este <form>;
            react-hook-form lee sus valores del estado, no del DOM. */}
        <form id={formId} hidden onSubmit={form.handleSubmit(onSubmit)} />
      </EntityEditor>
    </Form>
  );
}

function CategoryLink({ name, onOpen }: { name: string; onOpen: () => void }) {
  const guard = useEditorGuard();
  return (
    <button
      type="button"
      onClick={() => guard(onOpen)}
      className="w-max text-xs font-medium text-sky-700 hover:underline"
    >
      Ver categoría {name} →
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductDeleteButton } from "@/components/admin/catalog/product-delete-button";
import { ProductForm } from "@/components/admin/catalog/product-form";
import { RecipeSection } from "@/components/admin/catalog/recipe-section";
import type {
  AdminCategory,
  AdminProduct,
  AdminStation,
} from "@/lib/admin/catalog-query";
import { fetchProductRecipe } from "@/lib/ingredients/actions";
import type { FoodCostResult, RecipeLine } from "@/lib/ingredients/types";

type IngredientOption = { id: string; name: string; unit: string };

type Receta = { lines: RecipeLine[]; foodCost: FoodCostResult };

/**
 * Edición de producto en modal (no en página).
 *
 * La lista del catálogo ya trae el producto entero del server — adicionales
 * incluidos — así que abrir el modal no espera nada: el form se pinta con lo
 * que ya está en memoria. Antes cada click era una navegación completa
 * (`/catalogo/productos/[id]`), y volver era otra: dos round-trips para cambiar
 * un precio. La página sigue existiendo para el link directo.
 *
 * Lo único que se trae al abrir es la receta, que la lista no tiene.
 */
export function ProductDialog({
  slug,
  businessId,
  categories,
  stations,
  product,
  ingredientOptions,
  open,
  onOpenChange,
}: {
  slug: string;
  businessId: string;
  categories: AdminCategory[];
  stations: AdminStation[];
  product: AdminProduct;
  ingredientOptions: IngredientOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [receta, setReceta] = useState<Receta | null>(null);
  const [recetaError, setRecetaError] = useState(false);

  const productId = product.id;
  const formId = `producto-form-${productId}`;

  useEffect(() => {
    let vivo = true;
    setReceta(null);
    setRecetaError(false);
    fetchProductRecipe(slug, productId)
      .then((r) => {
        if (!vivo) return;
        if (r) setReceta(r);
        else setRecetaError(true);
      })
      .catch(() => {
        if (vivo) setRecetaError(true);
      });
    return () => {
      vivo = false;
    };
  }, [slug, productId]);

  const cerrar = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(760px,95vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
            Catálogo · editar
          </p>
          <DialogTitle className="truncate text-lg">{product.name}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <ProductForm
            slug={slug}
            businessId={businessId}
            categories={categories}
            stations={stations}
            product={product}
            formId={formId}
            hideActions
            onSubmittingChange={setSubmitting}
            onSuccess={cerrar}
            onCancel={cerrar}
          />

          <div className="border-t pt-5">
            {receta ? (
              <RecipeSection
                slug={slug}
                productId={productId}
                priceCents={product.price_cents}
                recipeLines={receta.lines}
                ingredientOptions={ingredientOptions}
                foodCost={receta.foodCost}
              />
            ) : recetaError ? (
              <p className="text-muted-foreground text-sm">
                No pudimos cargar la receta.
              </p>
            ) : (
              <div className="space-y-2" aria-busy>
                <div className="bg-muted h-5 w-24 animate-pulse rounded" />
                <div className="bg-muted h-16 w-full animate-pulse rounded-xl" />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="m-0 items-center justify-between gap-2 border-t sm:justify-between">
          <ProductDeleteButton
            slug={slug}
            productId={productId}
            productName={product.name}
            onDeleted={cerrar}
            compact
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={cerrar}>
              Cancelar
            </Button>
            <Button type="submit" form={formId} disabled={submitting}>
              {submitting ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

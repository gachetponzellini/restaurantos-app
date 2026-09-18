"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { ModifierGroupsEditor } from "@/components/admin/catalog/modifier-groups-editor";
import {
  ProductBasicsFields,
  ProductKitchenFields,
  ProductPriceField,
  ProductVisibilityFields,
  productDefaults,
  useSaveProduct,
} from "@/components/admin/catalog/product-fields";
import type {
  AdminCategory,
  AdminProduct,
  AdminStation,
} from "@/lib/admin/catalog-query";
import { ProductInput } from "@/lib/catalog/schemas";

/**
 * Formulario de producto en página (`/catalogo/productos/[id]` y `/nuevo`, para
 * los links directos). El catálogo usa el editor en modal (`ProductEditor`);
 * los dos arman los mismos campos de `product-fields` (spec 205).
 */
export function ProductForm({
  slug,
  businessId,
  categories,
  stations = [],
  product,
  onSuccess,
  onCancel,
}: {
  slug: string;
  businessId: string;
  categories: AdminCategory[];
  stations?: AdminStation[];
  product?: AdminProduct;
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const save = useSaveProduct(slug, product);

  const form = useForm<ProductInput>({
    resolver: zodResolver(ProductInput),
    defaultValues: productDefaults(product),
  });

  const onSubmit = async (values: ProductInput) => {
    setSubmitting(true);
    try {
      const id = await save(values);
      if (!id) return;
      if (onSuccess) onSuccess();
      else router.push(`/${slug}/admin/catalogo`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <ProductBasicsFields
          businessId={businessId}
          categories={categories}
          slugPlacement="inline"
        />
        <ProductPriceField />
        <ProductKitchenFields categories={categories} stations={stations} />
        <ProductVisibilityFields />
        <ModifierGroupsEditor />

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : product ? "Guardar" : "Crear"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => (onCancel ? onCancel() : router.back())}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </Form>
  );
}

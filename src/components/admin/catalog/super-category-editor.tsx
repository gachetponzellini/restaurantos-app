"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFormContext, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

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
  COLOR_CLASSES,
  resolveColorClasses,
  resolveSuperCategoryIcon,
} from "@/components/super-categories/visual";
import { CatalogDeleteButton } from "@/components/admin/catalog/category-editor";
import { slugFromName } from "@/components/admin/catalog/product-fields";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import type { CatalogEditorProps } from "@/components/admin/catalog/ui/editor-host";
import {
  EditorLinkList,
  EditorSectionHeading,
  EntityEditor,
} from "@/components/admin/catalog/ui/entity-editor";
import type { AdminSuperCategory } from "@/lib/admin/catalog-query";
import {
  deleteSuperCategory,
  createSuperCategory,
  updateSuperCategory,
} from "@/lib/catalog/super-category-actions";
import { SuperCategoryInput } from "@/lib/catalog/schemas";
import {
  SUPER_CATEGORY_COLORS,
  SUPER_CATEGORY_ICONS,
  type SuperCategoryColorSlug,
  type SuperCategoryIconSlug,
} from "@/lib/super-categories/visual";

/**
 * Editor de supercategoría (spec 205 · D7). Dos secciones: Básico (nombre,
 * ícono, color) y Categorías (enlazadas). Mismo schema/actions que el
 * `SuperCategoryDialog` que reemplaza (D5).
 */
export function SuperCategoryEditor(props: CatalogEditorProps) {
  const { superCategories } = useCatalogData();
  const superCategory = props.id
    ? superCategories.find((s) => s.id === props.id)
    : undefined;
  if (props.id && !superCategory) {
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
  return <SuperCategoryEditorForm {...props} superCategory={superCategory} />;
}

function superCategoryDefaults(
  superCategory?: AdminSuperCategory,
  draft?: Partial<SuperCategoryInput>,
): SuperCategoryInput {
  if (!superCategory) {
    return {
      name: "",
      slug: "",
      sort_order: 0,
      icon: "utensils-crossed",
      color: "zinc",
      is_active: true,
      ...draft,
    };
  }
  return {
    name: superCategory.name,
    slug: superCategory.slug,
    sort_order: superCategory.sort_order,
    icon: (superCategory.icon as SuperCategoryIconSlug) ?? "utensils-crossed",
    color: (superCategory.color as SuperCategoryColorSlug) ?? "zinc",
    is_active: superCategory.is_active,
  };
}

function SuperCategoryEditorForm({
  id,
  section,
  draft,
  nav,
  back,
  onClose,
  openLinked,
  onCreated,
  superCategory,
}: CatalogEditorProps & { superCategory: AdminSuperCategory | undefined }) {
  const { slug, categories } = useCatalogData();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const form = useForm<SuperCategoryInput>({
    resolver: zodResolver(SuperCategoryInput),
    defaultValues: superCategoryDefaults(
      superCategory,
      draft as Partial<SuperCategoryInput>,
    ),
  });
  const { isDirty } = form.formState;

  const formId = `supercategoria-${id ?? "nueva"}`;
  const onSubmit = async (values: SuperCategoryInput) => {
    setSaving(true);
    try {
      const result = superCategory
        ? await updateSuperCategory(slug, superCategory.id, values)
        : await createSuperCategory(slug, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(superCategory ? "Actualizada." : "Creada.");
      form.reset(values);
      setSaved(true);
      router.refresh();
      if (!id) onCreated(result.data.id);
    } finally {
      setSaving(false);
    }
  };

  const name = useWatch({ control: form.control, name: "name" });
  const icon = useWatch({ control: form.control, name: "icon" });
  const color = useWatch({ control: form.control, name: "color" });
  const c = resolveColorClasses(color);
  const Icon = resolveSuperCategoryIcon(icon);

  const categoriesInSuper = superCategory
    ? categories.filter((cat) => cat.super_category_id === superCategory.id)
    : [];

  return (
    <Form {...form}>
      <EntityEditor
        onClose={onClose}
        nav={nav}
        back={back}
        initialSection={section}
        eyebrow="Supercategoría"
        title={name || superCategory?.name || "Nueva supercategoría"}
        thumb={
          <span
            className={`flex size-9 items-center justify-center rounded-full ${c.bgStrong}`}
          >
            <Icon className={`size-4.5 ${c.text}`} />
          </span>
        }
        meta={
          superCategory ? (
            <span className="rounded-full bg-zinc-100 px-2 py-px text-[11px] font-semibold text-zinc-700 tabular-nums">
              {categoriesInSuper.length}{" "}
              {categoriesInSuper.length === 1 ? "categoría" : "categorías"}
            </span>
          ) : undefined
        }
        dirty={isDirty}
        saving={saving}
        saved={saved}
        formId={formId}
        saveLabel={superCategory ? "Guardar" : "Crear"}
        destructive={
          superCategory ? (
            <CatalogDeleteButton
              label="Eliminar"
              confirmMessage="¿Borrar? Sus categorías quedan sin asignar."
              onDelete={async () => {
                const r = await deleteSuperCategory(slug, superCategory.id);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Borrada. Las categorías quedaron sin asignar.");
                router.refresh();
                onClose();
              }}
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
                  description="Es una pestaña de la carta pública (Entradas, Bebidas…)."
                />
                <BasicFields />
              </>
            ),
          },
          {
            id: "categorias",
            label: "Categorías",
            count: categoriesInSuper.length,
            content: (
              <>
                <EditorSectionHeading title="Categorías" />
                <EditorLinkList
                  items={categoriesInSuper.map((cat) => ({
                    key: cat.id,
                    label: cat.name,
                    onOpen: () => openLinked({ kind: "category", id: cat.id }),
                  }))}
                  empty={
                    superCategory
                      ? "Sin categorías todavía."
                      : "Guardá la supercategoría para asignarle categorías."
                  }
                />
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

function BasicFields() {
  const form = useFormContext<SuperCategoryInput>();
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Nombre</FormLabel>
            <FormControl>
              <Input
                autoFocus
                placeholder="ej: Tragos"
                {...field}
                onChange={(e) => {
                  field.onChange(e);
                  if (!form.getFieldState("slug").isDirty)
                    form.setValue("slug", slugFromName(e.target.value));
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="icon"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Ícono</FormLabel>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {SUPER_CATEGORY_ICONS.map((iconSlug) => {
                const IconOption = resolveSuperCategoryIcon(iconSlug);
                const isSelected = field.value === iconSlug;
                return (
                  <button
                    key={iconSlug}
                    type="button"
                    onClick={() => field.onChange(iconSlug)}
                    className={`flex h-10 w-10 items-center justify-center rounded-xl transition active:scale-[0.95] ${
                      isSelected
                        ? "bg-zinc-900 text-white"
                        : "bg-zinc-50 text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100"
                    }`}
                    aria-label={iconSlug}
                    aria-pressed={isSelected}
                  >
                    <IconOption className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="color"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Color</FormLabel>
            <div className="flex flex-wrap gap-2">
              {SUPER_CATEGORY_COLORS.map((colorSlug) => {
                const cc = COLOR_CLASSES[colorSlug];
                const isSelected = field.value === colorSlug;
                return (
                  <button
                    key={colorSlug}
                    type="button"
                    onClick={() => field.onChange(colorSlug)}
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${cc.bgStrong} transition active:scale-[0.95] ${
                      isSelected
                        ? "ring-2 ring-zinc-900 ring-offset-2"
                        : "ring-1 ring-black/5 ring-inset"
                    }`}
                    aria-label={colorSlug}
                    aria-pressed={isSelected}
                  >
                    <span
                      className={`h-3 w-3 rounded-full ${cc.text} bg-current`}
                    />
                  </button>
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Avanzado: el slug se autogenera del nombre. */}
      <details
        className="text-[12.5px] text-zinc-500"
        open={!!form.formState.errors.slug || undefined}
      >
        <summary className="w-max cursor-pointer">Avanzado</summary>
        <div className="mt-2.5">
          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Dirección en la carta</FormLabel>
                <FormControl>
                  <Input placeholder="tragos" {...field} />
                </FormControl>
                <p className="text-muted-foreground text-xs">
                  Se genera sola del nombre. Cambiala sólo si ya compartiste el
                  link.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </details>
    </div>
  );
}

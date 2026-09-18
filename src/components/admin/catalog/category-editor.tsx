"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFormContext, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SuperCategoryAvatar } from "@/components/super-categories/visual";
import { Thumb } from "@/components/admin/catalog/product-bits";
import { slugFromName } from "@/components/admin/catalog/product-fields";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import {
  useCatalogEditor,
  type CatalogEditorProps,
} from "@/components/admin/catalog/ui/editor-host";
import {
  EditorLinkList,
  EditorSectionHeading,
  EntityEditor,
  useEditorGuard,
} from "@/components/admin/catalog/ui/entity-editor";
import type { AdminCategory } from "@/lib/admin/catalog-query";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/lib/catalog/category-actions";
import { CategoryInput } from "@/lib/catalog/schemas";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

const NO_SUPER = "__none__";

/**
 * Editor de categoría (spec 205 · D7). Mismo patrón que `ProductEditor`: tres
 * secciones (Básico · Comanda · Productos), Guardar no cierra, mismo schema y
 * actions que el `CategoryDialog` que reemplaza (D5).
 */
export function CategoryEditor(props: CatalogEditorProps) {
  const { categories } = useCatalogData();
  const category = props.id
    ? categories.find((c) => c.id === props.id)
    : undefined;
  // Recién creada: el id llega antes que la fila del refresh.
  if (props.id && !category) {
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
  return <CategoryEditorForm {...props} category={category} />;
}

function categoryDefaults(
  category?: AdminCategory,
  draft?: Partial<CategoryInput>,
): CategoryInput {
  if (!category) {
    return {
      name: "",
      slug: "",
      sort_order: 0,
      super_category_id: null,
      station_id: null,
      extra_station_ids: [],
      ...draft,
    };
  }
  return {
    name: category.name,
    slug: category.slug,
    sort_order: category.sort_order,
    super_category_id: category.super_category_id,
    station_id: category.station_id,
    extra_station_ids: category.extra_station_ids ?? [],
  };
}

function CategoryEditorForm({
  id,
  section,
  draft,
  nav,
  back,
  onClose,
  openLinked,
  onCreated,
  category,
}: CatalogEditorProps & { category: AdminCategory | undefined }) {
  const { slug, superCategories, stations, products } = useCatalogData();
  const editor = useCatalogEditor();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const form = useForm<CategoryInput>({
    resolver: zodResolver(CategoryInput),
    defaultValues: categoryDefaults(category, draft as Partial<CategoryInput>),
  });
  const { isDirty } = form.formState;

  const formId = `categoria-${id ?? "nueva"}`;
  const onSubmit = async (values: CategoryInput) => {
    setSaving(true);
    try {
      const result = category
        ? await updateCategory(slug, category.id, values)
        : await createCategory(slug, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(category ? "Actualizada." : "Creada.");
      form.reset(values);
      setSaved(true);
      router.refresh();
      if (!id) onCreated(result.data.id);
    } finally {
      setSaving(false);
    }
  };

  const name = useWatch({ control: form.control, name: "name" });
  const superCategoryId = useWatch({
    control: form.control,
    name: "super_category_id",
  });
  const sup = superCategoryId
    ? (superCategories.find((s) => s.id === superCategoryId) ?? null)
    : null;

  const productsInCategory = category
    ? products.filter((p) => p.category_id === category.id)
    : [];
  const ownStation = productsInCategory.filter((p) => p.station_id);

  return (
    <Form {...form}>
      <EntityEditor
        onClose={onClose}
        nav={nav}
        back={back}
        initialSection={section}
        eyebrow={`Categoría · ${sup ? sup.name : "sin supercategoría"}`}
        title={name || category?.name || "Nueva categoría"}
        thumb={
          category ? (
            <Thumb label={category.name} seed={category.id} size={36} />
          ) : undefined
        }
        meta={
          category ? (
            <span className="rounded-full bg-zinc-100 px-2 py-px text-[11px] font-semibold text-zinc-700 tabular-nums">
              {productsInCategory.length}{" "}
              {productsInCategory.length === 1 ? "producto" : "productos"}
            </span>
          ) : undefined
        }
        dirty={isDirty}
        saving={saving}
        saved={saved}
        formId={formId}
        saveLabel={category ? "Guardar" : "Crear"}
        destructive={
          category ? (
            <CatalogDeleteButton
              label="Eliminar"
              confirmMessage="¿Borrar la categoría? Sus productos quedan sin categoría."
              onDelete={async () => {
                const r = await deleteCategory(slug, category.id);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Borrada.");
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
                  description="Nombre y a qué supercategoría pertenece."
                />
                <BasicFields
                  superCategories={superCategories}
                  hint={
                    sup ? (
                      <SuperCategoryLink
                        name={sup.name}
                        onOpen={() =>
                          openLinked({ kind: "superCategory", id: sup.id })
                        }
                      />
                    ) : undefined
                  }
                />
              </>
            ),
          },
          {
            id: "comanda",
            label: "Comanda",
            content: (
              <>
                <EditorSectionHeading
                  title="Comanda por defecto"
                  description="Todos los productos de la categoría salen acá, salvo los que tengan sector propio."
                />
                <KitchenFields stations={stations} />
                {ownStation.length > 0 && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                    <p className="text-[12.5px] font-semibold text-amber-900">
                      {ownStation.length}{" "}
                      {ownStation.length === 1
                        ? "producto tiene"
                        : "productos tienen"}{" "}
                      sector propio
                    </p>
                    <p className="mt-0.5 text-[12px] text-amber-800">
                      {ownStation.map((p) => p.name).join(", ")}
                    </p>
                  </div>
                )}
              </>
            ),
          },
          {
            id: "productos",
            label: "Productos",
            count: productsInCategory.length,
            content: (
              <>
                <EditorSectionHeading
                  title="Productos"
                  description="En el orden en que aparecen en la carta. Tocá uno para editarlo."
                />
                <EditorLinkList
                  items={productsInCategory.map((p) => ({
                    key: p.id,
                    label: p.name,
                    meta: formatCurrency(p.price_cents),
                    onOpen: () => openLinked({ kind: "product", id: p.id }),
                  }))}
                  empty="Sin productos en esta categoría todavía."
                />
                {category ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full justify-center"
                    onClick={() =>
                      editor.create("product", { category_id: category.id })
                    }
                  >
                    <Plus /> Nuevo producto en {category.name}
                  </Button>
                ) : (
                  <p className="mt-3 text-[12.5px] text-zinc-500">
                    Creá la categoría para agregarle productos.
                  </p>
                )}
              </>
            ),
          },
        ]}
      >
        {/* El submit: los campos viven en las secciones, fuera de este <form>. */}
        <form id={formId} hidden onSubmit={form.handleSubmit(onSubmit)} />
      </EntityEditor>
    </Form>
  );
}

function BasicFields({
  superCategories,
  hint,
}: {
  superCategories: { id: string; name: string; icon: string; color: string }[];
  hint?: React.ReactNode;
}) {
  const form = useFormContextCategory();
  return (
    <div className="space-y-4">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input
                  autoFocus
                  placeholder="ej: Pizzas"
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
          name="super_category_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Supercategoría</FormLabel>
              <FormControl>
                <Select
                  value={field.value ?? NO_SUPER}
                  onValueChange={(v) =>
                    field.onChange(v === NO_SUPER ? null : v)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sin asignar">
                      {(value) => {
                        if (!value || value === NO_SUPER) return "Sin asignar";
                        return (
                          superCategories.find((s) => s.id === value)?.name ??
                          "Sin asignar"
                        );
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SUPER}>
                      <span className="text-zinc-500">Sin asignar</span>
                    </SelectItem>
                    {superCategories.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          <SuperCategoryAvatar
                            icon={s.icon}
                            color={s.color}
                            size="sm"
                          />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              {hint}
              <p className="text-muted-foreground text-xs">
                La pestaña de la carta donde aparece esta categoría.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Avanzado: el slug se autogenera del nombre; sólo importa si ya se
          compartió el link. */}
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
                  <Input placeholder="pizzas" {...field} />
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

/** Chip on/off, igual que el de `product-fields.tsx` (no exportado ahí). */
function Chip({
  on,
  onClick,
  children,
  muted = false,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
        on
          ? "border-zinc-900 bg-zinc-900 text-white"
          : cn(
              "border-zinc-200 bg-white hover:bg-zinc-50",
              muted ? "text-zinc-500" : "text-zinc-700",
            ),
      )}
    >
      {children}
    </button>
  );
}

function KitchenFields({
  stations,
}: {
  stations: { id: string; name: string; is_active: boolean }[];
}) {
  const form = useFormContextCategory();
  const activas = stations.filter((s) => s.is_active);
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="station_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Sector</FormLabel>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Sector"
            >
              <Chip
                on={!field.value}
                muted
                onClick={() => field.onChange(null)}
              >
                No imprime
              </Chip>
              {activas.map((s) => (
                <Chip
                  key={s.id}
                  on={field.value === s.id}
                  onClick={() => field.onChange(s.id)}
                >
                  {s.name}
                </Chip>
              ))}
            </div>
          </FormItem>
        )}
      />

      {/* Spec 180 · 2ª y 3ª comandera, como en MaxiRest. */}
      <FormField
        control={form.control}
        name="extra_station_ids"
        render={({ field }) => {
          const valor: string[] = field.value ?? [];
          const toggle = (id: string) => {
            const next = valor.includes(id)
              ? valor.filter((x) => x !== id)
              : [...valor, id].slice(-2);
            field.onChange(next);
          };
          return (
            <FormItem>
              <FormLabel>También imprime en</FormLabel>
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="También imprime en"
              >
                {activas.map((s) => (
                  <Chip
                    key={s.id}
                    on={valor.includes(s.id)}
                    onClick={() => toggle(s.id)}
                  >
                    {s.name}
                  </Chip>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                2ª y 3ª comandera. Cada sector recibe su propia comanda.
              </p>
              <FormMessage />
            </FormItem>
          );
        }}
      />
    </div>
  );
}

function SuperCategoryLink({
  name,
  onOpen,
}: {
  name: string;
  onOpen: () => void;
}) {
  const guard = useEditorGuard();
  return (
    <button
      type="button"
      onClick={() => guard(onOpen)}
      className="mt-1 w-max text-xs font-medium text-sky-700 hover:underline"
    >
      Ver supercategoría {name} →
    </button>
  );
}

/**
 * Eliminar con confirmación inline en el footer — mismo patrón que
 * `ProductDeleteButton` (compact), reusado acá y en `super-category-editor.tsx`.
 */
export function CatalogDeleteButton({
  label,
  confirmMessage,
  onDelete,
}: {
  label: string;
  confirmMessage: string;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-rose-700">{confirmMessage}</span>
        <Button
          type="button"
          variant="destructive-solid"
          size="sm"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              await onDelete();
            } finally {
              setPending(false);
              setConfirming(false);
            }
          }}
        >
          Sí, borrar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="size-3.5" />
      {label}
    </Button>
  );
}

// `useFormContext` tipado a `CategoryInput` para los sub-componentes de esta
// pantalla (evita repetir el generic en cada uno).
function useFormContextCategory() {
  return useFormContext<CategoryInput>();
}

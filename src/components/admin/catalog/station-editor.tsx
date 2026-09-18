"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
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
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import type { CatalogEditorProps } from "@/components/admin/catalog/ui/editor-host";
import {
  EditorLinkList,
  EditorSectionHeading,
  EditorToggle,
  EntityEditor,
} from "@/components/admin/catalog/ui/entity-editor";
import type { AdminStation } from "@/lib/admin/catalog-query";
import {
  createStation,
  deleteStation,
  updateStation,
} from "@/lib/catalog/station-actions";
import {
  categoriesByDefaultStation,
  categoriesByExtraStation,
  productsWithOwnStation,
} from "@/lib/catalog/station-routing";
import { StationInput } from "@/lib/catalog/schemas";

/**
 * Editor de sector de cocina (spec 205 · D4/D6/D9). Reemplaza al
 * `StationDialog`: mismo schema, mismas actions. «Qué imprime» es la vista de
 * solo-lectura del ruteo (categorías que rutean, 2ª comanda, productos con
 * sector propio) que antes no existía en ningún lado.
 */
export function StationEditor(props: CatalogEditorProps) {
  const { stations } = useCatalogData();
  const station = props.id
    ? stations.find((s) => s.id === props.id)
    : undefined;
  if (props.id && !station) {
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
  return <StationEditorForm {...props} station={station} />;
}

function StationEditorForm({
  id,
  draft,
  nav,
  back,
  onClose,
  openLinked,
  onCreated,
  station,
}: CatalogEditorProps & { station: AdminStation | undefined }) {
  const { slug, categories, products } = useCatalogData();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const form = useForm<StationInput>({
    resolver: zodResolver(StationInput),
    defaultValues: station
      ? {
          name: station.name,
          sort_order: station.sort_order,
          is_active: station.is_active,
        }
      : ({
          name: "",
          sort_order: 0,
          is_active: true,
          ...(draft as Partial<StationInput>),
        } as StationInput),
  });
  const { isDirty } = form.formState;
  const name = form.watch("name");
  const isActive = form.watch("is_active");

  // Ruteo de esta estación: categorías cuyo default es este sector, las que lo
  // usan como 2ª/3ª comandera, y los productos que lo pisan con uno propio
  // (misma lógica que la grilla de tarjetas, en `lib/catalog/station-routing.ts`).
  const categoriasDeAca = useMemo(
    () =>
      station
        ? (categoriesByDefaultStation(categories).get(station.id) ?? [])
        : [],
    [categories, station],
  );
  const comandaExtraDe = useMemo(
    () =>
      station
        ? (categoriesByExtraStation(categories).get(station.id) ?? [])
        : [],
    [categories, station],
  );
  const productosPropios = useMemo(
    () =>
      station ? (productsWithOwnStation(products, categories).get(station.id) ?? []) : [],
    [products, station],
  );

  const formId = `sector-${id ?? "nuevo"}`;
  const onSubmit = async (values: StationInput) => {
    setSaving(true);
    try {
      const result = station
        ? await updateStation(slug, station.id, values)
        : await createStation(slug, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(station ? "Actualizado." : "Creado.");
      form.reset(values);
      setSaved(true);
      if (!id) onCreated(result.data.id);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!station) return;
    if (
      !window.confirm(
        `¿Eliminar el sector «${station.name}»? Los productos y categorías que rutean acá quedan sin sector.`,
      )
    )
      return;
    setDeleting(true);
    try {
      const r = await deleteStation(slug, station.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Sector borrado.");
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Form {...form}>
      <EntityEditor
        onClose={onClose}
        nav={nav}
        back={back}
        eyebrow="Sector de cocina"
        title={name || station?.name || "Nuevo sector"}
        dirty={isDirty}
        saving={saving}
        saved={saved}
        formId={formId}
        saveLabel={station ? "Guardar" : "Crear"}
        destructive={
          station ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
              onClick={onDelete}
              disabled={deleting}
            >
              <Trash2 className="size-3.5" />
              Eliminar
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
                  description="Es el título que sale arriba de la comanda impresa."
                />
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="max-w-sm">
                        <FormLabel>Nombre</FormLabel>
                        <FormControl>
                          <Input
                            autoFocus
                            placeholder="ej: Parrilla"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="is_active"
                    render={({ field }) => (
                      <EditorToggle
                        title="Activo"
                        description="Si lo desactivás, no se podrán rutear nuevas comandas acá. Útil para un sector que rota por turno sin perder el histórico."
                        control={
                          <Switch
                            aria-label="Activo"
                            checked={field.value}
                            onCheckedChange={(on) => field.onChange(on)}
                          />
                        }
                      />
                    )}
                  />
                  {!isActive && (
                    <p className="text-[12.5px] text-amber-700">
                      Inactivo: las categorías y productos que ruteaban acá
                      quedan sin comanda hasta que lo reactivés o les asignes
                      otro sector.
                    </p>
                  )}
                </div>
              </>
            ),
          },
          {
            id: "ruteo",
            label: "Qué imprime",
            content: station ? (
              <>
                <EditorSectionHeading
                  title="Qué imprime acá"
                  description="Se cambia desde cada categoría o producto; acá se ve todo junto."
                />
                <div className="space-y-4">
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                      Categorías (sector principal)
                    </p>
                    <EditorLinkList
                      empty="Ninguna categoría rutea acá por defecto."
                      items={categoriasDeAca.map((c) => ({
                        key: c.id,
                        label: c.name,
                        meta: `${products.filter((p) => p.category_id === c.id).length} productos`,
                        onOpen: () =>
                          openLinked({ kind: "category", id: c.id }),
                      }))}
                    />
                  </div>

                  {comandaExtraDe.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                        Como 2ª/3ª comanda
                      </p>
                      <EditorLinkList
                        items={comandaExtraDe.map((c) => ({
                          key: c.id,
                          label: c.name,
                          meta: "2ª comandera",
                          onOpen: () =>
                            openLinked({ kind: "category", id: c.id }),
                        }))}
                      />
                    </div>
                  )}

                  {productosPropios.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                        Productos con sector propio
                      </p>
                      <EditorLinkList
                        items={productosPropios.map((p) => ({
                          key: p.id,
                          label: p.name,
                          meta: categories.find((c) => c.id === p.category_id)
                            ?.name,
                          onOpen: () =>
                            openLinked({ kind: "product", id: p.id }),
                        }))}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-zinc-500">
                Guardá el sector para ver qué categorías y productos rutean acá.
              </p>
            ),
          },
        ]}
      >
        <form id={formId} hidden onSubmit={form.handleSubmit(onSubmit)} />
      </EntityEditor>
    </Form>
  );
}

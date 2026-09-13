"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUploader } from "@/components/admin/catalog/image-uploader";
import { ModifierGroupsEditor } from "@/components/admin/catalog/modifier-groups-editor";
import { PrecioField } from "@/components/admin/catalog/pesos-input";
import type {
  AdminCategory,
  AdminProduct,
  AdminStation,
} from "@/lib/admin/catalog-query";
import { createProduct, updateProduct } from "@/lib/catalog/product-actions";
import { ProductInput } from "@/lib/catalog/schemas";

export function ProductForm({
  slug,
  businessId,
  categories,
  stations = [],
  product,
  onSuccess,
  onCancel,
  hideActions = false,
  formId,
}: {
  slug: string;
  businessId: string;
  categories: AdminCategory[];
  stations?: AdminStation[];
  product?: AdminProduct;
  onSuccess?: () => void;
  onCancel?: () => void;
  hideActions?: boolean;
  formId?: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ProductInput>({
    resolver: zodResolver(ProductInput),
    defaultValues: product
      ? {
          name: product.name,
          slug: product.slug,
          description: product.description ?? undefined,
          // El formulario trabaja en CENTAVOS, igual que la base y que el zod
          // que lo valida. Antes dividía por 100 acá y multiplicaba al enviar,
          // y esa ida y vuelta por pesos era la que obligaba a parsear el campo
          // con `parseInt` (el schema pide entero) — de ahí salía el $18.
          price_cents: product.price_cents,
          image_url: product.image_url,
          category_id: product.category_id,
          station_id: product.station_id,
          extra_station_ids: product.extra_station_ids,
          sin_comanda: product.sin_comanda,
          is_available: product.is_available,
          is_active: product.is_active,
          show_online: product.show_online,
          sort_order: product.sort_order,
          prep_time_minutes: product.prep_time_minutes,
          modifier_groups: product.modifier_groups.map((g) => ({
            id: g.id,
            name: g.name,
            min_selection: g.min_selection,
            max_selection: g.max_selection,
            is_required: g.is_required,
            sort_order: g.sort_order,
            modifiers: g.modifiers.map((m) => ({
              id: m.id,
              name: m.name,
              price_delta_cents: m.price_delta_cents,
              is_available: m.is_available,
              sort_order: m.sort_order,
            })),
          })),
        }
      : {
          name: "",
          slug: "",
          // Vacío, no cero: el alta con el campo sin tocar creaba el producto
          // en $0 y nadie se enteraba hasta que el mozo lo cobrara. NaN no pasa
          // el zod, así que el formulario se planta y pide el precio. Un
          // producto de cortesía a $0 sigue siendo posible: se escribe el 0.
          price_cents: Number.NaN,
          station_id: null,
          extra_station_ids: null,
          sin_comanda: false,
          is_available: true,
          is_active: true,
          show_online: true,
          sort_order: 0,
          prep_time_minutes: null,
          modifier_groups: [],
        },
  });

  const onSubmit = async (values: ProductInput) => {
    setSubmitting(true);
    try {
      // Los importes ya vienen en centavos desde el campo: no hay conversión
      // que redondear acá. El `Math.round(pesos * 100)` que había era la otra
      // mitad del hallazgo 3 — lo que llegaba mal parseado se guardaba igual.
      const payload: ProductInput = values;
      const result = product
        ? await updateProduct(slug, product.id, payload)
        : await createProduct(slug, payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(product ? "Actualizado." : "Creado.");
      if (result.data.warnings?.length) {
        for (const w of result.data.warnings) {
          toast.warning(w);
        }
      }
      router.refresh();
      if (onSuccess) {
        onSuccess();
      } else {
        router.push(`/${slug}/admin/catalogo`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="image_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Imagen</FormLabel>
              <FormControl>
                <ImageUploader
                  businessId={businessId}
                  value={field.value ?? null}
                  onChange={(url) => field.onChange(url)}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Slug</FormLabel>
                <FormControl>
                  <Input placeholder="muzzarella" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} value={field.value ?? ""} />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <PrecioField
            control={form.control}
            name="price_cents"
            label="Precio base ($)"
            hint={
              <p className="text-muted-foreground text-xs">
                Sin adicionales. Los grupos de adicionales se suman sobre este
                precio. Se escribe como se habla: 18.500 o 18.500,50.
              </p>
            }
          />
          <FormField
            control={form.control}
            name="category_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Categoría</FormLabel>
                <FormControl>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(v) => field.onChange(v || null)}
                  >
                    <SelectTrigger>
                      {/*
                        Base UI's SelectValue shows the raw value by default
                        (a UUID in our case). We resolve id → name via the
                        children render function so the trigger shows "Pizzas"
                        instead of "ab23-..."; falls back to null so the
                        placeholder renders for empty/unknown selections.
                      */}
                      <SelectValue placeholder="Elegí">
                        {(value) => {
                          if (!value) return null;
                          return (
                            categories.find((c) => c.id === value)?.name ?? null
                          );
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {/* Sector de cocina · null = hereda de la categoría */}
        <FormField
          control={form.control}
          name="station_id"
          render={({ field }) => {
            // Resolvemos el sector heredado de la categoría seleccionada para
            // que el placeholder ("Hereda de Pizzas → Cocina") sea informativo.
            const currentCategoryId = form.watch("category_id");
            const inherited = currentCategoryId
              ? (categories.find((c) => c.id === currentCategoryId) ?? null)
              : null;
            const inheritedStation = inherited?.station_id
              ? (stations.find((s) => s.id === inherited.station_id) ?? null)
              : null;

            return (
              <FormItem>
                <FormLabel>Sector de cocina</FormLabel>
                <FormControl>
                  <Select
                    value={field.value ?? "__inherit__"}
                    onValueChange={(v) =>
                      field.onChange(v === "__inherit__" ? null : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(value) => {
                          if (!value || value === "__inherit__") {
                            return inheritedStation
                              ? `Hereda · ${inheritedStation.name}`
                              : "Hereda de la categoría";
                          }
                          return (
                            stations.find((s) => s.id === value)?.name ?? null
                          );
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__inherit__">
                        <span className="text-zinc-500">
                          {inheritedStation
                            ? `Hereda · ${inheritedStation.name}`
                            : "Hereda de la categoría"}
                        </span>
                      </SelectItem>
                      {stations
                        .filter((s) => s.is_active)
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <p className="text-muted-foreground text-xs">
                  A qué sector se imprime la comanda. Si no especificás, hereda
                  el de la categoría. Override útil cuando un producto sale de
                  otro sector (ej: papas en categoría Cocina pero rutean a
                  Fritera).
                </p>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        {/* Spec 180 · varias comanderas por producto. Es lo que en MaxiRest es
            «2ª/3ª Comandera»: cocina «sale con todo» porque es la 2ª de cada
            plato. La 1ª (arriba) es la que cocina y mueve el estado; éstas
            reciben su propia comanda. null = hereda de la categoría. */}
        <FormField
          control={form.control}
          name="extra_station_ids"
          render={({ field }) => {
            const currentCategoryId = form.watch("category_id");
            const cat = currentCategoryId
              ? (categories.find((c) => c.id === currentCategoryId) ?? null)
              : null;
            const heredadas = cat?.extra_station_ids ?? [];
            const nombre = (id: string) =>
              stations.find((s) => s.id === id)?.name ?? "?";
            const hereda = field.value === null || field.value === undefined;
            const valor: string[] = hereda ? heredadas : (field.value ?? []);
            const setPos = (pos: 0 | 1, id: string | null) => {
              const base = [...valor];
              if (id === null) base.splice(pos, 1);
              else base[pos] = id;
              field.onChange(base.filter(Boolean).slice(0, 2));
            };
            return (
              <FormItem>
                <FormLabel>También imprime en</FormLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([0, 1] as const).map((pos) => (
                    <Select
                      key={pos}
                      value={valor[pos] ?? "__none__"}
                      onValueChange={(v) => setPos(pos, v === "__none__" ? null : v)}
                    >
                      <SelectTrigger aria-label={pos === 0 ? "2ª comandera" : "3ª comandera"}>
                        <SelectValue>
                          {(v) =>
                            !v || v === "__none__"
                              ? `${pos === 0 ? "2ª" : "3ª"} · ninguna`
                              : `${pos === 0 ? "2ª" : "3ª"} · ${nombre(String(v))}`
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          <span className="text-zinc-500">Ninguna</span>
                        </SelectItem>
                        {stations
                          .filter((s) => s.is_active)
                          .map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  {hereda
                    ? heredadas.length > 0
                      ? `Hereda de la categoría: ${heredadas.map(nombre).join(", ")}. Tocá para pisar.`
                      : "Hereda de la categoría (ninguna). Tocá para agregar."
                    : "Propio de este producto."}{" "}
                  Cada sector recibe su propia comanda; el estado del plato lo
                  mueve el sector de cocina de arriba.
                  {!hereda && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => field.onChange(null)}
                      >
                        Volver a heredar
                      </button>
                    </>
                  )}
                </p>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <FormField
          control={form.control}
          name="sin_comanda"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={field.value ?? false}
                    onChange={(e) => field.onChange(e.target.checked)}
                  />
                  <span>No imprime comanda</span>
                </label>
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Aunque la categoría tenga sector. Para lo que el mozo sirve
                directo: la Heineken, el alfajor.
              </p>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="prep_time_minutes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tiempo de preparación (minutos)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  placeholder="—"
                  value={field.value ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    field.onChange(v === "" ? null : parseInt(v) || null);
                  }}
                />
              </FormControl>
              <p className="text-muted-foreground text-xs">
                Opcional. Tiempo estimado de preparación para cálculo de ETA en
                cocina.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-4">
          <FormField
            control={form.control}
            name="is_available"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                    <span>Disponible ahora</span>
                  </label>
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="is_active"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                    <span>Activo (visible en el menú)</span>
                  </label>
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="show_online"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                    <span>Mostrar en la carta online</span>
                  </label>
                </FormControl>
              </FormItem>
            )}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Si desmarcás <strong>Mostrar en la carta online</strong>, el producto
          desaparece de la carta que ve el cliente pero el mozo lo sigue
          teniendo para cargar en la mesa.
        </p>

        <ModifierGroupsEditor />

        {!hideActions && (
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
        )}
      </form>
    </Form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUploader } from "@/components/admin/catalog/image-uploader";
import { PrecioField } from "@/components/admin/catalog/pesos-input";
import { EditorToggle } from "@/components/admin/catalog/ui/entity-editor";
import type {
  AdminCategory,
  AdminProduct,
  AdminStation,
} from "@/lib/admin/catalog-query";
import { createProduct, updateProduct } from "@/lib/catalog/product-actions";
import type { ProductInput } from "@/lib/catalog/schemas";
import { cn } from "@/lib/utils";

/**
 * Los campos del producto, partidos en las secciones del editor (spec 205 ·
 * D4). Los usan el editor en modal (una sección por bloque, con índice) y la
 * página `/productos/[id]` (todo seguido). Todos leen el form del contexto;
 * el schema y las actions son los de siempre (D5).
 */

// ─── Estado del form ────────────────────────────────────────────────────────

export function productDefaults(
  product?: AdminProduct,
  draft?: Partial<ProductInput>,
): ProductInput {
  if (!product) {
    return {
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
      ...draft,
    } as ProductInput;
  }
  return {
    name: product.name,
    slug: product.slug,
    description: product.description ?? undefined,
    // El formulario trabaja en CENTAVOS, igual que la base y que el zod que lo
    // valida (hallazgo 3: la ida y vuelta por pesos fue la que dejó un asado a $18).
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
  };
}

/** Del nombre a la dirección en la carta: «Bife de Chorizo» → «bife-de-chorizo». */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Guarda (crea o actualiza) con los avisos de siempre. Devuelve el id si salió
 * bien, `null` si no. Los importes ya vienen en centavos desde el campo.
 */
export function useSaveProduct(slug: string, product?: AdminProduct) {
  const router = useRouter();
  return async (values: ProductInput): Promise<string | null> => {
    const result = product
      ? await updateProduct(slug, product.id, values)
      : await createProduct(slug, values);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    toast.success(product ? "Actualizado." : "Creado.");
    for (const w of result.data.warnings ?? []) toast.warning(w);
    router.refresh();
    return result.data.id;
  };
}

// ─── Básico ─────────────────────────────────────────────────────────────────

export function ProductBasicsFields({
  businessId,
  categories,
  slugPlacement = "advanced",
  categoryHint,
}: {
  businessId: string;
  categories: AdminCategory[];
  /** `"inline"` lo muestra al lado del nombre (la página); `"advanced"` lo esconde. */
  slugPlacement?: "inline" | "advanced";
  /** Debajo de la categoría (ej. el link «Ver categoría»). */
  categoryHint?: React.ReactNode;
}) {
  const form = useFormContext<ProductInput>();
  const slugField = (
    <FormField
      control={form.control}
      name="slug"
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {slugPlacement === "inline" ? "Slug" : "Dirección en la carta"}
          </FormLabel>
          <FormControl>
            <Input placeholder="muzzarella" {...field} />
          </FormControl>
          {slugPlacement === "advanced" && (
            <p className="text-muted-foreground text-xs">
              Se genera sola del nombre. Cambiala sólo si ya compartiste el
              link.
            </p>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="space-y-4">
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

      <div className="grid gap-3.5 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    // El slug acompaña al nombre mientras nadie lo toque a mano.
                    if (
                      slugPlacement === "advanced" &&
                      !form.getFieldState("slug").isDirty
                    ) {
                      form.setValue("slug", slugFromName(e.target.value));
                    }
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {slugPlacement === "inline" ? (
          slugField
        ) : (
          <CategorySelect categories={categories} hint={categoryHint} />
        )}
      </div>

      {slugPlacement === "inline" && (
        <CategorySelect categories={categories} hint={categoryHint} />
      )}

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Descripción</FormLabel>
            <FormControl>
              <Textarea rows={2} {...field} value={field.value ?? ""} />
            </FormControl>
          </FormItem>
        )}
      />

      {slugPlacement === "advanced" && (
        <details
          className="text-[12.5px] text-zinc-500"
          // Si el slug tiene un error, abrir el desplegable para que se vea.
          open={!!form.formState.errors.slug || undefined}
        >
          <summary className="w-max cursor-pointer">Avanzado</summary>
          <div className="mt-2.5">{slugField}</div>
        </details>
      )}
    </div>
  );
}

function CategorySelect({
  categories,
  hint,
}: {
  categories: AdminCategory[];
  hint?: React.ReactNode;
}) {
  const form = useFormContext<ProductInput>();
  return (
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
              <SelectTrigger className="w-full">
                {/* SelectValue de Base UI muestra el id crudo: lo resolvemos a nombre. */}
                <SelectValue placeholder="Elegí">
                  {(value) =>
                    value
                      ? (categories.find((c) => c.id === value)?.name ?? null)
                      : null
                  }
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
          {hint}
        </FormItem>
      )}
    />
  );
}

// ─── Precio ─────────────────────────────────────────────────────────────────

export function ProductPriceField() {
  const form = useFormContext<ProductInput>();
  return (
    <div className="max-w-xs">
      <PrecioField
        control={form.control}
        name="price_cents"
        label="Precio base ($)"
        hint={
          <p className="text-muted-foreground text-xs">
            Sin adicionales. Se escribe como se habla: 18.500 o 18.500,50.
          </p>
        }
      />
    </div>
  );
}

// ─── Cocina e impresión ─────────────────────────────────────────────────────

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

export function ProductKitchenFields({
  categories,
  stations,
}: {
  categories: AdminCategory[];
  stations: AdminStation[];
}) {
  const form = useFormContext<ProductInput>();
  const categoryId = useWatch({ control: form.control, name: "category_id" });
  const sinComanda = useWatch({ control: form.control, name: "sin_comanda" });
  const cat = categoryId
    ? (categories.find((c) => c.id === categoryId) ?? null)
    : null;
  const activas = stations.filter((s) => s.is_active);
  const nombre = (id: string) => stations.find((s) => s.id === id)?.name ?? "?";
  const heredado = cat?.station_id ? nombre(cat.station_id) : null;

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="sin_comanda"
        render={({ field }) => (
          <EditorToggle
            title="Imprime comanda"
            description="Apagalo para lo que el mozo sirve directo: la Heineken, el alfajor. Aunque la categoría tenga sector."
            control={
              <Switch
                aria-label="Imprime comanda"
                checked={!field.value}
                onCheckedChange={(on) => field.onChange(!on)}
              />
            }
          />
        )}
      />

      {!sinComanda && (
        <>
          <FormField
            control={form.control}
            name="station_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Sector principal</FormLabel>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Sector principal"
                >
                  <Chip
                    on={!field.value}
                    muted
                    onClick={() => field.onChange(null)}
                  >
                    Hereda · {heredado ?? "de la categoría"}
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
                <p className="text-muted-foreground text-xs">
                  Es el que cocina y mueve el estado del plato. Pisalo cuando el
                  producto sale de otro sector que su categoría (papas →
                  Fritera).
                </p>
              </FormItem>
            )}
          />

          {/* Spec 180 · «2ª/3ª comandera» de MaxiRest. null = hereda de la categoría. */}
          <FormField
            control={form.control}
            name="extra_station_ids"
            render={({ field }) => {
              const heredadas = cat?.extra_station_ids ?? [];
              const hereda = field.value == null;
              const valor: string[] = hereda ? heredadas : (field.value ?? []);
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
                    {hereda
                      ? heredadas.length > 0
                        ? `Hereda de la categoría: ${heredadas.map(nombre).join(", ")}.`
                        : "Hereda de la categoría (ninguna)."
                      : "Propio de este producto."}{" "}
                    Hasta dos; cada sector recibe su propia comanda.
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
        </>
      )}

      <FormField
        control={form.control}
        name="prep_time_minutes"
        render={({ field }) => (
          <FormItem className="max-w-[200px]">
            <FormLabel>Tiempo de preparación</FormLabel>
            <div className="relative">
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  placeholder="—"
                  className="pr-12"
                  value={field.value ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    field.onChange(v === "" ? null : parseInt(v) || null);
                  }}
                />
              </FormControl>
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-zinc-500">
                min
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              Opcional. Para el ETA de cocina.
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// ─── Visibilidad ────────────────────────────────────────────────────────────

// Issue #365: los encargados no distinguían los tres. Cada uno dice cuándo
// usarlo y, debajo, qué pasa **ahora** según su estado (cambia al tocarlo).
// Lo que describen es el comportamiento real:
// - `is_available` off → el catálogo del mozo lo filtra (`mozo/catalog-query.ts`)
//   y la carta online lo muestra «agotado» (`menu/product-card.tsx`).
// - `show_online` off → sólo lo saca de la carta online (`lib/menu.ts`).
// - `is_active` off → sale de todos lados; las ventas viejas quedan.
const VISIBILITY = [
  {
    name: "is_available",
    title: "Hay para vender hoy",
    description:
      "Apagalo cuando se acaba en el servicio («se terminó el salmón») y prendelo de nuevo cuando vuelva.",
    on: "El mozo lo carga y la carta lo ofrece.",
    off: "El mozo no lo ve; en la carta online sale como «agotado».",
    highlight: true,
  },
  {
    name: "show_online",
    title: "Se ve en la carta online (QR y pedidos)",
    description: "Apagalo para lo que sólo se pide en el salón.",
    on: "Los clientes lo ven en la carta online.",
    off: "Los clientes no lo ven; el mozo lo carga igual.",
  },
  {
    name: "is_active",
    title: "Sigue en la carta del local",
    description:
      "Apagalo sólo si ya no se vende más. Las ventas viejas no se pierden.",
    on: "Está en uso.",
    off: "No aparece para el mozo ni en la carta. Queda guardado por su historial.",
  },
] as const;

export function ProductVisibilityFields() {
  const form = useFormContext<ProductInput>();
  return (
    <div className="grid gap-2">
      {VISIBILITY.map((v) => (
        <FormField
          key={v.name}
          control={form.control}
          name={v.name}
          render={({ field }) => (
            <EditorToggle
              title={v.title}
              description={
                <>
                  {v.description}
                  <span className="mt-1 block font-medium text-zinc-700">
                    Ahora: {field.value ? v.on : v.off}
                  </span>
                </>
              }
              highlight={"highlight" in v}
              control={
                <Switch
                  aria-label={v.title}
                  checked={!!field.value}
                  onCheckedChange={(on) => field.onChange(on)}
                />
              }
            />
          )}
        />
      ))}
    </div>
  );
}

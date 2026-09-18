"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFormContext, useWatch } from "react-hook-form";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploader } from "@/components/admin/catalog/image-uploader";
import { EditorToggle } from "@/components/admin/catalog/ui/entity-editor";
import { ProductPicker } from "@/components/admin/daily-menus/product-picker";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";
import {
  createDailyMenu,
  updateDailyMenu,
} from "@/lib/daily-menus/daily-menu-actions";
import {
  avisosDeModificadores,
  grupoQueDuplica,
  type ProductModifierGroup,
} from "@/lib/daily-menus/daily-menu-modifiers";
import {
  addOption,
  moveCard,
  moveOption,
  normalize,
  pruneBlocks,
  removeGroup,
  toCards,
} from "@/lib/daily-menus/component-order";
import {
  DailyMenuInput,
  type DailyMenuComponentInput,
} from "@/lib/daily-menus/schemas";
import { slugFromName } from "@/components/admin/catalog/product-fields";
import { cn } from "@/lib/utils";

/**
 * Campos del menú del día, partidos en las secciones del editor (spec 205 ·
 * D8), igual que `product-fields.tsx` con los de producto. Los usa el editor
 * en modal (`MenuEditor`) y la página `/menu-del-dia/[id]` (todo seguido, para
 * los links directos). Mismo schema y mismas actions que siempre (D5): acá
 * sólo se reparte lo que antes vivía junto en `DailyMenuForm`.
 */

// ─── Estado del form ────────────────────────────────────────────────────────

// Orden L..D para que la lectura sea natural (empezar por Lunes).
export const DAY_OPTIONS: { dow: number; label: string }[] = [
  { dow: 1, label: "Lun" },
  { dow: 2, label: "Mar" },
  { dow: 3, label: "Mié" },
  { dow: 4, label: "Jue" },
  { dow: 5, label: "Vie" },
  { dow: 6, label: "Sáb" },
  { dow: 0, label: "Dom" },
];

export function dailyMenuDefaults(
  menu?: AdminDailyMenu,
  draft?: Partial<DailyMenuInput>,
): DailyMenuInput {
  if (!menu) {
    return {
      name: "",
      slug: "",
      price_cents: 0,
      available_days: [1, 2, 3, 4, 5],
      is_active: true,
      is_available: true,
      sort_order: 0,
      display_context: "both",
      is_suggestion: false,
      components: [{ label: "", kind: "text" as const }],
      choice_groups: [],
      ...draft,
    } as DailyMenuInput;
  }
  return {
    name: menu.name,
    slug: menu.slug,
    description: menu.description ?? undefined,
    // El form trabaja en PESOS (como siempre trabajó este formulario);
    // `useSaveDailyMenu` hace la ida a centavos al guardar.
    price_cents: menu.price_cents / 100,
    image_url: menu.image_url,
    available_days: menu.available_days,
    is_active: menu.is_active,
    is_available: menu.is_available,
    sort_order: menu.sort_order,
    display_context: menu.display_context,
    is_suggestion: menu.is_suggestion,
    // `normalize` deja las opciones de cada grupo contiguas (spec 076, FR-005).
    components: normalize(
      menu.components.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description ?? undefined,
        kind: c.kind ?? "text",
        product_id: c.product_id,
        choice_group_id: c.choice_group_id,
        choice_group_label: c.choice_group_label,
        extra_price_cents: (c.extra_price_cents ?? 0) / 100,
        ignored_modifier_group_ids: c.ignored_modifier_group_ids ?? [],
      })),
    ),
    choice_groups: menu.choice_groups.map((g) => ({
      id: g.id,
      name: g.name,
      applies_when_group_id: g.applies_when_group_id,
      applies_when_product_ids: g.applies_when_product_ids,
    })),
  };
}

/** Los nombres/modificadores de los productos ya elegidos, para precargar el
 *  picker y los avisos (spec 148) sin volver a buscarlos. */
export function dailyMenuProductMaps(menu?: AdminDailyMenu) {
  const names = new Map<string, string>();
  const modifiers = new Map<string, ProductModifierGroup[]>();
  if (menu) {
    for (const c of menu.components) {
      if (c.product_id && c.product_name)
        names.set(c.product_id, c.product_name);
      if (c.product_id) modifiers.set(c.product_id, c.product_modifier_groups);
    }
  }
  return { names, modifiers };
}

/**
 * Guarda (crea o actualiza) con los avisos de siempre. Devuelve el id si salió
 * bien, `null` si no. El precio y los adicionales viajan en pesos en el form;
 * acá se pasan a centavos, que es lo que valida el schema y guarda la base.
 */
export function useSaveDailyMenu(slug: string, menu?: AdminDailyMenu) {
  const router = useRouter();
  return async (values: DailyMenuInput): Promise<string | null> => {
    const payload: DailyMenuInput = {
      ...values,
      price_cents: Math.round(values.price_cents * 100),
      components: values.components.map((c) => ({
        ...c,
        extra_price_cents: Math.round((c.extra_price_cents ?? 0) * 100),
      })),
    };
    const result = menu
      ? await updateDailyMenu(slug, menu.id, payload)
      : await createDailyMenu(slug, payload);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    toast.success(menu ? "Actualizado." : "Creado.");
    router.refresh();
    return result.data.id;
  };
}

// ─── Básico ─────────────────────────────────────────────────────────────────

export function DailyMenuBasicsFields({
  businessId,
  slugPlacement = "advanced",
}: {
  businessId: string;
  /** `"inline"` lo muestra al lado del nombre (la página); `"advanced"` lo esconde. */
  slugPlacement?: "inline" | "advanced";
}) {
  const form = useFormContext<DailyMenuInput>();
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
            <Input placeholder="menu-ejecutivo" {...field} />
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
                pathPrefix="daily-menu"
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
                  placeholder="Menú Ejecutivo"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
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
        {slugPlacement === "inline" ? slugField : <DailyMenuPriceField />}
      </div>

      {slugPlacement === "inline" && <DailyMenuPriceField />}

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Descripción (opcional)</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                placeholder="Texto breve que ve el cliente al abrir el menú."
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
          </FormItem>
        )}
      />

      {slugPlacement === "advanced" && (
        <details
          className="text-[12.5px] text-zinc-500"
          open={!!form.formState.errors.slug || undefined}
        >
          <summary className="w-max cursor-pointer">Avanzado</summary>
          <div className="mt-2.5">{slugField}</div>
        </details>
      )}
    </div>
  );
}

export function DailyMenuPriceField() {
  const form = useFormContext<DailyMenuInput>();
  return (
    <FormField
      control={form.control}
      name="price_cents"
      render={({ field }) => (
        <FormItem className="max-w-[200px]">
          <FormLabel>Precio cerrado ($)</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={0}
              {...field}
              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
            />
          </FormControl>
          <p className="text-muted-foreground text-xs">
            Precio único del combo. No se suman adicionales.
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ─── Cuándo y dónde ─────────────────────────────────────────────────────────

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
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
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
      )}
    >
      {children}
    </button>
  );
}

/** Días con atajos: L-V es el caso de menú ejecutivo; fin de semana, el de la
 *  parrillada del domingo. */
function DaysField() {
  const form = useFormContext<DailyMenuInput>();
  return (
    <FormField
      control={form.control}
      name="available_days"
      render={({ field }) => {
        const selected = new Set(field.value);
        const toggle = (dow: number) => {
          const next = new Set(selected);
          if (next.has(dow)) next.delete(dow);
          else next.add(dow);
          field.onChange([...next].sort((a, b) => a - b));
        };
        return (
          <FormItem>
            <FormLabel>Días</FormLabel>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Días disponibles"
            >
              {DAY_OPTIONS.map((d) => (
                <Chip
                  key={d.dow}
                  on={selected.has(d.dow)}
                  onClick={() => toggle(d.dow)}
                >
                  {d.label}
                </Chip>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Atajos:{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => field.onChange([1, 2, 3, 4, 5])}
              >
                Lunes a viernes
              </button>{" "}
              ·{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => field.onChange([6, 0])}
              >
                Fin de semana
              </button>{" "}
              ·{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => field.onChange([0, 1, 2, 3, 4, 5, 6])}
              >
                Todos
              </button>
            </p>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

/** `display_context` como dos chips independientes en vez de un select de tres
 *  opciones — «Salón» y «Carta online» se prenden y apagan por separado; con
 *  las dos apagadas no guarda (nunca se vería en ningún lado). */
function WhereField() {
  const form = useFormContext<DailyMenuInput>();
  const value = useWatch({ control: form.control, name: "display_context" });
  const salon = value === "salon" || value === "both";
  const online = value === "delivery" || value === "both";
  const set = (nextSalon: boolean, nextOnline: boolean) => {
    if (!nextSalon && !nextOnline) return;
    form.setValue(
      "display_context",
      nextSalon && nextOnline ? "both" : nextSalon ? "salon" : "delivery",
      { shouldDirty: true },
    );
  };
  return (
    <FormItem>
      <FormLabel>Se ofrece en</FormLabel>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Se ofrece en"
      >
        <Chip on={salon} onClick={() => set(!salon, online)}>
          Salón (mozo)
        </Chip>
        <Chip on={online} onClick={() => set(salon, !online)}>
          Carta online
        </Chip>
      </div>
    </FormItem>
  );
}

export function DailyMenuScheduleFields() {
  const form = useFormContext<DailyMenuInput>();
  return (
    <div className="space-y-4">
      <DaysField />
      <WhereField />
      <div className="grid gap-2 pt-1">
        <FormField
          control={form.control}
          name="is_available"
          render={({ field }) => (
            <EditorToggle
              title="Disponible hoy"
              description="Apagalo si hoy no sale, sin tocar los días."
              highlight
              control={
                <Switch
                  aria-label="Disponible hoy"
                  checked={field.value}
                  onCheckedChange={(on) => field.onChange(on)}
                />
              }
            />
          )}
        />
        <FormField
          control={form.control}
          name="is_active"
          render={({ field }) => (
            <EditorToggle
              title="Activo"
              description="Apagalo para archivarlo sin perder su historial."
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
        <FormField
          control={form.control}
          name="is_suggestion"
          render={({ field }) => (
            <EditorToggle
              title="Sugerencia del día"
              description="Lo destaca en el asistente de reservas y el chatbot."
              control={
                <Switch
                  aria-label="Sugerencia del día"
                  checked={field.value}
                  onCheckedChange={(on) => field.onChange(on)}
                />
              }
            />
          )}
        />
      </div>
    </div>
  );
}

// ─── Componentes ────────────────────────────────────────────────────────────

/** El nombre de un grupo/opción no es obligatorio: sin esto los avisos quedan
 *  con comillas vacías. */
const nombreODefault = (label: string) => label.trim() || "sin nombre";

function ModificadoresDelProducto({
  groups,
  comboGroupNames,
  fijo = false,
  ignored = [],
  onToggle,
}: {
  groups: ProductModifierGroup[];
  comboGroupNames: string[];
  fijo?: boolean;
  ignored?: string[];
  onToggle?: (groupId: string) => void;
}) {
  const apagado = (id: string) => ignored.includes(id);
  const avisos = avisosDeModificadores(groups, fijo ? [] : comboGroupNames).map(
    (a) => (apagado(a.id) ? { ...a, duplicaA: null } : a),
  );
  if (avisos.length === 0) return null;

  const duplicados = avisos.filter((a) => a.duplicaA);

  return (
    <div className="text-muted-foreground bg-muted/50 space-y-1 rounded-lg px-3 py-2 text-xs">
      <p>
        {fijo
          ? "Este producto tiene modificadores propios, pero al ser un componente fijo el asistente no los pregunta:"
          : "Al elegir esta opción, el asistente va a preguntar además:"}
      </p>
      <ul className="space-y-0.5">
        {avisos.map((a) => {
          const nombre = a.name.trim() || "(sin nombre)";
          const off = apagado(a.id);
          const texto = (
            <>
              <span
                className={
                  off
                    ? "text-muted-foreground font-medium line-through"
                    : "text-foreground font-medium"
                }
              >
                {nombre}
              </span>
              <span>{a.is_required ? "(obligatoria)" : "(opcional)"}</span>
              {a.duplicaA && (
                <span className="flex items-center gap-1 font-medium text-amber-700">
                  <AlertTriangle className="size-3" aria-hidden />
                  se pregunta dos veces
                </span>
              )}
            </>
          );
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-1.5">
              {onToggle ? (
                <label className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="size-3.5 rounded border-zinc-300"
                    checked={!off}
                    onChange={() => onToggle(a.id)}
                    aria-label={`Preguntar «${nombre}» en este menú`}
                  />
                  {texto}
                </label>
              ) : (
                texto
              )}
            </li>
          );
        })}
      </ul>
      {duplicados.map((a) => (
        <p key={`dup-${a.id}`} className="font-medium text-amber-700">
          El combo ya pregunta «{a.duplicaA}»; este producto la va a preguntar
          de nuevo. Destildala acá si en este menú no va — el producto suelto la
          sigue preguntando en la carta.
        </p>
      ))}
    </div>
  );
}

function CardMoveButtons({
  id,
  label,
  isFirst,
  isLast,
  onUp,
  onDown,
}: {
  id: string;
  label: string;
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col">
      <Button
        type="button"
        id={`${id}-up`}
        size="icon-sm"
        variant="ghost"
        className="h-5"
        disabled={isFirst}
        onClick={onUp}
        aria-label={`Subir ${label}`}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        id={`${id}-down`}
        size="icon-sm"
        variant="ghost"
        className="h-5"
        disabled={isLast}
        onClick={onDown}
        aria-label={`Bajar ${label}`}
      >
        <ChevronDown className="size-3.5" />
      </Button>
    </div>
  );
}

function SingleComponentCard({
  idx,
  kind,
  businessId,
  control,
  productNames,
  productModifiers,
  moveButtons,
  onKindChange,
  onRemove,
}: {
  idx: number;
  kind: string;
  businessId: string;
  control: ReturnType<typeof useFormContext<DailyMenuInput>>["control"];
  productNames: Map<string, string>;
  productModifiers: Map<string, ProductModifierGroup[]>;
  moveButtons: React.ReactNode;
  onKindChange: (kind: "text" | "product") => void;
  onRemove: () => void;
}) {
  const { watch, setValue } = useFormContext<DailyMenuInput>();
  const productId = watch(`components.${idx}.product_id`);

  return (
    <div className="bg-card space-y-2 rounded-xl border p-3">
      <div className="flex items-start gap-2">
        {moveButtons}
        <select
          value={kind === "choice" ? "text" : kind}
          onChange={(e) => onKindChange(e.target.value as "text" | "product")}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        >
          <option value="text">Texto</option>
          <option value="product">Producto fijo</option>
        </select>
        <FormField
          control={control}
          name={`components.${idx}.label`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormControl>
                <Input
                  placeholder={
                    kind === "product" ? "Ej: Principal" : "Milanesa con puré"
                  }
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onRemove}
          aria-label="Eliminar componente"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {kind === "product" && (
        <>
          <ProductPicker
            businessId={businessId}
            value={
              productId
                ? {
                    id: productId,
                    name: productNames.get(productId) ?? productId,
                    image_url: null,
                    modifier_groups: productModifiers.get(productId) ?? [],
                  }
                : null
            }
            onChange={(p) => {
              setValue(`components.${idx}.product_id`, p?.id ?? null);
              if (p) {
                productNames.set(p.id, p.name);
                productModifiers.set(p.id, p.modifier_groups);
              }
            }}
          />
          {productId && (
            <ModificadoresDelProducto
              groups={productModifiers.get(productId) ?? []}
              comboGroupNames={[]}
              fijo
            />
          )}
        </>
      )}

      {kind === "text" && (
        <FormField
          control={control}
          name={`components.${idx}.description`}
          render={({ field }) => (
            <FormItem>
              <Label className="text-muted-foreground text-[0.65rem] font-medium tracking-wider uppercase">
                Detalle (opcional)
              </Label>
              <FormControl>
                <Input
                  placeholder="200g, con crema de papas"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}
    </div>
  );
}

function ChoiceGroupCard({
  businessId,
  groupId,
  groupLabel,
  indices,
  earlierGroups,
  condition,
  onConditionChange,
  control,
  productNames,
  productModifiers,
  comboGroupNames,
  moveButtons,
  onLabelChange,
  onAddOption,
  onRemoveOption,
  onMoveOption,
  onDeleteGroup,
}: {
  businessId: string;
  groupId: string;
  groupLabel: string;
  indices: number[];
  earlierGroups: {
    id: string;
    label: string;
    options: { product_id: string; label: string }[];
  }[];
  condition: {
    applies_when_group_id: string | null;
    applies_when_product_ids: string[];
  };
  onConditionChange: (next: {
    applies_when_group_id: string | null;
    applies_when_product_ids: string[];
  }) => void;
  control: ReturnType<typeof useFormContext<DailyMenuInput>>["control"];
  productNames: Map<string, string>;
  productModifiers: Map<string, ProductModifierGroup[]>;
  comboGroupNames: string[];
  moveButtons: React.ReactNode;
  onLabelChange: (label: string) => void;
  onAddOption: () => void;
  onRemoveOption: (idx: number) => void;
  onMoveOption: (from: number, to: number, dir: "up" | "down") => void;
  onDeleteGroup: () => void;
}) {
  const { watch, setValue } = useFormContext<DailyMenuInput>();

  return (
    <div className="bg-card space-y-3 rounded-xl border-2 border-dashed border-amber-300 p-3">
      <div className="flex items-center gap-2">
        {moveButtons}
        <span className="rounded bg-amber-100 px-2 py-0.5 text-[0.65rem] font-bold tracking-wider text-amber-800 uppercase">
          Elegir una
        </span>
        <Input
          placeholder="Ej: Bebida"
          value={groupLabel}
          onChange={(e) => onLabelChange(e.target.value)}
          className="flex-1"
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onDeleteGroup}
          aria-label={`Borrar el grupo ${groupLabel || "sin nombre"}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-2 pl-3">
        {indices.map((idx, optIndex) => {
          const productId = watch(`components.${idx}.product_id`);
          return (
            <div key={idx} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <CardMoveButtons
                  id={`opt-${groupId}-${optIndex}`}
                  label={`la opción ${optIndex + 1} de ${groupLabel || `el grupo sin nombre ${groupId.slice(0, 4)}`}`}
                  isFirst={optIndex === 0}
                  isLast={optIndex === indices.length - 1}
                  onUp={() => onMoveOption(optIndex, optIndex - 1, "up")}
                  onDown={() => onMoveOption(optIndex, optIndex + 1, "down")}
                />
                <div className="flex-1">
                  <ProductPicker
                    businessId={businessId}
                    value={
                      productId
                        ? {
                            id: productId,
                            name: productNames.get(productId) ?? productId,
                            image_url: null,
                            modifier_groups:
                              productModifiers.get(productId) ?? [],
                          }
                        : null
                    }
                    onChange={(p) => {
                      setValue(`components.${idx}.product_id`, p?.id ?? null);
                      if (p) {
                        setValue(`components.${idx}.label`, p.name);
                        productNames.set(p.id, p.name);
                        productModifiers.set(p.id, p.modifier_groups);
                      }
                    }}
                  />
                </div>
                <FormField
                  control={control}
                  name={`components.${idx}.extra_price_cents`}
                  render={({ field }) => (
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-muted-foreground text-xs">+$</span>
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        placeholder="0"
                        aria-label="Adicional en pesos"
                        className="w-16"
                        value={field.value ?? 0}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 0)
                        }
                      />
                    </div>
                  )}
                />
                {indices.length > 1 && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onRemoveOption(idx)}
                    aria-label="Quitar opción"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>

              {productId && (
                <div className="pl-8">
                  <ModificadoresDelProducto
                    groups={productModifiers.get(productId) ?? []}
                    comboGroupNames={comboGroupNames}
                    ignored={
                      watch(`components.${idx}.ignored_modifier_group_ids`) ??
                      []
                    }
                    onToggle={(groupId) => {
                      const actuales =
                        watch(`components.${idx}.ignored_modifier_group_ids`) ??
                        [];
                      setValue(
                        `components.${idx}.ignored_modifier_group_ids`,
                        actuales.includes(groupId)
                          ? actuales.filter((g) => g !== groupId)
                          : [...actuales, groupId],
                        { shouldDirty: true },
                      );
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onAddOption}
        className="ml-3"
      >
        <Plus className="size-3.5" /> Opción
      </Button>

      <p className="text-muted-foreground ml-3 text-xs">
        <span className="font-medium">+$</span> = adicional sobre el combo. Dejá
        0 si la opción va incluida; lo que cargues se suma al precio cuando el
        cliente la elige.
      </p>

      <GroupCondition
        groupId={groupId}
        groupLabel={groupLabel}
        earlierGroups={earlierGroups}
        condition={condition}
        onChange={onConditionChange}
        productModifiers={productModifiers}
      />
    </div>
  );
}

function GroupCondition({
  groupId,
  groupLabel,
  earlierGroups,
  condition,
  onChange,
  productModifiers,
}: {
  groupId: string;
  groupLabel: string;
  earlierGroups: {
    id: string;
    label: string;
    options: { product_id: string; label: string }[];
  }[];
  condition: {
    applies_when_group_id: string | null;
    applies_when_product_ids: string[];
  };
  onChange: (next: {
    applies_when_group_id: string | null;
    applies_when_product_ids: string[];
  }) => void;
  productModifiers: Map<string, ProductModifierGroup[]>;
}) {
  if (earlierGroups.length === 0) return null;

  const fuente = earlierGroups.find(
    (g) => g.id === condition.applies_when_group_id,
  );
  const condicionado = !!fuente;

  return (
    <div className="ml-3 space-y-2 border-t pt-3">
      <p className="text-xs font-medium">¿Cuándo aparece este grupo?</p>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="radio"
          name={`cond-${groupId}`}
          className="size-3.5"
          checked={!condicionado}
          onChange={() =>
            onChange({
              applies_when_group_id: null,
              applies_when_product_ids: [],
            })
          }
        />
        <span>Siempre</span>
      </label>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`cond-${groupId}`}
            className="size-3.5"
            checked={condicionado}
            onChange={() => {
              const primero = earlierGroups[0];
              onChange({
                applies_when_group_id: primero.id,
                applies_when_product_ids: primero.options.map(
                  (o) => o.product_id,
                ),
              });
            }}
          />
          <span>Sólo si en</span>
        </label>
        <select
          value={condition.applies_when_group_id ?? ""}
          disabled={!condicionado}
          onChange={(e) => {
            const elegido = earlierGroups.find((g) => g.id === e.target.value);
            if (!elegido) return;
            onChange({
              applies_when_group_id: elegido.id,
              applies_when_product_ids: elegido.options.map(
                (o) => o.product_id,
              ),
            });
          }}
          className="border-input bg-background h-8 rounded-md border px-2 text-xs disabled:opacity-50"
          aria-label={`Grupo del que depende ${groupLabel || "este grupo"}`}
        >
          {earlierGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label || "(grupo sin nombre)"}
            </option>
          ))}
        </select>
        <span className={condicionado ? "" : "text-muted-foreground"}>
          eligieron:
        </span>
      </div>

      {condicionado && fuente && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6">
          {fuente.options.map((o) => {
            const duplica = grupoQueDuplica(
              productModifiers.get(o.product_id),
              groupLabel,
            );
            return (
              <label
                key={o.product_id}
                className="flex items-center gap-1.5 text-xs"
              >
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={condition.applies_when_product_ids.includes(
                    o.product_id,
                  )}
                  onChange={(e) =>
                    onChange({
                      applies_when_group_id: fuente.id,
                      applies_when_product_ids: e.target.checked
                        ? [...condition.applies_when_product_ids, o.product_id]
                        : condition.applies_when_product_ids.filter(
                            (id) => id !== o.product_id,
                          ),
                    })
                  }
                />
                <span>{o.label || "(sin producto)"}</span>
                {duplica && (
                  <span
                    className="flex items-center gap-1 font-medium text-amber-700"
                    title={`«${o.label}» ya pregunta «${duplica}» por su cuenta: se preguntaría dos veces.`}
                  >
                    <AlertTriangle className="size-3" aria-hidden />
                    ya pregunta «{duplica}»
                  </span>
                )}
              </label>
            );
          })}
          {fuente.options.length === 0 && (
            <span className="text-muted-foreground">
              Ese grupo todavía no tiene opciones con producto.
            </span>
          )}
        </div>
      )}

      {condicionado && condition.applies_when_product_ids.length === 0 && (
        <p className="text-xs text-amber-700">
          Sin ninguna tildada, este grupo no va a aparecer nunca.
        </p>
      )}
    </div>
  );
}

/**
 * Los componentes del menú: cada paso (entrada, principal…) como tarjeta, con
 * sus opciones enlazadas a un producto de la carta (spec 076/087/148/175). Se
 * reordena con ▲/▼ y no con drag & drop: hay dos niveles anidados —tarjetas y
 * opciones dentro de un grupo— y esto se opera igual con teclado y con el
 * dedo, sin sensores extra.
 */
export function DailyMenuComponentsEditor({
  businessId,
  productNames,
  productModifiers,
}: {
  businessId: string;
  productNames: Map<string, string>;
  productModifiers: Map<string, ProductModifierGroup[]>;
}) {
  const { control, watch, setValue, getValues, reset } =
    useFormContext<DailyMenuInput>();
  const components = watch("components");

  const cards = toCards(components);
  const cardStart: number[] = [];
  let flatIndex = 0;
  for (const card of cards) {
    cardStart.push(flatIndex);
    flatIndex += card.kind === "single" ? 1 : card.options.length;
  }

  const orderedGroups = cards.flatMap((card, cardIndex) =>
    card.kind === "group"
      ? [
          {
            id: card.groupId,
            label: card.label,
            cardIndex,
            options: card.options.flatMap((o) =>
              o.product_id
                ? [{ product_id: o.product_id, label: o.label }]
                : [],
            ),
          },
        ]
      : [],
  );

  const nombresDeGruposDelCombo = cards.flatMap((card) =>
    card.kind === "group" ? [card.label] : [],
  );

  const choiceGroups = watch("choice_groups") ?? [];
  const conditionOf = (groupId: string) => {
    const g = choiceGroups.find((x) => x.id === groupId);
    return {
      applies_when_group_id: g?.applies_when_group_id ?? null,
      applies_when_product_ids: g?.applies_when_product_ids ?? [],
    };
  };

  const setGroup = (
    groupId: string,
    patch: Partial<{
      name: string;
      applies_when_group_id: string | null;
      applies_when_product_ids: string[];
    }>,
  ) => {
    const actual = choiceGroups.find((g) => g.id === groupId);
    const siguiente = actual
      ? choiceGroups.map((g) => (g.id === groupId ? { ...g, ...patch } : g))
      : [
          ...choiceGroups,
          {
            id: groupId,
            name: "",
            applies_when_group_id: null,
            applies_when_product_ids: [],
            ...patch,
          },
        ];
    setValue("choice_groups", siguiente, { shouldDirty: true });
  };

  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    document.getElementById(id)?.focus();
  });

  const applyComponents = (
    next: DailyMenuComponentInput[],
    focusId?: string,
  ) => {
    const { components: cleaned, dropped } = pruneBlocks(next);
    reset({ ...getValues(), components: cleaned }, { keepDefaultValues: true });
    for (const d of dropped) {
      const bloqueado = nombreODefault(d.blockedLabel);
      toast.warning(
        `«${nombreODefault(d.optionLabel)}» ya no condiciona a «${bloqueado}»: ahora ${bloqueado} se decide antes que ${nombreODefault(d.ownerLabel)}.`,
      );
    }
    if (focusId) pendingFocus.current = focusId;
  };

  const removeAt = (idx: number) =>
    applyComponents(components.filter((_, i) => i !== idx));

  const moveCardTo = (from: number, to: number, dir: "up" | "down") => {
    const focusDir = to === 0 ? "down" : to === cards.length - 1 ? "up" : dir;
    applyComponents(moveCard(components, from, to), `card-${to}-${focusDir}`);
  };

  const moveOptionTo = (
    groupId: string,
    from: number,
    to: number,
    total: number,
    dir: "up" | "down",
  ) => {
    const focusDir = to === 0 ? "down" : to === total - 1 ? "up" : dir;
    applyComponents(
      moveOption(components, groupId, from, to),
      `opt-${groupId}-${to}-${focusDir}`,
    );
  };

  const addChoiceOption = (groupId: string, groupLabel: string) => {
    applyComponents(
      addOption(components, groupId, {
        label: "",
        kind: "choice",
        choice_group_id: groupId,
        choice_group_label: groupLabel,
        extra_price_cents: 0,
        blocks_choice_group_ids: [],
      }),
    );
  };

  const deleteGroup = (groupId: string, label: string, count: number) => {
    const ok = window.confirm(
      `¿Borrar el grupo «${nombreODefault(label)}» y ${
        count === 1 ? "su única opción" : `sus ${count} opciones`
      }?`,
    );
    if (!ok) return;
    applyComponents(removeGroup(components, groupId));
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Componentes del menú</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Lo que incluye el combo. Cada componente puede ser texto, un
            producto fijo, o un grupo de opciones donde el cliente elige.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              applyComponents([
                ...components,
                { label: "", kind: "text", extra_price_cents: 0 },
              ])
            }
          >
            <Plus className="size-3.5" /> Componente
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              applyComponents([
                ...components,
                {
                  label: "",
                  kind: "choice",
                  choice_group_id: crypto.randomUUID(),
                  choice_group_label: "",
                  extra_price_cents: 0,
                  blocks_choice_group_ids: [],
                },
              ])
            }
          >
            <Plus className="size-3.5" /> Grupo de opciones
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {cards.map((card, cardIndex) => {
          const start = cardStart[cardIndex];
          const posicion = `${cardIndex + 1}º`;
          const move = (
            <CardMoveButtons
              id={`card-${cardIndex}`}
              label={
                card.kind === "group"
                  ? `el grupo ${card.label || `sin nombre (${posicion})`}`
                  : `el componente ${card.component.label || `sin nombre (${posicion})`}`
              }
              isFirst={cardIndex === 0}
              isLast={cardIndex === cards.length - 1}
              onUp={() => moveCardTo(cardIndex, cardIndex - 1, "up")}
              onDown={() => moveCardTo(cardIndex, cardIndex + 1, "down")}
            />
          );

          if (card.kind === "group") {
            const indices = card.options.map((_, i) => start + i);
            return (
              <ChoiceGroupCard
                key={card.groupId}
                businessId={businessId}
                groupId={card.groupId}
                groupLabel={card.label}
                indices={indices}
                moveButtons={move}
                earlierGroups={orderedGroups.filter(
                  (g) => g.cardIndex < cardIndex,
                )}
                condition={conditionOf(card.groupId)}
                onConditionChange={(next) => setGroup(card.groupId, next)}
                control={control}
                productNames={productNames}
                productModifiers={productModifiers}
                comboGroupNames={nombresDeGruposDelCombo}
                onLabelChange={(label) => {
                  setGroup(card.groupId, { name: label });
                  for (const i of indices) {
                    setValue(`components.${i}.choice_group_label`, label);
                  }
                }}
                onAddOption={() => addChoiceOption(card.groupId, card.label)}
                onRemoveOption={(i) => removeAt(i)}
                onMoveOption={(from, to, dir) =>
                  moveOptionTo(card.groupId, from, to, card.options.length, dir)
                }
                onDeleteGroup={() =>
                  deleteGroup(card.groupId, card.label, card.options.length)
                }
              />
            );
          }

          return (
            <SingleComponentCard
              key={`card-${cardIndex}`}
              idx={start}
              kind={card.component.kind ?? "text"}
              businessId={businessId}
              control={control}
              productNames={productNames}
              productModifiers={productModifiers}
              moveButtons={move}
              onKindChange={(newKind) => {
                setValue(`components.${start}.kind`, newKind);
                if (newKind === "text") {
                  setValue(`components.${start}.product_id`, null);
                  setValue(`components.${start}.choice_group_id`, null);
                  setValue(`components.${start}.choice_group_label`, null);
                }
              }}
              onRemove={() => removeAt(start)}
            />
          );
        })}
      </div>
    </section>
  );
}

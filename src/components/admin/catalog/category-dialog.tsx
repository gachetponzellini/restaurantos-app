"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SuperCategoryAvatar } from "@/components/super-categories/visual";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/lib/catalog/category-actions";
import { CategoryInput } from "@/lib/catalog/schemas";
import type {
  AdminCategory,
  AdminStation,
  AdminSuperCategory,
} from "@/lib/admin/catalog-query";

const NO_SUPER = "__none__";
const NO_STATION = "__none__";

export function CategoryDialog({
  slug,
  category,
  superCategories,
  stations = [],
  trigger,
  defaultSuperCategoryId,
  defaultSortOrder = 0,
}: {
  slug: string;
  category?: AdminCategory;
  superCategories: AdminSuperCategory[];
  stations?: AdminStation[];
  trigger: React.ReactElement;
  defaultSuperCategoryId?: string | null;
  defaultSortOrder?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = useForm<CategoryInput>({
    resolver: zodResolver(CategoryInput),
    defaultValues: category
      ? {
          name: category.name,
          slug: category.slug,
          sort_order: category.sort_order,
          super_category_id: category.super_category_id,
          station_id: category.station_id,
          extra_station_ids: category.extra_station_ids ?? [],
        }
      : {
          name: "",
          slug: "",
          sort_order: defaultSortOrder,
          super_category_id: defaultSuperCategoryId ?? null,
          station_id: null,
          extra_station_ids: [],
        },
  });

  const onSubmit = async (values: CategoryInput) => {
    setSubmitting(true);
    try {
      const result = category
        ? await updateCategory(slug, category.id, values)
        : await createCategory(slug, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(category ? "Actualizada." : "Creada.");
      setOpen(false);
      form.reset(values);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!category) return;
    setSubmitting(true);
    try {
      const result = await deleteCategory(slug, category.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Borrada.");
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {category ? "Editar categoría" : "Nueva categoría"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-4"
            id="category-form"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl>
                    <Input autoFocus placeholder="ej: Pizzas" {...field} />
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
                    <Input placeholder="pizzas" {...field} />
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
                      <SelectTrigger>
                        <SelectValue placeholder="Sin asignar">
                          {(value) => {
                            if (!value || value === NO_SUPER) return "Sin asignar";
                            const sc = superCategories.find((s) => s.id === value);
                            return sc?.name ?? "Sin asignar";
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
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="station_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sector de cocina default</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value ?? NO_STATION}
                      onValueChange={(v) =>
                        field.onChange(v === NO_STATION ? null : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sin sector">
                          {(value) => {
                            if (!value || value === NO_STATION) return "Sin sector";
                            return (
                              stations.find((s) => s.id === value)?.name ??
                              "Sin sector"
                            );
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_STATION}>
                          <span className="text-zinc-500">Sin sector</span>
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
                    Default que heredan los productos de esta categoría. Cada
                    producto puede sobreescribirlo desde su propio drawer.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Spec 180 · 2ª y 3ª comandera por default del rubro. Es cómo se
                carga «todo lo de cocina también sale en cocina» diez veces en
                vez de doscientas. */}
            <FormField
              control={form.control}
              name="extra_station_ids"
              render={({ field }) => {
                const valor: string[] = field.value ?? [];
                const setPos = (pos: 0 | 1, id: string | null) => {
                  const base = [...valor];
                  if (id === null) base.splice(pos, 1);
                  else base[pos] = id;
                  field.onChange(base.filter(Boolean).slice(0, 2));
                };
                const nombre = (id: string) =>
                  stations.find((s) => s.id === id)?.name ?? "?";
                return (
                  <FormItem>
                    <FormLabel>También imprime en</FormLabel>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {([0, 1] as const).map((pos) => (
                        <Select
                          key={pos}
                          value={valor[pos] ?? "__none__"}
                          onValueChange={(v) =>
                            setPos(pos, v === "__none__" ? null : v)
                          }
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
                      Cada sector recibe su propia comanda con los productos del
                      rubro. Cada producto puede pisarlo desde su drawer.
                    </p>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          </form>
        </Form>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {category ? (
            confirmDelete ? (
              <div className="flex flex-1 items-center gap-2">
                <span className="text-xs text-red-700">¿Confirmás?</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={submitting}
                >
                  Sí, borrar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={submitting}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDelete(true)}
                disabled={submitting}
                className="text-red-600 hover:bg-red-50"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Borrar
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" form="category-form" disabled={submitting}>
              {submitting ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

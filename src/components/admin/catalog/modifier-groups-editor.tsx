"use client";

import { useFieldArray, useFormContext } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

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
import { PrecioField } from "@/components/admin/catalog/pesos-input";
import type { ProductInput } from "@/lib/catalog/schemas";

export function ModifierGroupsEditor() {
  const { control, setValue } = useFormContext<ProductInput>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "modifier_groups",
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Grupos de adicionales</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Ej: tamaño, punto de cocción, extras. Los precios de cada opción se
            suman al precio base del producto.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            append({
              name: "",
              min_selection: 0,
              max_selection: 1,
              is_required: false,
              sort_order: fields.length,
              modifiers: [],
            })
          }
        >
          <Plus className="size-3.5" /> Grupo
        </Button>
      </div>

      {fields.length === 0 && (
        <p className="text-muted-foreground text-sm italic">
          Sin grupos. Agregá uno si el producto tiene variantes o extras.
        </p>
      )}

      <div className="space-y-3">
        {fields.map((field, idx) => (
          <div
            key={field.id}
            className="bg-card space-y-3 rounded-xl border p-4"
          >
            <div className="flex items-start gap-2">
              <FormField
                control={control}
                name={`modifier_groups.${idx}.name`}
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Nombre del grupo</FormLabel>
                    <FormControl>
                      <Input placeholder="Tamaño, Extras..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => remove(idx)}
                aria-label="Eliminar grupo"
                className="mt-6"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <FormField
                control={control}
                name={`modifier_groups.${idx}.min_selection`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mín.</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`modifier_groups.${idx}.max_selection`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Máx.</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value) || 1)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`modifier_groups.${idx}.is_required`}
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Obligatorio</FormLabel>
                    <FormControl>
                      <label className="flex h-9 items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                        />
                        <span className="text-sm">Sí</span>
                      </label>
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            {/* Spec 207: la pizza y sus gustos. Opt-in, uno por producto. */}
            <FormField
              control={control}
              name={`modifier_groups.${idx}.is_variant`}
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={field.value ?? false}
                      onChange={(e) => {
                        const on = e.target.checked;
                        field.onChange(on);
                        if (on) {
                          setValue(`modifier_groups.${idx}.min_selection`, 1);
                          setValue(`modifier_groups.${idx}.max_selection`, 1);
                          setValue(`modifier_groups.${idx}.is_required`, true);
                        }
                      }}
                    />
                    <span className="text-sm">
                      Variantes con precio final
                      <span className="text-muted-foreground block text-xs">
                        Cada opción es una versión del producto (ej: los gustos
                        de la pizza) y se muestra con su precio total, no como
                        «+$». Apagar el producto apaga todas.
                      </span>
                    </span>
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />

            <ModifierList groupIdx={idx} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ModifierList({ groupIdx }: { groupIdx: number }) {
  const { control } = useFormContext<ProductInput>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: `modifier_groups.${groupIdx}.modifiers`,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs tracking-wider uppercase">Opciones</Label>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() =>
            append({
              name: "",
              price_delta_cents: 0,
              is_available: true,
              sort_order: fields.length,
            })
          }
        >
          <Plus className="size-3" /> Opción
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          Agregá al menos una opción.
        </p>
      ) : (
        <div className="flex items-center gap-2 px-1">
          <Label className="text-muted-foreground flex-1 text-[0.65rem] font-medium tracking-wider uppercase">
            Nombre
          </Label>
          <Label className="text-muted-foreground w-32 text-[0.65rem] font-medium tracking-wider uppercase">
            Precio extra ($)
          </Label>
          <span className="w-6" aria-hidden />
        </div>
      )}
      {fields.map((field, mIdx) => (
        <div key={field.id} className="flex items-start gap-2">
          <FormField
            control={control}
            name={`modifier_groups.${groupIdx}.modifiers.${mIdx}.name`}
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormControl>
                  <Input placeholder="Ej: Grande" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {/*
            El adicional es el gemelo chico del precio base y tenía el MISMO
            `parseInt`: un extra de «2.500» se guardaba como $2. Va por el mismo
            campo para que el criterio de lectura viva en un solo lugar.
          */}
          <PrecioField
            control={control}
            name={`modifier_groups.${groupIdx}.modifiers.${mIdx}.price_delta_cents`}
            className="w-32"
            prefix="+$"
            inputProps={{
              placeholder: "0",
              "aria-label": "Precio del adicional ($)",
            }}
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => remove(mIdx)}
            aria-label="Eliminar opción"
            className="mt-1"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

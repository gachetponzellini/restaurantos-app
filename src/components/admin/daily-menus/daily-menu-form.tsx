"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import {
  DailyMenuBasicsFields,
  DailyMenuComponentsEditor,
  DailyMenuScheduleFields,
  dailyMenuDefaults,
  dailyMenuProductMaps,
  useSaveDailyMenu,
} from "@/components/admin/daily-menus/daily-menu-fields";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";
import { DailyMenuInput } from "@/lib/daily-menus/schemas";

/**
 * Formulario de menú del día en página (`/menu-del-dia/[id]` y `/nuevo`, para
 * los links directos). El catálogo usa el editor en modal (`MenuEditor`); los
 * dos arman los mismos campos de `daily-menu-fields` (spec 205).
 */
export function DailyMenuForm({
  slug,
  businessId,
  menu,
}: {
  slug: string;
  businessId: string;
  menu?: AdminDailyMenu;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const save = useSaveDailyMenu(slug, menu);

  // Lo que cada producto pregunta por su cuenta (spec 148): arranca con lo que
  // trajo la query y crece cuando el picker elige uno nuevo.
  const [{ names: productNames, modifiers: productModifiers }] = useState(() =>
    dailyMenuProductMaps(menu),
  );

  const form = useForm<DailyMenuInput>({
    resolver: zodResolver(DailyMenuInput),
    defaultValues: dailyMenuDefaults(menu),
  });

  const onSubmit = async (values: DailyMenuInput) => {
    setSubmitting(true);
    try {
      const id = await save(values);
      if (!id) return;
      router.push(`/${slug}/admin/menu-del-dia`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <DailyMenuBasicsFields businessId={businessId} slugPlacement="inline" />
        <DailyMenuScheduleFields />
        <DailyMenuComponentsEditor
          businessId={businessId}
          productNames={productNames}
          productModifiers={productModifiers}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : menu ? "Guardar" : "Crear"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>
      </form>
    </Form>
  );
}

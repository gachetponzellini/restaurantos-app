"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Thumb } from "@/components/admin/catalog/product-bits";
import { useCatalogData } from "@/components/admin/catalog/ui/catalog-data";
import type { CatalogEditorProps } from "@/components/admin/catalog/ui/editor-host";
import {
  EditorSectionHeading,
  EntityEditor,
} from "@/components/admin/catalog/ui/entity-editor";
import {
  DailyMenuBasicsFields,
  DailyMenuComponentsEditor,
  DailyMenuScheduleFields,
  dailyMenuDefaults,
  dailyMenuProductMaps,
  useSaveDailyMenu,
} from "@/components/admin/daily-menus/daily-menu-fields";
import { MenuPills } from "@/components/admin/daily-menus/daily-menu-bits";
import { deleteDailyMenu } from "@/lib/daily-menus/daily-menu-actions";
import { formatCurrency } from "@/lib/currency";
import type { AdminDailyMenu } from "@/lib/admin/daily-menu-query";
import { DailyMenuInput } from "@/lib/daily-menus/schemas";

/**
 * Editor de menú del día (spec 205 · D4/D8/D6). Mismo patrón que
 * `ProductEditor`: tres secciones con índice, «Guardar no cierra», ‹ › sobre
 * la lista filtrada. Mismo schema y actions de siempre (D5).
 */
export function MenuEditor(props: CatalogEditorProps) {
  const { menus } = useCatalogData();
  const menu = props.id ? menus.find((m) => m.id === props.id) : undefined;
  if (props.id && !menu) {
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
  return <MenuEditorForm {...props} menu={menu} />;
}

function MenuEditorForm({
  id,
  section,
  draft,
  nav,
  back,
  onClose,
  onCreated,
  menu,
}: CatalogEditorProps & { menu: AdminDailyMenu | undefined }) {
  const { slug, businessId, todayDow } = useCatalogData();
  const save = useSaveDailyMenu(slug, menu);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [{ names: productNames, modifiers: productModifiers }] = useState(() =>
    dailyMenuProductMaps(menu),
  );

  const form = useForm<DailyMenuInput>({
    resolver: zodResolver(DailyMenuInput),
    defaultValues: dailyMenuDefaults(menu, draft as Partial<DailyMenuInput>),
  });
  const { isDirty } = form.formState;

  const formId = `menu-${id ?? "nuevo"}`;
  const onSubmit = async (values: DailyMenuInput) => {
    setSaving(true);
    try {
      const savedId = await save(values);
      if (!savedId) return;
      form.reset(values);
      setSaved(true);
      if (!id) onCreated(savedId);
    } finally {
      setSaving(false);
    }
  };

  const name = useWatch({ control: form.control, name: "name" });
  const groups = useWatch({ control: form.control, name: "components" }) ?? [];

  const onDelete = async () => {
    if (!menu) return;
    if (!window.confirm(`¿Eliminar «${menu.name}»? No se puede deshacer.`))
      return;
    setDeleting(true);
    try {
      const r = await deleteDailyMenu(slug, menu.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Eliminado.");
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
        initialSection={section}
        eyebrow="Menú del día"
        title={name || menu?.name || "Nuevo menú"}
        thumb={
          menu ? (
            <Thumb
              src={menu.image_url}
              label={menu.name}
              seed={menu.id}
              size={36}
            />
          ) : undefined
        }
        meta={
          menu ? (
            <>
              <span className="rounded-full bg-zinc-100 px-2 py-px text-[11px] font-semibold text-zinc-700 tabular-nums">
                {formatCurrency(menu.price_cents)}
              </span>
              <MenuPills menu={menu} todayDow={todayDow} />
            </>
          ) : undefined
        }
        dirty={isDirty}
        saving={saving}
        saved={saved}
        formId={formId}
        saveLabel={menu ? "Guardar" : "Crear"}
        destructive={
          menu ? (
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
                  description="Un combo con precio cerrado."
                />
                <DailyMenuBasicsFields businessId={businessId} />
              </>
            ),
          },
          {
            id: "dias",
            label: "Cuándo y dónde",
            content: (
              <>
                <EditorSectionHeading
                  title="Cuándo y dónde"
                  description="Qué días sale, dónde se ofrece y si está disponible ahora."
                />
                <DailyMenuScheduleFields />
              </>
            ),
          },
          {
            id: "componentes",
            label: "Componentes",
            count: groups.length,
            content: (
              <DailyMenuComponentsEditor
                businessId={businessId}
                productNames={productNames}
                productModifiers={productModifiers}
              />
            ),
          },
        ]}
      >
        <form id={formId} hidden onSubmit={form.handleSubmit(onSubmit)} />
      </EntityEditor>
    </Form>
  );
}

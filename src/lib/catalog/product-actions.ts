"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  ProductInput,
  type ModifierGroupInput,
  warnGarnishModifierGroups,
} from "./schemas";

import { requireCatalogManager } from "./require-catalog-manager";

/**
 * «Se guardó» sólo si el UPDATE tocó una fila.
 *
 * El patrón que se repite en todas las mutaciones de este archivo: el id viaja
 * desde el browser y el scope es `.eq("id").eq("business_id")` + RLS. Con un id
 * ajeno o viejo la escritura afecta 0 filas y Supabase devuelve `error = null`,
 * así que la action contestaba «ok» y el catálogo mostraba «Actualizado» sin
 * haber actualizado nada (issue #269).
 */
function tocoAlgunaFila(filas: { id: string }[] | null): boolean {
  return (filas?.length ?? 0) > 0;
}

async function syncModifierGroups(
  productId: string,
  businessId: string,
  groups: ModifierGroupInput[],
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("modifier_groups")
    .select("id")
    .eq("product_id", productId);
  const existingIds = new Set((existing ?? []).map((g) => g.id));
  const incomingIds = new Set(
    groups.map((g) => g.id).filter((id): id is string => !!id),
  );
  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("modifier_groups")
      .delete()
      .in("id", toDelete);
    if (error) return "No pudimos borrar grupos viejos.";
  }

  for (const [idx, group] of groups.entries()) {
    const groupPayload = {
      business_id: businessId,
      product_id: productId,
      name: group.name,
      min_selection: group.min_selection,
      max_selection: group.max_selection,
      is_required: group.is_required,
      is_variant: group.is_variant ?? false,
      sort_order: idx,
    };

    let groupId = group.id;
    if (groupId) {
      const { error } = await supabase
        .from("modifier_groups")
        .update(groupPayload)
        .eq("id", groupId);
      if (error) return "No pudimos actualizar un grupo.";
    } else {
      const { data: inserted, error } = await supabase
        .from("modifier_groups")
        .insert(groupPayload)
        .select("id")
        .single();
      if (error || !inserted) return "No pudimos crear un grupo.";
      groupId = inserted.id;
    }

    // Sync modifiers inside this group
    const { data: existingMods } = await supabase
      .from("modifiers")
      .select("id")
      .eq("group_id", groupId);
    const existingModIds = new Set((existingMods ?? []).map((m) => m.id));
    const incomingModIds = new Set(
      group.modifiers.map((m) => m.id).filter((id): id is string => !!id),
    );
    const modsToDelete = [...existingModIds].filter(
      (id) => !incomingModIds.has(id),
    );
    if (modsToDelete.length > 0) {
      const { error } = await supabase
        .from("modifiers")
        .delete()
        .in("id", modsToDelete);
      if (error) return "No pudimos borrar adicionales viejos.";
    }

    for (const [mIdx, mod] of group.modifiers.entries()) {
      const modPayload = {
        group_id: groupId,
        name: mod.name,
        price_delta_cents: mod.price_delta_cents,
        is_available: mod.is_available,
        sort_order: mIdx,
      };
      if (mod.id) {
        const { error } = await supabase
          .from("modifiers")
          .update(modPayload)
          .eq("id", mod.id);
        if (error) return "No pudimos actualizar un adicional.";
      } else {
        const { error } = await supabase.from("modifiers").insert(modPayload);
        if (error) return "No pudimos crear un adicional.";
      }
    }
  }

  return null;
}

export async function createProduct(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  const parsed = ProductInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;
  const businessId = guard.data.businessId;

  const supabase = await createSupabaseServerClient();
  const { modifier_groups, ...productData } = parsed.data;
  const { data, error } = await supabase
    .from("products")
    .insert({ ...productData, business_id: businessId })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createProduct", error);
    return actionError(
      error?.code === "23505"
        ? "Ya existe un producto con ese slug."
        : "No pudimos crear el producto.",
    );
  }
  if (modifier_groups.length > 0) {
    const err = await syncModifierGroups(data.id, businessId, modifier_groups);
    if (err) return actionError(err);
  }
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  const warnings = warnGarnishModifierGroups(modifier_groups);
  return actionOk({ id: data.id, warnings });
}

export async function updateProduct(
  businessSlug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string; warnings: string[] }>> {
  const parsed = ProductInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;
  const businessId = guard.data.businessId;

  const supabase = await createSupabaseServerClient();
  const { modifier_groups, ...productData } = parsed.data;
  const { data: actualizados, error } = await supabase
    .from("products")
    .update(productData)
    .eq("id", id)
    .eq("business_id", businessId)
    .select("id");
  if (error) {
    console.error("updateProduct", error);
    return actionError(
      error.code === "23505"
        ? "Ya existe un producto con ese slug."
        : "No pudimos actualizar el producto.",
    );
  }
  // El id viaja desde el browser. Con uno de otro negocio, el `.eq(business_id)`
  // + la RLS dejan el UPDATE en 0 filas… y Supabase devuelve `error = null`. Sin
  // este corte la action seguía como si nada y `syncModifierGroups` le insertaba
  // grupos de adicionales —con MI business_id y SU product_id— a un producto
  // ajeno: aparecían en la carta pública y en la app del mozo de la víctima, que
  // no los veía en su admin (issue #269). Que la base lo rechace (FK compuesta,
  // migración 0091) no alcanza: el que llamó tiene que enterarse de que su
  // cambio no se guardó, en vez de recibir «Actualizado».
  if (!tocoAlgunaFila(actualizados)) {
    return actionError("Producto no encontrado.");
  }
  const err = await syncModifierGroups(id, businessId, modifier_groups);
  if (err) return actionError(err);
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  revalidatePath(`/${businessSlug}/menu`);
  const warnings = warnGarnishModifierGroups(modifier_groups);
  return actionOk({ id, warnings });
}

export async function deleteProduct(
  businessSlug: string,
  id: string,
): Promise<ActionResult<{ soft_deleted: boolean }>> {
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;
  const businessId = guard.data.businessId;

  const supabase = await createSupabaseServerClient();
  const { data: borrados, error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("business_id", businessId)
    .select("id");

  if (!error && !tocoAlgunaFila(borrados)) {
    return actionError("Producto no encontrado.");
  }
  if (!error) {
    revalidatePath(`/${businessSlug}/admin/catalogo`);
    revalidatePath(`/${businessSlug}/menu`);
    return actionOk({ soft_deleted: false });
  }

  // FK violation: el producto tiene pedidos asociados. Hacemos soft-delete
  // (is_active=false + is_available=false) para que no aparezca en el menú
  // ni en el catálogo activo, pero el historial de pedidos queda intacto.
  // Nota: una vez aplicada la migration 0020, los FKs son ON DELETE SET NULL
  // y este branch deja de ejecutarse — el delete duro funciona siempre.
  if (error.code === "23503") {
    const { error: softErr } = await supabase
      .from("products")
      .update({ is_active: false, is_available: false })
      .eq("id", id)
      .eq("business_id", businessId);
    if (softErr) {
      console.error("deleteProduct soft-delete", softErr);
      return actionError("No pudimos borrar el producto.");
    }
    revalidatePath(`/${businessSlug}/admin/catalogo`);
    revalidatePath(`/${businessSlug}/menu`);
    return actionOk({ soft_deleted: true });
  }

  console.error("deleteProduct", error);
  return actionError("No pudimos borrar el producto.");
}

export async function toggleProductAvailability(
  businessSlug: string,
  id: string,
  isAvailable: boolean,
): Promise<ActionResult<{ is_available: boolean }>> {
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { data: tocados, error } = await supabase
    .from("products")
    .update({ is_available: isAvailable })
    .eq("id", id)
    .eq("business_id", guard.data.businessId)
    .select("id");
  if (error) {
    console.error("toggleProductAvailability", error);
    return actionError("No pudimos actualizar.");
  }
  if (!tocoAlgunaFila(tocados)) return actionError("Producto no encontrado.");
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  revalidatePath(`/${businessSlug}/menu`);
  return actionOk({ is_available: isAvailable });
}

/**
 * spec 0021 — saca/pone el producto en la carta pública SIN tocar su
 * disponibilidad para el mozo. Sirve para el catálogo heredado del POS
 * (kiosko, cafetería, sugerencias del día) que se vende en el salón pero no
 * va en la carta que ve el cliente.
 */
export async function toggleProductShowOnline(
  businessSlug: string,
  id: string,
  showOnline: boolean,
): Promise<ActionResult<{ show_online: boolean }>> {
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { data: tocados, error } = await supabase
    .from("products")
    .update({ show_online: showOnline })
    .eq("id", id)
    .eq("business_id", guard.data.businessId)
    .select("id");
  if (error) {
    console.error("toggleProductShowOnline", error);
    return actionError("No pudimos actualizar.");
  }
  if (!tocoAlgunaFila(tocados)) return actionError("Producto no encontrado.");
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  revalidatePath(`/${businessSlug}/menu`);
  return actionOk({ show_online: showOnline });
}

export async function toggleProductActive(
  businessSlug: string,
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ is_active: boolean }>> {
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { data: tocados, error } = await supabase
    .from("products")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("business_id", guard.data.businessId)
    .select("id");
  if (error) {
    console.error("toggleProductActive", error);
    return actionError("No pudimos actualizar.");
  }
  if (!tocoAlgunaFila(tocados)) return actionError("Producto no encontrado.");
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  revalidatePath(`/${businessSlug}/menu`);
  return actionOk({ is_active: isActive });
}

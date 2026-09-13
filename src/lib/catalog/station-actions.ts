"use server";

import { revalidatePath } from "next/cache";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canManageBusiness, ensureAdminAccess } from "@/lib/admin/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import { StationInput, StationPrinterInput } from "./schemas";

import { requireCatalogManager } from "./require-catalog-manager";

export async function createStation(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = StationInput.safeParse(input);
  if (!parsed.success) {
    console.error("createStation · invalid input", {
      input,
      issues: parsed.error.issues,
    });
    const first = parsed.error.issues[0];
    return actionError(
      first ? `${first.path.join(".") || "campo"}: ${first.message}` : "Datos inválidos.",
    );
  }

  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;
  const businessId = guard.data.businessId;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stations")
    .insert({ ...parsed.data, business_id: businessId })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createStation", error);
    return actionError(
      error?.code === "23505"
        ? "Ya existe un sector con ese nombre."
        : "No pudimos crear el sector.",
    );
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk({ id: data.id });
}

export async function updateStation(
  businessSlug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = StationInput.safeParse(input);
  if (!parsed.success) {
    console.error("updateStation · invalid input", {
      input,
      issues: parsed.error.issues,
    });
    const first = parsed.error.issues[0];
    return actionError(
      first ? `${first.path.join(".") || "campo"}: ${first.message}` : "Datos inválidos.",
    );
  }

  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("stations")
    .update(parsed.data)
    .eq("id", id)
    .eq("business_id", guard.data.businessId);

  if (error) {
    console.error("updateStation", error);
    return actionError(
      error.code === "23505"
        ? "Ya existe un sector con ese nombre."
        : "No pudimos actualizar.",
    );
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk({ id });
}

export async function deleteStation(
  businessSlug: string,
  id: string,
): Promise<ActionResult<null>> {
  // categories.station_id y products.station_id son ON DELETE SET NULL así
  // que se desreferencian limpio. PERO comandas.station_id es ON DELETE
  // RESTRICT — si el sector ya tiene comandas históricas, falla con 23503.
  // Capturamos ese caso y sugerimos usar `is_active=false` en su lugar.
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;

  const supabase = await createSupabaseServerClient();

  // Spec 180 — las 2ª/3ª comanderas viven en un `uuid[]` sin FK, así que el
  // SET NULL no las alcanza. Se sacan a mano antes de borrar: un id muerto en
  // el array sería un bucket de ruteo a un sector que no existe.
  const bizId = guard.data.businessId;
  const { data: cats } = await supabase
    .from("categories")
    .select("id, extra_station_ids")
    .eq("business_id", bizId)
    .contains("extra_station_ids", [id]);
  for (const c of (cats ?? []) as { id: string; extra_station_ids: string[] }[]) {
    await supabase
      .from("categories")
      .update({ extra_station_ids: c.extra_station_ids.filter((x) => x !== id) })
      .eq("id", c.id);
  }
  const { data: prods } = await supabase
    .from("products")
    .select("id, extra_station_ids")
    .eq("business_id", bizId)
    .contains("extra_station_ids", [id]);
  for (const p of (prods ?? []) as { id: string; extra_station_ids: string[] }[]) {
    await supabase
      .from("products")
      .update({ extra_station_ids: p.extra_station_ids.filter((x) => x !== id) })
      .eq("id", p.id);
  }

  const { error } = await supabase
    .from("stations")
    .delete()
    .eq("id", id)
    .eq("business_id", bizId);
  if (error) {
    console.error("deleteStation", error);
    if (error.code === "23503") {
      return actionError(
        "No podés borrar este sector porque tiene comandas históricas. Marcalo como inactivo en su lugar.",
      );
    }
    return actionError("No pudimos borrar el sector.");
  }
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

/**
 * Configura la comandera (impresora térmica) de un sector (spec 28). La IP vive
 * en `stations` (no es secreto: LAN). Gate `canManageBusiness` (admin/platform,
 * igual que el resto de `/admin/configuracion`); update scopeado por
 * `business_id` para no tocar sectores de otro negocio. IP vacía → null = sector
 * sin impresora (el print agent lo saltea).
 */
export async function setStationPrinter(
  businessSlug: string,
  stationId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = StationPrinterInput.safeParse(input);
  if (!parsed.success) {
    console.error("setStationPrinter · invalid input", {
      input,
      issues: parsed.error.issues,
    });
    const first = parsed.error.issues[0];
    return actionError(
      first ? `${first.path.join(".") || "campo"}: ${first.message}` : "Datos inválidos.",
    );
  }

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para configurar las comanderas.");
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("stations")
    .update({
      printer_ip: parsed.data.printer_ip,
      printer_port: parsed.data.printer_port,
      printer_enabled: parsed.data.printer_enabled,
    })
    .eq("id", stationId)
    .eq("business_id", business.id);

  if (error) {
    console.error("setStationPrinter", error);
    return actionError("No pudimos guardar la comandera.");
  }

  revalidatePath(`/${businessSlug}/admin/configuracion`);
  return actionOk(null);
}

/**
 * Reordena los sectores de un business. Bulk update en dos pasos para evitar
 * colisiones intermedias. Mismo patrón que `reorderSuperCategories`.
 */
export async function reorderStations(
  businessSlug: string,
  idsInOrder: string[],
): Promise<ActionResult<null>> {
  const guard = await requireCatalogManager(businessSlug);
  if (!guard.ok) return guard;
  const businessId = guard.data.businessId;

  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("stations")
    .select("id")
    .eq("business_id", businessId);
  if (!existing) return actionError("No pudimos leer los sectores.");

  const existingIds = new Set(existing.map((r) => r.id));
  const inputIds = new Set(idsInOrder);
  if (
    existingIds.size !== inputIds.size ||
    [...existingIds].some((id) => !inputIds.has(id))
  ) {
    return actionError("Lista de orden inconsistente.");
  }

  for (let i = 0; i < idsInOrder.length; i++) {
    await supabase
      .from("stations")
      .update({ sort_order: 100_000 + i })
      .eq("id", idsInOrder[i]!)
      .eq("business_id", businessId);
  }
  for (let i = 0; i < idsInOrder.length; i++) {
    await supabase
      .from("stations")
      .update({ sort_order: i })
      .eq("id", idsInOrder[i]!)
      .eq("business_id", businessId);
  }

  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk(null);
}

/**
 * Comandera de **control** del negocio (spec 063): dónde se imprime el "control
 * de pedido" que se lleva el repartidor. Es un destino único del local, no un
 * sector más, así que vive en `businesses` — pero se configura en la misma
 * pantalla y con la misma validación que las comanderas por sector.
 */
export async function setControlPrinter(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = StationPrinterInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first ? `${first.path.join(".") || "campo"}: ${first.message}` : "Datos inválidos.",
    );
  }

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para configurar las comanderas.");
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("businesses")
    .update({
      control_printer_ip: parsed.data.printer_ip,
      control_printer_port: parsed.data.printer_port,
      control_printer_enabled: parsed.data.printer_enabled,
    })
    .eq("id", business.id);

  if (error) {
    console.error("setControlPrinter", error);
    return actionError("No pudimos guardar la comandera de control.");
  }

  revalidatePath(`/${businessSlug}/admin/configuracion`);
  return actionOk(null);
}

/**
 * Comandera de **cuentas** del negocio (spec 080): el default del local para el
 * papel que se le da a la mesa. Un salón puede pisarla con la suya
 * (`setFloorPlanCuentaPrinter`).
 */
export async function setCuentaPrinter(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = StationPrinterInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first ? `${first.path.join(".") || "campo"}: ${first.message}` : "Datos inválidos.",
    );
  }

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para configurar las comanderas.");
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("businesses")
    .update({
      cuenta_printer_ip: parsed.data.printer_ip,
      cuenta_printer_port: parsed.data.printer_port,
      cuenta_printer_enabled: parsed.data.printer_enabled,
    })
    .eq("id", business.id);

  if (error) {
    console.error("setCuentaPrinter", error);
    return actionError("No pudimos guardar la comandera de cuentas.");
  }

  revalidatePath(`/${businessSlug}/admin/configuracion`);
  return actionOk(null);
}

/**
 * Comandera de cuentas propia de un **salón** (spec 080). IP vacía = hereda la
 * del negocio; el switch apagado = ese salón no imprime cuentas (el "off"
 * explícito gana, no cae al fallback).
 */
export async function setFloorPlanCuentaPrinter(
  businessSlug: string,
  floorPlanId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = StationPrinterInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first ? `${first.path.join(".") || "campo"}: ${first.message}` : "Datos inválidos.",
    );
  }

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para configurar las comanderas.");
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("floor_plans")
    .update({
      cuenta_printer_ip: parsed.data.printer_ip,
      cuenta_printer_port: parsed.data.printer_port,
      cuenta_printer_enabled: parsed.data.printer_enabled,
    })
    .eq("id", floorPlanId)
    // Scope por negocio: sin esto se podría configurar el salón de otro tenant.
    .eq("business_id", business.id);

  if (error) {
    console.error("setFloorPlanCuentaPrinter", error);
    return actionError("No pudimos guardar la comandera del salón.");
  }

  revalidatePath(`/${businessSlug}/admin/configuracion`);
  return actionOk(null);
}

/**
 * Comandera **fiscal** de una caja (spec 084): dónde sale la factura impresa
 * de los cobros de esa caja. Por caja y no por negocio porque el papel fiscal
 * tiene que salir donde está parado el que cobra.
 */
export async function setCajaFiscalPrinter(
  businessSlug: string,
  cajaId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  const parsed = StationPrinterInput.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return actionError(
      first ? `${first.path.join(".") || "campo"}: ${first.message}` : "Datos inválidos.",
    );
  }

  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await ensureAdminAccess(business.id, businessSlug);
  if (!canManageBusiness(ctx)) {
    return actionError("No tenés permisos para configurar las comanderas.");
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("cajas")
    .update({
      fiscal_printer_ip: parsed.data.printer_ip,
      fiscal_printer_port: parsed.data.printer_port,
      fiscal_printer_enabled: parsed.data.printer_enabled,
    })
    .eq("id", cajaId)
    // Scope por negocio: sin esto se podría configurar la caja de otro tenant.
    .eq("business_id", business.id);

  if (error) {
    console.error("setCajaFiscalPrinter", error);
    return actionError("No pudimos guardar la comandera fiscal.");
  }

  revalidatePath(`/${businessSlug}/admin/configuracion`);
  return actionOk(null);
}

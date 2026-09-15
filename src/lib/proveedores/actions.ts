"use server";


import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { getCajaAdministrativa } from "@/lib/caja/queries";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { canMakeSangria, canManageProveedores } from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { calcularVencimiento } from "./cuenta-corriente";
// Los del lector (contrato 1): `normalizarCuit` devuelve 11 dígitos o null, y
// `cuitValido` corre módulo 11. No son los de `@/lib/afip/cuit`, que sólo cuenta
// dígitos porque ahí el que valida de verdad es el gateway de ARCA.
import { cuitValido, normalizarCuit } from "./lectura/cuit";
import { conceptoEsDelNegocio } from "./queries";
import { ImportSupplierBatch, SupplierInput, SupplierInvoiceInput } from "./schema";

// ── Helpers ──────────────────────────────────────────────────────

async function getBusinessIdBySlug(slug: string): Promise<string | null> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("businesses")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return data?.id ?? null;
}

// Las columnas de la spec 158 (`default_expense_concept_id`, `payment_terms_days`,
// `expense_concept_id`, `document_type`, `due_date`) todavía no están en
// `database.types.ts`: el `pnpm db:types` del repo necesita el CLI linkeado.
// Mismo escape hatch que `caja/cuenta-corriente-actions.ts` de la spec 141.
type GenericClient = SupabaseClient;

function db(): GenericClient {
  return createSupabaseServiceClient() as unknown as GenericClient;
}

async function requireProveedorContext(businessId: string) {
  const ctxResult = await requireMozoActionContext(businessId);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;
  if (!canManageProveedores(ctx.role) && !ctx.isPlatformAdmin) {
    return actionError("Solo admin o encargado pueden gestionar proveedores.");
  }
  return actionOk(ctx);
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIERS (PROVEEDORES)
// ═══════════════════════════════════════════════════════════════════

export async function createSupplier(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = SupplierInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();
  const { data, error } = await service
    .from("suppliers")
    .insert({
      ...parsed.data,
      email: parsed.data.email || null,
      business_id: businessId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createSupplier", error);
    return actionError(
      error?.code === "23505"
        ? "Ya existe un proveedor con ese nombre."
        : "No pudimos crear el proveedor.",
    );
  }
  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk({ id: data.id });
}

export async function updateSupplier(
  businessSlug: string,
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = SupplierInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();
  const { error } = await service
    .from("suppliers")
    .update({ ...parsed.data, email: parsed.data.email || null })
    .eq("id", id)
    .eq("business_id", businessId);

  if (error) {
    console.error("updateSupplier", error);
    return actionError(
      error.code === "23505"
        ? "Ya existe un proveedor con ese nombre."
        : "No pudimos actualizar el proveedor.",
    );
  }
  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk({ id });
}

export async function deactivateSupplier(
  businessSlug: string,
  id: string,
): Promise<ActionResult<void>> {
  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();
  const { error } = await service
    .from("suppliers")
    .update({ is_active: false })
    .eq("id", id)
    .eq("business_id", businessId);

  if (error) {
    console.error("deactivateSupplier", error);
    return actionError("No pudimos desactivar el proveedor.");
  }
  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk(undefined);
}

/**
 * Alta de proveedor con lo que el modelo leyó de la foto — spec 173.
 *
 * Es el «no está en la lista» de la banda de proveedor: la foto trajo un nombre
 * y quizás un CUIT, ninguno de los candidatos es, y obligar a salir a la ficha
 * de proveedores para volver después es exactamente la vuelta que la spec vino a
 * sacar («que sea un botón general y que desde ahí busque todos los datos»).
 *
 * Delega en `createSupplier`: misma validación Zod, mismo chequeo de permisos,
 * mismo 23505 traducido. Duplicar el insert acá era la forma segura de que el
 * día que se agregue un campo obligatorio esta puerta quede sin él.
 *
 * **El CUIT entra sólo si pasa módulo 11.** Lo que el modelo lee de un papel
 * arrugado tiene dígitos de más y de menos, y en golf-jcr ya viven 10 CUIT
 * basura de la migración de MaxiRest que hoy no matchean con nada y no se sabe
 * si son un error de tipeo o un proveedor distinto. Vacío se completa mirando la
 * factura; un CUIT falso se descubre el día que no factura.
 */
export async function crearProveedorDesdeLectura(
  businessSlug: string,
  datos: { nombre: string; cuit: string | null },
): Promise<ActionResult<{ id: string }>> {
  // El nombre lo escribió el modelo, no una persona: puede venir con espacios de
  // más o larguísimo (media razón social con domicilio pegado). Se corta al
  // máximo de la columna en vez de rebotar con «Datos inválidos», que desde la
  // banda no se puede corregir sin perder la lectura entera.
  const nombre = (datos.nombre ?? "").trim().slice(0, 100);
  if (!nombre) return actionError("Falta el nombre del proveedor.");

  const cuit11 = normalizarCuit(datos.cuit);
  const cuit = cuit11 && cuitValido(cuit11) ? cuit11 : null;

  return createSupplier(businessSlug, { name: nombre, cuit, is_active: true });
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIER INVOICES (FACTURAS DE COMPRA)
// ═══════════════════════════════════════════════════════════════════

/**
 * Qué pasó con el pago al cargar la compra — spec 187.
 *
 * `pendiente` es el estado raro que la D3 decide NO tapar: el comprobante quedó
 * bien y el pago no salió. Se nombra para que la pantalla lo pueda decir; un
 * estado raro que se tapa es un bug.
 */
export type EstadoPagoCompra = "no_aplica" | "registrado" | "pendiente";

export async function createSupplierInvoice(
  businessSlug: string,
  input: unknown,
): Promise<ActionResult<{ id: string; pago: EstadoPagoCompra }>> {
  const parsed = SupplierInvoiceInput.safeParse(input);
  if (!parsed.success) return actionError("Datos inválidos.");

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();

  // spec 158 · el proveedor precarga la compra. Sin esto el encargado tipea el
  // concepto y calcula el vencimiento a mano diez veces por día — que es
  // exactamente la fricción que el módulo viene a sacar.
  const { data: supplier } = await service
    .from("suppliers")
    .select("id, name, default_expense_concept_id, payment_terms_days")
    .eq("id", parsed.data.supplier_id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (!supplier) return actionError("Proveedor no encontrado.");
  const prov = supplier as unknown as {
    name: string;
    default_expense_concept_id: string | null;
    payment_terms_days: number | null;
  };

  const conceptId =
    parsed.data.expense_concept_id ?? prov.default_expense_concept_id ?? null;

  // Issue #268 · el concepto tiene que ser de ESTE negocio. El FK apunta a
  // `expense_concepts(id)` a secas y el service client bypassa RLS, así que sin
  // esto un id ajeno entra igual: el comprobante queda clasificado en la ficha
  // y en «Sin concepto» en el informe de la 158, para siempre. Mismo chequeo
  // que ya hace `linkSupplierIngredients` con los insumos.
  if (!(await conceptoEsDelNegocio(service, businessId, conceptId))) {
    return actionError("El concepto de gasto no es de este negocio.");
  }

  /**
   * Las guardas del contado corren ANTES de crear el comprobante — spec 187·D2.
   *
   * Las tres cosas que pueden decir que no al pago en efectivo —el permiso de
   * sangría, que exista la Caja Mayor y que esté activa— son verificables sin
   * escribir una fila. Chequearlas después dejaría la compra cargada y un «no»
   * que habla de otra pantalla; chequearlas acá deja el formulario intacto y el
   * arreglo a un click (cambiar el medio, o destildar contado).
   */
  const alContado = parsed.data.payment_condition === "contado";
  let cajaAdminId: string | null = null;

  if (alContado && parsed.data.payment_method === "cash") {
    // Sacar plata del cajón no puede tener un techo más bajo por entrar desde la
    // pantalla de carga que desde el diálogo de pago (187·D5).
    if (!canMakeSangria(ctxResult.data.role) && !ctxResult.data.isPlatformAdmin) {
      return actionError("Solo encargado o admin pueden sacar efectivo de la caja.");
    }
    const cajaAdmin = await getCajaAdministrativa(businessId);
    if (!cajaAdmin) {
      return actionError(
        "Este negocio todavía no tiene Caja Mayor, así que no se puede pagar en efectivo. Cargala en cuenta corriente y avisale al equipo.",
      );
    }
    if (!cajaAdmin.is_active) {
      return actionError("La Caja Mayor está inactiva: no se puede pagar en efectivo.");
    }
    cajaAdminId = cajaAdmin.id;
  }

  const dueDate =
    parsed.data.due_date ??
    calcularVencimiento(parsed.data.invoice_date, prov.payment_terms_days ?? 0);

  /**
   * Las páginas del comprobante — spec 173.
   *
   * Se escriben LAS DOS columnas. `photo_urls` es la nueva y `photo_url` la
   * vieja, que la migración no dropea: entre que la migración se aplica y que
   * el deploy está arriba, el diálogo viejo sigue mandando `photo_url` solo, y
   * la ficha del proveedor —que todavía muestra una foto— sigue leyendo la
   * columna vieja. Escribir las dos hace que las dos versiones del código vean
   * lo mismo mientras dure la ventana.
   *
   * `photo_url` se queda con la PRIMERA página, que es la que trae el
   * encabezado: si un ticket de un metro entró en cuatro fotos, la que sirve
   * para reconocer la compra de un vistazo es la primera.
   */
  const photoUrls =
    parsed.data.photo_urls.length > 0
      ? parsed.data.photo_urls
      : parsed.data.photo_url
        ? [parsed.data.photo_url]
        : [];

  const { data, error } = await service
    .from("supplier_invoices")
    .insert({
      business_id: businessId,
      supplier_id: parsed.data.supplier_id,
      invoice_number: parsed.data.invoice_number ?? null,
      invoice_date: parsed.data.invoice_date,
      total_cents: parsed.data.total_cents,
      photo_urls: photoUrls,
      photo_url: photoUrls[0] ?? null,
      notes: parsed.data.notes ?? null,
      created_by: ctxResult.data.userId,
      document_type: parsed.data.document_type,
      expense_concept_id: conceptId,
      due_date: dueDate,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createSupplierInvoice", error);
    // Issue #268 · el índice único parcial de la 0085. El módulo no tenía NINGÚN
    // chequeo de duplicado: el mismo taco de papeles cargado dos veces duplicaba
    // la deuda con el proveedor y —si traía renglones— el stock. Se traduce acá
    // igual que el 23505 de `suppliers`, porque el que carga no tiene por qué
    // saber que hay un índice.
    return actionError(
      error?.code === "23505"
        ? "Ya cargaste este comprobante de este proveedor con ese número."
        : "No pudimos cargar la factura.",
    );
  }

  // spec 165 · el detalle por insumo, si vino. Una RPC: cada renglón toca la
  // línea, el stock, el consumo y el precio del insumo, y un fallo a mitad
  // dejaría stock sumado sin rastro o precio nuevo sin mercadería.
  //
  // Si los renglones fallan, el comprobante NO queda: se anula, porque un
  // comprobante que el usuario cargó con detalle y quedó sin él es peor que
  // ninguno — parece cargado y no movió nada.
  if (parsed.data.items.length > 0) {
    const { error: itemsErr } = await service.rpc("registrar_items_comprobante_tx", {
      p_business_id: businessId,
      p_invoice_id: data.id,
      p_created_by: ctxResult.data.userId,
      p_items: parsed.data.items,
    });

    if (itemsErr) {
      console.error("createSupplierInvoice · items", itemsErr);
      await service
        .from("supplier_invoices")
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by: ctxResult.data.userId,
          cancelled_reason: "Revertido: falló la carga del detalle por insumo",
        })
        .eq("id", data.id);
      return actionError(
        itemsErr.message?.includes("INSUMO_DE_OTRO_NEGOCIO")
          ? "Uno de los insumos no es de este negocio."
          : "No pudimos cargar el detalle por insumo. El comprobante no se guardó.",
      );
    }
  }

  /**
   * spec 187 · el contado, que es el pago del diálogo de pago sin el rodeo.
   *
   * Va DESPUÉS de los renglones a propósito: si los renglones fallan el
   * comprobante ya se anuló solo (165·D3) y pagar un comprobante anulado es lo
   * que la RPC rechaza con COMPROBANTE_NO_DISPONIBLE.
   *
   * `paid_at` es la fecha del comprobante —contado significa que la plata salió
   * contra ese papel— y el movimiento de caja lo estampa la RPC con `now()`:
   * son dos hechos distintos y la Caja Mayor se entera hoy (187·D4). Como el
   * egreso va a la caja administrativa, que no corta nunca (160), cargar el
   * remito del martes no puede descuadrar el arqueo del martes.
   */
  let pago: EstadoPagoCompra = "no_aplica";

  if (alContado) {
    const { data: rpcPago, error: pagoErr } = await service.rpc(
      "registrar_pago_proveedor_tx",
      {
        p_business_id: businessId,
        p_supplier_id: parsed.data.supplier_id,
        p_amount_cents: parsed.data.total_cents,
        p_method: parsed.data.payment_method,
        p_paid_at: parsed.data.invoice_date,
        p_notes: null,
        p_created_by: ctxResult.data.userId,
        p_caja_id: cajaAdminId,
        p_caja_reason: `Pago a proveedor · ${prov.name}`,
        p_imputaciones: [{ invoice_id: data.id, amount_cents: parsed.data.total_cents }],
      },
    );

    const fila = (rpcPago as Array<{ payment_id: string }> | null)?.[0];
    if (pagoErr || !fila) {
      /**
       * El comprobante NO se anula — spec 187·D3.
       *
       * Un comprobante sin pago es un estado válido: es la cuenta corriente,
       * donde vivían todos hasta ayer. Anularlo además obligaría a revertir los
       * renglones que ya entraron (stock adentro, costo pisado, histórico
       * escrito): perder trabajo bueno para dejar la pantalla prolija.
       */
      console.error("createSupplierInvoice · pago al contado", pagoErr);
      pago = "pendiente";
    } else {
      pago = "registrado";
      revalidatePath(`/${businessSlug}/admin/caja/movimientos`);
    }
  }

  revalidatePath(`/${businessSlug}/admin/proveedores`);
  revalidatePath(`/${businessSlug}/admin/catalogo`);
  return actionOk({ id: data.id, pago });
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIER ↔ INGREDIENTS (VÍNCULO N:N)
// ═══════════════════════════════════════════════════════════════════

export async function linkSupplierIngredients(
  businessSlug: string,
  supplierId: string,
  ingredientIds: string[],
): Promise<ActionResult<void>> {
  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();

  // Validar tenant de supplier + insumos: el service client bypassa RLS y los
  // FK sólo chequean existencia, no negocio. Sin esto, un admin del negocio A
  // podría pasar ids del negocio B y crear vínculos cruzados.
  const { data: supplier } = await service
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!supplier) return actionError("Proveedor no encontrado.");

  if (ingredientIds.length > 0) {
    const { data: owned } = await service
      .from("ingredients")
      .select("id")
      .eq("business_id", businessId)
      .in("id", ingredientIds);
    const ownedIds = new Set((owned ?? []).map((r: { id: string }) => r.id));
    if (ingredientIds.some((id) => !ownedIds.has(id))) {
      return actionError("Algún insumo no pertenece a este negocio.");
    }
  }

  // Atomic replace: delete existing, insert new
  await service
    .from("supplier_ingredients")
    .delete()
    .eq("supplier_id", supplierId)
    .eq("business_id", businessId);

  if (ingredientIds.length > 0) {
    const rows = ingredientIds.map((ingredientId) => ({
      supplier_id: supplierId,
      ingredient_id: ingredientId,
      business_id: businessId,
    }));
    const { error } = await service.from("supplier_ingredients").insert(rows);
    if (error) {
      console.error("linkSupplierIngredients", error);
      return actionError("No pudimos vincular los insumos.");
    }
  }

  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk(undefined);
}

// ═══════════════════════════════════════════════════════════════════
// IMPORT MASIVO
// ═══════════════════════════════════════════════════════════════════

export async function importSuppliers(
  businessSlug: string,
  rows: unknown,
): Promise<ActionResult<{ created: number; updated: number; errors: number }>> {
  const parsed = ImportSupplierBatch.safeParse(rows);
  if (!parsed.success) return actionError("Datos del lote inválidos.");

  const businessId = await getBusinessIdBySlug(businessSlug);
  if (!businessId) return actionError("Negocio no encontrado.");

  const ctxResult = await requireProveedorContext(businessId);
  if (!ctxResult.ok) return ctxResult;

  const service = db();
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const row of parsed.data) {
    const { data: existing } = await service
      .from("suppliers")
      .select("id")
      .eq("business_id", businessId)
      .eq("name", row.name)
      .maybeSingle();

    if (existing) {
      const { error } = await service
        .from("suppliers")
        .update({
          cuit: row.cuit ?? null,
          contact: row.contact ?? null,
          phone: row.phone ?? null,
          email: row.email || null,
        })
        .eq("id", existing.id);
      if (error) {
        errors++;
        console.error("importSuppliers update", row.name, error);
      } else {
        updated++;
      }
    } else {
      const { error } = await service.from("suppliers").insert({
        business_id: businessId,
        name: row.name,
        cuit: row.cuit ?? null,
        contact: row.contact ?? null,
        phone: row.phone ?? null,
        email: row.email || null,
      });
      if (error) {
        errors++;
        console.error("importSuppliers insert", row.name, error);
      } else {
        created++;
      }
    }
  }

  revalidatePath(`/${businessSlug}/admin/proveedores`);
  return actionOk({ created, updated, errors });
}

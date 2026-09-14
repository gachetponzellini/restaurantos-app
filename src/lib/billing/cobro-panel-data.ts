"use server";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { canFiar } from "@/lib/permissions/can";
import { canSee } from "@/lib/permissions/sections";
import { getClientesParaFiar } from "@/lib/caja/cuenta-corriente-queries";
import { getInvoiceForOrder } from "@/lib/afip/queries";
import type { Invoice } from "@/lib/afip/types";
import type { BusinessRole } from "@/lib/admin/context";
import type { IniciarCobroResult } from "@/lib/billing/cobro-actions";
import { getCuentaForTable } from "@/lib/billing/cuenta-query";
import type { CuentaState } from "@/lib/billing/types";
import {
  getCajasForBusiness,
  getPaymentMethodConfigs,
} from "@/lib/caja/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

/**
 * Datos para el cobro EMBEBIDO en el panel del salón (vista del encargado).
 *
 * Equivalente a lo que hace `app/[business_slug]/admin/(authed)/mesa/[id]/
 * cobrar/page.tsx`, pero como server action cliente-llamable para abrir el
 * cobro sin navegar (mismo patrón que `lib/mozo/pedir-panel-data.ts`).
 *
 * Perf — esta es la ruta caliente del cobro embebido. Contra la DB cloud cada
 * round-trip cuesta ~600ms desde dev, así que minimizamos las OLAS secuenciales:
 *
 *   Ola 1:  auth.getUser()  ∥  getBusiness(slug)
 *           (no dependen entre sí: getUser solo mira la cookie, getBusiness el
 *            slug → en paralelo en vez de uno tras otro).
 *   Ola 2:  membership ∥ perfil ∥ label ∥ cuenta ∥ cajas ∥ configs
 *           (todo depende solo de business.id + user.id, ya resueltos).
 *
 * Antes eran 3 olas (getBusiness → ensureAdminAccess(auth) → datos). Además NO
 * llamamos a `iniciarCobro` (re-autenticaría y recargaría orden + splits que la
 * cuenta ya trae): ensamblamos el `IniciarCobroResult` con lo ya cargado. Cero
 * lógica de dinero nueva.
 *
 * Los estados borde se devuelven como DATA (`no_cuenta` / `no_caja`) en vez de
 * páginas, para que el panel los pinte inline.
 */

export type CobroPanelData =
  | {
      kind: "ok";
      cuenta: CuentaState;
      init: IniciarCobroResult;
      tableLabel: string;
      /** El negocio tiene AFIP configurado (CUIT + punto de venta): el panel
       *  ofrece emitir el comprobante al cobrar y no se cierra solo (#137).
       *  Sale de `business`, sin query extra en la ruta caliente. */
      afipConfigured: boolean;
      /** Factura ya emitida para esta orden. Sin esto el panel mostraría el
       *  formulario sobre una orden ya facturada, y el guard del server es
       *  por TIPO (`invoices_order_tipo_active_uq`): dejaría pasar una A
       *  sobre una B existente. Sólo se consulta si el negocio factura. */
      existingInvoice: Invoice | null;
      /**
       * Clientes a los que se les puede fiar, con su saldo (spec 141 · D2/D7).
       * Vacío ⇒ el método «Cuenta corriente» no se ofrece: o el rol no puede
       * fiar, o el negocio todavía no habilitó a nadie.
       */
      clientesParaFiar: {
        id: string;
        name: string | null;
        phone: string;
        saldo_cents: number;
      }[];
    }
  | { kind: "no_cuenta"; tableLabel: string }
  | { kind: "no_caja"; error: string; tableLabel: string };

/** Datos para el paso de CUENTA embebido (propina/descuento/dividir) previo al
 *  cobro, en el panel del salón. Más liviano que el cobro: solo cuenta + label. */
export type CuentaPanelData =
  | { kind: "ok"; cuenta: CuentaState; tableLabel: string }
  | { kind: "no_cuenta"; tableLabel: string };

/** Label de la mesa con guard cross-tenant (mesa ∈ floor_plan del business). */
async function loadTableLabel(
  tableId: string,
  businessId: string,
): Promise<string | null> {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("tables")
    .select("label, floor_plans!inner(business_id)")
    .eq("id", tableId)
    .maybeSingle();
  if (!data) return null;
  const fpRaw = (data as unknown as { floor_plans: unknown }).floor_plans;
  const fp = Array.isArray(fpRaw)
    ? (fpRaw[0] as { business_id: string } | undefined)
    : (fpRaw as { business_id: string } | null);
  if (!fp || fp.business_id !== businessId) return null;
  return (data as { label: string }).label;
}

export async function loadCobroForTable(
  slug: string,
  tableId: string,
): Promise<ActionResult<CobroPanelData>> {
  const supabase = await createSupabaseServerClient();
  const service = createSupabaseServiceClient();

  // ── Ola 1: auth + negocio en paralelo (no dependen entre sí). ──
  const [userRes, business] = await Promise.all([
    supabase.auth.getUser(),
    getBusiness(slug),
  ]);
  const user = userRes.data.user;
  if (!user) return actionError("Sesión expirada. Iniciá sesión nuevamente.");
  if (!business) return actionError("Negocio no encontrado.");

  // ── Ola 2: autorización + todos los datos, en paralelo. ──
  // Las queries de datos usan service client scopeado por business.id; solo se
  // devuelven si la autorización pasa. Un request sin sesión ya fue rechazado
  // en la Ola 1, así que nunca tocamos datos sin un usuario autenticado.
  const [membershipRes, profileRes, tableLabel, cuenta, cajas, methodConfigs] =
    await Promise.all([
      service
        .from("business_users")
        .select("role, disabled_at")
        .eq("business_id", business.id)
        .eq("user_id", user.id)
        .maybeSingle(),
      service
        .from("users")
        .select("is_platform_admin")
        .eq("id", user.id)
        .maybeSingle(),
      loadTableLabel(tableId, business.id),
      getCuentaForTable(tableId, business.id),
      getCajasForBusiness(business.id),
      getPaymentMethodConfigs(business.id),
    ]);

  // Autorización: la matriz de secciones, la misma que abre el plano (#294).
  // La lista a mano —admin o encargado— dejaba afuera a la `terminal`, que
  // ve el salón pero recibía «No tenés permisos» al tocar «Cobrar».
  const isPlatformAdmin =
    (profileRes.data as { is_platform_admin: boolean } | null)
      ?.is_platform_admin ?? false;
  const membership = membershipRes.data as {
    role: BusinessRole;
    disabled_at: string | null;
  } | null;
  const role = membership?.role ?? null;
  const disabled = !!membership?.disabled_at;
  const authorized =
    isPlatformAdmin ||
    (!disabled && canSee("operacion", role, { isPlatformAdmin }));
  if (!authorized) return actionError("No tenés permisos.");

  if (tableLabel === null) return actionError("Mesa no encontrada.");
  // Sin order abierta → no hay nada que cobrar.
  if (!cuenta) return actionOk({ kind: "no_cuenta", tableLabel });
  // Sin caja abierta → no se puede asentar el cobro (misma regla que iniciarCobro).
  if (cajas.length === 0) {
    return actionOk({
      kind: "no_caja",
      error: "No hay caja configurada. Pedile al admin que cree una.",
      tableLabel,
    });
  }

  // Ensamblamos el resultado de iniciarCobro con lo ya cargado. `order` se
  // mapea desde `cuenta.order` (la UI del cobro no lo usa, pero el contrato
  // del tipo lo pide). getCuentaForTable ya garantizó order abierta.
  const init: IniciarCobroResult = {
    order: {
      id: cuenta.order.id,
      business_id: cuenta.order.business_id,
      order_number: cuenta.order.order_number,
      table_id: cuenta.order.table_id,
      lifecycle_status: cuenta.order.lifecycle_status,
      status: cuenta.order.status,
      total_cents: cuenta.order.total_cents,
      total_paid_cents: cuenta.order.total_paid_cents,
      tip_cents: cuenta.order.tip_cents,
      discount_cents: cuenta.order.discount_cents,
    },
    splits: cuenta.splits,
    // Una división cancelada no divide nada: su `expected` ya volvió a las
    // vivas (o a la mesa entera). Contándola, una mesa a la que le limpiaron la
    // división llegaba al cobro con una sub-cuenta «Cancelado», sin fila para
    // cobrar y sin «Mesa completa» — no se podía cobrar (issue #189).
    hasImplicitSplit: cuenta.splits.every((s) => s.status === "cancelled"),
    cajas,
    methodConfigs,
  };

  const biz = business as unknown as Record<string, unknown>;
  const afipConfigured = !!(biz.afip_cuit && biz.afip_punto_venta);

  // Ola 3, y sólo para negocios que facturan: la invoice depende de
  // `cuenta.order.id`, que recién existe después de la ola 2. Un negocio sin
  // AFIP no paga este round-trip.
  const existingInvoice = afipConfigured
    ? await getInvoiceForOrder(business.id, cuenta.order.id)
    : null;

  // spec 141 — sólo si el rol puede fiar. Un negocio que no usa cuentas
  // corrientes tampoco paga este viaje: la query corta con la lista vacía.
  const clientesParaFiar =
    role && canFiar(role) ? await getClientesParaFiar(business.id) : [];

  return actionOk({
    kind: "ok",
    cuenta,
    init,
    tableLabel,
    afipConfigured,
    existingInvoice,
    clientesParaFiar,
  });
}

export async function loadCuentaForTable(
  slug: string,
  tableId: string,
): Promise<ActionResult<CuentaPanelData>> {
  const supabase = await createSupabaseServerClient();
  const service = createSupabaseServiceClient();

  // Ola 1: auth ∥ negocio.
  const [userRes, business] = await Promise.all([
    supabase.auth.getUser(),
    getBusiness(slug),
  ]);
  const user = userRes.data.user;
  if (!user) return actionError("Sesión expirada. Iniciá sesión nuevamente.");
  if (!business) return actionError("Negocio no encontrado.");

  // Ola 2: autorización ∥ datos (label + cuenta).
  const [membershipRes, profileRes, tableLabel, cuenta] = await Promise.all([
    service
      .from("business_users")
      .select("role, disabled_at")
      .eq("business_id", business.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    service
      .from("users")
      .select("is_platform_admin")
      .eq("id", user.id)
      .maybeSingle(),
    loadTableLabel(tableId, business.id),
    getCuentaForTable(tableId, business.id),
  ]);

  const isPlatformAdmin =
    (profileRes.data as { is_platform_admin: boolean } | null)
      ?.is_platform_admin ?? false;
  const membership = membershipRes.data as {
    role: BusinessRole;
    disabled_at: string | null;
  } | null;
  const role = membership?.role ?? null;
  const disabled = !!membership?.disabled_at;
  const authorized =
    isPlatformAdmin ||
    (!disabled && canSee("operacion", role, { isPlatformAdmin }));
  if (!authorized) return actionError("No tenés permisos.");

  if (tableLabel === null) return actionError("Mesa no encontrada.");
  if (!cuenta) return actionOk({ kind: "no_cuenta", tableLabel });
  return actionOk({ kind: "ok", cuenta, tableLabel });
}

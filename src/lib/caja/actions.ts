"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import { assignMozoToTable } from "@/lib/mozo/actions";
import { requireMozoActionContext } from "@/lib/mozo/auth";
import { notifyRendicionPendiente } from "@/lib/notifications/events";
import {
  canAcceptCajaDifference,
  canAssignMozo,
  canHacerCorte,
  canMakeSangria,
  canManageCajas,
  canRendirMozo,
  DIFERENCIA_CAJA_OK_CENTS,
} from "@/lib/permissions/can";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { formatCurrency } from "@/lib/currency";
import { getBusiness } from "@/lib/tenant";

import { mozosQueDebenRendir } from "./deben-rendir";
import {
  getCajaLiveStats,
  getCuentasAbiertas,
  getDefaultCaja,
  getMovimientosPeriodoActual,
  getOperadoresDeCaja,
  getRendicionesPendientesTodosLosMozos,
  getRendicionPendienteMozo,
} from "./queries";
import type {
  CajaCorte,
  CierreResumenSnapshot,
  MozoRendicion,
  PaymentMethod,
  RendicionEstado,
  VentaOrigen,
} from "./types";

type GenericClient = SupabaseClient;

// ── Helpers internos ───────────────────────────────────────────

async function loadCajaForBusiness(
  service: GenericClient,
  cajaId: string,
  businessId: string,
): Promise<{
  id: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  is_administrative: boolean;
} | null> {
  const { data } = await service
    .from("cajas")
    .select("id, business_id, name, is_active, is_default, is_administrative")
    .eq("id", cajaId)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    business_id: string;
    name: string;
    is_active: boolean;
    is_default: boolean;
    is_administrative: boolean;
  };
  if (row.business_id !== businessId) return null;
  return {
    id: row.id,
    name: row.name,
    is_active: row.is_active,
    is_default: row.is_default,
    is_administrative: row.is_administrative,
  };
}

/**
 * spec 160 · el mensaje único para cuando alguien apunta a la caja mayor desde una
 * pantalla de turno. Se comparte para que diga lo mismo en los cuatro caminos.
 */
/**
 * spec 168 · D5 — un movimiento sobre la caja administrativa no se ve en el board
 * del turno: se ve en Proveedores (la tarjeta del saldo) y en el libro. Revalidar
 * sólo `/admin/operacion` dejaba las dos pantallas que sí lo muestran con el
 * número viejo.
 */
function revalidarMovimiento(
  businessSlug: string,
  esAdministrativa: boolean,
): void {
  if (esAdministrativa) {
    revalidatePath(`/${businessSlug}/admin/proveedores`);
    revalidatePath(`/${businessSlug}/admin/caja/movimientos`);
    return;
  }
  revalidatePath(`/${businessSlug}/admin/operacion`);
}

const NO_ES_CAJA_DE_TURNO =
  "La Caja Mayor no es una caja de turno: no cobra ni se arquea. Los pagos a proveedor salen de ahí desde Proveedores.";

// ── CRUD de cajas físicas ──────────────────────────────────────

export async function crearCaja(
  name: string,
  businessSlug: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar cajas.");
  }
  const trimmed = name.trim();
  if (trimmed === "") return actionError("La caja necesita un nombre.");
  if (trimmed.length > 60) return actionError("Nombre demasiado largo.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { data, error } = await service
    .from("cajas")
    .insert({
      business_id: business.id,
      name: trimmed,
      is_active: true,
    })
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") {
      return actionError("Ya existe una caja con ese nombre.");
    }
    return actionError(`No se pudo crear la caja: ${error.message}`);
  }

  revalidatePath(`/${businessSlug}/admin/caja`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({
    id: (data as { id: string }).id,
    name: (data as { name: string }).name,
  });
}

export async function renombrarCaja(
  cajaId: string,
  newName: string,
  businessSlug: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar cajas.");
  }
  const trimmed = newName.trim();
  if (trimmed === "") return actionError("La caja necesita un nombre.");
  if (trimmed.length > 60) return actionError("Nombre demasiado largo.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");

  const { data, error } = await service
    .from("cajas")
    .update({ name: trimmed })
    .eq("id", cajaId)
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") {
      return actionError("Ya existe una caja con ese nombre.");
    }
    return actionError(`No se pudo renombrar la caja: ${error.message}`);
  }

  revalidatePath(`/${businessSlug}/admin/caja`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({
    id: (data as { id: string }).id,
    name: (data as { name: string }).name,
  });
}

export async function setCajaActive(
  cajaId: string,
  isActive: boolean,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar cajas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  // spec 160 · desactivarla dejaría al pago a proveedor sin destino.
  if (caja.is_administrative) return actionError(NO_ES_CAJA_DE_TURNO);

  // issue #254 — apagar la caja principal apagaba las guardas del cierre.
  //
  // Las dos guardas que impiden cerrar el día con plata suelta —cuentas
  // abiertas y rendiciones sin resolver— cuelgan de `caja.is_default`, acá
  // abajo y en la RPC vía `p_barrer_salon`. Y esta action no limpiaba la marca
  // al desactivar, mientras que `setCajaDefault` sí se niega a marcar una caja
  // inactiva. Esa asimetría dejaba alcanzable, con un click, el estado
  // «ninguna caja ACTIVA es la principal»: desde ahí el cierre de la caja que
  // sí se usa no chequeaba nada y tampoco barría el salón.
  //
  // Se corta acá y no traspasando la marca sola: mover la default es decidir
  // dónde caen los cobros online sin cajero, y eso lo elige una persona.
  if (!isActive && caja.is_default) {
    return actionError(
      "Es la caja principal: marcá otra como principal antes de desactivarla. Si no, el cierre deja de controlar mesas abiertas y rendiciones.",
    );
  }

  const { error } = await service
    .from("cajas")
    .update({ is_active: isActive })
    .eq("id", cajaId);
  if (error) return actionError(`No se pudo actualizar la caja: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/caja`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

/**
 * Marca la caja donde caen los cobros sin cajero — hoy, el pago online de un
 * delivery / take-away que acredita el webhook de MP (no hay nadie eligiendo
 * dónde asentarlo y `payments.caja_id` es NOT NULL).
 *
 * Es excluyente: el índice único parcial `cajas_one_default_per_business`
 * (migración 0025) sólo admite una por negocio, así que primero se limpia la
 * anterior. Sin una marcada, `getDefaultCaja` cae en la primera activa.
 */
export async function setCajaDefault(
  cajaId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar cajas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  // spec 160 · la default recibe los cobros online, y además el CHECK de la base
  // lo prohíbe: sin eso, las facturas fiscales saldrían por su impresora.
  if (caja.is_administrative) return actionError(NO_ES_CAJA_DE_TURNO);
  if (!caja.is_active) {
    return actionError("Una caja inactiva no puede ser la caja por defecto.");
  }

  // Limpiar la anterior antes de marcar la nueva: el unique parcial no admite
  // dos, y hacerlo al revés falla.
  const { error: clearErr } = await service
    .from("cajas")
    .update({ is_default: false })
    .eq("business_id", business.id)
    .eq("is_default", true);
  if (clearErr) {
    return actionError(`No se pudo actualizar la caja: ${clearErr.message}`);
  }

  const { error } = await service
    .from("cajas")
    .update({ is_default: true })
    .eq("id", cajaId);
  if (error) return actionError(`No se pudo actualizar la caja: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/caja`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

// ── Corte ─────────────────────────────────────────────────────

/**
 * Cierra la caja: registra el corte, retira el efectivo y —si es la caja
 * principal— deja el salón en cero. Un botón (spec 130).
 *
 * Reemplaza a `hacerCorte`. Antes cerrar el día eran tres pasos sueltos, y el
 * del medio era el encargado **tipeando la plata entera del día** en una
 * sangría a mano para que el sistema no creyera que el cajón seguía lleno. Un
 * dedo mal puesto ahí y el arqueo del día siguiente arrancaba torcido.
 *
 * `retirar: false` es el arqueo de mitad de turno: se cuenta sin vaciar.
 *
 * La escritura entera va en `cerrar_caja_tx` (migración 0052): un corte sin su
 * retiro deja al sistema esperando plata que ya no está en el cajón. Acá quedan
 * las guardas de contexto —rol, techo de diferencia, cuentas abiertas con
 * nombre y monto— que necesitan leer otras tablas y dar mensajes en castellano.
 */
export async function cerrarCaja(input: {
  cajaId: string;
  closing_cash_cents: number;
  closing_notes: string | null;
  denomination_count: Record<string, number> | null;
  /** Sacar del cajón lo contado. Destildado = arqueo sin vaciar (D2). */
  retirar: boolean;
  businessSlug: string;
}): Promise<
  ActionResult<{
    corte: CajaCorte;
    retiro_cents: number;
    mesasLiberadas: number;
    mozosLimpiados: number;
  }>
> {
  const business = await getBusiness(input.businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canHacerCorte(ctx.role)) {
    return actionError("Solo encargado o admin pueden cerrar la caja.");
  }
  if (input.closing_cash_cents < 0) {
    return actionError("El monto de cierre no puede ser negativo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, input.cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  // spec 160 · la caja administrativa no se arquea. `cerrar_caja_tx` también lo
  // rechaza (es la que imprime el ticket y barre el salón); acá se corta antes
  // para no calcular un arqueo que no existe.
  if (caja.is_administrative) return actionError(NO_ES_CAJA_DE_TURNO);
  if (!caja.is_active) return actionError("Caja inactiva.");

  const stats = await getCajaLiveStats(input.cajaId, business.id);
  if (!stats) return actionError("No se pudieron calcular los stats de la caja.");
  const expected_cash_cents = stats.expected_cash_cents;
  const difference_cents = input.closing_cash_cents - expected_cash_cents;

  if (difference_cents !== 0) {
    if (!input.closing_notes || input.closing_notes.trim() === "") {
      return actionError(
        "Hay diferencia con el efectivo esperado. Tenés que registrar el motivo en las notas.",
      );
    }
    if (!canAcceptCajaDifference(ctx.role, difference_cents)) {
      return actionError(
        "La diferencia excede tu autorización. Pedile al admin que cierre la caja.",
      );
    }
  }

  // D7 · La cuenta abierta se nombra: la RPC también bloquea (por la carrera),
  // pero «OPEN_TABLE_ORDERS:3» no le sirve a nadie a la 1 de la mañana. Acá se
  // dice qué mesa y cuánto falta cobrar.
  if (caja.is_default) {
    const abiertas = await getCuentasAbiertas(business.id);
    if (abiertas.length > 0) {
      const detalle = abiertas
        .slice(0, 3)
        .map((c) => `Mesa ${c.table_label} (${formatCurrency(c.pendiente_cents)})`)
        .join(", ");
      const resto = abiertas.length > 3 ? ` y ${abiertas.length - 3} más` : "";
      return actionError(
        abiertas.length === 1
          ? `No podés cerrar: la ${detalle} todavía tiene la cuenta abierta.`
          : `No podés cerrar: hay ${abiertas.length} mesas con la cuenta abierta — ${detalle}${resto}.`,
      );
    }
  }

  // Spec 139 · D1/D5 — la caja principal no cierra dejando a un mozo sin
  // resolver. La RPC bloquea igual (carrera), pero «UNRENDERED_MOZOS:3» no le
  // sirve a nadie: acá se dice quién falta y cuánto tiene encima.
  if (caja.is_default) {
    const pendientes = mozosQueDebenRendir(
      await getRendicionesPendientesTodosLosMozos(business.id),
      await getOperadoresDeCaja(input.cajaId, business.id),
    );
    if (pendientes.length > 0) {
      const detalle = pendientes
        .slice(0, 3)
        .map((m) => `${m.mozo_name} (${formatCurrency(m.efectivo_cents)})`)
        .join(", ");
      const resto =
        pendientes.length > 3 ? ` y ${pendientes.length - 3} más` : "";
      return actionError(
        pendientes.length === 1
          ? `Falta la rendición de ${detalle}. Registrala o marcá que no entregó.`
          : `Faltan ${pendientes.length} rendiciones — ${detalle}${resto}. Registralas o marcá quién no entregó.`,
      );
    }
  }

  // D9 · El snapshot de lo que el encargado está viendo. No hay cálculo nuevo:
  // `stats` ya se computó arriba para validar la diferencia. Se congela acá
  // porque después de cerrar el período vivo pasa a ser el siguiente, y una
  // corrección posterior (spec 070) movería un papel que alguien ya firmó.
  const [movimientos, encargado] = await Promise.all([
    getMovimientosPeriodoActual(input.cajaId, business.id),
    service
      .from("business_users")
      .select("full_name")
      .eq("business_id", business.id)
      .eq("user_id", ctx.userId)
      .maybeSingle(),
  ]);

  const vivos = movimientos.filter((m) => !m.cancelled_at);
  const linea = (m: (typeof vivos)[number], fallback: string) => ({
    detalle: m.reason?.trim() || fallback,
    total_cents: m.amount_cents,
  });

  const resumen: CierreResumenSnapshot = {
    version: 1,
    caja_name: caja.name,
    encargado_name:
      (encargado.data as { full_name: string | null } | null)?.full_name ?? null,
    periodo_desde: stats.periodo_desde,
    total_ventas_cents: stats.total_ventas_cents,
    total_propinas_cents: stats.total_propinas_cents,
    cobros_count: stats.cobros_count,
    expected_cash_cents,
    closing_cash_cents: input.closing_cash_cents,
    difference_cents,
    desglose_esperado: stats.desglose_esperado,
    // Los anulados no van al papel: no movieron la caja (spec 070) y en un
    // documento que se firma sumarían confusión, no información.
    movimientos: {
      ingresos: vivos.filter((m) => m.kind === "ingreso").map((m) => linea(m, "Ingreso")),
      // Spec 177 · Parte B — la propina pagada es una salida del cajón y va al
      // papel como cualquier otra: sin esto, el sobre cerraría con una
      // diferencia que el resumen no explica.
      egresos: vivos
        .filter((m) => m.kind === "sangria" || m.kind === "propina")
        .map((m) => linea(m, m.kind === "propina" ? "Propina" : "Sangria")),
    },
    ventas_por_origen_lineas: ORIGEN_PAPEL.filter(
      (o) => (stats.ventas_por_origen[o.key] ?? 0) > 0,
    ).map((o) => ({
      detalle: o.label,
      total_cents: stats.ventas_por_origen[o.key] ?? 0,
      cant: stats.cobros_por_origen[o.key] ?? 0,
    })),
    ventas_por_metodo_lineas: METODO_PAPEL.filter(
      (m) => (stats.ventas_por_metodo[m.key] ?? 0) > 0,
    ).map((m) => ({
      detalle: m.label,
      total_cents: stats.ventas_por_metodo[m.key] ?? 0,
      cant: stats.cobros_por_metodo[m.key] ?? 0,
    })),
  };

  const { data: rpcData, error } = await service.rpc("cerrar_caja_tx", {
    p_caja_id: input.cajaId,
    p_business_id: business.id,
    p_encargado_id: ctx.userId,
    p_expected_cash_cents: expected_cash_cents,
    p_closing_cash_cents: input.closing_cash_cents,
    p_closing_notes: input.closing_notes,
    p_denomination_count: input.denomination_count,
    p_retirar: input.retirar,
    // D9 · Sólo la principal barre el salón: el cierre del bar puede pasar en
    // plena cena y no tiene por qué liberar mesas.
    p_barrer_salon: caja.is_default,
    p_resumen: resumen,
  });

  if (error) {
    if (error.message.includes("OPEN_TABLE_ORDERS")) {
      return actionError(
        "Se abrió una cuenta mientras cerrabas. Revisá el salón y volvé a intentar.",
      );
    }
    // spec 160 · la RPC es la última línea: la UI ya no ofrece cerrar la caja
    // administrativa, pero `resolveCierrePrinter` no mira `cajas`, así que un
    // cierre que llegara por otro camino imprimiría el ticket igual.
    if (error.message.includes("CAJA_ADMINISTRATIVA_NO_SE_ARQUEA")) {
      return actionError(NO_ES_CAJA_DE_TURNO);
    }
    if (error.message.includes("UNRENDERED_MOZOS")) {
      return actionError(
        "Un mozo cobró mientras cerrabas y le quedó plata sin rendir. Actualizá y volvé a intentar.",
      );
    }
    return actionError(`No se pudo cerrar la caja: ${error.message}`);
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as {
    corte: CajaCorte;
    retiro_id: string | null;
    mesas_liberadas: number;
    mozos_limpiados: number;
  } | null;
  if (!row) return actionError("No se pudo cerrar la caja.");

  // Issue #218 · el estampado del `corte_id` del retiro vivía acá, como un
  // UPDATE best-effort **después** de la transacción: un cierre cuyo update
  // fallaba quedaba con la plata retirada y el movimiento sin atar, y el
  // resumen (spec 149) no podía decir cuánto se había sacado. Desde la 0063 lo
  // hace `cerrar_caja_tx` adentro de la misma transacción.

  if (caja.is_default) {
    revalidatePath(`/${input.businessSlug}/mozo`);
  }
  revalidatePath(`/${input.businessSlug}/admin/operacion`);

  return actionOk({
    corte: row.corte,
    retiro_cents: row.retiro_id ? input.closing_cash_cents : 0,
    mesasLiberadas: Number(row.mesas_liberadas ?? 0),
    mozosLimpiados: Number(row.mozos_limpiados ?? 0),
  });
}

/**
 * Rótulos del papel del cierre. Van en ASCII y sin acentos a propósito: la
 * térmica no recibe codepage, así que todo lo que pase de 0x7e sale como el
 * símbolo que tenga cargado en su tabla. `sanitizeTicketText` lo cubriría igual,
 * pero acá el nombre es corto y conviene que se lea igual en pantalla y papel.
 *
 * Las filas en $0 no se imprimen (se filtran arriba): el papel de MaxiRest sólo
 * lista lo que tuvo movimiento.
 */
const METODO_PAPEL: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Efectivo" },
  { key: "mp_qr", label: "MercadoPago QR" },
  { key: "mp_link", label: "MercadoPago link" },
  { key: "card_manual", label: "Tarjeta" },
  { key: "transfer", label: "Transferencia" },
  { key: "other", label: "Otro" },
];

const ORIGEN_PAPEL: { key: VentaOrigen; label: string }[] = [
  { key: "salon", label: "Salon" },
  { key: "delivery", label: "Delivery" },
  { key: "takeaway", label: "Take away" },
  { key: "otro", label: "Otro" },
];

// ── Movimientos manuales ───────────────────────────────────────

export async function registrarSangria(
  cajaId: string,
  amount_cents: number,
  reason: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canMakeSangria(ctx.role)) {
    return actionError("Solo encargado o admin pueden registrar una sangría.");
  }
  if (amount_cents <= 0) return actionError("El monto debe ser mayor a 0.");
  if (!reason || reason.trim() === "") {
    return actionError("La sangría requiere un motivo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  if (!caja.is_active) return actionError("Caja inactiva.");

  const { error } = await service.from("caja_movimientos").insert({
    caja_id: cajaId,
    business_id: business.id,
    kind: "sangria",
    amount_cents,
    reason: reason.trim(),
    created_by: ctx.userId,
  });
  if (error) return actionError(`No se pudo registrar la sangría: ${error.message}`);

  revalidarMovimiento(businessSlug, caja.is_administrative);
  return actionOk(undefined);
}

export async function registrarIngreso(
  cajaId: string,
  amount_cents: number,
  reason: string | null,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canMakeSangria(ctx.role)) {
    return actionError("Solo encargado o admin pueden registrar un ingreso.");
  }
  if (amount_cents <= 0) return actionError("El monto debe ser mayor a 0.");

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada.");
  if (!caja.is_active) return actionError("Caja inactiva.");

  const { error } = await service.from("caja_movimientos").insert({
    caja_id: cajaId,
    business_id: business.id,
    kind: "ingreso",
    amount_cents,
    reason: reason?.trim() || null,
    created_by: ctx.userId,
  });
  if (error) return actionError(`No se pudo registrar el ingreso: ${error.message}`);

  revalidarMovimiento(businessSlug, caja.is_administrative);
  return actionOk(undefined);
}

// ── Configuración de métodos de pago ──────────────────────────────

const VALID_METHODS: PaymentMethod[] = [
  "cash", "card_manual", "mp_link", "mp_qr", "transfer", "other",
];

export async function upsertPaymentMethodConfig(
  businessSlug: string,
  method: PaymentMethod,
  input: { adjustment_percent: number; label: string | null; is_active: boolean },
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede configurar métodos de pago.");
  }
  if (!VALID_METHODS.includes(method)) {
    return actionError("Método de pago inválido.");
  }
  if (input.adjustment_percent < -100 || input.adjustment_percent > 100) {
    return actionError("El ajuste debe estar entre -100% y 100%.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;
  const { error } = await service
    .from("payment_method_configs")
    .upsert(
      {
        business_id: business.id,
        method,
        adjustment_percent: input.adjustment_percent,
        label: input.label?.trim() || null,
        is_active: input.is_active,
      },
      { onConflict: "business_id,method" },
    );

  if (error) return actionError(`No se pudo guardar: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/configuracion`);
  revalidatePath(`/${businessSlug}/mozo`);
  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk(undefined);
}

// ── Rendición de mozos ──────────────────────────────────────────

/**
 * Registra la rendición de un mozo y **cierra su período** (spec 07), ahora con
 * estado (spec 139 · D1).
 *
 * `estado = 'no_entrego'` es la salida para el mozo que se fue: no inventa una
 * rendición que cuadre ni deja al encargado trabado a la 1 de la mañana — deja
 * la deuda escrita, con nombre y motivo, y avisa al admin. El monto entregado
 * se ignora y se persiste en $0: lo que se declara es que no entregó nada.
 *
 * Lo que NO hace, a propósito: aplicar `canAcceptCajaDifference`. Ese techo es
 * del arqueo de caja; un faltante de rendición no se acepta, se cobra (D6).
 */
export async function registrarRendicionMozo(
  mozoId: string,
  delivered_cash_cents: number,
  notes: string | null,
  businessSlug: string,
  estado: RendicionEstado = "rendida",
  /**
   * De qué cajón sale la propina (spec 177 · Parte B). Sin esto, la caja por
   * defecto — que es de donde sale la plata en un local de una sola caja.
   */
  cajaId?: string,
): Promise<ActionResult<{ rendicion: MozoRendicion; propina_pagada_cents: number }>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canRendirMozo(ctx.role)) {
    return actionError("Solo encargado o admin pueden registrar una rendición.");
  }
  if (delivered_cash_cents < 0) {
    return actionError("El monto entregado no puede ser negativo.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { data: mozoUser } = await service
    .from("business_users")
    .select("user_id, full_name")
    .eq("business_id", business.id)
    .eq("user_id", mozoId)
    .maybeSingle();
  if (!mozoUser) return actionError("El mozo no pertenece a este negocio.");

  // issue #264 — el corte se fija ANTES de leer, y es el mismo que se guarda.
  //
  // Antes esto leía «todo lo cobrado desde la última rendición» sin techo, y
  // después insertaba la fila con el `now()` del server. Entre las dos cosas hay
  // un round-trip contra la base, y un cobro que entrara en ese hueco quedaba
  // huérfano: no lo cubría esta rendición —se leyó antes— ni la siguiente, cuyo
  // piso es el `created_at` de esta fila, posterior al del cobro. Ese efectivo
  // dejaba de figurar en «deben rendir» para siempre, pero seguía contado en el
  // esperado del cajón: el faltante aparecía en el arqueo sin dueño.
  //
  // Fijando el corte y guardándolo como `created_at`, el período que cierra y el
  // que abre se tocan exactamente, sin hueco ni solape.
  //
  // Residual honesto: el corte sale del reloj de Node y los `created_at` de los
  // pagos, del de Postgres. Si Node adelantara MÁS de lo que tarda el
  // round-trip, un pago podría volver a caer en el hueco. Antes el hueco existía
  // siempre; ahora hace falta desincronización de relojes. Cerrarlo del todo
  // pide mover la rendición entera a una RPC transaccional —como
  // `registrar_pago_tx`— y eso es otra tanda: no se hace acá para no duplicar la
  // aritmética de la rendición en SQL, que es justo lo que causó el #253.
  const corteIso = new Date().toISOString();

  const pendiente = await getRendicionPendienteMozo(
    mozoId,
    business.id,
    (mozoUser as { full_name: string | null }).full_name ?? "Sin nombre",
    undefined,
    corteIso,
  );

  const expected_cash_cents = pendiente.efectivo_cents;
  // Declarar que no entregó es declarar $0: el monto que venga del formulario
  // no se usa, así no hay dos verdades en la misma fila.
  const entregado = estado === "no_entrego" ? 0 : delivered_cash_cents;
  const difference_cents = entregado - expected_cash_cents;
  const motivo = notes?.trim() || null;

  if (estado === "no_entrego" && !motivo) {
    return actionError("Decí por qué no entregó: queda registrado como deuda.");
  }
  if (estado === "rendida" && difference_cents !== 0 && !motivo) {
    return actionError(
      "Hay diferencia entre lo esperado y lo entregado. Registrá el motivo.",
    );
  }

  const { data: inserted, error } = await service
    .from("mozo_rendiciones")
    .insert({
      business_id: business.id,
      mozo_id: mozoId,
      registered_by: ctx.userId,
      expected_cash_cents,
      delivered_cash_cents: entregado,
      difference_cents,
      notes: motivo,
      por_metodo: pendiente.por_metodo,
      estado,
      // El mismo instante con el que se leyó: define el piso del próximo período.
      created_at: corteIso,
    })
    .select("*")
    .single();

  if (error) return actionError(`No se pudo registrar la rendición: ${error.message}`);

  const rendicion = inserted as MozoRendicion;

  // ── Spec 177 · Parte B — la propina se paga acá ──────────────────────────
  //
  // Decisión de Juan (2026-09-10): *"la propina que se pague en la misma
  // rendición"*. Sale del cajón como movimiento propio, con el mozo adentro, y
  // por eso `calculateExpectedCash` la descuenta sola: el cajón espera lo que
  // entró menos lo que salió (D5).
  //
  // Cubre los dos casos físicos con la misma cuenta. Si el mozo cobró en
  // efectivo, la propina ya la tiene encima y entrega el neto: el movimiento
  // deja al esperado en ese neto. Si cobró la caja —o si la propina vino por
  // tarjeta—, el billete sale del cajón ahora.
  //
  // Un `no_entrego` no cobra: declaró que no entregó nada, pagarle la propina
  // sería sacar plata del cajón contra una deuda abierta.
  let propina_pagada_cents = 0;
  if (estado === "rendida" && pendiente.total_propinas_cents > 0) {
    const caja = cajaId ?? (await getDefaultCaja(business.id))?.id;
    if (!caja) {
      await service.from("mozo_rendiciones").delete().eq("id", rendicion.id);
      return actionError(
        "El negocio no tiene ninguna caja donde registrar el pago de la propina.",
      );
    }
    const { error: movErr } = await service.from("caja_movimientos").insert({
      business_id: business.id,
      caja_id: caja,
      kind: "propina",
      mozo_id: mozoId,
      amount_cents: pendiente.total_propinas_cents,
      // El nombre va adentro del motivo a propósito: el papel del cierre
      // (spec 139) arma sus renglones con `reason` y sin esto la línea diría
      // sólo «Propina», que en una lista de seis es inútil.
      reason: `Propina · ${(mozoUser as { full_name: string | null }).full_name ?? "Mozo"}`,
      created_by: ctx.userId,
      created_at: corteIso,
    });
    if (movErr) {
      // La rendición ya está escrita y define el piso del próximo período: si
      // el pago no entró, dejarla parada mentiría dos veces —diría que el mozo
      // ya cobró su propina y cerraría un período que no se liquidó—. Se
      // deshace, que es seguro porque nada la referencia todavía.
      await service.from("mozo_rendiciones").delete().eq("id", rendicion.id);
      return actionError(
        `No se pudo pagar la propina, así que la rendición no se registró: ${movErr.message}`,
      );
    }
    propina_pagada_cents = pendiente.total_propinas_cents;
  }

  // D6 · no traba el cierre, pero no queda invisible: el dueño se entera de la
  // plata que quedó afuera del cajón. Best-effort, como el resto de la spec 27.
  const faltanteGrande =
    difference_cents < 0 &&
    Math.abs(difference_cents) >= DIFERENCIA_CAJA_OK_CENTS;
  if (estado === "no_entrego" || faltanteGrande) {
    await notifyRendicionPendiente({
      businessId: business.id,
      mozoName: (mozoUser as { full_name: string | null }).full_name ?? "Un mozo",
      estado,
      expectedCents: expected_cash_cents,
      deliveredCents: entregado,
      differenceCents: difference_cents,
      reason: motivo,
      actorUserId: ctx.userId,
    });
  }

  revalidatePath(`/${businessSlug}/admin/operacion`);
  return actionOk({ rendicion, propina_pagada_cents });
}

// ── Asignación caja↔usuario ─────────────────────────────────────

export async function asignarCajaUsuario(
  cajaId: string,
  userId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede asignar cajas a usuarios.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const caja = await loadCajaForBusiness(service, cajaId, business.id);
  if (!caja) return actionError("Caja no encontrada en este negocio.");
  // spec 160 · a una caja que no cobra no se le asignan mozos.
  if (caja.is_administrative) return actionError(NO_ES_CAJA_DE_TURNO);

  const { data: bu } = await service
    .from("business_users")
    .select("user_id")
    .eq("business_id", business.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!bu) return actionError("El usuario no pertenece a este negocio.");

  const { error } = await service
    .from("caja_user_assignments")
    .upsert(
      {
        business_id: business.id,
        caja_id: cajaId,
        user_id: userId,
      },
      { onConflict: "business_id,caja_id,user_id" },
    );

  if (error) return actionError(`No se pudo asignar la caja: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/operacion`);
  revalidatePath(`/${businessSlug}/admin/caja`);
  return actionOk(undefined);
}

export async function desasignarCajaUsuario(
  cajaId: string,
  userId: string,
  businessSlug: string,
): Promise<ActionResult<void>> {
  const business = await getBusiness(businessSlug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canManageCajas(ctx.role)) {
    return actionError("Solo admin puede desasignar cajas.");
  }

  const service = createSupabaseServiceClient() as unknown as GenericClient;

  const { error } = await service
    .from("caja_user_assignments")
    .delete()
    .eq("business_id", business.id)
    .eq("caja_id", cajaId)
    .eq("user_id", userId);

  if (error) return actionError(`No se pudo desasignar: ${error.message}`);

  revalidatePath(`/${businessSlug}/admin/operacion`);
  revalidatePath(`/${businessSlug}/admin/caja`);
  return actionOk(undefined);
}

// ── Distribución masiva del salón ────────────────────────────────

export async function distribuirSalon(
  input: {
    assignments: Array<{ tableId: string; mozoId: string | null }>;
    slug: string;
  },
): Promise<ActionResult<{ count: number }>> {
  const business = await getBusiness(input.slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctxResult = await requireMozoActionContext(business.id);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  if (!canAssignMozo(ctx.role)) {
    return actionError("Solo encargado o admin pueden distribuir el salón.");
  }

  let count = 0;
  for (const a of input.assignments) {
    const r = await assignMozoToTable(a.tableId, a.mozoId, input.slug);
    if (!r.ok) return actionError(`Falló asignar mesa: ${r.error}`);
    count += 1;
  }

  return actionOk({ count });
}

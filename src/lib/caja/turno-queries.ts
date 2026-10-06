import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getCuentasAbiertas, getMesasSinCobrarPorMozo, type CuentaAbierta } from "./queries";
import type { MesaSinCobrar } from "./mesas-sin-cobrar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, "public", any>;
const db = () => createSupabaseServiceClient() as unknown as AnyClient;

/**
 * Spec 210/211 v2 — lo que la pantalla de caja lee del modelo nuevo. Todo sale
 * de funciones de la base (0134–0139): la pantalla no recalcula plata.
 */

/** Un mozo con plata de una caja: lo que cobró, su propina, lo que entregó y lo que debe. */
export type SaldoMozo = {
  mozo_id: string;
  mozo_name: string;
  caja_id: string;
  caja_name: string;
  /** Lo que traía de antes de la ventana (una deuda que se arrastra). */
  anterior_cents: number;
  /** Lo de las cuentas en efectivo (sin su propina en efectivo, que ya tiene). */
  efectivo_cents: number;
  /** Su propina de tarjeta/QR: se la queda de lo que trae. */
  propina_tarjeta_cents: number;
  /** Su propina en efectivo: ya la tiene, no entra en ninguna cuenta. */
  propina_efectivo_cents: number;
  cobros_count: number;
  entregado_cents: number;
  /** Lo que la caja le pagó de propina cuando no tenía efectivo. */
  pagado_cents: number;
  /** Lo que todavía tiene que entregar. Negativo: la caja le debe. */
  saldo_cents: number;
  /** Saldo en cero, o «no entregó» reconocido sobre este saldo. */
  resuelto: boolean;
  /** Si tiene alguna mesa sin cobrar, no puede rendir. */
  mesas_sin_cobrar: MesaSinCobrar[];
  /** Hay una deuda reconocida vigente («no entregó»). */
  deuda: boolean;
};

/**
 * `desde`: el inicio de la ventana que se muestra (el período de la caja). Lo
 * anterior viene como `anterior_cents`; el saldo y si está resuelto son
 * siempre los de ahora.
 */
export async function getSaldosMozos(businessId: string, desde?: string): Promise<SaldoMozo[]> {
  const [{ data, error }, mesas] = await Promise.all([
    db().rpc("saldos_mozos", { p_business_id: businessId, p_desde: desde ?? "-infinity" }),
    getMesasSinCobrarPorMozo(businessId),
  ]);
  if (error) throw new Error(`saldos_mozos: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const saldo = Number(r.saldo_cents);
    const resuelto = Boolean(r.resuelto);
    return {
      mozo_id: String(r.mozo_id),
      mozo_name: String(r.mozo_name),
      caja_id: String(r.caja_id),
      caja_name: String(r.caja_name),
      anterior_cents: Number(r.anterior_cents),
      efectivo_cents: Number(r.efectivo_cents),
      propina_tarjeta_cents: Number(r.propina_tarjeta_cents),
      propina_efectivo_cents: Number(r.propina_efectivo_cents),
      cobros_count: Number(r.cobros_count),
      entregado_cents: Number(r.entregado_cents),
      pagado_cents: Number(r.pagado_cents),
      saldo_cents: saldo,
      resuelto,
      mesas_sin_cobrar: mesas.get(String(r.mozo_id)) ?? [],
      deuda: resuelto && saldo > 0,
    };
  });
}

export type CajaDelTurno = {
  id: string;
  name: string;
  is_default: boolean;
  /** Tuvo cobros o movimientos después de su último corte. */
  sin_contar: boolean;
  /** Hora del último corte (null si nunca se cerró). */
  ultimo_corte_at: string | null;
};

export type EstadoTurno = {
  turno_id: string | null;
  abierto_at: string | null;
  cuentas_abiertas: CuentaAbierta[];
  saldos: SaldoMozo[];
  cajas: CajaDelTurno[];
};

/**
 * El estado del cierre del turno (spec 211 · R6): mesas, mozos y cajas. Es lo
 * mismo que valida `cerrar_turno_tx` y cada `cerrar_caja_tx`, leído de las
 * mismas funciones.
 */
export async function getEstadoTurno(businessId: string): Promise<EstadoTurno> {
  const service = db();
  const [turno, cuentas, saldos, cajasRes, sinContar, cortes] = await Promise.all([
    service
      .from("turnos")
      .select("id, abierto_at")
      .eq("business_id", businessId)
      .is("cerrado_at", null)
      .maybeSingle(),
    getCuentasAbiertas(businessId),
    // Las cifras de la ventana del turno; el saldo y si está resuelto, los de ahora.
    service
      .from("turnos")
      .select("abierto_at")
      .eq("business_id", businessId)
      .is("cerrado_at", null)
      .maybeSingle()
      .then((t) => getSaldosMozos(businessId, (t.data as { abierto_at: string } | null)?.abierto_at)),
    service
      .from("cajas")
      .select("id, name, is_default, sort_order")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .eq("is_administrative", false)
      .order("sort_order"),
    service.rpc("cajas_sin_contar", { p_business_id: businessId }),
    service
      .from("caja_cortes")
      .select("caja_id, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (sinContar.error) throw new Error(`cajas_sin_contar: ${sinContar.error.message}`);
  const sinContarIds = new Set(
    ((sinContar.data ?? []) as Array<{ caja_id: string }>).map((r) => r.caja_id),
  );
  const ultimoCorte = new Map<string, string>();
  for (const c of (cortes.data ?? []) as Array<{ caja_id: string; created_at: string }>) {
    if (!ultimoCorte.has(c.caja_id)) ultimoCorte.set(c.caja_id, c.created_at);
  }
  const t = turno.data as { id: string; abierto_at: string } | null;
  return {
    turno_id: t?.id ?? null,
    abierto_at: t?.abierto_at ?? null,
    cuentas_abiertas: cuentas,
    saldos,
    cajas: ((cajasRes.data ?? []) as Array<{ id: string; name: string; is_default: boolean }>).map((c) => ({
      id: c.id,
      name: c.name,
      is_default: c.is_default,
      sin_contar: sinContarIds.has(c.id),
      ultimo_corte_at: ultimoCorte.get(c.id) ?? null,
    })),
  };
}

import { db, businessId } from "./db";
import { SLUG } from "./roles";

/**
 * Una mesa propia del test, con su cuenta abierta — y su limpieza.
 *
 * Los specs que **completan** un cobro (P04, y los escenarios de cobro en
 * partes de P01) no pueden usar las mesas vivas del seed: cobrarlas se las
 * saca a los demás specs y ensucia el arqueo del demo, que es justo lo que
 * P01/P03 evitan a propósito. Cada uno arma la suya, en el primer salón (el
 * que abre el plano) y con un label que no choca, y la borra al final.
 *
 * Se siembra con el service client porque es **precondición**, no el proceso
 * que se está probando: lo que tiene que pasar por la UI con el rol real es el
 * cobro, la anulación y la corrección.
 */
export type MesaDePrueba = {
  tableId: string;
  orderId: string;
  itemIds: string[];
  label: string;
  totalCents: number;
  bizId: string;
  mozoId: string | null;
};

export async function crearMesaDePrueba(opts: {
  /** Un ítem por monto (en centavos). */
  montos: number[];
  tipCents?: number;
  /** Etiqueta única; conviene el nombre del test. */
  label: string;
  /** A quién se le atribuyen los cobros. Sin esto, la mesa no tiene mozo. */
  mozoEmail?: string;
}): Promise<MesaDePrueba> {
  const bizId = await businessId(SLUG);

  const { data: planos } = await db
    .from("floor_plans")
    .select("id")
    .eq("business_id", bizId)
    .order("created_at", { ascending: true })
    .limit(1);
  const planoId = ((planos ?? [])[0] as { id: string }).id;

  let mozoId: string | null = null;
  if (opts.mozoEmail) {
    const { data: u } = await db
      .from("users")
      .select("id")
      .eq("email", opts.mozoEmail)
      .maybeSingle();
    mozoId = (u as { id: string } | null)?.id ?? null;
  }

  const { data: table, error: tErr } = await db
    .from("tables")
    .insert({
      floor_plan_id: planoId,
      label: opts.label,
      seats: 4,
      shape: "circle",
      // Fuera del área donde el seed dibuja el salón: no tapa ninguna mesa real.
      x: 1200,
      y: 1200,
      width: 80,
      height: 80,
      operational_status: "pidio_cuenta",
      opened_at: new Date().toISOString(),
      mozo_id: mozoId,
    })
    .select("id")
    .single();
  if (tErr) throw tErr;

  const subtotal = opts.montos.reduce((a, b) => a + b, 0);
  const tip = opts.tipCents ?? 0;
  const { data: order, error: oErr } = await db
    .from("orders")
    .insert({
      business_id: bizId,
      customer_name: opts.label,
      customer_phone: "0",
      delivery_type: "dine_in",
      table_id: table!.id,
      mozo_id: mozoId,
      subtotal_cents: subtotal,
      tip_cents: tip,
      total_cents: subtotal + tip,
      lifecycle_status: "open",
      status: "preparing",
    })
    .select("id")
    .single();
  if (oErr) throw oErr;

  await db.from("tables").update({ current_order_id: order!.id }).eq("id", table!.id);

  const { data: items, error: iErr } = await db
    .from("order_items")
    .insert(
      opts.montos.map((m, i) => ({
        order_id: order!.id,
        product_name: `Item ${i + 1}`,
        unit_price_cents: m,
        quantity: 1,
        subtotal_cents: m,
        loaded_by: mozoId,
      })),
    )
    .select("id");
  if (iErr) throw iErr;

  return {
    tableId: table!.id,
    orderId: order!.id,
    itemIds: ((items ?? []) as { id: string }[]).map((i) => i.id),
    label: opts.label,
    totalCents: subtotal + tip,
    bizId,
    mozoId,
  };
}

/**
 * Borra la mesa de prueba y todo lo que colgó de ella.
 *
 * Los pagos se borran antes que la orden: en `payments` el rastro es sagrado en
 * producción (nunca se borra una fila de plata), pero acá son datos de prueba y
 * dejarlos mueve el arqueo del demo para el spec siguiente.
 */
export async function borrarMesaDePrueba(mesa: MesaDePrueba | null) {
  if (!mesa) return;
  await db.from("caja_audit_log").delete().eq("business_id", mesa.bizId).in(
    "entity_id",
    ((await db.from("payments").select("id").eq("order_id", mesa.orderId)).data ?? []).map(
      (p) => (p as { id: string }).id,
    ),
  );
  await db.from("payments").delete().eq("order_id", mesa.orderId);
  await db.from("order_splits").delete().eq("order_id", mesa.orderId);
  await db.from("tables").update({ current_order_id: null }).eq("id", mesa.tableId);
  await db.from("orders").delete().eq("id", mesa.orderId);
  await db.from("tables").delete().eq("id", mesa.tableId);
}

/** Lo que la caja principal espera tener ahora, según la base. */
export async function esperadoDeLaCajaPrincipal(bizId: string): Promise<{
  cajaId: string;
  esperadoCents: number;
}> {
  const { data: cajas } = await db
    .from("cajas")
    .select("id")
    .eq("business_id", bizId)
    .eq("is_default", true)
    .limit(1);
  const cajaId = ((cajas ?? [])[0] as { id: string }).id;
  const { data } = await db.rpc("efectivo_esperado_caja", {
    p_caja_id: cajaId,
    p_hasta: new Date().toISOString(),
  });
  return { cajaId, esperadoCents: Number(data) };
}

// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbAvailable = Boolean(supabaseUrl && serviceKey);

const TEST_TAG = `test-caja-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let CURRENT_USER_ID = "";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      // `getClaims` es por dónde entra hoy la identidad en las actions del
      // salón (spec 106: el hop a GoTrue se pagaba en cada gesto del turno).
      // El mock viejo sólo tenía `getUser` y este archivo entero fallaba con
      // "getClaims is not a function" antes de llegar a probar nada.
      getClaims: async () => ({
        data: { claims: { sub: CURRENT_USER_ID } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: CURRENT_USER_ID } },
        error: null,
      }),
    },
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const {
  cerrarCaja,
  registrarSangria,
  registrarIngreso,
  distribuirSalon,
} = await import("./actions");
const { cerrarTurno, reconocerDeuda } = await import("./turno-actions");
const { getSaldosMozos } = await import("./turno-queries");
const { getCajaLiveStats, getCierreCajaData } = await import("./queries");


/**
 * Cerrar sin retirar es el arqueo de mitad de turno: contar sin vaciar, que es
 * lo que hacía el corte de antes. Los casos históricos pasan por acá.
 */
const corte = (
  cajaId: string,
  closing: number,
  notes: string | null,
  slug: string,
) =>
  cerrarCaja({
    cajaId,
    closing_cash_cents: closing,
    closing_notes: notes,
    denomination_count: null,
    retirar: false,
    businessSlug: slug,
  });

describe.skipIf(!dbAvailable)("caja continua (integration)", () => {
  const supabase = createClient(supabaseUrl!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let businessId: string;
  let businessSlug: string;
  let cajaA: string;
  let cajaPrincipal: string;
  let encargadoId: string;
  let mozoAId: string;
  let adminId: string;
  let table1: string;
  let table2: string;
  let openOrderId: string;

  /** El efectivo esperado de la caja: cerrar con eso es cerrar sin diferencia. */
  const esperado = async (cajaId: string) =>
    (await getCajaLiveStats(cajaId, businessId))!.expected_cash_cents;


  const seedUser = async (label: string) => {
    const email = `${TEST_TAG}-${label}@example.test`;
    const { data: created } = await supabase.auth.admin.createUser({
      email,
      password: "test-pass-12345",
      email_confirm: true,
    });
    const id = created!.user!.id;
    await supabase.from("users").upsert({ id, email, full_name: label });
    return id;
  };

  beforeAll(async () => {
    encargadoId = await seedUser("Encargado");
    mozoAId = await seedUser("MozoA");
    adminId = await seedUser("Admin");

    const { data: biz } = await supabase
      .from("businesses")
      .insert({ slug: TEST_TAG, name: "Caja Test", is_active: true })
      .select("id, slug")
      .single();
    businessId = biz!.id;
    businessSlug = biz!.slug;

    await supabase.from("business_users").insert([
      { business_id: businessId, user_id: encargadoId, role: "encargado", full_name: "Encargado" },
      { business_id: businessId, user_id: mozoAId, role: "mozo", full_name: "MozoA" },
      { business_id: businessId, user_id: adminId, role: "admin", full_name: "Admin" },
    ]);

    // issue #266 — desde la 0081 un negocio SIEMPRE tiene una caja principal:
    // la primera de turno que se crea queda marcada. Así que para tener una
    // caja NO principal —que es lo que estos tests necesitan— hace falta crear
    // primero la que sí lo es. Además de correcto, es más parecido al local
    // real: una principal y una del bar.
    const { data: cPrin } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Principal", sort_order: 0 })
      .select("id")
      .single();
    cajaPrincipal = cPrin!.id;

    const { data: cA } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Salón", sort_order: 1 })
      .select("id")
      .single();
    cajaA = cA!.id;

    const { data: fp } = await supabase
      .from("floor_plans")
      .insert({ business_id: businessId, name: "S1" })
      .select("id")
      .single();
    const { data: t1 } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label: "1",
        seats: 2,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
      })
      .select("id")
      .single();
    table1 = t1!.id;
    const { data: t2 } = await supabase
      .from("tables")
      .insert({
        floor_plan_id: fp!.id,
        label: "2",
        seats: 4,
        shape: "circle",
        x: 0, y: 0, width: 80, height: 80,
      })
      .select("id")
      .single();
    table2 = t2!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await supabase.from("businesses").delete().eq("id", businessId);
    }
    for (const id of [encargadoId, mozoAId, adminId].filter(Boolean)) {
      await supabase.from("users").delete().eq("id", id);
      await supabase.auth.admin.deleteUser(id);
    }
  });

  it("caja disponible inmediatamente sin abrir nada", async () => {
    const stats = await getCajaLiveStats(cajaA, businessId);
    expect(stats).not.toBeNull();
    expect(stats!.expected_cash_cents).toBe(0);
    expect(stats!.cobros_count).toBe(0);
  });

  it("registrar sangría contra caja → OK", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await registrarSangria(cajaA, 5_000, "depósito en banco", businessSlug);
    expect(r.ok).toBe(true);
  });

  it("sangría sin motivo → falla", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await registrarSangria(cajaA, 5_000, "", businessSlug);
    expect(r.ok).toBe(false);
  });

  it("registrar ingreso contra caja → OK", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await registrarIngreso(cajaA, 20_000, "fondo extra", businessSlug);
    expect(r.ok).toBe(true);
  });

  it("expected_cash refleja movimientos (0 + ingreso 20k - sangría 5k)", async () => {
    const stats = await getCajaLiveStats(cajaA, businessId);
    expect(stats).not.toBeNull();
    expect(stats!.expected_cash_cents).toBe(0 + 20_000 - 5_000);
  });

  it("hacer corte con diff $0 → OK sin notes", async () => {
    CURRENT_USER_ID = encargadoId;
    const expected = 15_000; // 0 + 20k - 5k
    const r = await corte(cajaA, expected, null, businessSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.corte.difference_cents).toBe(0);
  });

  it("post-corte: nuevo período arranca con closing_cash del corte anterior", async () => {
    const stats = await getCajaLiveStats(cajaA, businessId);
    expect(stats).not.toBeNull();
    // Nuevo período: last_closing = 15_000, sin movimientos nuevos.
    expect(stats!.expected_cash_cents).toBe(15_000);
  });

  it("hacer corte con diff sin notes → falla", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await corte(cajaA, 20_000, null, businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/diferencia/i);
  });

  it("hacer corte con diff + notes (encargado) → OK", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await corte(cajaA, 20_000, "sobrante por vuelto", businessSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.corte.difference_cents).toBe(20_000 - 15_000);
  });

  it("hacer corte con diff $10k como encargado → falla por permiso", async () => {
    CURRENT_USER_ID = encargadoId;
    // Nuevo período: last_closing = 20_000, expected = 20_000.
    // Closing = 20_000 + 1_000_000 → diff = 1_000_000 cents = $10.000
    const r = await corte(cajaA, 20_000 + 1_000_000, "sobrante grande", businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/excede/i);
  });

  it("hacer corte con diff $10k como admin → OK", async () => {
    CURRENT_USER_ID = adminId;
    const r = await corte(cajaA, 20_000 + 1_000_000, "sobrante grande", businessSlug);
    expect(r.ok).toBe(true);
  });

  it("mozo no puede hacer corte → falla permiso", async () => {
    CURRENT_USER_ID = mozoAId;
    const r = await corte(cajaA, 0, null, businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/encargado|admin/i);
  });

  it("distribuirSalon funciona independiente de caja", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await distribuirSalon({
      assignments: [
        { tableId: table1, mozoId: mozoAId },
        { tableId: table2, mozoId: mozoAId },
      ],
      slug: businessSlug,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.count).toBe(2);
  });

  // El corte de la caja principal cierra el día → libera la distribución de
  // mozos. El de una caja secundaria (el bar) puede pasar en plena cena, así
  // que no la toca.
  it("corte de caja NO principal deja la distribución intacta", async () => {
    CURRENT_USER_ID = encargadoId;
    // table1/table2 quedaron con mozoA del test anterior.
    const stats = await getCajaLiveStats(cajaA, businessId);
    const r = await corte(
      cajaA,
      stats!.expected_cash_cents,
      null,
      businessSlug,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.mesasLiberadas).toBe(0);

    const { data: rows } = await supabase
      .from("tables")
      .select("mozo_id")
      .in("id", [table1, table2]);
    expect(rows!.every((t) => t.mozo_id === mozoAId)).toBe(true);
  });

  it("spec 210 v2 · cerrar una caja ya no toca el salón: lo libera cerrar el turno", async () => {
    CURRENT_USER_ID = encargadoId;
    await supabase.from("cajas").update({ is_default: false }).eq("id", cajaPrincipal);
    await supabase.from("cajas").update({ is_default: true }).eq("id", cajaA);

    const r = await corte(cajaA, await esperado(cajaA), null, businessSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.mesasLiberadas).toBe(0);
    expect(r.data.mozosLimpiados).toBe(0);
    const { data: antes } = await supabase.from("tables").select("mozo_id").in("id", [table1, table2]);
    expect(antes!.every((t) => t.mozo_id === mozoAId)).toBe(true);

    // Con todas las cajas contadas, el turno barre la distribución.
    const p = await corte(cajaPrincipal, await esperado(cajaPrincipal), null, businessSlug);
    expect(p.ok).toBe(true);
    const t = await cerrarTurno({ slug: businessSlug });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.data.mozosLimpiados).toBe(2);
    const { data: despues } = await supabase.from("tables").select("mozo_id").in("id", [table1, table2]);
    expect(despues!.every((x) => x.mozo_id === null)).toBe(true);
    const { data: audit } = await supabase
      .from("tables_audit_log")
      .select("kind")
      .eq("business_id", businessId)
      .eq("reason", "Cierre del turno")
      .eq("kind", "assignment");
    expect(audit).toHaveLength(2);
  });

  // ── spec 130 · Cerrar caja ───────────────────────────────────────

  // D3 · El retiro es una sangría insertada **después** del corte (+1 ms). Sin
  // ese desfase la sangría comparte timestamp con el corte y, como el período
  // se calcula con `>` estricto, no cae ni en el viejo ni en el nuevo: la
  // plata se evapora del libro sin que nadie la haya sacado.
  it("cerrar con retiro deja el período nuevo en $0 y la sangría en el libro", async () => {
    CURRENT_USER_ID = encargadoId;
    const antes = await getCajaLiveStats(cajaA, businessId);
    const contado = antes!.expected_cash_cents;
    expect(contado).toBeGreaterThan(0);

    const r = await cerrarCaja({
      cajaId: cajaA,
      closing_cash_cents: contado,
      closing_notes: null,
      denomination_count: { "1000": 20, "500": 4 },
      retirar: true,
      businessSlug,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.retiro_cents).toBe(contado);

    const despues = await getCajaLiveStats(cajaA, businessId);
    expect(despues!.expected_cash_cents).toBe(0);

    // La sangría es una línea del libro como cualquier otra: visible,
    // corregible y anulable con lo que ya existe (spec 070).
    const { data: movs } = await supabase
      .from("caja_movimientos")
      .select("kind, amount_cents, reason, created_at")
      .eq("caja_id", cajaA)
      .eq("reason", "Retiro del cierre de caja");
    expect(movs).toHaveLength(1);
    expect(movs![0].kind).toBe("sangria");
    expect(movs![0].amount_cents).toBe(contado);
    expect(
      new Date(movs![0].created_at).getTime() -
        new Date(r.data.corte.created_at).getTime(),
    ).toBe(1);

    // Y el conteo por billete deja de ser una columna muerta (D10).
    expect(r.data.corte.denomination_count).toEqual({ "1000": 20, "500": 4 });
  });

  it("spec 209 · si el esperado cambió mientras se contaba, no cierra y devuelve el nuevo", async () => {
    CURRENT_USER_ID = encargadoId;
    const ing = await registrarIngreso(cajaA, 500_000, "cambio", businessSlug);
    expect(ing.ok).toBe(true);
    const actual = (await getCajaLiveStats(cajaA, businessId))!.expected_cash_cents;
    const { count: cortesAntes } = await supabase
      .from("caja_cortes")
      .select("id", { count: "exact", head: true })
      .eq("caja_id", cajaA);

    const r = await cerrarCaja({
      cajaId: cajaA,
      closing_cash_cents: actual,
      closing_notes: null,
      denomination_count: null,
      retirar: true,
      businessSlug,
      expected_visto_cents: actual - 5_000,
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ esperado_actual_cents: actual, delta_cents: 5_000 });
    const { count: cortesDespues } = await supabase
      .from("caja_cortes")
      .select("id", { count: "exact", head: true })
      .eq("caja_id", cajaA);
    expect(cortesDespues).toBe(cortesAntes);

    // Con el número de ahora cierra, y el recuento queda en el resumen.
    const ok = await cerrarCaja({
      cajaId: cajaA,
      closing_cash_cents: actual,
      closing_notes: null,
      denomination_count: null,
      retirar: true,
      businessSlug,
      expected_visto_cents: actual,
      recuentos_cents: [actual - 10_000],
    });
    expect(ok.ok).toBe(true);
    const { data: guardado } = await supabase
      .from("caja_cortes")
      .select("resumen")
      .eq("id", ok.ok ? ok.data.corte.id : "")
      .single();
    expect(
      (guardado!.resumen as { recuentos_cents?: number[] }).recuentos_cents,
    ).toEqual([actual - 10_000]);
  });

  it("cerrar sin retirar deja el esperado en lo contado (arqueo de mitad de turno)", async () => {
    CURRENT_USER_ID = encargadoId;
    await registrarIngreso(cajaA, 30_000, "fondo", businessSlug);

    const r = await corte(cajaA, 30_000, null, businessSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.retiro_cents).toBe(0);

    const stats = await getCajaLiveStats(cajaA, businessId);
    expect(stats!.expected_cash_cents).toBe(30_000);
  });

  // D7 · Cerrar con una mesa abierta es cerrar el día con plata sin cobrar.
  it("una mesa con la cuenta abierta bloquea el cierre, y el error la nombra", async () => {
    CURRENT_USER_ID = encargadoId;
    const { data: orden } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        table_id: table1,
        lifecycle_status: "open",
        delivery_type: "dine_in",
        subtotal_cents: 84_000,
        total_cents: 84_000,
        status: "pending",
        customer_name: "Mesa 1",
        customer_phone: "000",
      })
      .select("id")
      .single();
    openOrderId = orden!.id;

    const r = await corte(cajaA, 30_000, null, businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Mesa 1/);
      expect(r.error).toMatch(/abierta/i);
    }
  });

  // D7 · El delivery abierto avisa pero no bloquea: el repartidor puede estar
  // en la calle, y ese cobro cayendo en el período nuevo es lo correcto.
  it("un delivery abierto no bloquea el cierre", async () => {
    CURRENT_USER_ID = encargadoId;
    const { data: envio } = await supabase
      .from("orders")
      .insert({
        business_id: businessId,
        lifecycle_status: "open",
        delivery_type: "delivery",
        subtotal_cents: 20_000,
        total_cents: 20_000,
        status: "pending",
        customer_name: "Delivery",
        customer_phone: "000",
      })
      .select("id")
      .single();

    // La mesa abierta del test anterior se cierra; queda sólo el delivery.
    await supabase
      .from("orders")
      .update({ lifecycle_status: "closed" })
      .eq("id", openOrderId);

    const data = await getCierreCajaData(cajaA, businessId);
    expect(data!.cuentas_abiertas).toHaveLength(0);
    expect(data!.pedidos_abiertos.map((p) => p.origen)).toEqual(["delivery"]);

    const r = await corte(cajaA, 30_000, null, businessSlug);
    expect(r.ok).toBe(true);

    await supabase.from("orders").delete().eq("id", envio!.id);
  });

  // D9 · El cierre del bar puede pasar en plena cena: no barre el salón ni
  // mira si la 12 sigue comiendo.
  it("spec 210 v2 · con una mesa abierta no cierra ninguna caja, tampoco la del bar", async () => {
    CURRENT_USER_ID = encargadoId;
    const { data: cB } = await supabase
      .from("cajas")
      .insert({ business_id: businessId, name: "Bar" })
      .select("id")
      .single();
    // Una cuenta abierta nueva: un pedido cerrado no se reabre (spec 212 · 0146).
    const { data: abierta } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, table_id: table1, lifecycle_status: "open", delivery_type: "dine_in",
        subtotal_cents: 20_000, total_cents: 20_000, status: "pending", customer_name: "Mesa 1", customer_phone: "000",
      })
      .select("id")
      .single();

    const bar = await getCierreCajaData(cB!.id, businessId);
    expect(bar!.cuentas_abiertas.length).toBeGreaterThan(0);
    const r = await corte(cB!.id, 0, null, businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Mesa/);

    await supabase.from("orders").update({ lifecycle_status: "cancelled", status: "cancelled" }).eq("id", abierta!.id);
    await supabase.from("cajas").update({ is_active: false }).eq("id", cB!.id);
  });

  it("spec 210 v2 · el efectivo del mozo no entra al cajón: queda en su saldo", async () => {
    const antes = await esperado(cajaA);
    const { data: orden } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, lifecycle_status: "closed", delivery_type: "dine_in",
        subtotal_cents: 71_200, total_cents: 71_200, status: "delivered",
        customer_name: "Cobro del mozo", customer_phone: "000",
      })
      .select("id")
      .single();
    await supabase.from("payments").insert({
      business_id: businessId, order_id: orden!.id, caja_id: cajaA, method: "cash",
      amount_cents: 71_200, tip_cents: 0, payment_status: "paid", attributed_mozo_id: mozoAId,
    });

    expect(await esperado(cajaA)).toBe(antes);
    const saldos = await getSaldosMozos(businessId);
    const delMozo = saldos.find((m) => m.mozo_id === mozoAId && m.caja_id === cajaA);
    expect(delMozo?.saldo_cents).toBe(71_200);
    expect(delMozo?.resuelto).toBe(false);
  });

  // ── Spec 139 · la rendición obligatoria ────────────────────────────
  //
  // Encadenados con el caso de arriba a propósito: el pago de MozoA que quedó
  // sin rendir es justo el que ahora tiene que frenar el cierre.

  it("el mozo sin rendir bloquea el cierre de la principal, y el error lo nombra", async () => {
    CURRENT_USER_ID = encargadoId;

    const data = await getCierreCajaData(cajaA, businessId);
    expect(data!.deben_rendir.map((m) => m.mozo_name)).toContain("MozoA");
    expect(data!.sin_operadores).toBe(true);

    const r = await corte(cajaA, await esperado(cajaA), null, businessSlug);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/MozoA/);
      expect(r.error).toMatch(/rendición|rendiciones/i);
    }
  });

  // D1 · «Resolver» no es «entregar»: si el mozo se fue, la deuda se declara y
  // el cierre sigue. Lo que no se puede es saltearlo.
  it("marcar «no entregó» deja la deuda escrita y desbloquea el cierre", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await reconocerDeuda({ slug: businessSlug, mozoId: mozoAId, cajaId: cajaA, motivo: "se fue temprano" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.deuda_cents).toBe(71_200);

    const cierre = await corte(cajaA, await esperado(cajaA), null, businessSlug);
    expect(cierre.ok).toBe(true);
  });

  it("«no entregó» sin motivo se rechaza", async () => {
    CURRENT_USER_ID = encargadoId;
    const r = await reconocerDeuda({ slug: businessSlug, mozoId: mozoAId, cajaId: cajaA, motivo: "  " });
    expect(r.ok).toBe(false);
  });

  it("el operador asignado a la caja no rinde: lo que cobra entra derecho al cajón", async () => {
    CURRENT_USER_ID = encargadoId;
    await supabase.from("caja_user_assignments").insert({ business_id: businessId, caja_id: cajaA, user_id: mozoAId });
    const antes = await esperado(cajaA);
    const saldoAntes = (await getSaldosMozos(businessId)).find((m) => m.mozo_id === mozoAId && m.caja_id === cajaA)?.saldo_cents ?? 0;
    const { data: orden } = await supabase
      .from("orders")
      .insert({
        business_id: businessId, lifecycle_status: "closed", delivery_type: "dine_in",
        subtotal_cents: 10_000, total_cents: 10_000, status: "delivered",
        customer_name: "Cobro del operador", customer_phone: "000",
      })
      .select("id")
      .single();
    await supabase.from("payments").insert({
      business_id: businessId, order_id: orden!.id, caja_id: cajaA, method: "cash",
      amount_cents: 10_000, tip_cents: 0, payment_status: "paid", attributed_mozo_id: mozoAId,
    });
    expect(await esperado(cajaA)).toBe(antes + 10_000);
    const saldoDespues = (await getSaldosMozos(businessId)).find((m) => m.mozo_id === mozoAId && m.caja_id === cajaA)?.saldo_cents ?? 0;
    expect(saldoDespues).toBe(saldoAntes);
  });

});

/**
 * El negocio sobre el que se juega «un día de caja» (escenario de regresión).
 *
 * Dos orígenes:
 *  · `crearNegocioDePrueba(tag)` — un negocio descartable, con su gente, su
 *    salón, dos cajas y una carta mínima. Lo usa el test de regresión.
 *  · `cargarNegocioDemo()` — el negocio `demo` de la base LOCAL, con Sofía,
 *    Pedro, Lucía y Diego. Le agrega lo que el escenario necesita (productos
 *    «Prueba caja», un cliente para fiar, la transferencia con descuento y a
 *    Diego como operador de la Caja Bar) sin tocar lo demás.
 *
 * Lo que el escenario necesita saber del negocio está en `Negocio`; los precios
 * son fijos para que las cuentas esperadas se hagan a mano.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Persona = "encargada" | "pedro" | "lucia" | "diego";

/** Precios de la carta del escenario, en centavos. */
export const PRECIO = {
  milanesa: 1_200_000,
  pizza: 1_500_000,
  extraQueso: 200_000,
  agua: 300_000,
  flan: 500_000,
  cafe: 250_000,
} as const;

/** Ajustes por método (payment_method_configs), en %: los mismos que tiene el demo. */
export const AJUSTE_TRANSFERENCIA = -10;
export const RECARGO_TARJETA = 10;

export type Negocio = {
  sb: SupabaseClient;
  slug: string;
  businessId: string;
  gente: Record<Persona, string>;
  cajas: { principal: string; bar: string };
  productos: { milanesa: string; pizza: string; agua: string; flan: string; cafe: string };
  extraQueso: string;
  /** Cliente con cuenta corriente para el fiado. */
  cliente: string;
  /** Mesas libres para el día, en orden. */
  mesas: string[];
  /** Para limpiar (sólo el negocio de prueba). */
  teardown: () => Promise<void>;
};

function check<T>(r: { data: T; error: { message: string } | null }, que: string): NonNullable<T> {
  if (r.error) throw new Error(`${que}: ${r.error.message}`);
  if (r.data == null) throw new Error(`${que}: sin datos`);
  return r.data as NonNullable<T>;
}
/** Para escrituras sin `select`: sólo importa que no haya error. */
function sinError(r: { error: { message: string } | null }, que: string): void {
  if (r.error) throw new Error(`${que}: ${r.error.message}`);
}

/** Carta mínima del escenario: una estación, una categoría y cinco productos. */
async function cargarCarta(sb: SupabaseClient, businessId: string, sufijo: string, stationId?: string) {
  const station =
    stationId ??
    check(
      await sb.from("stations").insert({ business_id: businessId, name: `Cocina ${sufijo}` }).select("id").single(),
      "estación",
    ).id;
  const cat = check(
    await sb
      .from("categories")
      .insert({ business_id: businessId, name: `Prueba caja ${sufijo}`, slug: `prueba-caja-${sufijo}`, station_id: station })
      .select("id")
      .single(),
    "categoría",
  );
  const prod = async (key: keyof typeof PRECIO, nombre: string) =>
    check(
      await sb
        .from("products")
        .insert({
          business_id: businessId,
          category_id: cat.id,
          name: `${nombre} (prueba caja)`,
          slug: `prueba-caja-${key}-${sufijo}`,
          price_cents: PRECIO[key],
          is_active: true,
          is_available: true,
          show_online: false,
        })
        .select("id")
        .single(),
      `producto ${key}`,
    ).id as string;
  const productos = {
    milanesa: await prod("milanesa", "Milanesa"),
    pizza: await prod("pizza", "Pizza"),
    agua: await prod("agua", "Agua"),
    flan: await prod("flan", "Flan"),
    cafe: await prod("cafe", "Café"),
  };
  const grupo = check(
    await sb
      .from("modifier_groups")
      .insert({ business_id: businessId, product_id: productos.pizza, name: "Agregados", min_selection: 0, max_selection: 1 })
      .select("id")
      .single(),
    "grupo de modificadores",
  );
  const extra = check(
    await sb
      .from("modifiers")
      .insert({ group_id: grupo.id, name: "Extra queso", price_delta_cents: PRECIO.extraQueso })
      .select("id")
      .single(),
    "modificador",
  );
  return { productos, extraQueso: extra.id as string };
}

async function configurarCobro(sb: SupabaseClient, businessId: string) {
  sinError(
    await sb.from("payment_method_configs").upsert(
      [
        { business_id: businessId, method: "transfer", adjustment_percent: AJUSTE_TRANSFERENCIA, is_active: true },
        { business_id: businessId, method: "card_manual", adjustment_percent: RECARGO_TARJETA, is_active: true },
      ],
      { onConflict: "business_id,method" },
    ),
    "ajustes por método",
  );
}

async function clienteParaFiar(sb: SupabaseClient, businessId: string, sufijo: string) {
  return check(
    await sb
      .from("customers")
      .insert({ business_id: businessId, phone: `11-prueba-${sufijo}`, name: "Cliente Fiado (prueba caja)", credit_enabled: true })
      .select("id")
      .single(),
    "cliente",
  ).id as string;
}

// ── Negocio de prueba (descartable) ─────────────────────────────────────────

export async function crearNegocioDePrueba(sb: SupabaseClient, tag: string): Promise<Negocio> {
  const usuarios: string[] = [];
  const crearPersona = async (label: string, nombre: string) => {
    const email = `${tag}-${label}@example.test`;
    const { data, error } = await sb.auth.admin.createUser({ email, password: "test-pass-12345", email_confirm: true });
    if (error || !data.user) throw new Error(`usuario ${label}: ${error?.message}`);
    usuarios.push(data.user.id);
    sinError(await sb.from("users").upsert({ id: data.user.id, email, full_name: nombre }), "users");
    return data.user.id;
  };
  const gente: Record<Persona, string> = {
    encargada: await crearPersona("enc", "Sofía Encargada"),
    pedro: await crearPersona("pedro", "Pedro Mozo"),
    lucia: await crearPersona("lucia", "Lucía Moza"),
    diego: await crearPersona("diego", "Diego Mozo"),
  };

  const biz = check(
    await sb.from("businesses").insert({ slug: tag, name: "Día de caja (prueba)", is_active: true }).select("id").single(),
    "negocio",
  );
  const businessId = biz.id as string;
  const roles: [Persona, string][] = [["encargada", "encargado"], ["pedro", "mozo"], ["lucia", "mozo"], ["diego", "mozo"]];
  sinError(
    await sb.from("business_users").insert(
      roles.map(([p, role]) => ({ business_id: businessId, user_id: gente[p], role, full_name: p })),
    ),
    "equipo",
  );

  // Cajas: la principal la crea el trigger del negocio (0088); se suma la Bar.
  const { data: existentes } = await sb
    .from("cajas")
    .select("id, is_default, is_administrative")
    .eq("business_id", businessId);
  let principal = (existentes ?? []).find((c) => c.is_default && !c.is_administrative)?.id as string | undefined;
  if (!principal) {
    principal = check(
      await sb.from("cajas").insert({ business_id: businessId, name: "Caja Principal", is_default: true }).select("id").single(),
      "caja principal",
    ).id as string;
  }
  const bar = check(
    await sb.from("cajas").insert({ business_id: businessId, name: "Caja Bar", sort_order: 1 }).select("id").single(),
    "caja bar",
  ).id as string;
  sinError(
    await sb.from("caja_user_assignments").insert({ business_id: businessId, caja_id: bar, user_id: gente.diego }),
    "operador de la Bar",
  );

  const plan = check(await sb.from("floor_plans").insert({ business_id: businessId, name: "Salón" }).select("id").single(), "salón");
  const mesas = check(
    await sb
      .from("tables")
      .insert(
        Array.from({ length: 52 }, (_, i) => ({
          floor_plan_id: plan.id,
          label: `${i + 1}`,
          seats: 4,
          shape: "square",
          x: (i % 7) * 100,
          y: Math.floor(i / 7) * 100,
          width: 80,
          height: 80,
          operational_status: "libre",
        })),
      )
      .select("id, label"),
    "mesas",
  ) as { id: string; label: string }[];

  const carta = await cargarCarta(sb, businessId, tag);
  await configurarCobro(sb, businessId);
  const cliente = await clienteParaFiar(sb, businessId, tag);

  return {
    sb,
    slug: tag,
    businessId,
    gente,
    cajas: { principal, bar },
    ...carta,
    cliente,
    mesas: mesas.sort((a, b) => Number(a.label) - Number(b.label)).map((m) => m.id),
    teardown: async () => {
      await sb.from("businesses").delete().eq("id", businessId);
      for (const id of usuarios) {
        await sb.from("users").delete().eq("id", id);
        await sb.auth.admin.deleteUser(id);
      }
    },
  };
}

// ── El negocio demo (base local) ────────────────────────────────────────────

const EMAILS_DEMO: Record<Persona, string> = {
  encargada: "sofia@demo.test",
  pedro: "pedro@demo.test",
  lucia: "lucia@demo.test",
  diego: "diego@demo.test",
};

export async function cargarNegocioDemo(sb: SupabaseClient): Promise<Negocio> {
  const biz = check(await sb.from("businesses").select("id").eq("slug", "demo").single(), "negocio demo");
  const businessId = biz.id as string;

  const { data: equipo } = await sb
    .from("business_users")
    .select("user_id, users!inner(email)")
    .eq("business_id", businessId);
  const porEmail = new Map(
    ((equipo ?? []) as unknown as { user_id: string; users: { email: string } }[]).map((r) => [r.users.email, r.user_id]),
  );
  const gente = Object.fromEntries(
    (Object.keys(EMAILS_DEMO) as Persona[]).map((p) => {
      const id = porEmail.get(EMAILS_DEMO[p]);
      if (!id) throw new Error(`En demo falta ${EMAILS_DEMO[p]}`);
      return [p, id];
    }),
  ) as Record<Persona, string>;

  const { data: cajas } = await sb
    .from("cajas")
    .select("id, name, is_default, is_administrative, is_active")
    .eq("business_id", businessId);
  const lista = (cajas ?? []).filter((c) => c.is_active && !c.is_administrative);
  const principal = lista.find((c) => c.is_default)?.id;
  const bar = lista.find((c) => !c.is_default && /bar/i.test(c.name))?.id ?? lista.find((c) => !c.is_default)?.id;
  if (!principal || !bar) throw new Error("demo necesita una caja principal y otra (la Bar)");

  // Diego opera la Caja Bar (lo que cobra ahí entra derecho al cajón).
  sinError(
    await sb
      .from("caja_user_assignments")
      .upsert({ business_id: businessId, caja_id: bar, user_id: gente.diego }, { onConflict: "business_id,caja_id,user_id" }),
    "operador de la Bar",
  );

  // Carta del escenario: se reusa si ya se cargó en una corrida anterior.
  const { data: prev } = await sb
    .from("products")
    .select("id, slug")
    .eq("business_id", businessId)
    .like("slug", "prueba-caja-%-demo");
  let carta: { productos: Negocio["productos"]; extraQueso: string };
  if ((prev ?? []).length >= 5) {
    const id = (k: string) => prev!.find((p) => p.slug === `prueba-caja-${k}-demo`)!.id as string;
    const { data: grupo } = await sb.from("modifier_groups").select("id").eq("product_id", id("pizza")).single();
    const { data: mod } = await sb.from("modifiers").select("id").eq("group_id", grupo!.id).single();
    carta = {
      productos: { milanesa: id("milanesa"), pizza: id("pizza"), agua: id("agua"), flan: id("flan"), cafe: id("cafe") },
      extraQueso: mod!.id as string,
    };
  } else {
    const { data: est } = await sb.from("stations").select("id").eq("business_id", businessId).eq("is_active", true).limit(1);
    carta = await cargarCarta(sb, businessId, "demo", est?.[0]?.id);
  }
  await configurarCobro(sb, businessId);

  const { data: cli } = await sb
    .from("customers")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone", "11-prueba-demo")
    .maybeSingle();
  const cliente = (cli?.id as string | undefined) ?? (await clienteParaFiar(sb, businessId, "demo"));

  // Mesas libres y sin cuenta abierta.
  const { data: planes } = await sb.from("floor_plans").select("id").eq("business_id", businessId);
  const { data: libres } = await sb
    .from("tables")
    .select("id, label")
    .in("floor_plan_id", (planes ?? []).map((p) => p.id))
    .eq("operational_status", "libre")
    .eq("status", "active")
    .is("current_order_id", null);
  const mesas = ((libres ?? []) as { id: string; label: string }[])
    .sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true }))
    .map((m) => m.id);

  return {
    sb,
    slug: "demo",
    businessId,
    gente,
    cajas: { principal, bar },
    ...carta,
    cliente,
    mesas,
    teardown: async () => {},
  };
}

import { test, expect } from "@playwright/test";

import { SLUG, storageState } from "./roles";
import { db, businessId } from "./db";

/**
 * P03 · Cerrar la caja — los dos números, y la guarda que no deja cerrar.
 *
 * Caso de uso: wiki/qa/procesos/P03-cerrar-la-caja.md
 *
 * Estos tests **no cierran ninguna caja**: verifican los números del arqueo y
 * el bloqueo. Un cierre de verdad barre el salón entero del demo —libera todas
 * las mesas y borra la distribución de mozos— y deja los otros specs sin datos.
 * El camino que sí se ejercita es el que importa: que el sistema **frene** con
 * plata sin cobrar, que es el que le falla a MaxiRest todos los días.
 *
 * Se entra como **encargada** y no como admin: el techo de diferencia
 * ($5.000, `DIFERENCIA_CAJA_OK_CENTS`) sólo existe con el rol real.
 *
 * La **spec 177** metió mano en los dos números: el esperado ya no descuenta la
 * propina (sale por un movimiento propio cuando se paga), y el retiro del
 * cierre puede dejar un fondo en el cajón.
 */
test.use({ storageState: storageState("encargada") });

test.describe("P03 · el arqueo y su guarda", () => {
  test("«deberías tener» sale del arrastre más los cobros en efectivo", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);

    // Lo esperado se deriva de la base, con la misma cuenta que
    // `calculateExpectedCash`: arrastre del último corte + efectivo del período
    // + ingresos − sangrías − propinas pagadas.
    //
    // ⚠️ Spec 177 · D5 — esta cuenta CAMBIÓ. Hasta la 177 el efectivo iba
    // «− propina» (la 098 asumía que el negocio se la pagaba al mozo por fuera
    // del cajón). Ahora el cajón espera **lo que entró**, propina incluida, y
    // la propina sale por su propio movimiento cuando se le paga al mozo en la
    // rendición. La cuenta vieja dejaba faltante todas las noches en un local
    // que paga la propina de tarjeta con efectivo del cajón.
    const { data: cajas } = await db
      .from("cajas")
      .select("id, name")
      .eq("business_id", bizId)
      .eq("is_default", true)
      .limit(1);
    const caja = (cajas ?? [])[0] as { id: string; name: string };
    expect(caja, "el demo tiene que tener una caja principal").toBeTruthy();

    const { data: cortes } = await db
      .from("caja_cortes")
      .select("closing_cash_cents, created_at")
      .eq("caja_id", caja.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const ultimo = (cortes ?? [])[0] as
      | { closing_cash_cents: number; created_at: string }
      | undefined;

    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await expect(page.getByText(/EN LA CAJA DEBER[IÍ]AS TENER/i)).toBeVisible({
      timeout: 20_000,
    });

    // La pantalla explica de dónde sale el número, y el arrastre tiene que ser
    // el cierre anterior — no lo esperado de ese turno. Si tomara lo esperado,
    // una diferencia aceptada se contaría dos veces.
    if (ultimo) {
      await expect(
        page.getByText(/del corte anterior/i).first(),
      ).toContainText(montoAR(ultimo.closing_cash_cents));
    }
  });

  test("«cobrado en el período» y «deberías tener» son números distintos", async ({
    page,
  }) => {
    // No es un detalle de UI: son conceptos distintos y la ayuda lo dice
    // («es otra cosa y casi nunca coincide»). Confundirlos es lo que hace que
    // un encargado crea que le falta plata.
    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await expect(page.getByText(/COBRADO EN EL PER[IÍ]ODO/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/EN LA CAJA DEBER[IÍ]AS TENER/i)).toBeVisible();

    // El desglose por método tiene que sumar el cobrado, no el esperado.
    await expect(page.getByText(/COBRADO POR M[EÉ]TODO/i)).toBeVisible();
  });

  test("con mesas abiertas, la caja principal no cierra y las nombra", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: abiertas } = await db
      .from("orders")
      .select("id")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null);
    expect(
      (abiertas ?? []).length,
      "el seed tiene que dejar mesas vivas para que la guarda tenga qué frenar",
    ).toBeGreaterThan(0);

    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await page.getByRole("button", { name: /^Cerrar caja$/ }).click();

    // La guarda es de la spec 092 y del cierre: no se cierra el día con
    // consumo sin cobrar. Y no alcanza con frenar — tiene que decir CUÁL mesa,
    // porque «OPEN_TABLE_ORDERS:3» no le sirve a nadie a la 1 de la mañana.
    await expect(
      page.getByText(/cuenta abierta|mesas con la cuenta abierta/i).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Mesa\s/i).first()).toBeVisible();
  });
});

// ── Spec 177 · D5 — la cuenta del efectivo esperado ───────────────────────
//
// Lo que se prueba acá es el NÚMERO, no el rótulo: el esperado es
//   apertura + efectivo cobrado BRUTO + ingresos − sangrías − propinas pagadas
// y la parte nueva son los dos extremos. Hasta la 177 el efectivo iba «neto de
// propina», lo que dejaba faltante todas las noches en un local que le paga la
// propina de tarjeta al mozo con plata del cajón.

/** El esperado de la caja principal, con la misma cuenta que el server. */
async function esperadoDeLaPrincipal(bizId: string) {
  const { data: cajas } = await db
    .from("cajas")
    .select("id")
    .eq("business_id", bizId)
    .eq("is_default", true)
    .limit(1);
  const caja = (cajas ?? [])[0] as { id: string };
  expect(caja, "el demo tiene que tener una caja principal").toBeTruthy();

  const { data: cortes } = await db
    .from("caja_cortes")
    .select("closing_cash_cents, created_at")
    .eq("caja_id", caja.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const ultimo = (cortes ?? [])[0] as
    | { closing_cash_cents: number; created_at: string }
    | undefined;
  const desde = ultimo?.created_at ?? "1970-01-01T00:00:00Z";

  const { data: pagos } = await db
    .from("payments")
    .select("amount_cents, tip_cents")
    .eq("caja_id", caja.id)
    .eq("payment_status", "paid")
    .eq("method", "cash")
    .gt("created_at", desde);

  const { data: movs } = await db
    .from("caja_movimientos")
    .select("kind, amount_cents")
    .eq("caja_id", caja.id)
    .is("cancelled_at", null)
    .gt("created_at", desde);

  const suma = (k: string) =>
    ((movs ?? []) as { kind: string; amount_cents: number }[])
      .filter((m) => m.kind === k)
      .reduce((a, m) => a + m.amount_cents, 0);

  const efectivoBruto = ((pagos ?? []) as { amount_cents: number }[]).reduce(
    (a, p) => a + p.amount_cents,
    0,
  );
  const propinaCobrada = ((pagos ?? []) as { tip_cents: number }[]).reduce(
    (a, p) => a + (p.tip_cents ?? 0),
    0,
  );

  return {
    cajaId: caja.id,
    propinaCobrada,
    esperado:
      (ultimo?.closing_cash_cents ?? 0) +
      efectivoBruto +
      suma("ingreso") -
      suma("sangria") -
      suma("propina"),
  };
}

test.describe("P03 · el esperado es lo que entró menos lo que salió", () => {
  test("el número de la pantalla sale de la cuenta nueva, con la propina adentro", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { esperado, propinaCobrada } = await esperadoDeLaPrincipal(bizId);

    // Sin propina cobrada las dos fórmulas dan igual y el test no probaría nada.
    test.skip(
      propinaCobrada === 0,
      "el seed no dejó propinas en efectivo en el período",
    );

    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await expect(page.getByText(/EN LA CAJA DEBER[IÍ]AS TENER/i)).toBeVisible({
      timeout: 20_000,
    });

    const tarjeta = page
      .locator("div", { hasText: /^En la caja deberías tener/ })
      .last();
    await expect(tarjeta).toContainText(montoAR(esperado));

    // Y la cuenta VIEJA (neto de propina) tiene que dar otro número: si diera
    // el mismo, este test pasaría con la implementación anterior y no estaría
    // probando la spec.
    expect(esperado).not.toBe(esperado - propinaCobrada);
  });

  test("pagarle la propina a un mozo baja el esperado por ese monto", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { cajaId, esperado } = await esperadoDeLaPrincipal(bizId);

    const { data: mozos } = await db
      .from("business_users")
      .select("user_id")
      .eq("business_id", bizId)
      .eq("role", "mozo")
      .limit(1);
    const mozo = (mozos ?? [])[0] as { user_id: string } | undefined;
    test.skip(!mozo, "el demo no tiene mozos");

    // Fixture: el movimiento lo crea la rendición, y rendir de verdad cierra el
    // período del mozo y deja a los otros specs sin datos. Lo que se prueba acá
    // es la FÓRMULA, así que se inserta el movimiento y se borra al salir.
    const PAGO = 123_400;
    let movId: string | null = null;
    try {
      const { data: mov } = await db
        .from("caja_movimientos")
        .insert({
          business_id: bizId,
          caja_id: cajaId,
          kind: "propina",
          mozo_id: mozo!.user_id,
          amount_cents: PAGO,
          reason: "Propina · E2E",
        })
        .select("id")
        .single();
      movId = (mov as { id: string } | null)?.id ?? null;
      expect(movId, "el check de la base tiene que aceptar propina+mozo").toBeTruthy();

      await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
      await expect(page.getByText(/EN LA CAJA DEBER[IÍ]AS TENER/i)).toBeVisible({
        timeout: 20_000,
      });

      const tarjeta = page
        .locator("div", { hasText: /^En la caja deberías tener/ })
        .last();
      await expect(tarjeta).toContainText(montoAR(esperado - PAGO));
    } finally {
      if (movId) await db.from("caja_movimientos").delete().eq("id", movId);
    }
  });

  test("una propina sin dueño no entra: el check de la base la rechaza", async () => {
    // D6 — una propina sin mozo es una sangría con otro nombre, y un `mozo_id`
    // colgado de una sangría haría que el reporte por mozo contara plata ajena.
    const bizId = await businessId(SLUG);
    const { cajaId } = await esperadoDeLaPrincipal(bizId);

    const { error } = await db.from("caja_movimientos").insert({
      business_id: bizId,
      caja_id: cajaId,
      kind: "propina",
      amount_cents: 1000,
    });
    expect(error, "la base tiene que rechazar una propina sin mozo").toBeTruthy();
  });
});

// ── Spec 177 · Parte B — la rendición paga ─────────────────────────────────
test.describe("P03 · la propina se le paga al mozo en la rendición", () => {
  test("la tarjeta del mozo dice cuánto hay que pagarle, no «aparte»", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);

    // Sólo tiene sentido si el seed dejó algún cobro con propina sin rendir.
    const { data: conPropina } = await db
      .from("payments")
      .select("id")
      .eq("business_id", bizId)
      .eq("payment_status", "paid")
      .gt("tip_cents", 0)
      .not("attributed_mozo_id", "is", null)
      .limit(1);
    test.skip(
      (conPropina ?? []).length === 0,
      "el seed no dejó propinas atribuidas a ningún mozo",
    );

    await page.goto(`/${SLUG}/admin/operacion?tab=rendicion`);

    // El cambio de concepto: dejó de ser un número informativo («Propinas
    // (aparte)») y pasó a ser plata que sale del cajón en esta pantalla.
    await expect(page.getByText(/Propina a pagarle/i).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Propinas \(aparte\)/i)).toHaveCount(0);
  });

  test("el modal avisa que la propina sale del cajón ANTES de confirmar", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: conPropina } = await db
      .from("payments")
      .select("id")
      .eq("business_id", bizId)
      .eq("payment_status", "paid")
      .gt("tip_cents", 0)
      .not("attributed_mozo_id", "is", null)
      .limit(1);
    test.skip(
      (conPropina ?? []).length === 0,
      "el seed no dejó propinas atribuidas a ningún mozo",
    );

    await page.goto(`/${SLUG}/admin/operacion?tab=rendicion`);
    await page
      .getByRole("button", { name: /Registrar rendición/i })
      .first()
      .click();

    // Que salga plata del cajón no puede ser una sorpresa: se lee antes de
    // apretar, no en un toast después. No se confirma — registrar la rendición
    // cierra el período del mozo y deja a los otros specs sin datos.
    await expect(
      page.getByText(/sale del cajón como movimiento de caja/i),
    ).toBeVisible({ timeout: 20_000 });
  });
});

// ── Spec 177 · Parte C — el fondo de caja ──────────────────────────────────
//
// La spec 130 · D2 decía «se retira todo o nada, sin fondo configurable». La
// 177 lo revierte SIN perder el argumento: el fondo está configurado, así que a
// la 1 de la mañana no hay ninguna decisión nueva que tomar.
test.describe("P03 · el cierre puede dejar fondo en el cajón", () => {
  test("con fondo configurado, la casilla dice cuánto queda", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: cajas } = await db
      .from("cajas")
      .select("id, fondo_fijo_cents")
      .eq("business_id", bizId)
      .eq("is_default", true)
      .limit(1);
    const caja = (cajas ?? [])[0] as {
      id: string;
      fondo_fijo_cents: number;
    };
    expect(caja, "el demo tiene que tener una caja principal").toBeTruthy();

    // Fixture, no acción del usuario: el fondo es CONFIGURACIÓN (se edita en
    // Caja → Editar caja, con rol admin) y lo que este test prueba es el
    // cierre, no la pantalla de config. Se restaura sí o sí — el resto de la
    // suite comparte el mismo negocio.
    const original = caja.fondo_fijo_cents ?? 0;
    try {
      await db
        .from("cajas")
        .update({ fondo_fijo_cents: 100_000 })
        .eq("id", caja.id);

      await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
      await page.getByRole("button", { name: /^Cerrar caja$/ }).click();

      const contado = page.locator("#cierre-contado");
      await expect(contado).toBeVisible({ timeout: 20_000 });
      await contado.fill("5000");

      // Contado $5.000 con fondo $1.000 → se retiran $4.000 y quedan $1.000.
      await expect(page.getByText(/Retirar todo el efectivo/i)).toHaveCount(0);
      await expect(
        page.getByText(/quedan .* de fondo para el próximo turno/i),
      ).toBeVisible();
    } finally {
      await db
        .from("cajas")
        .update({ fondo_fijo_cents: original })
        .eq("id", caja.id);
    }
  });

  test("sin fondo, sigue diciendo que se retira todo", async ({ page }) => {
    const bizId = await businessId(SLUG);
    const { data: cajas } = await db
      .from("cajas")
      .select("fondo_fijo_cents")
      .eq("business_id", bizId)
      .eq("is_default", true)
      .limit(1);
    const fondo = ((cajas ?? [])[0] as { fondo_fijo_cents: number })
      ?.fondo_fijo_cents;
    test.skip(
      (fondo ?? 0) > 0,
      "el demo tiene fondo configurado: el default es otro",
    );

    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await page.getByRole("button", { name: /^Cerrar caja$/ }).click();

    const contado = page.locator("#cierre-contado");
    await expect(contado).toBeVisible({ timeout: 20_000 });
    await contado.fill("5000");

    await expect(page.getByText(/Retirar todo el efectivo/i)).toBeVisible();
  });
});


function montoAR(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

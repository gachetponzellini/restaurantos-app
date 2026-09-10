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

// ── Spec 177 · Parte B — el desglose del esperado ──────────────────────────
//
// El desglose no es decoración: es lo que hace que la diferencia del arqueo ya
// venga explicada antes de contar (issue #188). Si los renglones no espejan la
// fórmula, el encargado ve un número que no puede reconstruir.
test.describe("P03 · el desglose dice de dónde sale el esperado", () => {
  test("el efectivo cobrado se muestra CON la propina adentro", async ({
    page,
  }) => {
    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await expect(page.getByText(/EN LA CAJA DEBER[IÍ]AS TENER/i)).toBeVisible({
      timeout: 20_000,
    });

    // La bajada del renglón es el contrato: antes decía «Sin propinas» y desde
    // la 177 dice lo contrario. Un renglón que miente sobre su propia cuenta es
    // peor que no tenerlo.
    await expect(page.getByText(/Con propinas/i).first()).toBeVisible();
    await expect(page.getByText(/Sin propinas/i)).toHaveCount(0);
  });

  test("el renglón de propinas pagadas aparece sólo si hubo", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);

    // Se DERIVA de la base, igual que el resto de la suite: si el seed no dejó
    // ninguna propina pagada, el renglón no tiene que estar. Un renglón en $0
    // en la pantalla del cierre es ruido a la 1 de la mañana.
    const { data: pagos } = await db
      .from("caja_movimientos")
      .select("id")
      .eq("business_id", bizId)
      .eq("kind", "propina")
      .is("cancelled_at", null);
    const hubo = (pagos ?? []).length > 0;

    await page.goto(`/${SLUG}/admin/operacion?tab=caja`);
    await expect(page.getByText(/EN LA CAJA DEBER[IÍ]AS TENER/i)).toBeVisible({
      timeout: 20_000,
    });

    await expect(page.getByText(/Propinas pagadas/i)).toHaveCount(hubo ? 1 : 0);
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

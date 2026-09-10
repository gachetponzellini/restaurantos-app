import { test, expect, type Page } from "@playwright/test";

import { SLUG, storageState } from "./roles";
import { db, businessId } from "./db";

/**
 * P01 · Piden la cuenta — el número que se ve es el que se cobra.
 *
 * Caso de uso: wiki/qa/procesos/P01-piden-la-cuenta.md
 *
 * Estos tests **no completan ningún cobro**: llegan hasta la pantalla y
 * verifican lo que se le muestra al cliente antes de confirmar. Es a propósito
 * — cobrar de verdad ensucia el arqueo del demo, y lo que hay que probar acá es
 * justamente el momento anterior: que el total que el encargado lee en voz alta
 * sea el que el sistema va a registrar.
 *
 * El recargo por método (spec 062) es la pieza que se cruza: vive en
 * `payment_method_configs`, se aplica en el server, y se muestra ya calculado en
 * el botón. Tres lugares que tienen que decir lo mismo.
 *
 * Desde la **spec 177 · Parte A** se cruza una segunda: qué pasa con lo que se
 * cobra de más. Es el mismo contrato —lo que el botón dice es lo que se va a
 * registrar— pero ahora el excedente tiene dos destinos posibles y el default
 * depende del método.
 */
test.use({ storageState: storageState("encargada") });

/** Del plano a la pantalla de cobro, que son tres saltos y ninguno navega. */
async function abrirCobro(page: Page, mesa: string) {
  await page.goto(`/${SLUG}/admin/operacion?tab=salon`);
  // Señal de hidratación: el contador lo calcula el cliente.
  await expect(page.getByRole("button", { name: /^Mesas \d+$/ })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: new RegExp(mesa) }).first().click();
  // «Cobrar» abre la CUENTA (propina, descuento, dividir), no el cobro. El
  // cobro es el paso siguiente. Los dos paneles son embebidos: no cambian la
  // URL, así que no hay navegación que esperar — se espera el contenido.
  await page.getByRole("button", { name: /^Cobrar$/ }).first().click();
  const pasar = page.getByRole("button", { name: /Pasar a cobro/ });
  await pasar.waitFor({ timeout: 20_000 });
  return pasar;
}

/** Una mesa viva del seed, con su total. Todos los tests arrancan de acá. */
async function mesaViva(): Promise<{ total_cents: number; label: string }> {
  const bizId = await businessId(SLUG);
  const { data } = await db
    .from("orders")
    .select("total_cents, tables!orders_table_id_fkey(label)")
    .eq("business_id", bizId)
    .eq("lifecycle_status", "open")
    .not("table_id", "is", null)
    .limit(1);
  const orden = (data ?? [])[0] as unknown as {
    total_cents: number;
    tables: { label: string };
  };
  expect(orden, "el seed tiene que dejar una mesa viva").toBeTruthy();
  return { total_cents: orden.total_cents, label: orden.tables.label };
}

/** Tipea un monto (en PESOS, como el input) en el paso 2 del cobro. */
async function tipearMonto(page: Page, pesos: number) {
  // Por id y no por label: el panel embebido puede tener más de un «Monto» a la
  // vez, y en modo estricto eso es un fallo que no dice nada del producto.
  const monto = page.locator("#cobro-monto");
  await expect(monto).toBeVisible({ timeout: 20_000 });
  await monto.fill(String(pesos));
}

test.describe("P01 · lo que se muestra antes de confirmar", () => {
  test("la cuenta abre por el total que la base tiene para esa mesa", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data } = await db
      .from("orders")
      .select("total_cents, tables!orders_table_id_fkey(label)")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null)
      .limit(1);
    const orden = (data ?? [])[0] as unknown as {
      total_cents: number;
      tables: { label: string };
    };
    expect(orden, "el seed tiene que dejar una mesa viva").toBeTruthy();

    const pasar = await abrirCobro(page, orden.tables.label);

    // El botón lleva el importe: «Pasar a cobro · $ 47.000». Es el número que
    // el encargado le dice al cliente, y tiene que ser el de la base.
    await expect(pasar).toContainText(montoAR(orden.total_cents));
  });

  test("el recargo del método se muestra ya calculado, y sale de la config", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);

    // Lo esperado se DERIVA: el porcentaje de la config, aplicado al total de
    // la orden. Nada hardcodeado — si mañana el dueño cambia el recargo, el
    // test sigue midiendo lo correcto.
    const { data: configs } = await db
      .from("payment_method_configs")
      .select("method, adjustment_percent")
      .eq("business_id", bizId)
      .neq("adjustment_percent", 0);
    const card = (configs ?? []).find((c) => c.method === "card_manual") as
      | { adjustment_percent: number }
      | undefined;
    test.skip(!card, "el negocio no tiene recargo en tarjeta configurado");

    const { data } = await db
      .from("orders")
      .select("total_cents, tables!orders_table_id_fkey(label)")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null)
      .limit(1);
    const orden = (data ?? [])[0] as unknown as {
      total_cents: number;
      tables: { label: string };
    };

    const pasar = await abrirCobro(page, orden.tables.label);
    await pasar.click();

    const pct = Number(card!.adjustment_percent);
    const conRecargo =
      orden.total_cents + Math.round((orden.total_cents * pct) / 100);

    const boton = page.getByRole("button", { name: /Tarjeta/ }).first();
    await expect(boton).toBeVisible({ timeout: 20_000 });

    // Las dos mitades del contrato de la spec 062: el porcentaje y el número
    // final, los dos a la vista ANTES de confirmar. La ayuda es explícita:
    // «Decile al cliente el número final antes de confirmar, no después».
    await expect(boton).toContainText(`${pct > 0 ? "+" : ""}${pct}%`);
    await expect(boton).toContainText(montoAR(conRecargo));
  });

  test("el efectivo no lleva recargo: se cobra la cuenta y nada más", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data } = await db
      .from("orders")
      .select("total_cents, tables!orders_table_id_fkey(label)")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null)
      .limit(1);
    const orden = (data ?? [])[0] as unknown as {
      total_cents: number;
      tables: { label: string };
    };

    const pasar = await abrirCobro(page, orden.tables.label);
    await pasar.click();

    const efectivo = page.getByRole("button", { name: /Efectivo/ }).first();
    await expect(efectivo).toBeVisible({ timeout: 20_000 });
    // Sin porcentaje en el botón: el que no tiene ajuste no muestra ninguno.
    await expect(efectivo).not.toContainText("%");
  });

  // ── Spec 177 · Parte A — lo que se cobra de más ────────────────────────
  //
  // El contrato es el mismo de siempre —el botón dice lo que se va a
  // registrar— pero ahora el excedente tiene dos destinos y el default sale
  // del método. Ninguno de estos tests confirma: lo que se prueba es
  // justamente lo que el encargado LEE antes de apretar.

  test("en efectivo, de más es vuelto: el botón cobra lo que se debe", async ({
    page,
  }) => {
    // issue #188 — el billete grande es el caso normal, y tipearlo ES calcular
    // el vuelto. Por eso en efectivo el default no puede ser propina.
    const mesa = await mesaViva();
    const pasar = await abrirCobro(page, mesa.label);
    await pasar.click();

    await page.getByRole("button", { name: /Efectivo/ }).first().click();
    const deMas = mesa.total_cents / 100 + 5_000;
    await tipearMonto(page, deMas);

    await expect(page.getByText(/^Vuelto:/)).toBeVisible();
    await expect(page.getByText(/^Vuelto:/)).toContainText(montoAR(500_000));
    // Lo que se registra sigue siendo la cuenta, no el billete.
    await expect(
      page.getByRole("button", { name: /^Confirmar/ }),
    ).toContainText(montoAR(mesa.total_cents));
  });

  test("«se lo dejan de propina» hace entrar el billete entero", async ({
    page,
  }) => {
    const mesa = await mesaViva();
    const pasar = await abrirCobro(page, mesa.label);
    await pasar.click();

    await page.getByRole("button", { name: /Efectivo/ }).first().click();
    await tipearMonto(page, mesa.total_cents / 100 + 5_000);

    await page
      .getByRole("button", { name: /se lo dejan de propina/i })
      .click();

    // El cartel cambia de concepto y el botón, de número: la propina NO es
    // vuelto, así que entra a la caja (y es del mozo, no venta del negocio).
    await expect(page.getByText(/^Propina:/)).toBeVisible();
    await expect(page.getByText(/^Propina:/)).toContainText(montoAR(500_000));
    await expect(page.getByText(/^Vuelto:/)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Confirmar/ }),
    ).toContainText(montoAR(mesa.total_cents + 500_000));
  });

  test("en tarjeta el excedente es propina sin preguntar", async ({ page }) => {
    // Lo que estaba mal hasta la spec 177: el posnet cobraba de más y esos
    // pesos entraban como VENTA del negocio, con `tip_cents = 0`. En tarjeta
    // no hay vuelto que dar, así que no hay nada que preguntar.
    const mesa = await mesaViva();
    const pasar = await abrirCobro(page, mesa.label);
    await pasar.click();

    await page.getByRole("button", { name: /Tarjeta/ }).first().click();
    const monto = page.locator("#cobro-monto");
    await expect(monto).toBeVisible({ timeout: 20_000 });
    // Se parte del monto que la pantalla ya puso (que puede traer recargo) y
    // se le suman $5.000: así el test no depende de si hay ajuste configurado.
    const base = Math.round(Number(await monto.inputValue()) * 100);
    await monto.fill(String(base / 100 + 5_000));

    await expect(page.getByText(/^Propina:/)).toBeVisible();
    await expect(page.getByText(/^Vuelto:/)).toHaveCount(0);
    await expect(page.getByText(/^Propina:/)).toContainText(
      /para el mozo de la mesa/i,
    );
    await expect(
      page.getByRole("button", { name: /^Confirmar/ }),
    ).toContainText(montoAR(base + 500_000));
  });
});

/** El monto como lo escribe la app: 47.000 (sin decimales, punto de miles). */
function montoAR(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

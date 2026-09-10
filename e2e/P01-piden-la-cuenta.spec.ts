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

/**
 * Una mesa viva del seed, con su total. Todos los tests arrancan de acá.
 *
 * Dos cosas que parecen detalle y no lo son:
 *
 *  - **Se acota al primer salón.** El plano abre en el que la app ordena
 *    primero (`floor_plans` por `created_at`), y el demo tiene dos. Una mesa
 *    del Salón 2 existe en la base pero no está en pantalla, así que el click
 *    por label espera para siempre.
 *  - **Se ordena.** Un `limit(1)` sin `order` en Postgres devuelve la fila que
 *    salga primero, y eso cambia con cada UPDATE. Era un flake dormido: la
 *    suite elegía una mesa distinta según lo que hubiera corrido antes.
 */
async function mesaViva(): Promise<{
  id: string;
  total_cents: number;
  tip_cents: number;
  table_id: string;
  label: string;
}> {
  const bizId = await businessId(SLUG);
  const { data: planos } = await db
    .from("floor_plans")
    .select("id")
    .eq("business_id", bizId)
    .order("created_at", { ascending: true })
    .limit(1);
  const plano = (planos ?? [])[0] as { id: string };
  expect(plano, "el demo tiene que tener al menos un salón").toBeTruthy();

  const { data } = await db
    .from("orders")
    .select(
      "id, total_cents, tip_cents, table_id, tables!orders_table_id_fkey!inner(label, floor_plan_id)",
    )
    .eq("business_id", bizId)
    .eq("lifecycle_status", "open")
    .not("table_id", "is", null)
    .eq("tables.floor_plan_id", plano.id)
    .order("id", { ascending: true })
    .limit(1);
  const orden = (data ?? [])[0] as unknown as {
    id: string;
    total_cents: number;
    tip_cents: number;
    table_id: string;
    tables: { label: string };
  };
  expect(orden, "el seed tiene que dejar una mesa viva en el primer salón").toBeTruthy();
  return {
    id: orden.id,
    total_cents: orden.total_cents,
    tip_cents: orden.tip_cents,
    table_id: orden.table_id,
    label: orden.tables.label,
  };
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
    const mesa = await mesaViva();
    const pasar = await abrirCobro(page, mesa.label);

    // El botón lleva el importe: «Pasar a cobro · $ 47.000». Es el número que
    // el encargado le dice al cliente, y tiene que ser el de la base.
    await expect(pasar).toContainText(montoAR(mesa.total_cents));
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

    const mesa = await mesaViva();
    const pasar = await abrirCobro(page, mesa.label);
    await pasar.click();

    const pct = Number(card!.adjustment_percent);
    const conRecargo =
      mesa.total_cents + Math.round((mesa.total_cents * pct) / 100);

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
    const mesa = await mesaViva();
    const pasar = await abrirCobro(page, mesa.label);
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

  // ── Spec 177 · Parte A — el único test de P01 que SÍ confirma ──────────
  //
  // El resto de la suite se detiene antes de apretar, a propósito. Éste no
  // puede: lo que la spec promete —que el excedente quede como propina del
  // mozo y que el comprobante NO cambie— sólo se puede mirar después del
  // cobro. Se deshace entero al salir, así que la mesa vuelve como estaba.
  test("confirmar con excedente deja la propina en la base y no toca lo facturable", async ({
    page,
  }) => {
    const orden = await mesaViva();

    const { data: mesaAntes } = await db
      .from("tables")
      .select("operational_status, current_order_id, opened_at")
      .eq("id", orden.table_id)
      .single();

    // La base fiscal ANTES: es lo que no se puede mover (spec 36 · R-C1, la
    // propina no integra la base imponible en AR).
    const facturableAntes = orden.total_cents - orden.tip_cents;
    const EXCEDENTE = 500_000;

    try {
      const pasar = await abrirCobro(page, orden.label);
      await pasar.click();
      await page.getByRole("button", { name: /Efectivo/ }).first().click();
      await tipearMonto(page, (orden.total_cents + EXCEDENTE) / 100);
      await page
        .getByRole("button", { name: /se lo dejan de propina/i })
        .click();
      await page.getByRole("button", { name: /^Confirmar/ }).click();

      await expect
        .poll(
          async () => {
            const { data } = await db
              .from("payments")
              .select("amount_cents, tip_cents, received_cents")
              .eq("order_id", orden.id)
              .eq("payment_status", "paid");
            return ((data ?? []) as unknown[]).length;
          },
          { timeout: 20_000 },
        )
        .toBe(1);

      const { data: pagos } = await db
        .from("payments")
        .select("amount_cents, tip_cents, received_cents, attributed_mozo_id")
        .eq("order_id", orden.id)
        .eq("payment_status", "paid");
      const pago = (pagos ?? [])[0] as {
        amount_cents: number;
        tip_cents: number;
        received_cents: number | null;
        attributed_mozo_id: string | null;
      };

      // Entra el billete entero, y el excedente queda etiquetado como propina.
      expect(pago.amount_cents).toBe(orden.total_cents + EXCEDENTE);
      expect(pago.tip_cents).toBe(orden.tip_cents + EXCEDENTE);
      // Y queda el billete que entró, para poder reconstruir el vuelto.
      expect(pago.received_cents).toBe(orden.total_cents + EXCEDENTE);

      const { data: despues } = await db
        .from("orders")
        .select("tip_cents, total_cents, total_paid_cents")
        .eq("id", orden.id)
        .single();
      const o = despues as {
        tip_cents: number;
        total_cents: number;
        total_paid_cents: number;
      };

      // Los dos suben juntos…
      expect(o.tip_cents).toBe(orden.tip_cents + EXCEDENTE);
      expect(o.total_cents).toBe(orden.total_cents + EXCEDENTE);
      // …y por eso la cuenta cierra exacta en vez de quedar «pagada de más».
      expect(o.total_paid_cents).toBe(o.total_cents);
      // Lo que la spec promete: el comprobante no cambia en un peso.
      expect(o.total_cents - o.tip_cents).toBe(facturableAntes);
    } finally {
      // Teardown: la mesa vuelve como estaba, o el próximo run arranca con una
      // mesa menos y la suite se degrada sola.
      await db.from("payments").delete().eq("order_id", orden.id);
      await db
        .from("orders")
        .update({
          tip_cents: orden.tip_cents,
          total_cents: orden.total_cents,
          total_paid_cents: 0,
          lifecycle_status: "open",
          closed_at: null,
        })
        .eq("id", orden.id);
      await db
        .from("tables")
        .update(mesaAntes as Record<string, unknown>)
        .eq("id", orden.table_id);
    }
  });

  // ── Spec 177 · Parte 0 — la propina de cada sub-cuenta ─────────────────
  test("dividir reparte la propina: cada sub-cuenta lleva SU porción", async ({
    page,
  }) => {
    // El bug que cierra: las dos pantallas de cobro le pasaban la propina
    // ENTERA de la orden a cada tarjeta de split, así que una cuenta de
    // $10.000 con $1.000 dividida en 3 registraba $3.000 de propina — la venta
    // bajaba $2.000 en el arqueo y el mozo aparecía con el triple.
    const orden = await mesaViva();

    // La propina va como fixture: guardarla desde la UI obliga a pasar por el
    // cobro y volver, y lo que se prueba acá es la DIVISIÓN. El reparto sí se
    // ejercita de verdad — lo hace `persistSplits` cuando la acción corre.
    const PROPINA = 100_000;
    const totalOriginal = orden.total_cents;
    const tipOriginal = orden.tip_cents;
    try {
      await db
        .from("orders")
        .update({
          tip_cents: PROPINA,
          total_cents: totalOriginal - tipOriginal + PROPINA,
        })
        .eq("id", orden.id);

      await abrirCobro(page, orden.label);
      await page.getByRole("button", { name: /Dividir cuenta/i }).click();
      await page
        .getByRole("button", { name: /Confirmar división/i })
        .click();

      // La verdad está en la base: la suma de las porciones tiene que dar la
      // propina de la orden, exacta. Si diera el doble, es el bug de vuelta.
      await expect
        .poll(
          async () => {
            const { data } = await db
              .from("order_splits")
              .select("tip_cents")
              .eq("order_id", orden.id)
              .neq("status", "cancelled");
            const filas = (data ?? []) as { tip_cents: number }[];
            return filas.length === 0
              ? null
              : filas.reduce((a, r) => a + r.tip_cents, 0);
          },
          { timeout: 20_000 },
        )
        .toBe(PROPINA);

      const { data: splits } = await db
        .from("order_splits")
        .select("tip_cents")
        .eq("order_id", orden.id)
        .neq("status", "cancelled");
      const porciones = (splits ?? []) as { tip_cents: number }[];
      expect(porciones.length).toBeGreaterThanOrEqual(2);
      // Ninguna se lleva la propina entera, que es exactamente lo que pasaba.
      for (const p of porciones) {
        expect(p.tip_cents).toBeLessThan(PROPINA);
        expect(p.tip_cents).toBeGreaterThan(0);
      }
    } finally {
      await db.from("order_splits").delete().eq("order_id", orden.id);
      await db
        .from("orders")
        .update({ tip_cents: tipOriginal, total_cents: totalOriginal })
        .eq("id", orden.id);
    }
  });

  test("en tarjeta el excedente es propina sin preguntar", async ({ page }) => {
    // Lo que estaba mal hasta la spec 177: el posnet cobraba de más y esos
    // pesos entraban como VENTA del negocio, con `tip_cents = 0`. En tarjeta
    // no hay vuelto que dar, así que no hay nada que preguntar.
    const bizId = await businessId(SLUG);
    const mesa = await mesaViva();

    // El tope del excedente es `lo que falta + el ajuste del método`, así que
    // hay que derivarlo igual que lo hace el server. Leerlo del input no sirve:
    // arranca en lo que falta y el efecto le aplica el recargo un tick después,
    // así que un `inputValue()` apurado devuelve el número de antes.
    const { data: configs } = await db
      .from("payment_method_configs")
      .select("method, adjustment_percent")
      .eq("business_id", bizId);
    const pct = Number(
      (configs ?? []).find((c) => c.method === "card_manual")
        ?.adjustment_percent ?? 0,
    );
    const conRecargo =
      mesa.total_cents + Math.round((mesa.total_cents * pct) / 100);

    const pasar = await abrirCobro(page, mesa.label);
    await pasar.click();
    await page.getByRole("button", { name: /Tarjeta/ }).first().click();

    // El campo tiene que haber terminado de aplicar el recargo antes de tocarlo.
    const monto = page.locator("#cobro-monto");
    await expect(monto).toHaveValue(String(conRecargo / 100), {
      timeout: 20_000,
    });
    await monto.fill(String(conRecargo / 100 + 5_000));

    await expect(page.getByText(/^Propina:/)).toBeVisible();
    await expect(page.getByText(/^Vuelto:/)).toHaveCount(0);
    await expect(page.getByText(/^Propina:/)).toContainText(
      /para el mozo de la mesa/i,
    );
    await expect(page.getByText(/^Propina:/)).toContainText(montoAR(500_000));
    // Entra TODO: el excedente no se acota, se etiqueta.
    await expect(
      page.getByRole("button", { name: /^Confirmar/ }),
    ).toContainText(montoAR(conRecargo + 500_000));
  });
});

/** El monto como lo escribe la app: 47.000 (sin decimales, punto de miles). */
function montoAR(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

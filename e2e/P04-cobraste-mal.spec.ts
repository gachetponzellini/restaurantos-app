import { test, expect } from "@playwright/test";

import { SLUG, storageState } from "./roles";
import { db, businessId, pesos } from "./db";
import { cobrar } from "./cobrar-ui";
import {
  borrarMesaDePrueba,
  crearMesaDePrueba,
  esperadoDeLaCajaPrincipal,
  type MesaDePrueba,
} from "./mesa-de-prueba";

/**
 * P04 · Cobraste mal — deshacer un cobro sin romper la caja.
 *
 * Caso de uso: wiki/qa/procesos/P04-cobraste-mal.md
 *
 * Es el proceso menos probado del Tier 1 y el que más rápido se pudre al tocar
 * el cobro: pasa pocas veces por semana y, cuando falla, falla en silencio —
 * la plata desaparece del arqueo o queda contada dos veces, y nadie llama.
 *
 * A diferencia de P01/P03, estos tests **sí escriben**: cobran de verdad y
 * después anulan o corrigen. Para no sacarle las mesas del seed a los otros
 * specs, cada uno arma **su propia mesa** (`mesa-de-prueba.ts`) y la borra al
 * terminar.
 *
 * Dos caminos, y son distintos a propósito:
 *
 *  - **Anular la línea**, desde el libro de movimientos: es el que existe para
 *    una mesa ya cobrada y cerrada, que es el caso real.
 *  - **Anular el cobro** entero, desde la pantalla de cobro: sólo mientras la
 *    cuenta sigue abierta (un cobro parcial). Devuelve todo y reabre.
 *
 * Los casos de plata que cubre vienen del epic #361: que anular devuelva la
 * propina del excedente, que corregir el método recalcule el recargo, y que un
 * cobro ya rendido no se pueda tocar.
 */
test.use({ storageState: storageState("encargada") });

/** El pago vivo (o anulado) de una orden, como lo ve la base. */
async function pagosDe(orderId: string) {
  const { data } = await db
    .from("payments")
    .select("id, method, amount_cents, tip_cents, extra_tip_cents, adjustment_cents, payment_status, refunded_reason")
    .eq("order_id", orderId)
    .order("created_at");
  return (data ?? []) as Array<{
    id: string;
    method: string;
    amount_cents: number;
    tip_cents: number;
    extra_tip_cents: number;
    adjustment_cents: number;
    payment_status: string;
    refunded_reason: string | null;
  }>;
}

async function ordenDe(orderId: string) {
  const { data } = await db
    .from("orders")
    .select("total_cents, tip_cents, total_paid_cents, lifecycle_status, payment_status")
    .eq("id", orderId)
    .single();
  return data as {
    total_cents: number;
    tip_cents: number;
    total_paid_cents: number;
    lifecycle_status: string;
    payment_status: string;
  };
}

/** Abre la línea de esa mesa en el libro de movimientos de hoy. */
async function abrirLineaEnElLibro(page: import("@playwright/test").Page, label: string) {
  await page.goto(`/${SLUG}/admin/operacion/movimientos`);
  const linea = page.getByRole("button", { name: new RegExp(label) }).first();
  await expect(linea).toBeVisible({ timeout: 20_000 });
  await linea.click();
}

test.describe("P04 · anular la línea de un cobro", () => {
  let mesa: MesaDePrueba | null = null;
  test.afterEach(async () => {
    await borrarMesaDePrueba(mesa);
    mesa = null;
  });

  test("el efectivo anulado sale del arqueo, y el cobro queda como rastro", async ({
    page,
  }) => {
    mesa = await crearMesaDePrueba({ montos: [700_000], label: "P04-anular" });
    const bizId = mesa.bizId;
    const antes = (await esperadoDeLaCajaPrincipal(bizId)).esperadoCents;

    await cobrar(page, { mesa: mesa.label, metodo: /Efectivo/, pesos: 7_000 });
    await expect
      .poll(async () => (await ordenDe(mesa!.orderId)).lifecycle_status, {
        timeout: 20_000,
      })
      .toBe("closed");
    expect((await esperadoDeLaCajaPrincipal(bizId)).esperadoCents).toBe(antes + 700_000);

    // El camino real de una mesa ya cobrada: el libro.
    await abrirLineaEnElLibro(page, mesa.label);
    await page.getByRole("button", { name: /Anular este cobro/ }).click();
    // Sin motivo no deja: la plata que sale del arqueo tiene que tener por qué.
    await expect(page.getByRole("button", { name: /^Anular$/ })).toBeDisabled();
    await page.locator("#corregir-motivo").fill("se cobró la mesa equivocada");
    await page.getByRole("button", { name: /^Anular$/ }).click();

    await expect
      .poll(async () => (await pagosDe(mesa!.orderId))[0]?.payment_status, {
        timeout: 20_000,
      })
      .toBe("refunded");

    // El corazón del proceso: la fila NO se borra.
    const pagos = await pagosDe(mesa.orderId);
    expect(pagos).toHaveLength(1);
    expect(pagos[0].refunded_reason).toContain("mesa equivocada");
    // Y el cajón deja de esperar esa plata.
    expect((await esperadoDeLaCajaPrincipal(bizId)).esperadoCents).toBe(antes);

    // La cuenta queda cerrada con saldo y se puede volver a cobrar (#339).
    const o = await ordenDe(mesa.orderId);
    expect(o.lifecycle_status).toBe("closed");
    expect(o.payment_status).toBe("pending");
    expect(o.total_paid_cents).toBe(0);
  });

  test("anular devuelve la propina del excedente que ese cobro sumó", async ({
    page,
  }) => {
    // #355 — el excedente en un método sin vuelto es propina (spec 177) y le
    // sube el total a la cuenta. Al anular la línea tiene que volver: si no, la
    // cuenta queda pidiendo una propina que nadie dejó — el caso de kcc (#338).
    //
    // Transferencia y no tarjeta: la tarjeta del demo tiene recargo, y entonces
    // parte de lo que entra de más es el recargo y no propina. Acá se prueba el
    // excedente, no el ajuste por método (eso es el test de corregir).
    mesa = await crearMesaDePrueba({ montos: [1_000_000], label: "P04-excedente" });

    await cobrar(page, { mesa: mesa.label, metodo: /Transferencia/, pesos: 12_000 });
    await expect
      .poll(async () => (await ordenDe(mesa!.orderId)).total_cents, { timeout: 20_000 })
      .toBe(1_200_000);
    const pago = (await pagosDe(mesa.orderId))[0];
    expect(pago.extra_tip_cents).toBe(200_000);

    await abrirLineaEnElLibro(page, mesa.label);
    await page.getByRole("button", { name: /Anular este cobro/ }).click();
    await page.locator("#corregir-motivo").fill("no dejó propina");
    await page.getByRole("button", { name: /^Anular$/ }).click();

    await expect
      .poll(async () => (await ordenDe(mesa!.orderId)).total_cents, { timeout: 20_000 })
      .toBe(1_000_000);
    expect((await ordenDe(mesa.orderId)).tip_cents).toBe(0);
  });
});

test.describe("P04 · corregir en vez de anular", () => {
  let mesa: MesaDePrueba | null = null;
  test.afterEach(async () => {
    await borrarMesaDePrueba(mesa);
    mesa = null;
  });

  test("cambiar el método arrastra su recargo al monto cobrado", async ({ page }) => {
    // #356 — el ajuste sigue al método. Se cobró en efectivo pero fue tarjeta:
    // corregirlo tiene que aplicar el recargo configurado, no dejar el monto
    // viejo con el recargo de nadie.
    const bizId = await businessId(SLUG);
    const { data: cfg } = await db
      .from("payment_method_configs")
      .select("adjustment_percent")
      .eq("business_id", bizId)
      .eq("method", "card_manual")
      .eq("is_active", true)
      .maybeSingle();
    const pct = Number((cfg as { adjustment_percent: number } | null)?.adjustment_percent ?? 0);
    test.skip(pct === 0, "el demo no tiene recargo configurado en tarjeta");

    mesa = await crearMesaDePrueba({ montos: [1_000_000], label: "P04-corregir" });
    await cobrar(page, { mesa: mesa.label, metodo: /Efectivo/, pesos: 10_000 });
    await expect
      .poll(async () => (await pagosDe(mesa!.orderId)).length, { timeout: 20_000 })
      .toBe(1);

    await abrirLineaEnElLibro(page, mesa.label);
    // La pantalla lo avisa antes de confirmar: el monto se recalcula solo.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^Tarjeta$/ }).click();
    await expect(page.getByText(/el monto se recalcula solo/i)).toBeVisible();
    await page.locator("#corregir-motivo").fill("fue con tarjeta, no en efectivo");
    await page.getByRole("button", { name: /^Corregir/ }).click();

    const esperado = 1_000_000 + Math.round((1_000_000 * pct) / 100);
    await expect
      .poll(async () => (await pagosDe(mesa!.orderId))[0]?.amount_cents, { timeout: 20_000 })
      .toBe(esperado);
    const pago = (await pagosDe(mesa.orderId))[0];
    expect(pago.method).toBe("card_manual");
    expect(pago.adjustment_cents).toBe(esperado - 1_000_000);
    // La cuenta sigue saldada: lo que cubre es la base, sin el recargo.
    expect((await ordenDe(mesa.orderId)).total_paid_cents).toBe(1_000_000);
  });

  test("un cobro que el mozo ya rindió no se corrige en la plata", async ({ page }) => {
    // #356 — el mozo entregó contra ESE método y ESE monto. Cambiarlo después
    // movía el esperado del cajón y no la rendición: diferencia sin dueño.
    mesa = await crearMesaDePrueba({
      montos: [500_000],
      label: "P04-rendido",
      mozoEmail: "pedro@demo.test",
    });
    await cobrar(page, { mesa: mesa.label, metodo: /Efectivo/, pesos: 5_000 });
    await expect
      .poll(async () => (await pagosDe(mesa!.orderId)).length, { timeout: 20_000 })
      .toBe(1);

    // El mozo rinde (precondición, va por la base).
    const { error } = await db.from("mozo_rendiciones").insert({
      business_id: mesa.bizId,
      mozo_id: mesa.mozoId,
      registered_by: mesa.mozoId,
      expected_cash_cents: 500_000,
      delivered_cash_cents: 500_000,
      difference_cents: 0,
      estado: "rendida",
    });
    expect(error).toBeNull();

    await abrirLineaEnElLibro(page, mesa.label);
    await page.locator("#corregir-monto").fill("40");
    await page.locator("#corregir-motivo").fill("eran $400");
    await page.getByRole("button", { name: /^Corregir/ }).click();

    await expect(page.getByText(/ya entró en la rendición/i)).toBeVisible({
      timeout: 20_000,
    });
    // Y la plata no se movió.
    expect((await pagosDe(mesa.orderId))[0].amount_cents).toBe(500_000);

    await db.from("mozo_rendiciones").delete().eq("mozo_id", mesa.mozoId!).eq("business_id", mesa.bizId);
  });
});

test.describe("P04 · anular el cobro entero, con la cuenta abierta", () => {
  let mesa: MesaDePrueba | null = null;
  test.afterEach(async () => {
    await borrarMesaDePrueba(mesa);
    mesa = null;
  });

  test("pide motivo, devuelve todo y deja la mesa como estaba", async ({ page }) => {
    mesa = await crearMesaDePrueba({ montos: [600_000, 400_000], label: "P04-parcial" });

    // Cobro parcial (en efectivo no se puede pagar de menos): la cuenta sigue
    // abierta, así que la pantalla de cobro ofrece «Anular cobro».
    await cobrar(page, { mesa: mesa.label, metodo: /Transferencia/, pesos: 4_000 });
    await expect
      .poll(async () => (await ordenDe(mesa!.orderId)).total_paid_cents, { timeout: 20_000 })
      .toBe(400_000);

    await page.goto(`/${SLUG}/admin/mesa/${mesa.tableId}/cobrar`);
    await page.getByRole("button", { name: /Anular cobro/ }).first().click();
    const confirmar = page.getByRole("dialog").getByRole("button", { name: /Anular cobro/ });
    await expect(confirmar).toBeDisabled();
    await page.getByRole("dialog").getByRole("textbox").first().fill("se equivocó de mesa");
    await confirmar.click();

    await expect
      .poll(async () => (await ordenDe(mesa!.orderId)).total_paid_cents, { timeout: 20_000 })
      .toBe(0);
    const o = await ordenDe(mesa.orderId);
    expect(o.lifecycle_status).toBe("open");
    // Los ítems no se tocan: la mesa vuelve con lo que consumieron.
    const { count } = await db
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", mesa.orderId)
      .is("cancelled_at", null);
    expect(count).toBe(2);
    // El pago queda reembolsado, no borrado.
    expect((await pagosDe(mesa.orderId))[0].payment_status).toBe("refunded");
  });
});

test.describe("P04 · permisos", () => {
  test.use({ storageState: storageState("mozo") });

  let mesa: MesaDePrueba | null = null;
  test.afterEach(async () => {
    await borrarMesaDePrueba(mesa);
    mesa = null;
  });

  test("el mozo no llega al libro de movimientos", async ({ page }) => {
    // E-05 — anular es de encargada o dueño. El libro es donde se anula una
    // línea, y el mozo no entra ni escribiendo la URL.
    mesa = await crearMesaDePrueba({ montos: [100_000], label: "P04-permisos" });
    await page.goto(`/${SLUG}/admin/operacion/movimientos`);
    // Rebotado a su app: ni el libro ni sus acciones.
    await expect(page.getByRole("heading", { name: /Mis mesas/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Anular este cobro/ })).toHaveCount(0);
  });
});

/** El monto como lo escribe la app, para los asserts de pantalla. */
export const montoDePantalla = pesos;

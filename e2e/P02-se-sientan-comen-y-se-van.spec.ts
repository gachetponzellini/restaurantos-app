import { test, expect, type Page } from "@playwright/test";

import { SLUG, storageState } from "./roles";
import { db, businessId } from "./db";

/**
 * P02 · Se sientan, comen y se van — la columna vertebral.
 *
 * Caso de uso: wiki/qa/procesos/P02-se-sientan-comen-y-se-van.md
 *
 * Esto NO prueba pantallas: prueba la **costura** entre el plano, la mesa y el
 * cobro. Que cada una de las tres ande por separado no dice nada — el bug que
 * importa es que muestren números distintos del mismo consumo, y ése sólo
 * aparece cruzándolas.
 *
 * Lo esperado se deriva de la base, no se hardcodea: el seed arma la operación
 * del día con `Math.random()`.
 */
test.use({ storageState: storageState("encargada") });


/**
 * Abre el plano y espera a que el salón esté **vivo**, no sólo pintado.
 *
 * Sin esto los tests son flakies por hidratación: el server manda el HTML, el
 * botón de la mesa ya está visible y habilitado —o sea «accionable» para
 * Playwright— pero React todavía no le colgó el handler, así que el click se
 * pierde en el vacío y el panel nunca abre. El fallo sale como «no encuentro
 * Total de la mesa», que apunta al lugar equivocado.
 *
 * El contador de la pestaña sirve de señal porque lo calcula el cliente.
 */
async function abrirSalon(page: Page) {
  await page.goto(`/${SLUG}/admin/operacion?tab=salon`);
  await expect(page.getByRole("button", { name: /^Mesas \d+$/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
}


/**
 * El id del salón que el plano abre: el primero por `created_at`.
 *
 * El demo tiene dos, y el plano muestra uno. Una mesa del Salón 2 existe en la
 * base pero no está en pantalla, así que el click por nombre espera para
 * siempre — y el fallo sale como «no encuentro el total», que apunta al lugar
 * equivocado. Es la misma trampa que P01 documenta en `mesaViva`.
 */
async function primerSalon(bizId: string): Promise<string> {
  const { data } = await db
    .from("floor_plans")
    .select("id")
    .eq("business_id", bizId)
    .order("created_at", { ascending: true })
    .limit(1);
  const plano = (data ?? [])[0] as { id: string } | undefined;
  expect(plano, "el demo tiene que tener al menos un salón").toBeTruthy();
  return plano!.id;
}

test.describe("P02 · el plano, la mesa y el cobro dicen lo mismo", () => {
  test("el plano muestra las mesas que la base dice que están ocupadas", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: abiertas } = await db
      .from("orders")
      .select("id, table_id")
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null);
    const ocupadas = (abiertas ?? []).length;
    expect(ocupadas, "el seed tiene que dejar mesas vivas").toBeGreaterThan(0);

    await abrirSalon(page);
    // La pestaña lleva el contador: «Mesas 12». Es el número que el encargado
    // mira de reojo toda la noche, y el que tiene que coincidir con la base.
    // El nombre accesible normaliza el salto de línea del markup a un espacio.
    await expect(
      page.getByRole("button", { name: `Mesas ${ocupadas}`, exact: true }),
    ).toBeVisible();
  });

  test("abrir una mesa muestra el total que la base tiene para esa mesa", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: orders } = await db
      .from("orders")
      .select(
        "id, customer_name, total_cents, table_id, tables!orders_table_id_fkey!inner(floor_plan_id)",
      )
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null)
      .eq("tables.floor_plan_id", await primerSalon(bizId))
      .order("total_cents", { ascending: false })
      .limit(1);
    const orden = (orders ?? [])[0] as {
      customer_name: string;
      total_cents: number;
    };
    expect(orden).toBeTruthy();

    await abrirSalon(page);
    await page
      .getByRole("button", { name: new RegExp(escapeRe(orden.customer_name)) })
      .first()
      .click();

    // «Total de la mesa» es lo que el encargado le va a decir al cliente.
    await expect(page.getByText(/Total de la mesa/i).first()).toBeVisible();
    await expect(
      page.getByText(montoAR(orden.total_cents), { exact: false }).first(),
    ).toBeVisible();
  });

  test("«Cobrar» abre la cuenta por el mismo total, sin recalcular nada", async ({
    page,
  }) => {
    const bizId = await businessId(SLUG);
    const { data: orders } = await db
      .from("orders")
      .select(
        "customer_name, total_cents, total_paid_cents, tables!orders_table_id_fkey!inner(floor_plan_id)",
      )
      .eq("business_id", bizId)
      .eq("lifecycle_status", "open")
      .not("table_id", "is", null)
      .eq("tables.floor_plan_id", await primerSalon(bizId))
      .order("total_cents", { ascending: false })
      .limit(1);
    const orden = (orders ?? [])[0] as {
      customer_name: string;
      total_cents: number;
      total_paid_cents: number;
    };
    const falta = orden.total_cents - orden.total_paid_cents;

    await abrirSalon(page);
    await page
      .getByRole("button", { name: new RegExp(escapeRe(orden.customer_name)) })
      .first()
      .click();
    await page.getByRole("button", { name: /^Cobrar$/ }).first().click();

    // El salto de pantalla es donde un total se puede perder, y hay que
    // afirmarlo sobre la pantalla NUEVA.
    //
    // Antes esto decía `getByText(monto).toBeVisible()` a secas, y pasaba sin
    // que el panel llegara a abrir: el mismo importe ya estaba a la vista en el
    // detalle de la mesa, dos centímetros más arriba. Un test que puede pasar
    // sin ejercer la transición que dice probar no prueba nada.
    //
    // El botón «Pasar a cobro · $ 47.000» sólo existe en el panel de la cuenta,
    // así que afirmarlo sobre él es afirmar que el salto ocurrió.
    const pasar = page.getByRole("button", { name: /Pasar a cobro/ });
    await expect(pasar).toBeVisible({ timeout: 20_000 });
    await expect(pasar).toContainText(montoAR(falta));
  });
});

/** El monto como lo escribe la app: 127.500 (sin decimales, punto de miles). */
function montoAR(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

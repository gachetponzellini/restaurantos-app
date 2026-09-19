import { expect, type Page } from "@playwright/test";

import { SLUG } from "./roles";

/**
 * Los tres saltos del cobro, compartidos por P01 y P04.
 *
 * Vivían copiados en P01. Los specs que completan un cobro (P04, los
 * escenarios de cobro en partes) necesitan exactamente el mismo camino: si la
 * navegación cambia, tiene que romper una sola cosa.
 */

/** Del plano a la pantalla de cobro. Ninguno de los saltos navega. */
export async function abrirCobro(page: Page, mesa: string) {
  await page.goto(`/${SLUG}/admin/operacion?tab=salon`);
  // Señal de hidratación: el contador lo calcula el cliente.
  await expect(page.getByRole("button", { name: /^Mesas \d+$/ })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: new RegExp(mesa) }).first().click();
  // «Cobrar» abre la CUENTA (propina, descuento, dividir), no el cobro.
  await page.getByRole("button", { name: /^Cobrar$/ }).first().click();
  const pasar = page.getByRole("button", { name: /Pasar a cobro/ });
  await pasar.waitFor({ timeout: 20_000 });
  return pasar;
}

/** Tipea un monto (en PESOS, como el input) en el paso 2 del cobro. */
export async function tipearMonto(page: Page, pesos: number) {
  // Por id y no por label: el panel embebido puede tener más de un «Monto».
  const monto = page.locator("#cobro-monto");
  await expect(monto).toBeVisible({ timeout: 20_000 });
  await monto.fill(String(pesos));
}

/**
 * Cobra: elige método, tipea el monto y confirma. Devuelve cuando el botón
 * terminó (el panel se cierra o cambia de estado).
 */
export async function cobrar(
  page: Page,
  opts: { mesa: string; metodo: RegExp; pesos: number; confirmarExcedente?: boolean },
) {
  const pasar = await abrirCobro(page, opts.mesa);
  await pasar.click();
  await page.getByRole("button", { name: opts.metodo }).first().click();
  await tipearMonto(page, opts.pesos);
  if (opts.confirmarExcedente) {
    await page.getByRole("button", { name: /Sí, es propina/ }).click();
  }
  const confirmar = page.getByRole("button", { name: /^Confirmar/ });
  await expect(confirmar).toBeEnabled({ timeout: 20_000 });
  await confirmar.click();
}

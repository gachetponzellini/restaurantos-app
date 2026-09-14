"use server";

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireMozoActionContext } from "@/lib/mozo/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/actions";
import {
  getTodayOrders,
  startOfTodayUtc,
  type AdminOrder,
} from "@/lib/admin/orders-query";
import { getCierreCajaData, type CierreCajaData } from "@/lib/caja/queries";
import { sectionAccess } from "@/lib/permissions/sections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getBusiness } from "@/lib/tenant";

import {
  loadCaja,
  loadFichaje,
  loadRendicion,
  loadReservas,
  loadSalon,
  type CajaData,
  type FichajeData,
  type RendicionData,
  type ReservasData,
  type SalonData,
} from "./data";

/**
 * Refetch por tab de `/admin/operacion` (specs 102 y 103).
 *
 * Antes, cada acción del operativo y cada evento de realtime resolvían con
 * `router.refresh()`, que re-ejecuta `operacion/page.tsx` **entera**:
 * `getBusiness` + `ensureAdminAccess` (hop de red a Auth) + `getSalonOptions` +
 * las **7 promesas de tab** (~30 queries) y el árbol RSC completo por el cable
 * a Virginia — para actualizar una sola tab. Acá cada tab corre lo suyo con el
 * mismo loader que usa la page, y el cliente mergea en su estado local. Mismo
 * patrón que `getComandasTabData` (spec 052).
 */

type OperacionCtx = { businessId: string; timezone: string };

/**
 * Gate común de todas las actions de esta ruta. Dos capas, las dos necesarias:
 *
 * 1. **Membresía** — los loaders corren con el cliente service-role (RLS
 *    bypass), así que sin esto un autenticado ajeno al negocio leería el plano,
 *    las reservas con teléfono, la caja y la nómina pasando un slug foráneo. Es
 *    la lección de la 2da ronda de review de la spec 052.
 * 2. **Rol** — el mismo que aplica `operacion/page.tsx`, y por el mismo camino:
 *    la matriz de secciones. El mozo opera desde `/mozo` y no tiene por qué
 *    leer la caja del turno ni lo que rindieron sus compañeros. Sin esta capa
 *    la action sería una puerta de atrás a una pantalla que la UI le niega.
 *
 *    Acá había una lista de roles escrita a mano —admin o encargado— que se
 *    quedó vieja cuando la spec 140 sumó `terminal`, la compu del salón: el
 *    page-gate (que sí lee la matriz) la dejaba entrar, pero TODOS sus refetch
 *    volvían "No tenés permisos". Y como `refetchSalon` se traga el error —es
 *    un refresh de fondo—, el síntoma no era un cartel sino un plano
 *    **congelado**: asignabas los mozos y no aparecían hasta recargar. La
 *    matriz es una sola: si la página abre, sus datos también.
 *
 * `soloSupervision` marca las tabs que la terminal NO ve (caja, rendición,
 * pedidos de mostrador — spec 140 · D2): ahí sigue haciendo falta acceso
 * `full`, o sea encargado/admin.
 */
async function requireOperacionContext(
  slug: string,
  opts: { soloSupervision?: boolean } = {},
): Promise<ActionResult<OperacionCtx>> {
  const business = await getBusiness(slug);
  if (!business) return actionError("Negocio no encontrado.");

  const ctx = await requireMozoActionContext(business.id);
  if (!ctx.ok) return ctx;

  const { role, isPlatformAdmin } = ctx.data;
  const access = sectionAccess("operacion", role, { isPlatformAdmin });
  const alcanza = opts.soloSupervision ? access === "full" : access !== "none";
  if (!alcanza) {
    return actionError("No tenés permisos para esta operación.");
  }

  return actionOk({ businessId: business.id, timezone: business.timezone });
}

const service = () =>
  createSupabaseServiceClient() as unknown as SupabaseClient;

/**
 * Tab **Mesas** (plano del salón). La ventana de reservas se calcula igual que
 * en la page: "hoy" en la TZ del **negocio**, no la del server, para que no se
 * corra en el borde de la medianoche.
 */
export async function getSalonTabData(
  slug: string,
): Promise<ActionResult<SalonData>> {
  const ctx = await requireOperacionContext(slug);
  if (!ctx.ok) return ctx;

  const todayStart = startOfTodayUtc(ctx.data.timezone);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  return actionOk(
    await loadSalon(ctx.data.businessId, service(), {
      todayStart,
      tomorrowStart,
    }),
  );
}

/**
 * Tab **Pedidos online**: los pedidos del día, nada más.
 *
 * Era la única tab sin refetch, y encima la que más lo necesita: su panel está
 * **siempre montado** (`local-shell.tsx`, para no tirar la suscripción al
 * cambiar de tab), así que se seedea con el SSR del page-load y de ahí en más
 * vive del stream de realtime. Un evento perdido —canal caído, token vencido en
 * una pantalla que lleva horas abierta, máquina suspendida— la dejaba
 * desincronizada **para siempre**: tarjetas en la columna equivocada, con el
 * botón de un estado que el pedido ya pasó, y el server rechazando la
 * transición («No se puede pasar de "delivered" a "ready"»).
 *
 * Devuelve sólo las orders: los horarios programables y los leads de marcha
 * salen de la config del negocio, que no cambia mientras la pantalla está
 * abierta.
 */
export async function getPedidosTabOrders(
  slug: string,
): Promise<ActionResult<AdminOrder[]>> {
  const ctx = await requireOperacionContext(slug, {
    soloSupervision: true,
  });
  if (!ctx.ok) return ctx;
  return actionOk(await getTodayOrders(ctx.data.businessId, ctx.data.timezone));
}

/** Tab **Caja**: las cajas del negocio con su estado (último corte, período). */
export async function getCajaTabData(
  slug: string,
): Promise<ActionResult<CajaData>> {
  const ctx = await requireOperacionContext(slug, {
    soloSupervision: true,
  });
  if (!ctx.ok) return ctx;
  return actionOk(await loadCaja(ctx.data.businessId));
}

/**
 * Todo lo que el modal de **Cerrar caja** necesita (spec 130): la plata del
 * período, el esperado partido por dueño, las cuentas abiertas que bloquean y
 * lo que el cierre va a barrer del salón.
 *
 * Se pide al abrir el modal y no en el poll de la tab: el reparto por dueño
 * consulta la rendición pendiente de cada mozo, y colgarlo del tick de 30 s
 * eran decenas de queries por tablet para un número que se mira una vez por
 * día.
 */
export async function getCierreCajaTabData(
  slug: string,
  cajaId: string,
): Promise<ActionResult<CierreCajaData>> {
  const ctx = await requireOperacionContext(slug, {
    soloSupervision: true,
  });
  if (!ctx.ok) return ctx;

  const data = await getCierreCajaData(cajaId, ctx.data.businessId);
  if (!data) return actionError("Caja no encontrada.");
  return actionOk(data);
}

/** Tab **Rendición**: pendientes por mozo, historial, asignaciones y nómina. */
export async function getRendicionTabData(
  slug: string,
): Promise<ActionResult<RendicionData>> {
  const ctx = await requireOperacionContext(slug, {
    soloSupervision: true,
  });
  if (!ctx.ok) return ctx;
  return actionOk(await loadRendicion(ctx.data.businessId, service()));
}

/**
 * Tab **Reservas** (libro del día). Recibe el día porque el navegador de fechas
 * ahora lo cambia sin navegar: antes cada flecha era un `router.push` que
 * re-corría las 7 tabs para pintar otra lista.
 *
 * Un `date` inválido cae en "hoy" en la TZ del negocio — mismo criterio que la
 * page, así no hay forma de pedir una ventana sin sentido desde el cliente.
 */
export async function getReservasTabData(
  slug: string,
  date: string,
): Promise<ActionResult<ReservasData>> {
  // Spec 182 · D1 — el libro del día es supervisión: la terminal perdió la tab
  // (la matriz ya cerraba `/admin/reservas` para ella), y las reservas que sí
  // necesita —las de hoy, para sentar— viajan en la tab Mesas.
  const ctx = await requireOperacionContext(slug, { soloSupervision: true });
  if (!ctx.ok) return ctx;

  const { businessId, timezone } = ctx.data;
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const dayStart = fromZonedTime(`${dia}T00:00:00`, timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  return actionOk(
    await loadReservas(businessId, service(), {
      date: dia,
      dayStart,
      dayEnd,
      timezone,
    }),
  );
}

/** Tab **Fichaje**: quién está presente ahora + el resumen del día. */
export async function getFichajeTabData(
  slug: string,
): Promise<ActionResult<FichajeData>> {
  const ctx = await requireOperacionContext(slug);
  if (!ctx.ok) return ctx;
  return actionOk(await loadFichaje(ctx.data.businessId, slug));
}

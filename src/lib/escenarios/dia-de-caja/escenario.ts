/**
 * «Un día de caja» — el escenario de regresión de la operación diaria.
 *
 * Juega un turno entero con las MISMAS server actions que usa la app (comandar,
 * cancelar, dividir, cobrar, anular, corregir, mostrador, delivery, fiado,
 * sangrías…), cada una con el rol que la hace en el local. Cada caso deja
 * escrito, calculado a mano, qué tiene que pasar con la plata: cuánto entra al
 * cajón de cada caja y cuánto le queda a cada mozo para entregar. Esa es la
 * verdad contra la que se compara la base.
 *
 * Lo usan:
 *  · `dia-de-caja.integration.test.ts` — en un negocio descartable, juega el
 *    día, verifica cada caso y lo cierra entero (diferencia $0).
 *  · `preparar-demo.escenario.ts` — lo juega sobre el negocio demo local y lo
 *    deja abierto para cerrarlo a mano.
 *
 * Las actions se importan acá; el que llama tiene que haber mockeado la sesión
 * (`@/lib/supabase/server`), `react.cache` y `next/cache` antes de importar
 * este módulo, y fija quién actúa con `setActor`.
 */
import { randomUUID } from "node:crypto";

import { enviarComanda, cancelarItem, cancelarComanda, editarItemComanda } from "@/lib/comandas/actions";
import { registrarPago, anularCobro, forzarPago, cancelarSplit } from "@/lib/billing/cobro-actions";
import {
  aplicarPropinaYDescuento,
  dividirPorPersonas,
  dividirPorMonto,
  dividirPorItems,
  dividirPorComensal,
  cancelarItemEnCuenta,
} from "@/lib/billing/cuenta-actions";
import { cerrarSinCobro } from "@/lib/billing/cerrar-sin-cobro";
import { trasladarMesa, anularMesa, pedirCuenta, assignMozoToTable } from "@/lib/mozo/actions";
import { anularLineaDeCobro, corregirCobro, corregirMovimiento } from "@/lib/caja/correccion-actions";
import { rendirMozo, anularEntrega } from "@/lib/caja/turno-actions";
import { aplicarReembolsoMp } from "@/lib/payments/efectos-pago-mp";
import { registrarSangria, registrarIngreso } from "@/lib/caja/actions";
import { registrarCobranza } from "@/lib/caja/cuenta-corriente-actions";
import { venderMostrador } from "@/lib/orders/venta-mostrador";
import { cargarPedidoStaff } from "@/lib/orders/staff-order";

import { PRECIO, RECARGO_TARJETA, type Negocio, type Persona } from "./negocio";

// ── Quién actúa ─────────────────────────────────────────────────────────────

declare global {
  var __ESCENARIO_ACTOR__: string | undefined;
}
export function setActor(userId: string) {
  globalThis.__ESCENARIO_ACTOR__ = userId;
}

// ── Lo esperado ─────────────────────────────────────────────────────────────

export type CajaKey = "principal" | "bar";

/** Lo que un caso le hace a la plata, calculado a mano. */
export type Efecto =
  | { cajon: CajaKey; cents: number } // entra (o sale) del cajón
  | { mozo: Persona; caja: CajaKey; cents: number }; // le suma (o resta) al saldo del mozo

export type EstadoMesa = "cerrada" | "abierta" | "cancelada";

export type Caso = {
  id: string;
  titulo: string;
  /** Qué tiene de particular: lo que este caso cubre. */
  cubre: string;
  orderId?: string;
  /** Cómo queda la cuenta al terminar el día (antes del cierre). */
  estado?: EstadoMesa;
  /** Lo cobrado vivo de la orden (sin ajustes), si importa. */
  pagado?: number;
  efectos: Efecto[];
  /** Queda pendiente para el cierre (mesas sin cobrar). */
  pendiente?: { quien: Persona; falta: number };
};

export type Dia = { casos: Caso[] };

// ── Herramientas ────────────────────────────────────────────────────────────

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(r: ActionResult<T>, que: string): T {
  if (!r.ok) throw new Error(`${que}: ${r.error}`);
  return r.data;
}

export function herramientas(n: Negocio) {
  const sb = n.sb;
  let proximaMesa = 0;
  const mesa = () => {
    const id = n.mesas[proximaMesa++];
    if (!id) throw new Error("No quedan mesas libres para el escenario");
    return id;
  };
  const como = (p: Persona) => setActor(n.gente[p]);

  type Item = { p: keyof Negocio["productos"]; q?: number; extra?: boolean; precio?: number; motivo?: string; comensal?: number };
  const items = (lista: Item[]) =>
    lista.map((i) => ({
      product_id: n.productos[i.p],
      quantity: i.q ?? 1,
      modifier_ids: i.extra ? [n.extraQueso] : [],
      ...(i.comensal ? { seat_number: i.comensal } : {}),
      ...(i.precio !== undefined ? { price_override_cents: i.precio, price_override_reason: i.motivo ?? "Prueba" } : {}),
    }));

  /** Comanda en una mesa nueva (la abre quien la manda). */
  async function abrirMesa(quien: Persona, lista: Item[], tableId = mesa()) {
    como(quien);
    const r = ok(await enviarComanda({ tableId, items: items(lista), slug: n.slug }), `comanda ${quien}`);
    return { tableId, orderId: r.order_id as string };
  }
  async function sumar(quien: Persona, orderId: string, lista: Item[]) {
    como(quien);
    ok(await enviarComanda({ orderId, items: items(lista), slug: n.slug }), `agregar ${quien}`);
  }

  /** Un ítem fuera de carta (lo carga la encargada). */
  async function sumarLibre(orderId: string, name: string, cents: number) {
    como("encargada");
    ok(
      await enviarComanda({ orderId, items: [{ kind: "free", name, unit_price_cents: cents, quantity: 1 }], slug: n.slug }),
      "ítem libre",
    );
  }

  async function orden(orderId: string) {
    const { data, error } = await sb
      .from("orders")
      .select("id, total_cents, total_paid_cents, lifecycle_status, payment_status, status, tip_cents")
      .eq("id", orderId)
      .single();
    if (error) throw error;
    return data as {
      total_cents: number;
      total_paid_cents: number;
      lifecycle_status: string;
      payment_status: string;
      status: string;
      tip_cents: number;
    };
  }
  async function itemsDe(orderId: string) {
    const { data, error } = await sb
      .from("order_items")
      .select("id, product_id, subtotal_cents, cancelled_at")
      .eq("order_id", orderId);
    if (error) throw new Error(`ítems: ${error.message}`);
    return (data ?? []) as { id: string; product_id: string; subtotal_cents: number; cancelled_at: string | null }[];
  }

  type Cobro = {
    method: "cash" | "card_manual" | "transfer" | "mp_manual" | "cuenta_corriente" | "other";
    amount: number;
    caja?: CajaKey;
    splitId?: string | null;
    excedente?: "vuelto" | "propina";
    cliente?: boolean;
  };
  async function cobrar(quien: Persona, orderId: string, c: Cobro) {
    como(quien);
    return ok(
      await registrarPago({
        orderId,
        splitId: c.splitId ?? null,
        method: c.method,
        amount_cents: c.amount,
        tip_cents: 0,
        caja_id: n.cajas[c.caja ?? "principal"],
        slug: n.slug,
        requestId: randomUUID(),
        ...(c.method === "card_manual" ? { last_four: "4242", card_brand: "visa" as const } : {}),
        ...(c.method === "other" ? { notes: "Prueba" } : {}),
        ...(c.excedente ? { destino_excedente: c.excedente, confirmar_excedente: true } : {}),
        ...(c.cliente ? { creditCustomerId: n.cliente } : {}),
      }),
      `cobro ${c.method} ${quien}`,
    );
  }

  return { sb, n, como, mesa, abrirMesa, sumar, sumarLibre, orden, itemsDe, cobrar };
}

const P = PRECIO;
/** Lo que se cobra con tarjeta por una base: con el recargo del método. */
const T = (base: number) => base + Math.round((base * RECARGO_TARJETA) / 100);

// ── El día ──────────────────────────────────────────────────────────────────

/**
 * Juega el día. Deja dos mesas abiertas (C21, C22) y a los mozos sin rendir:
 * el cierre lo hace el test o la persona que prueba.
 */
export async function jugarElDia(n: Negocio): Promise<Dia> {
  const h = herramientas(n);
  const casos: Caso[] = [];
  const caso = async (c: Omit<Caso, "efectos"> & { efectos?: Efecto[] }, fn: () => Promise<Partial<Caso> | void>) => {
    try {
      const extra = (await fn()) ?? {};
      casos.push({ efectos: [], ...c, ...extra } as Caso);
    } catch (e) {
      throw new Error(`[${c.id} · ${c.titulo}] ${(e as Error).message}`);
    }
  };

  // ── Salón ────────────────────────────────────────────────────────────────

  await caso(
    { id: "C01", titulo: "Mesa simple en efectivo", cubre: "comanda + cobro en efectivo del mozo: la plata queda a su nombre", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa", q: 2 }, { p: "agua", q: 2 }]);
      await h.cobrar("pedro", orderId, { method: "cash", amount: 2 * P.milanesa + 2 * P.agua });
      return { orderId, pagado: 3_000_000, efectos: [{ mozo: "pedro", caja: "principal", cents: 3_000_000 }] };
    },
  );

  await caso(
    { id: "C02", titulo: "Tarjeta con propina en la cuenta", cubre: "modificador con precio + propina cargada en la cuenta + tarjeta: el mozo se queda la propina de su efectivo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "pizza", extra: true }, { p: "flan" }]);
      h.como("encargada");
      ok(await aplicarPropinaYDescuento(orderId, { tip_cents: 220_000, discount_cents: 0, discount_reason: null }, n.slug), "propina");
      await h.cobrar("pedro", orderId, { method: "card_manual", amount: T(2_420_000) });
      return { orderId, efectos: [{ mozo: "pedro", caja: "principal", cents: -220_000 }] };
    },
  );

  await caso(
    { id: "C03", titulo: "Pago mixto: tarjeta y el resto en efectivo", cubre: "dos cobros parciales con métodos distintos en la misma cuenta", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "milanesa", q: 3 }]);
      await h.cobrar("lucia", orderId, { method: "card_manual", amount: T(1_600_000) });
      await h.cobrar("lucia", orderId, { method: "cash", amount: 2_000_000 });
      return { orderId, pagado: 3_600_000, efectos: [{ mozo: "lucia", caja: "principal", cents: 2_000_000 }] };
    },
  );

  await caso(
    { id: "C04", titulo: "Dividida entre dos: uno efectivo, otro transferencia con descuento", cubre: "split por personas con propina prorrateada + transferencia −10%", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "cafe", q: 4 }, { p: "flan", q: 2 }]);
      h.como("encargada");
      ok(await aplicarPropinaYDescuento(orderId, { tip_cents: 200_000, discount_cents: 0, discount_reason: null }, n.slug), "propina");
      h.como("lucia");
      const { splits } = ok(await dividirPorPersonas(orderId, 2, n.slug), "dividir");
      await h.cobrar("lucia", orderId, { method: "cash", amount: 1_100_000, splitId: splits[0].id });
      // 1.100.000 con −10% = 990.000 (el ajuste lo recalcula el server).
      await h.cobrar("lucia", orderId, { method: "transfer", amount: 990_000, splitId: splits[1].id });
      return {
        orderId,
        efectos: [
          { mozo: "lucia", caja: "principal", cents: 1_000_000 }, // efectivo sin su propina en efectivo
          { mozo: "lucia", caja: "principal", cents: -100_000 }, // propina de la transferencia
        ],
      };
    },
  );

  await caso(
    { id: "C05", titulo: "Dividida por monto en la Caja Bar, cobra el operador", cubre: "split por monto + Mercado Pago manual + efectivo del operador de caja: entra derecho al cajón", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "pizza", q: 2 }]);
      const { splits } = ok(await dividirPorMonto(orderId, [1_000_000], n.slug), "dividir por monto");
      await h.cobrar("diego", orderId, { method: "mp_manual", amount: 1_000_000, splitId: splits[0].id, caja: "bar" });
      await h.cobrar("diego", orderId, { method: "cash", amount: 2_000_000, splitId: splits[1].id, caja: "bar" });
      return { orderId, efectos: [{ cajon: "bar", cents: 2_000_000 }] };
    },
  );

  await caso(
    { id: "C06", titulo: "Ítem cancelado después de marchar", cubre: "la encargada cancela un plato ya enviado a cocina; se cobra el resto", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa" }, { p: "pizza" }, { p: "agua" }]);
      const pizza = (await h.itemsDe(orderId)).find((i) => i.product_id === n.productos.pizza)!;
      h.como("encargada");
      ok(await cancelarItem(pizza.id, "Se equivocaron de mesa", n.slug), "cancelar ítem");
      await h.cobrar("pedro", orderId, { method: "cash", amount: P.milanesa + P.agua });
      return { orderId, pagado: 1_500_000, efectos: [{ mozo: "pedro", caja: "principal", cents: 1_500_000 }] };
    },
  );

  await caso(
    { id: "C07", titulo: "Comanda anulada entera y vuelta a pedir", cubre: "anular una comanda completa + nueva tanda + tarjeta sin propina", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "flan", q: 2 }]);
      const { data: comandas } = await h.sb.from("comandas").select("id").eq("order_id", orderId);
      h.como("encargada");
      ok(await cancelarComanda(n.slug, comandas![0].id as string, "Pidieron otra cosa"), "anular comanda");
      await h.sumar("lucia", orderId, [{ p: "milanesa" }]);
      await h.cobrar("lucia", orderId, { method: "card_manual", amount: T(P.milanesa) });
      return { orderId, pagado: P.milanesa, efectos: [] };
    },
  );

  await caso(
    { id: "C08", titulo: "Efectivo de más: el excedente es propina", cubre: "billete grande, «lo que sobra es propina»: el mozo se queda la propina en efectivo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa" }, { p: "agua" }]);
      await h.cobrar("pedro", orderId, { method: "cash", amount: 1_700_000, excedente: "propina" });
      return { orderId, efectos: [{ mozo: "pedro", caja: "principal", cents: 1_500_000 }] };
    },
  );

  await caso(
    { id: "C09", titulo: "Tarjeta de más: el excedente es propina", cubre: "cobran $1.500 de más por tarjeta (sobre la cuenta con recargo): propina automática", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "pizza" }]);
      await h.cobrar("diego", orderId, { method: "card_manual", amount: T(P.pizza) + 150_000 });
      return { orderId, efectos: [{ mozo: "diego", caja: "principal", cents: -150_000 }] };
    },
  );

  await caso(
    { id: "C10", titulo: "Descuento y propina, en efectivo", cubre: "descuento del 10% de la encargada + propina en la cuenta + efectivo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "milanesa", q: 2 }]);
      h.como("encargada");
      ok(
        await aplicarPropinaYDescuento(orderId, { tip_cents: 100_000, discount_cents: 240_000, discount_reason: "Cliente habitual" }, n.slug),
        "descuento",
      );
      await h.cobrar("lucia", orderId, { method: "cash", amount: 2_260_000 });
      return { orderId, efectos: [{ mozo: "lucia", caja: "principal", cents: 2_160_000 }] };
    },
  );

  await caso(
    { id: "C11", titulo: "Fiado a cuenta corriente", cubre: "la encargada cierra la mesa a la cuenta de un cliente: no entra plata", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa" }]);
      await h.cobrar("encargada", orderId, { method: "cuenta_corriente", amount: P.milanesa, cliente: true });
      return { orderId, efectos: [] };
    },
  );

  await caso(
    { id: "C12", titulo: "Invitación de la casa (cuenta en $0)", cubre: "precio pisado a $0 + cerrar sin cobro", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("encargada", [{ p: "cafe", q: 2, precio: 0, motivo: "Invita la casa" }]);
      h.como("encargada");
      ok(await cerrarSinCobro(orderId, "Invita la casa", n.slug), "cerrar sin cobro");
      return { orderId, efectos: [] };
    },
  );

  await caso(
    { id: "C13", titulo: "Invitación parcial: un postre sin cargo", cubre: "la encargada agrega un ítem a $0 en la mesa del mozo; se cobra el resto con tarjeta", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "milanesa" }]);
      await h.sumar("encargada", orderId, [{ p: "flan", precio: 0, motivo: "Cumpleaños" }]);
      await h.cobrar("lucia", orderId, { method: "card_manual", amount: T(P.milanesa) });
      return { orderId, efectos: [] };
    },
  );

  await caso(
    { id: "C14", titulo: "Cobro en efectivo anulado y vuelto a cobrar con tarjeta", cubre: "anular una línea de cobro (la cuenta queda cerrada con saldo) y cobrarla de nuevo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "pizza" }]);
      const r = await h.cobrar("diego", orderId, { method: "cash", amount: P.pizza });
      h.como("encargada");
      ok(await anularLineaDeCobro({ paymentId: r.payment.id, slug: n.slug, motivo: "Pagó con tarjeta" }), "anular línea");
      await h.cobrar("diego", orderId, { method: "card_manual", amount: T(P.pizza) });
      return { orderId, efectos: [] };
    },
  );

  await caso(
    { id: "C15", titulo: "Cobro corregido de efectivo a tarjeta", cubre: "corrección del método después de cobrar: deja de ser plata del mozo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa" }, { p: "agua" }]);
      const r = await h.cobrar("pedro", orderId, { method: "cash", amount: 1_500_000 });
      h.como("encargada");
      ok(
        await corregirCobro({ paymentId: r.payment.id, slug: n.slug, motivo: "Era con tarjeta", method: "card_manual", last_four: "4242" }),
        "corregir",
      );
      return { orderId, efectos: [] };
    },
  );

  await caso(
    { id: "C16", titulo: "La encargada cobra la mesa de un mozo en efectivo", cubre: "quien cobra no es el dueño de la plata: la rinde el mozo de la mesa", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "pizza" }]);
      await h.cobrar("encargada", orderId, { method: "cash", amount: P.pizza });
      return { orderId, efectos: [{ mozo: "lucia", caja: "principal", cents: 1_500_000 }] };
    },
  );

  await caso(
    { id: "C17", titulo: "Mesa trasladada y cobrada", cubre: "traslado de mesa con la cuenta abierta", estado: "cerrada" },
    async () => {
      const { tableId, orderId } = await h.abrirMesa("pedro", [{ p: "cafe", q: 2 }]);
      h.como("encargada");
      ok(await trasladarMesa(tableId, h.mesa(), n.slug, "Pasaron afuera"), "trasladar");
      await h.cobrar("pedro", orderId, { method: "cash", amount: 2 * P.cafe });
      return { orderId, efectos: [{ mozo: "pedro", caja: "principal", cents: 500_000 }] };
    },
  );

  await caso(
    { id: "C18", titulo: "Cobro entero anulado y vuelto a cobrar en efectivo", cubre: "anular el cobro de una cuenta cerrada (la reabre) y cobrarla de nuevo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "milanesa" }]);
      await h.cobrar("diego", orderId, { method: "card_manual", amount: T(P.milanesa) });
      h.como("encargada");
      ok(await anularCobro(orderId, "Se cobró en la mesa equivocada", n.slug), "anular cobro");
      await h.cobrar("diego", orderId, { method: "cash", amount: P.milanesa });
      return { orderId, efectos: [{ mozo: "diego", caja: "principal", cents: 1_200_000 }] };
    },
  );

  await caso(
    { id: "C19", titulo: "Dividida por ítems", cubre: "split por ítems: una parte en efectivo, otra con tarjeta", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa" }, { p: "pizza" }, { p: "agua" }]);
      const it = await h.itemsDe(orderId);
      const id = (k: keyof Negocio["productos"]) => it.find((i) => i.product_id === n.productos[k])!.id;
      const { splits } = ok(
        await dividirPorItems(orderId, { 0: [id("milanesa"), id("agua")], 1: [id("pizza")] }, n.slug),
        "dividir por ítems",
      );
      await h.cobrar("pedro", orderId, { method: "cash", amount: 1_500_000, splitId: splits[0].id });
      await h.cobrar("pedro", orderId, { method: "card_manual", amount: T(1_500_000), splitId: splits[1].id });
      return { orderId, efectos: [{ mozo: "pedro", caja: "principal", cents: 1_500_000 }] };
    },
  );

  await caso(
    { id: "C20", titulo: "Mesa sólo con tarjeta en la Caja Bar: la caja le debe la propina", cubre: "saldo negativo: el mozo no tiene efectivo del que quedarse su propina", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "flan" }]);
      h.como("encargada");
      ok(await aplicarPropinaYDescuento(orderId, { tip_cents: 100_000, discount_cents: 0, discount_reason: null }, n.slug), "propina");
      await h.cobrar("lucia", orderId, { method: "card_manual", amount: T(600_000), caja: "bar" });
      return { orderId, efectos: [{ mozo: "lucia", caja: "bar", cents: -100_000 }] };
    },
  );

  // ── Más variantes del salón ──────────────────────────────────────────────

  await caso(
    { id: "C31", titulo: "Efectivo con vuelto", cubre: "pagan con un billete grande y se da el vuelto: entra sólo lo de la cuenta", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa" }]);
      await h.cobrar("pedro", orderId, { method: "cash", amount: 2_000_000 });
      return { orderId, pagado: P.milanesa, efectos: [{ mozo: "pedro", caja: "principal", cents: 1_200_000 }] };
    },
  );

  await caso(
    { id: "C32", titulo: "Un mozo cobra en la Caja Bar (sin ser su operador)", cubre: "la plata queda a su nombre en la Bar: un mozo con saldo en dos cajas", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "cafe", q: 2 }]);
      await h.cobrar("pedro", orderId, { method: "cash", amount: 2 * P.cafe, caja: "bar" });
      return { orderId, efectos: [{ mozo: "pedro", caja: "bar", cents: 500_000 }] };
    },
  );

  await caso(
    { id: "C33", titulo: "Cobro movido de caja: era de la Bar (la opera Diego)", cubre: "corregir la caja de un cobro en efectivo: al pasar a la caja que opera su mozo, deja de ser del mozo y entra al cajón", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "agua" }]);
      const r = await h.cobrar("diego", orderId, { method: "cash", amount: P.agua });
      h.como("encargada");
      ok(await corregirCobro({ paymentId: r.payment.id, slug: n.slug, motivo: "Era de la barra", caja_id: n.cajas.bar }), "mover de caja");
      return { orderId, efectos: [{ cajon: "bar", cents: 300_000 }] };
    },
  );

  await caso(
    { id: "C34", titulo: "Cobro reasignado a otro mozo (corrección)", cubre: "se atribuyó al mozo equivocado: la plata pasa al que corresponde", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "flan" }]);
      const r = await h.cobrar("diego", orderId, { method: "cash", amount: P.flan });
      h.como("encargada");
      ok(
        await corregirCobro({ paymentId: r.payment.id, slug: n.slug, motivo: "La atendió Pedro", attributed_mozo_id: n.gente.pedro }),
        "reasignar mozo",
      );
      return { orderId, efectos: [{ mozo: "pedro", caja: "principal", cents: 500_000 }] };
    },
  );

  await caso(
    { id: "C35", titulo: "Mesa pasada a otro mozo antes de cobrar", cubre: "cambio de mozo de la mesa: cobra y rinde el nuevo", estado: "cerrada" },
    async () => {
      const { tableId, orderId } = await h.abrirMesa("lucia", [{ p: "pizza" }]);
      h.como("encargada");
      ok(await assignMozoToTable(tableId, n.gente.diego, n.slug), "pasar la mesa");
      await h.cobrar("diego", orderId, { method: "cash", amount: P.pizza });
      return { orderId, efectos: [{ mozo: "diego", caja: "principal", cents: 1_500_000 }] };
    },
  );

  await caso(
    { id: "C36", titulo: "Precio especial pisado por la encargada", cubre: "override de precio con motivo (no $0)", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "cafe" }]);
      await h.sumar("encargada", orderId, [{ p: "milanesa", precio: 1_000_000, motivo: "Promo del día" }]);
      await h.cobrar("pedro", orderId, { method: "card_manual", amount: T(1_250_000) });
      return { orderId, pagado: 1_250_000, efectos: [] };
    },
  );

  await caso(
    { id: "C37", titulo: "Ítem fuera de carta", cubre: "la encargada carga un ítem libre con su precio", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "cafe" }]);
      await h.sumarLibre(orderId, "Torta de cumpleaños", 800_000);
      await h.cobrar("lucia", orderId, { method: "cash", amount: 1_050_000 });
      return { orderId, pagado: 1_050_000, efectos: [{ mozo: "lucia", caja: "principal", cents: 1_050_000 }] };
    },
  );

  await caso(
    { id: "C38", titulo: "Dividida por comensal", cubre: "cada comensal paga lo suyo (por asiento)", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa", comensal: 1 }, { p: "pizza", comensal: 2 }]);
      const { splits } = ok(await dividirPorComensal(orderId, n.slug), "dividir por comensal");
      for (const sp of splits) {
        await h.cobrar("pedro", orderId, { method: "cash", amount: sp.expected_amount_cents, splitId: sp.id });
      }
      return { orderId, pagado: 2_700_000, efectos: [{ mozo: "pedro", caja: "principal", cents: 2_700_000 }] };
    },
  );

  await caso(
    { id: "C39", titulo: "Sub-cuenta cancelada: se reparte entre los que quedan", cubre: "dividida en 3, uno se va sin pagar su parte y la pagan los otros dos", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "cafe", q: 3 }]);
      const { splits } = ok(await dividirPorPersonas(orderId, 3, n.slug), "dividir en 3");
      h.como("encargada");
      ok(await cancelarSplit(splits[2].id, "Se fue antes", n.slug), "cancelar sub-cuenta");
      const { data: vivas } = await h.sb
        .from("order_splits")
        .select("id, expected_amount_cents")
        .eq("order_id", orderId)
        .neq("status", "cancelled");
      for (const sp of vivas ?? []) {
        await h.cobrar("lucia", orderId, { method: "cash", amount: sp.expected_amount_cents as number, splitId: sp.id as string });
      }
      return { orderId, pagado: 750_000, efectos: [{ mozo: "lucia", caja: "principal", cents: 750_000 }] };
    },
  );

  await caso(
    { id: "C40", titulo: "Ítem cancelado desde la cuenta ya dividida", cubre: "cancelar en la cuenta deshace la división; se cobra el total nuevo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "milanesa" }, { p: "agua" }]);
      ok(await dividirPorPersonas(orderId, 2, n.slug), "dividir");
      const agua = (await h.itemsDe(orderId)).find((i) => i.product_id === n.productos.agua)!;
      h.como("encargada");
      ok(await cancelarItemEnCuenta(agua.id, "No la trajeron", n.slug), "cancelar en la cuenta");
      await h.cobrar("diego", orderId, { method: "cash", amount: P.milanesa });
      return { orderId, pagado: P.milanesa, efectos: [{ mozo: "diego", caja: "principal", cents: 1_200_000 }] };
    },
  );

  await caso(
    { id: "C41", titulo: "Cobro con método «otro»", cubre: "medio de pago no listado, con nota obligatoria", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "flan" }]);
      await h.cobrar("pedro", orderId, { method: "other", amount: P.flan });
      return { orderId, efectos: [] };
    },
  );

  await caso(
    { id: "C49", titulo: "Cantidad cambiada después de marchar", cubre: "la encargada corrige la cantidad de un ítem enviado", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "agua", q: 2 }]);
      const agua = (await h.itemsDe(orderId))[0];
      h.como("encargada");
      ok(await editarItemComanda(n.slug, agua.id, { quantity: 3 }), "cambiar cantidad");
      await h.cobrar("pedro", orderId, { method: "cash", amount: 3 * P.agua });
      return { orderId, pagado: 900_000, efectos: [{ mozo: "pedro", caja: "principal", cents: 900_000 }] };
    },
  );

  // ── Splits contra la caja nueva ──────────────────────────────────────────

  await caso(
    { id: "C50", titulo: "Dividida por personas y cobrada en dos cajas", cubre: "cada sub-cuenta en efectivo en una caja distinta: el saldo del mozo queda partido entre las dos", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "pizza", q: 2 }]);
      const { splits } = ok(await dividirPorPersonas(orderId, 2, n.slug), "dividir");
      await h.cobrar("pedro", orderId, { method: "cash", amount: 1_500_000, splitId: splits[0].id });
      await h.cobrar("pedro", orderId, { method: "cash", amount: 1_500_000, splitId: splits[1].id, caja: "bar" });
      return {
        orderId,
        pagado: 3_000_000,
        efectos: [
          { mozo: "pedro", caja: "principal", cents: 1_500_000 },
          { mozo: "pedro", caja: "bar", cents: 1_500_000 },
        ],
      };
    },
  );

  await caso(
    { id: "C51", titulo: "Sub-cuenta cobrada, anulada y vuelta a cobrar con tarjeta", cubre: "anular el pago de una sub-cuenta la deja para cobrar de nuevo; el efectivo anulado deja de ser del mozo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "milanesa", q: 2 }]);
      const { splits } = ok(await dividirPorPersonas(orderId, 2, n.slug), "dividir");
      const r = await h.cobrar("lucia", orderId, { method: "cash", amount: 1_200_000, splitId: splits[0].id });
      h.como("encargada");
      ok(await anularLineaDeCobro({ paymentId: r.payment.id, slug: n.slug, motivo: "Pagó con tarjeta" }), "anular sub-cuenta");
      await h.cobrar("lucia", orderId, { method: "card_manual", amount: T(1_200_000), splitId: splits[0].id });
      await h.cobrar("lucia", orderId, { method: "cash", amount: 1_200_000, splitId: splits[1].id });
      return { orderId, pagado: 2_400_000, efectos: [{ mozo: "lucia", caja: "principal", cents: 1_200_000 }] };
    },
  );

  await caso(
    { id: "C52", titulo: "Re-dividida después de un pago parcial, con propina", cubre: "dividida en 2, paga uno; lo que falta se re-divide por monto y se cobra: la propina va una sola vez", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "cafe", q: 4 }]);
      h.como("encargada");
      ok(await aplicarPropinaYDescuento(orderId, { tip_cents: 100_000, discount_cents: 0, discount_reason: null }, n.slug), "propina");
      h.como("diego");
      const { splits } = ok(await dividirPorPersonas(orderId, 2, n.slug), "dividir");
      await h.cobrar("diego", orderId, { method: "cash", amount: splits[0].expected_amount_cents, splitId: splits[0].id });
      const { splits: resto } = ok(await dividirPorMonto(orderId, [300_000], n.slug), "re-dividir por monto");
      for (const sp of resto.filter((x) => x.status !== "paid" && x.status !== "cancelled")) {
        await h.cobrar("diego", orderId, { method: "cash", amount: sp.expected_amount_cents - sp.paid_amount_cents, splitId: sp.id });
      }
      // Todo en efectivo: entrega lo cobrado ($11.000) menos su propina en efectivo ($1.000).
      return { orderId, pagado: 1_100_000, efectos: [{ mozo: "diego", caja: "principal", cents: 1_000_000 }] };
    },
  );

  await caso(
    { id: "C53", titulo: "Sub-cuenta corregida de efectivo a tarjeta", cubre: "corregir el método del pago de una sub-cuenta: la cuenta sigue saldada y esa parte deja de ser del mozo", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "milanesa" }, { p: "flan" }]);
      const it = await h.itemsDe(orderId);
      const id = (k: keyof Negocio["productos"]) => it.find((i) => i.product_id === n.productos[k])!.id;
      const { splits } = ok(await dividirPorItems(orderId, { 0: [id("milanesa")], 1: [id("flan")] }, n.slug), "dividir por ítems");
      const sMila = splits.find((x) => x.expected_amount_cents === P.milanesa)!;
      const sFlan = splits.find((x) => x.expected_amount_cents === P.flan)!;
      await h.cobrar("pedro", orderId, { method: "cash", amount: P.milanesa, splitId: sMila.id });
      const r = await h.cobrar("pedro", orderId, { method: "cash", amount: P.flan, splitId: sFlan.id });
      h.como("encargada");
      ok(
        await corregirCobro({ paymentId: r.payment.id, slug: n.slug, motivo: "El postre lo pagó con tarjeta", method: "card_manual", last_four: "4242" }),
        "corregir sub-cuenta",
      );
      return { orderId, pagado: 1_700_000, efectos: [{ mozo: "pedro", caja: "principal", cents: 1_200_000 }] };
    },
  );

  await caso(
    { id: "C54", titulo: "Cada sub-cuenta la cobra alguien distinto", cubre: "dividida en 3: cobran la moza y la encargada; toda la plata es de la moza de la mesa", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("lucia", [{ p: "flan", q: 3 }]);
      const { splits } = ok(await dividirPorPersonas(orderId, 3, n.slug), "dividir en 3");
      await h.cobrar("lucia", orderId, { method: "cash", amount: P.flan, splitId: splits[0].id });
      await h.cobrar("encargada", orderId, { method: "cash", amount: P.flan, splitId: splits[1].id });
      await h.cobrar("encargada", orderId, { method: "card_manual", amount: T(P.flan), splitId: splits[2].id });
      return { orderId, pagado: 1_500_000, efectos: [{ mozo: "lucia", caja: "principal", cents: 1_000_000 }] };
    },
  );

  await caso(
    { id: "C55", titulo: "Dividida con propina: una parte con tarjeta (con recargo) y otra en efectivo", cubre: "propina prorrateada en las sub-cuentas + recargo de tarjeta: se queda su propina de tarjeta de lo que trae", estado: "cerrada" },
    async () => {
      const { orderId } = await h.abrirMesa("diego", [{ p: "pizza" }, { p: "milanesa" }]);
      h.como("encargada");
      ok(await aplicarPropinaYDescuento(orderId, { tip_cents: 270_000, discount_cents: 0, discount_reason: null }, n.slug), "propina");
      h.como("diego");
      const { splits } = ok(await dividirPorPersonas(orderId, 2, n.slug), "dividir");
      await h.cobrar("diego", orderId, { method: "card_manual", amount: T(1_485_000), splitId: splits[0].id });
      await h.cobrar("diego", orderId, { method: "cash", amount: 1_485_000, splitId: splits[1].id });
      return {
        orderId,
        efectos: [
          { mozo: "diego", caja: "principal", cents: 1_485_000 - 135_000 }, // efectivo sin su propina en efectivo
          { mozo: "diego", caja: "principal", cents: -135_000 }, // su propina de la tarjeta
        ],
      };
    },
  );

  // ── Rendiciones a mitad del turno ────────────────────────────────────────

  await caso(
    { id: "C47", titulo: "Una moza entrega una parte a mitad del turno", cubre: "rendición parcial: baja su saldo y entra al cajón", estado: undefined },
    async () => {
      h.como("encargada");
      ok(
        await rendirMozo({ slug: n.slug, mozoId: n.gente.lucia, cajaId: n.cajas.principal, entregadoCents: 1_000_000 }),
        "rendición parcial",
      );
      return {
        efectos: [
          { cajon: "principal", cents: 1_000_000 },
          { mozo: "lucia", caja: "principal", cents: -1_000_000 },
        ],
      };
    },
  );

  await caso(
    { id: "C48", titulo: "Entrega cargada por error y anulada", cubre: "anular una entrega: el saldo vuelve y el cajón no la cuenta", estado: undefined },
    async () => {
      h.como("encargada");
      ok(
        await rendirMozo({ slug: n.slug, mozoId: n.gente.diego, cajaId: n.cajas.principal, entregadoCents: 100_000 }),
        "entrega",
      );
      const { data: r } = await h.sb
        .from("mozo_rendiciones")
        .select("id")
        .eq("mozo_id", n.gente.diego)
        .eq("caja_id", n.cajas.principal)
        .is("anulada_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      ok(await anularEntrega({ slug: n.slug, rendicionId: r!.id as string, motivo: "Era de otro mozo" }), "anular entrega");
      return { efectos: [] };
    },
  );

  // ── Lo que queda abierto para el cierre ─────────────────────────────────

  await caso(
    { id: "C21", titulo: "Mesa abierta sin pedir la cuenta", cubre: "bloquea el cierre de cualquier caja hasta cobrarla", estado: "abierta" },
    async () => {
      const { orderId } = await h.abrirMesa("pedro", [{ p: "pizza" }]);
      return { orderId, efectos: [], pendiente: { quien: "pedro", falta: P.pizza } };
    },
  );

  await caso(
    { id: "C22", titulo: "Pidió la cuenta y pagó una parte con tarjeta", cubre: "cuenta con pago parcial: falta el resto", estado: "abierta" },
    async () => {
      const { tableId, orderId } = await h.abrirMesa("lucia", [{ p: "milanesa", q: 2 }]);
      h.como("lucia");
      ok(await pedirCuenta(tableId, n.slug), "pedir cuenta");
      await h.cobrar("lucia", orderId, { method: "card_manual", amount: T(1_000_000) });
      return { orderId, pagado: 1_000_000, efectos: [], pendiente: { quien: "lucia", falta: 1_400_000 } };
    },
  );

  await caso(
    { id: "C23", titulo: "Mesa anulada sin cobrar", cubre: "se fueron sin consumir: la mesa se anula y no deja nada", estado: "cancelada" },
    async () => {
      const { tableId, orderId } = await h.abrirMesa("diego", [{ p: "agua" }]);
      h.como("encargada");
      ok(await anularMesa(tableId, "Se fueron", n.slug), "anular mesa");
      return { orderId, efectos: [] };
    },
  );

  // ── Mostrador, delivery y web ────────────────────────────────────────────

  await caso(
    { id: "C24", titulo: "Mostrador en efectivo", cubre: "venta de mostrador de la encargada: sin mesa, la rinde ella", estado: "cerrada" },
    async () => {
      h.como("encargada");
      const r = ok(
        await venderMostrador({
          business_slug: n.slug,
          items: [{ product_id: n.productos.cafe, quantity: 2, modifier_ids: [] }],
          method: "cash",
          caja_id: n.cajas.principal,
          tip_cents: 0,
          request_id: randomUUID(),
        }),
        "mostrador",
      ) as { order_id?: string; orderId?: string };
      return { orderId: r.order_id ?? r.orderId, efectos: [{ mozo: "encargada", caja: "principal", cents: 500_000 }] };
    },
  );

  await caso(
    { id: "C25", titulo: "Mostrador con tarjeta", cubre: "venta de mostrador cobrada con tarjeta", estado: "cerrada" },
    async () => {
      h.como("encargada");
      const r = ok(
        await venderMostrador({
          business_slug: n.slug,
          items: [{ product_id: n.productos.flan, quantity: 1, modifier_ids: [] }],
          method: "card_manual",
          caja_id: n.cajas.principal,
          tip_cents: 0,
          last_four: "4242",
          card_brand: "visa",
          request_id: randomUUID(),
        }),
        "mostrador tarjeta",
      ) as { order_id?: string; orderId?: string };
      return { orderId: r.order_id ?? r.orderId, efectos: [] };
    },
  );

  await caso(
    { id: "C26", titulo: "Delivery cargado por la encargada, cobrado en efectivo", cubre: "pedido de delivery cargado a mano (con costo de envío si el negocio lo cobra) y cobrado contra entrega", estado: "cerrada" },
    async () => {
      h.como("encargada");
      const r = ok(
        await cargarPedidoStaff({
          business_slug: n.slug,
          delivery_type: "delivery",
          customer_name: "Delivery Prueba",
          customer_phone: "1155550000",
          delivery_address: "Calle Falsa 123",
          items: [{ product_id: n.productos.pizza, quantity: 1, modifier_ids: [] }],
        }),
        "delivery",
      ) as { order_id?: string; orderId?: string; id?: string };
      const orderId = (r.order_id ?? r.orderId ?? r.id)!;
      // Pizza + el costo de envío del negocio (en el demo hay; en el de prueba, no).
      const { total_cents } = await h.orden(orderId);
      if (total_cents < P.pizza) throw new Error(`total ${total_cents} menor que la pizza`);
      await h.cobrar("encargada", orderId, { method: "cash", amount: total_cents });
      return { orderId, efectos: [{ mozo: "encargada", caja: "principal", cents: total_cents }] };
    },
  );

  await caso(
    { id: "C27", titulo: "Pedido para retirar pagado con Mercado Pago", cubre: "pago MP pendiente que se acredita (forzar pago = lo que hace el webhook)", estado: "cerrada" },
    async () => {
      h.como("encargada");
      const r = ok(
        await cargarPedidoStaff({
          business_slug: n.slug,
          delivery_type: "pickup",
          customer_name: "Retira Prueba",
          items: [{ product_id: n.productos.milanesa, quantity: 1, modifier_ids: [] }],
        }),
        "pickup",
      ) as { order_id?: string; orderId?: string; id?: string };
      const orderId = (r.order_id ?? r.orderId ?? r.id)!;
      // Lo que deja iniciarPagoMp (la preferencia de MP no se puede crear sin red).
      const { data: pago, error } = await h.sb
        .from("payments")
        .insert({
          order_id: orderId,
          business_id: n.businessId,
          caja_id: n.cajas.principal,
          method: "mp_link",
          amount_cents: P.milanesa,
          tip_cents: 0,
          payment_status: "pending",
          operated_by: n.gente.encargada,
        })
        .select("id")
        .single();
      if (error) throw error;
      ok(await forzarPago(pago.id as string, "Acreditado en MP", n.slug), "forzar pago MP");
      return { orderId, efectos: [] };
    },
  );

  // ── Movimientos de caja ──────────────────────────────────────────────────

  await caso(
    { id: "C28", titulo: "El cliente del fiado paga una parte en efectivo", cubre: "cobranza de cuenta corriente: entra al cajón como ingreso", estado: undefined },
    async () => {
      h.como("encargada");
      ok(
        await registrarCobranza({
          customerId: n.cliente,
          amount_cents: 500_000,
          method: "cash",
          cajaId: n.cajas.principal,
          notes: "Pago a cuenta",
          slug: n.slug,
        } as Parameters<typeof registrarCobranza>[0]),
        "cobranza",
      );
      return { efectos: [{ cajon: "principal", cents: 500_000 }] };
    },
  );

  await caso(
    { id: "C29", titulo: "Sangría de la principal", cubre: "se saca plata del cajón (pago a un proveedor)", estado: undefined },
    async () => {
      h.como("encargada");
      ok(await registrarSangria(n.cajas.principal, 300_000, "Pago al panadero", n.slug), "sangría");
      return { efectos: [{ cajon: "principal", cents: -300_000 }] };
    },
  );

  await caso(
    { id: "C30", titulo: "Ingreso de cambio en la Caja Bar", cubre: "se pone cambio en el cajón", estado: undefined },
    async () => {
      h.como("encargada");
      ok(await registrarIngreso(n.cajas.bar, 1_000_000, "Cambio", n.slug), "ingreso");
      return { efectos: [{ cajon: "bar", cents: 1_000_000 }] };
    },
  );

  await caso(
    { id: "C42", titulo: "Fiado en el mostrador", cubre: "venta de mostrador a la cuenta corriente de un cliente: no entra plata", estado: "cerrada" },
    async () => {
      h.como("encargada");
      const r = ok(
        await venderMostrador({
          business_slug: n.slug,
          items: [{ product_id: n.productos.cafe, quantity: 1, modifier_ids: [] }],
          method: "cuenta_corriente",
          credit_customer_id: n.cliente,
          caja_id: n.cajas.principal,
          tip_cents: 0,
          request_id: randomUUID(),
        }),
        "mostrador fiado",
      ) as { order_id?: string };
      return { orderId: r.order_id, efectos: [] };
    },
  );

  await caso(
    { id: "C43", titulo: "Pedido pagado con Mercado Pago y devuelto por MP", cubre: "spec 212: si MP devuelve la plata el pedido queda anulado (sale de entregados y de «por cobrar»); no toca la caja", estado: "cancelada" },
    async () => {
      h.como("encargada");
      const r = ok(
        await cargarPedidoStaff({
          business_slug: n.slug,
          delivery_type: "pickup",
          customer_name: "Devolución Prueba",
          items: [{ product_id: n.productos.pizza, quantity: 1, modifier_ids: [] }],
        }),
        "pickup",
      ) as { order_id?: string };
      const orderId = r.order_id!;
      const mpId = `esc-${randomUUID()}`;
      const { data: pago, error } = await h.sb
        .from("payments")
        .insert({
          order_id: orderId,
          business_id: n.businessId,
          caja_id: n.cajas.principal,
          method: "mp_link",
          amount_cents: P.pizza,
          tip_cents: 0,
          payment_status: "pending",
          operated_by: n.gente.encargada,
          mp_payment_id: mpId,
        })
        .select("id")
        .single();
      if (error) throw error;
      ok(await forzarPago(pago.id as string, "Acreditado en MP", n.slug), "forzar pago MP");
      const { reembolsados } = await aplicarReembolsoMp(h.sb, { orderId, businessId: n.businessId, paymentId: mpId });
      if (reembolsados !== 1) throw new Error(`reembolsados ${reembolsados}`);
      return { orderId, efectos: [] };
    },
  );

  await caso(
    { id: "C45", titulo: "Sangría corregida", cubre: "se cargó mal el monto de una sangría y se corrige", estado: undefined },
    async () => {
      h.como("encargada");
      ok(await registrarSangria(n.cajas.bar, 100_000, "Hielo", n.slug), "sangría");
      const { data: m } = await h.sb
        .from("caja_movimientos")
        .select("id")
        .eq("caja_id", n.cajas.bar)
        .eq("kind", "sangria")
        .eq("reason", "Hielo")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      ok(await corregirMovimiento({ movimientoId: m!.id as string, slug: n.slug, motivo: "Eran $500", amount_cents: 50_000 }), "corregir sangría");
      return { efectos: [{ cajon: "bar", cents: -50_000 }] };
    },
  );

  return { casos };
}

// ── Cuentas esperadas ───────────────────────────────────────────────────────

export function totales(dia: Dia) {
  const cajon: Record<CajaKey, number> = { principal: 0, bar: 0 };
  const saldos = new Map<string, number>(); // `${persona}|${caja}`
  for (const c of dia.casos) {
    for (const e of c.efectos) {
      if ("cajon" in e) cajon[e.cajon] += e.cents;
      else saldos.set(`${e.mozo}|${e.caja}`, (saldos.get(`${e.mozo}|${e.caja}`) ?? 0) + e.cents);
    }
  }
  return { cajon, saldos };
}

export const pesos = (cents: number) =>
  `${cents < 0 ? "−" : ""}$ ${Math.abs(cents / 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;

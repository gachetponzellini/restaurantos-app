import { NextResponse } from "next/server";

import { marchDueScheduledOrders } from "@/lib/orders/march-scheduled";
import { vencerPedidosSinResolver } from "@/lib/orders/vencer-pendientes";

// Marcha programada de pedidos diferidos (spec 31). Lo dispara `pg_cron` vía
// `pg_net` cada pocos minutos (ver migración del cron), o se puede curl-ear a
// mano on-site. Protegido por `CRON_SECRET` (Bearer). Fail-closed: sin secreto
// configurado, el endpoint queda cerrado.
//
// La marcha en sí es idempotente (`routeOrderToCocina`), así que reintentos o
// solapes de ticks no duplican comandas.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "cron not configured" },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await marchDueScheduledOrders();

  // #148 · H-20 + H-45 — vencer los pedidos online que nadie resolvió. Va en
  // este mismo tick (cada 5 min) para no sumar invocaciones, y aislado: si
  // falla, la marcha ya corrió y se loguea.
  let vencimiento: Awaited<ReturnType<typeof vencerPedidosSinResolver>> | null = null;
  try {
    vencimiento = await vencerPedidosSinResolver();
  } catch (e) {
    console.error("cron march-scheduled · vencerPedidosSinResolver", e);
  }

  return NextResponse.json({ ok: true, ...result, vencimiento });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

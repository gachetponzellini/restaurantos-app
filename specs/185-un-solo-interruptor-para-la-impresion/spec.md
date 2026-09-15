# 185 · Un solo interruptor para apagar las comandas de cocina

Issue [#308](https://github.com/gachetponzellini/RestaurantOS-app/issues/308).

> ⚠️ **Corrección de alcance (mismo día).** La primera versión apagaba las
> seis familias de papel (comandas + control + cuenta + factura + cierre +
> rendición) con un solo flag. Juan lo acotó: lo que molesta y se quiere poder
> apagar de un tirón son **las comandas de cocina** — control, cuenta y
> factura siguen su propio switch, sin enterarse de este.

## El problema

Apagar las comandas de cocina de un negocio hoy es ir sector por sector
(`stations.printer_enabled`, uno por cada uno de N sectores). Un local que
todavía no tiene comanderas instaladas —golf-house en onboarding— o que
necesita un corte de emergencia en cocina, tiene que ir sector por sector en
vez de un solo click.

## La solución

Un interruptor, `businesses.comandas_printer_enabled` (default `true`), que se
lee dentro de `buildTrabajos` (`GET /api/print-agent`) y que, en `false`,
vacía **sólo** `printable` —las comandas de cocina, la lista que arma
`buildTrabajos` a partir de la tabla `comandas`— sin importar lo que haya
pendiente en ningún sector.

No reemplaza `stations.printer_enabled` — es un OR por encima. Apagarlo no
toca la config de ningún sector; al reactivarlo, cada uno vuelve exactamente
a como estaba. **No afecta** control, cuenta, factura, cierre ni rendición:
esas cinco familias se ensamblan por funciones separadas
(`buildPrintableControlTickets` y compañía) que no leen este flag.

El latido (`print_agent_status`) se sigue registrando aunque el flag esté en
`false`: el agente sigue pidiendo, el panel no tiene por qué decir "sin
conexión" por una decisión explícita del encargado. La retención de la spec
183 (D5) tampoco se corta — apagar cocina no dice nada sobre si va a aparecer
un control/cuenta/factura para retener, así que sigue su curso normal.

## Dónde vive

- Migración `0108` + `0109` (rename: `printing_enabled` →
  `comandas_printer_enabled`, mismo default `true` — la columna no tenía uso
  real todavía cuando se corrigió el nombre).
- `isComandaPrintingEnabled()` en [`route.ts`](../../src/app/api/print-agent/route.ts),
  corrida en paralelo con la query de `comandas` dentro de `buildTrabajos` (no
  agrega un viaje secuencial al camino de todos los días). En `false`, se
  saltea también la query de "combina con" (`loadItemsPorPedido`) — no tiene
  sentido armarla para un ticket que no se va a imprimir.
- `setComandasPrintingEnabled()` en [`station-actions.ts`](../../src/lib/catalog/station-actions.ts),
  gate `canManageBusiness`.
- Toggle adentro de la sección "Comanderas" en `/admin/configuracion`, arriba
  de la lista por sector —
  [`comandas-printing-toggle-form.tsx`](../../src/components/admin/settings/comandas-printing-toggle-form.tsx).

## Fuera de alcance

Las alertas de "agente sin conexión" / "no se imprimió" no se suprimen
explícitamente. Con el flag apagado no deberían dispararse porque no hay
comanda que falle, pero una que ya estaba `print_failed_at` de antes de
apagar el switch sigue mostrando su badge. No bloqueante — se resuelve
reintentando o dejando que salga cuando se reactive.

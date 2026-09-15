# 185 · Un solo interruptor para apagar toda la impresión del negocio

Issue [#308](https://github.com/gachetponzellini/RestaurantOS-app/issues/308).

## El problema

Apagar la impresión de un negocio hoy son cuatro switches distintos, cada uno
en su config: `stations.printer_enabled` (por sector, N sectores),
`businesses.control_printer_enabled`, `businesses`/`floor_plans.cuenta_printer_enabled`
(por salón), `cajas.fiscal_printer_enabled` (por caja). Un local que todavía
no tiene comanderas instaladas —golf-house en onboarding— o que necesita un
corte de emergencia, tiene que ir uno por uno.

## La solución

Un interruptor maestro, `businesses.printing_enabled` (default `true`), que se
lee en el único punto por el que pasan las seis familias de papel —comandas +
control + cuenta + factura, ensambladas en `buildTrabajos` dentro de
`GET /api/print-agent`— y que, en `false`, hace que el GET conteste
`comandas: []` sin importar lo que haya pendiente.

No reemplaza los switches existentes — es un OR por encima. Apagarlo no
apaga `stations.printer_enabled` ni los demás; al reactivarlo, cada impresora
vuelve exactamente a la config que tenía.

El latido (`print_agent_status`) se sigue registrando aunque el flag esté en
`false`: el agente sigue pidiendo, el panel no tiene por qué decir "sin
conexión" por una decisión explícita del encargado.

## Dónde vive

- Migración `0108`: columna aditiva en `businesses`.
- `isPrintingEnabled()` en [`route.ts`](../../src/app/api/print-agent/route.ts),
  corrida en paralelo con `buildTrabajos` y el latido (no agrega un viaje
  secuencial a la request de todos los días) — si da `false`, la respuesta se
  fuerza a `comandas: []` y se salta la retención (spec 183 · D5): no tiene
  sentido sondear la cola 25 s si ya se sabe la respuesta.
- `setPrintingEnabled()` en [`station-actions.ts`](../../src/lib/catalog/station-actions.ts),
  gate `canManageBusiness`.
- Toggle en `/admin/configuracion`, arriba de "Comanderas" —
  [`printing-toggle-form.tsx`](../../src/components/admin/settings/printing-toggle-form.tsx).

## Fuera de alcance

Las alertas de "agente sin conexión" / "no se imprimió" no se suprimen
explícitamente. Con el flag apagado no deberían dispararse porque no hay
trabajo que falle, pero una comanda que ya estaba `print_failed_at` de antes
de apagar el switch sigue mostrando su badge. No bloqueante — se resuelve
reintentando o dejando que salga cuando se reactive.

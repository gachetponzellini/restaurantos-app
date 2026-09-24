# 208 · La vista de comandas muestra las anuladas del día

**Issue:** [#378](https://github.com/gachetponzellini/RestaurantOS-app/issues/378) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** en curso. Juan aprobó (2026-09-24) la sección plegable abajo y la
ventana del día operativo.

**Input:** Juan, después de #377: *"se tendría que poder ver al igual que en
pedido, en la vista de comandas las comandas que fueron canceladas"*.

## Por qué

Cuando se cancela un pedido (`cancelDownstream`) o se anula una comanda
(spec 049), la comanda queda con `cancelled_at` y desaparece del kanban:
`getActiveComandas` la excluye (H-28, *"las anuladas no tienen nada que hacer
en cocina"*) y el kanban oculta las comandas sin ítems vivos. La cocina no
tiene cómo confirmar en la pantalla que algo se anuló. En Pedidos, en cambio,
los cancelados del día quedan en una sección plegable «Cancelados».

## Qué cambia

- **R1 · Query.** `getActiveComandas(businessId, timezone)` trae además las
  comandas con `cancelled_at >= startOfOperatingDayUtc(timezone)` (tope 100,
  las más recientes primero), scopeadas por `orders.business_id` + RLS como
  las otras dos. `LocalComanda` suma `cancelled_reason`.
- **R2 · Fuera de lo operativo (H-28 se mantiene).** Una comanda con
  `cancelled_at` no entra en ninguna columna, no suma a la saturación por
  sector, no cuenta para la alerta de impresión ni para el aviso de
  «comandas ocultas por salón».
- **R3 · Sección «Anuladas».** Debajo del kanban, un `<details>` cerrado por
  defecto: «Anuladas (N) · tocá para ver», igual que «Cancelados» en Pedidos.
  Sólo aparece si N > 0. Cada fila: `#daily_number`, sector, origen
  (`Mesa N` / nombre del cliente), hora de anulación en la TZ del negocio,
  ítems tachados y el motivo (el de la comanda, o el del primer ítem si no hay).
  Sin botones.
- **R4 · Salón.** La sección respeta el filtro de salón (spec 065), como el
  resto del kanban.

## Escenarios

- **Dado** un pedido en cocina que se cancela, **cuando** la cocina mira
  Comandas, **entonces** la comanda ya no está en «En preparación» y aparece
  en «Anuladas (1)» con el motivo.
- **Dado** una comanda anulada, **entonces** la saturación del sector y la
  alerta de impresión no la cuentan.
- **Dado** que no hay anuladas en el día operativo, **entonces** la sección no
  se muestra.
- **Dado** una anulada de ayer (antes del corte de las 6), **entonces** no
  aparece.

## Fuera de alcance

Desanular, reimprimir o editar desde la sección. Los ítems cancelados sueltos
de una comanda viva (ya se ven tachados dentro de su card).

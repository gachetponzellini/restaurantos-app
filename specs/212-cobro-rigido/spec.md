# Spec 212 · Pagos devueltos por Mercado Pago y cancelación del cliente

**Estado:** aprobada por Juan (2026-10-07), a partir de la prueba del escenario «día de caja» (#384).

## Problema

En el demo, un pedido entregado cuyo pago devolvió Mercado Pago quedaba «Entregado», «a cobrar» y en el
aviso de cuentas con saldo, como si el pedido siguiera vivo.

## Decisiones de Juan

- **D1 · Pedido confirmado:** se puede cancelar mientras no esté entregado, como hoy. No cambia.
- **~~D2 · El pago de un pedido entregado no se anula, sólo se corrige.~~ Descartada.** Se implementó y se
  revirtió antes de desplegarla. Juan: «está mal esto de que no se pueda anular». Hay casos legítimos,
  como haber cobrado la mesa equivocada. Anular un cobro hecho en el local sigue como siempre: la
  encargada, con motivo, y el cobro entero reabre la mesa.
- **D3 · Devolución de Mercado Pago** (desde el panel de MP o contracargo): no se puede frenar. Cuando
  llega y no queda ningún pago vivo, el pedido queda **anulado**: sale de «Entregados» y de «Por cobrar».
- **D4 · El cliente** puede cancelar su pedido desde la web sólo mientras no esté confirmado (`pending`).
  Una vez confirmado, no hay devolución.

## Requisitos

- **R3:** `aplicarReembolsoMp`, sin pagos vivos, anula el pedido:
  - cerrado → `cancelled` sin tocar ítems ni stock (la comida ya salió);
  - abierto → `cancelarOrden`.
  - Si queda otro pago vivo, no se anula.
- **R4:** `CUSTOMER_CANCELLABLE_STATUSES = {pending}`.

## Fuera de alcance

Nota de crédito ARCA de un pedido facturado que MP devuelve.

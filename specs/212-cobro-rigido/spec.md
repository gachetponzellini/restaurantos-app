# Spec 212 · Lo cobrado y entregado no se anula

**Estado:** aprobada por Juan (2026-10-07), a partir de la prueba del escenario «día de caja» (#384).

## Problema

En el demo, un pedido entregado cuyo pago se había devuelto quedaba «Entregado», «a cobrar» y aparecía
como cuenta con saldo pendiente. Juan: «el sistema no debería dejar anular el pago y recibir el pedido…
tiene que ser rígido el sistema con esto».

## Decisiones de Juan

- **D1 · Pedido confirmado:** se puede cancelar mientras no esté entregado, como hoy. No cambia.
- **D2 · Pedido entregado y cobrado:** **nadie** anula su pago, ni una línea ni el cobro entero. Sólo se
  **corrige** (método, caja, mozo, monto), que no deja el pedido sin cobrar.
- **D3 · Devolución de Mercado Pago** (desde el panel de MP o contracargo): no se puede frenar. Cuando llega
  y no queda ningún pago vivo, el pedido queda **anulado**: sale de «Entregados» y de «Por cobrar».
- **D4 · El cliente** puede cancelar su pedido desde la web sólo mientras no esté confirmado (`pending`).
  Una vez confirmado, no hay devolución.

## Requisitos

- **R1 (base, rígido):**
  - Un cobro que no es de MP no pasa de `paid` a `refunded` si su pedido está cerrado.
  - Un pedido cerrado no se reabre.
  - Error: `COBRO_CERRADO_NO_SE_ANULA`.
- **R2 (app):**
  - `anularLineaDeCobro` y `anularCobro` sobre un pedido cerrado responden «El pedido ya está cerrado: el
    cobro no se anula, se corrige (método, caja, mozo o monto)».
  - La pantalla no ofrece anular un cobro de un pedido cerrado.
- **R3:** `aplicarReembolsoMp`, sin pagos vivos, anula el pedido:
  - cerrado → `cancelled` sin tocar ítems ni stock (la comida ya salió);
  - abierto → `cancelarOrden`.
- **R4:** `CUSTOMER_CANCELLABLE_STATUSES = {pending}`.

## Fuera de alcance

Nota de crédito ARCA de un pedido facturado que MP devuelve.

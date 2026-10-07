# Tasks · 212

- [x] Tests: la devolución de MP anula el pedido (y no lo anula si queda otro pago); el cliente no cancela un pedido confirmado.
- [x] `aplicarReembolsoMp` anula; `CUSTOMER_CANCELLABLE_STATUSES = {pending}`.
- [x] Escenario «día de caja»: C43 queda anulado.
- [x] D2 (no anular lo cerrado): implementada en `e15f4b8` y revertida antes de desplegar. La 0146 no existe.
- [x] `pnpm typecheck && pnpm test` (4047).
- [ ] Deploy (sin migraciones) con OK de Juan.

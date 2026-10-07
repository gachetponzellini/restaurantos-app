# Tasks · 212

- [x] Tests rojos:
  - base (refund de un cobro de un pedido cerrado; reabrir un pedido cerrado);
  - app (anular línea y anular cobro de un pedido cerrado);
  - devolución MP anula;
  - el cliente no cancela un pedido confirmado.
- [x] 0146: triggers `cobro_cerrado_no_se_anula` (payments) y `pedido_cerrado_no_se_reabre` (orders).
- [x] App: mensajes, botones de anular ocultos en pedidos cerrados, `aplicarReembolsoMp` anula, `CUSTOMER_CANCELLABLE_STATUSES`.
- [x] Tests viejos que anulaban sobre cerradas: al comportamiento nuevo.
- [x] Escenario «día de caja»: C14 y C18 pasan a «no se puede; se corrige»; C43 queda anulado.
- [x] `pnpm typecheck && pnpm test` (4049) y verificado en vivo en local (la hoja de un cobro cerrado ofrece corregir, no anular).
- [ ] 0146 al cloud + deploy (con OK de Juan).

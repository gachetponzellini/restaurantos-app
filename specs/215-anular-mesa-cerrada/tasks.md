# Tasks · 215

- [x] Tests rojos: `puedeAnularCuentaCerrada`; `bloqueoPorPlata` ignora sandbox; `porCobrar` marca las cerradas.
- [x] R1–R3: guarda pura, sandbox en `bloqueoPorPlata`, `cancelarOrden({ desdeCerrada })`.
- [x] R4: `anularCuentaCerrada`.
- [x] R5: botón «Anular» en «Por cobrar».
- [x] `pnpm typecheck && pnpm test`: verde, integración incluida (stack local; 0147/0148 aplicadas al local para SEC-04).
- [x] Verify en vivo como Sofía (encargada, magic link) en `demo` local, mesa R11: anular cobro efectivo → Por cobrar con «Anular»; Anular con la tarjeta viva → frena «Anulá el cobro primero»; anular la tarjeta → Anular → «Mesa R11 anulada», sale de Por cobrar. Base: orden cancelled total 0, ítems cancelados, cobros refunded, sin reprint de comandas.

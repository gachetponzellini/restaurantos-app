# 210 · Tareas (v2)

Todo con TDD contra Postgres local (`pnpm test` con `.env.test`). Las migraciones van al cloud vía MCP **sólo con OK de Juan**.

- [ ] Tests de integración rojos para cada escenario del spec: mozo con plata de dos cajas, se confundieron de caja, propina neta, mozo sólo-tarjeta (saldo negativo), entrega parcial, caja con plata pendiente (`UNRENDERED_MOZOS`), mesa abierta (`OPEN_TABLE_ORDERS`), cerrar el turno (`CAJA_SIN_CONTAR`), `MOZO_YA_RINDIO` y anular entrega, vista previa, pasaje
- [ ] Migración A: `payments.efectivo_de` + trigger con `mozos_que_deben_rendir` (regla única en SQL); `businesses.caja_modelo_v2_desde`
- [ ] Migración B: `saldo_mozo()`, `efectivo_esperado_caja` v2, `caja_movimientos.kind` suma `'rendicion'`, `registrar_rendicion_tx` v2 (entrega / no entregó / anular entrega), techo y nota en la base
- [ ] Migración C: tabla `turnos` (índice único parcial del abierto) + RLS; `cerrar_turno_tx` (barre el salón, papel del turno); `cerrar_caja_tx` sin barrido, exige mesas cobradas y la plata de la caja rendida, con `retiro_cents` en el retorno
- [ ] Migración D: `corregir_pago_tx` con mozo, caja y propina + guardas; `efecto_de_correccion` (sólo lectura)
- [ ] Pasaje: activación de `caja_modelo_v2_desde` en `cerrar_turno_tx`; deudas viejas como saldo inicial
- [ ] TS: `getCierreCajaData` / stats / resumen leen SQL; borrar `expected-cash.ts` y la regla TS de `deben-rendir`; actions traducen los códigos nuevos al glosario (`textos.ts`)
- [ ] `pnpm db:types` + `pnpm typecheck && pnpm test`
- [ ] Aplicar al cloud vía MCP (con OK) y verificar con `get_advisors`
- [ ] Revisión fresca (code-reviewer) con foco en plata y carreras

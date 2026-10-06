# 210 · Tareas (v2)

**Estado 2026-10-06:** base de datos completa en local (0134–0137, 31 tests de integración nuevos, caja + billing en verde). Falta TS, el cloud y la revisión.

Todo con TDD contra Postgres local (`pnpm test` con `.env.test`). Las migraciones van al cloud vía MCP **sólo con OK de Juan**.

- [x] Tests de integración rojos para cada escenario del spec: mozo con plata de dos cajas, se confundieron de caja, propina neta, mozo sólo-tarjeta (saldo negativo), entrega parcial, caja con plata pendiente (`UNRENDERED_MOZOS`), mesa abierta (`OPEN_TABLE_ORDERS`), cerrar el turno (`CAJA_SIN_CONTAR`), `MOZO_YA_RINDIO` y anular entrega, vista previa, pasaje
- [x] Migración A (0134): `payments.efectivo_de` + trigger con `mozos_que_deben_rendir` (regla única en SQL); `businesses.caja_modelo_v2_desde`
- [x] Migración B (0135): `saldo_mozo()`, `efectivo_esperado_caja` v2, `caja_movimientos.kind` suma `'rendicion'`, `registrar_rendicion_tx` v2 (entrega / no entregó / anular entrega), techo y nota en la base
- [x] Migración C (0136): tabla `turnos` (índice único parcial del abierto) + RLS; `cerrar_turno_tx` (barre el salón, papel del turno); `cerrar_caja_tx` sin barrido, exige mesas cobradas y la plata de la caja rendida, con `retiro_cents` en el retorno
- [x] Migración D (0137): `corregir_pago_tx` con mozo, caja y propina + guardas; `efecto_de_correccion` (sólo lectura)
- [ ] ~~Pasaje por negocio~~ (reemplazado, ver abajo). Hecho en 0136 y queda obsoleto: `caja_modelo_v2_pedido` → se activa en el próximo cierre de la principal (modelo viejo: sin mesas abiertas y todos rendidos), con el primer turno abierto. Las deudas viejas no se migran: en el modelo viejo ya quedaron como faltante del arqueo que las firmó
- [ ] Migración de pasaje `0138` (R8 v2): todos al modelo nuevo, efectivo no rendido del período abierto a nombre del mozo, turno abierto por negocio, `default now()`; tests del pasaje
- [ ] TS: `getCierreCajaData` / stats / resumen leen SQL; borrar `expected-cash.ts` y la regla TS de `deben-rendir`; actions traducen los códigos nuevos al glosario (`textos.ts`)
- [ ] `pnpm db:types` + `pnpm typecheck && pnpm test`
- [ ] Aplicar al cloud vía MCP (con OK) y verificar con `get_advisors`
- [ ] Revisión fresca (code-reviewer) con foco en plata y carreras
- [ ] Deploy conjunto (migraciones + app, con OK de Juan) y, después, migración que borra el modelo viejo

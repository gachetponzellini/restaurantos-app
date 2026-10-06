# 210 · Tareas

- [ ] Test de integración rojo: `estado_cierre_caja` vs `cerrar_caja_tx` con el mismo esperado y los mismos `deben_rendir` en un escenario mixto (cobros, ingresos, sangrías, propina de tarjeta, anulado, fondo, mozo en dos cajas)
- [ ] Migración nueva: `mozos_que_deben_rendir`, `estado_cierre_caja`, `cerrar_caja_tx` usando las dos funciones + `NOTES_REQUIRED` / `DIFFERENCE_OVER_LIMIT` + `retiro_cents` en el retorno
- [ ] Tests rojos + migración: `registrar_rendicion_tx` con `NOTES_REQUIRED` / `MOZO_HAS_OPEN_TABLES`
- [ ] `getCierreCajaData`, `getCajaLiveStats` y el resumen archivado leen de SQL; borrar `expected-cash.ts`, la regla TS de `deben-rendir` y la rama muerta del admin; migrar los tests
- [ ] Traducir los códigos nuevos en `actions.ts` a mensajes del glosario (spec 209 · R8)
- [ ] Aplicar la migración al cloud vía MCP + `pnpm db:types`
- [ ] `pnpm typecheck && pnpm test` (con Supabase local arriba para la integración)
- [ ] Verificado en vivo con el rol encargado
- [ ] Revisión fresca (code-reviewer)

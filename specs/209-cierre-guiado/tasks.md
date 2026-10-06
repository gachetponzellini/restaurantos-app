# 209 · Tareas

- [ ] Test rojo `caja-admin-board`: la franja con mesas abiertas y mozos sin rendir → el botón primario dice el próximo paso; nunca hay un botón de cierre deshabilitado y mudo
- [ ] R1/R2/R9 franja «Cierre del día» + carga de `getCierreCajaData` con el board (mismo poll de 30 s) + reordenar el board + `Sangría`/`Ingreso` como secundarios
- [ ] Test rojo `cerrar-caja-modal`: paso 1 sin esperado ni diferencia → «Listo, conté» → resultado; «Volver a contar» vacía el input y acumula `recuentos`
- [ ] R3/R4 modal sólo de conteo (borrar el bloque de ventas y el form inline de rendición) + conteo ciego + `resumen.recuentos` en `cerrarCaja`
- [ ] R5 sacar el checkbox de retiro del cierre; acción «Contar sin cerrar» con el mismo flujo (`retirar: false`)
- [ ] Test rojo + R6: `EXPECTED_CHANGED` estructurado en `cerrarCaja` y pantalla de resultado que se actualiza sin recontar
- [ ] R7 redirect al resumen del cierre con el banner (papel / sin comandera / mesas liberadas); el resumen muestra los recuentos
- [ ] R8 `src/lib/caja/textos.ts` y su aplicación en board, modal, `resumen-de-cierre`, `cierres-client`; actualizar los tests que matchean texto
- [ ] `pnpm typecheck && pnpm test`
- [ ] Verificado en vivo con el rol encargado (no admin): cierre completo con una mesa abierta y un mozo sin rendir
- [ ] Revisión fresca (code-reviewer)

# 211 · Tareas

- [ ] Test rojo `rendicion-en-caja`: «Entregó $X justo» registra `delivered = expected` (por canal); «Entregó otro monto» con diferencia exige motivo; el caso sin efectivo muestra «Darle $P de propina y cerrar» o «Cerrar su turno»
- [ ] R2/R3 rediseño de `RendirModal`
- [ ] R4 links a `/admin/mesa/{id}/cobrar` en el cartel de bloqueo (el motivo devuelve ids además de labels)
- [ ] R5 página `/admin/caja/rendiciones` (historial + Imprimir, gate `canHacerCorte`); mudar la asignación caja↔usuario a `/admin/caja`; borrar el `<details>`
- [ ] Test rojo + R6: `canVerMiTurno`, una action que resuelve el mozo por sesión, la tarjeta «Tu turno» en `/mozo` con Suspense; un test que cruza el mismo monto del lado del encargado
- [ ] R7 textos desde `src/lib/caja/textos.ts`
- [ ] `pnpm typecheck && pnpm test`
- [ ] Verificado en vivo con los roles **encargado** y **mozo** reales
- [ ] Revisión fresca (code-reviewer)

# 209 · Tareas

- [x] Test rojo de la lógica pura: `proximo-paso.test.ts` (6) y `textos.test.ts` (3) → `pasosDelCierre` y `veredictoDiferencia`
- [x] R1/R2/R9: componente `cierre-del-dia.tsx`, carga de `getCierreCajaData` con el board (al activar, después de cada cambio y cada 60 s, sin reparto), board reordenado, `Sangría`/`Ingreso` como secundarios (`cierre-del-dia.test.tsx`, 8)
- [x] R3/R4: modal sólo de conteo, sin el bloque de ventas ni el form inline de rendición, conteo ciego en dos fases y `resumen.recuentos_cents` (`cerrar-caja-modal.test.tsx`, 16)
- [x] R5: sin checkbox de retiro, cerrar siempre retira. «Contar sin cerrar» descartado (ver spec)
- [x] R6: `cerrarCaja` con `expected_visto_cents` devuelve `{esperado_actual_cents, delta_cents}`; la pantalla recalcula sin recontar (integración: `caja.integration.test.ts`, +1)
- [x] R7: redirect al resumen con banner (retiro del corte, ventana de 10 min, aviso de comandera) + recuentos en el resumen y en el papel (`cierre-ticket.test.ts`, +2)
- [x] R8: `src/lib/caja/textos.ts` aplicado en board, modal, `resumen-de-cierre` y `cierres-client`
- [x] Correcciones de la revisión: billetes enteros, $0 declarable, red caída sin botón trabado, guarda de secuencia, aria-labels
- [x] `pnpm typecheck && pnpm test`: verde, 3867 tests, con la integración corriendo contra Supabase local
- [x] Verificado en vivo con el rol encargado (Sofía, `demo` local): franja con 10 mesas abiertas en la Principal; cierre de la Caja Bar con conteo por billete → Falta → Volver a contar → Cuadra → resumen con banner y recuento
- [x] Verificado en vivo — 2026-10-06, base local, encargada real: ciclo completo de dos cajas con conteo ciego, recuento (507.000 → 507.500) y cierre del turno. Detalle en #379.
- [x] Revisión fresca (code-reviewer): 10 hallazgos, sin bloqueantes de plata; aplicados los 8 que corresponden

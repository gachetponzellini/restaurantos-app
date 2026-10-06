# 211 · Tareas (v2)

Arranca cuando la 210 esté en la base (usa `saldo_mozo`, `efecto_de_correccion`, `cerrar_turno_tx`).

- [x] Test rojo de la invariante de la pantalla: con datos de fixture, los cinco números de efectivo suman lo cobrado, y el saldo de la primera fila de movimientos = "Debería haber" — `efectivo-de-la-caja.test.tsx`: los tiles reparten lo que cada mozo tuvo en la mano (0143 review).
- [x] R1: reordenar `caja-admin-board.tsx` (cobrado por método → efectivo → cajón → movimientos); barra apilada y tabla por mozo
- [x] Test rojo + R2: panel de rendición (entregó justo / otro monto / no entregó / saldo negativo → "Darle $X del cajón"); borrar `RendicionEnCaja` como tarjeta y su `<details>` — `rendir-mozo-modal.test.tsx`; el server rechaza confirmar sobre un saldo viejo (`esperadoCents`).
- [x] R5: extraer `DetalleSheet` → `detalle-movimiento-sheet.tsx` (lo usan el libro y la caja); campos mozo/caja/propina con la aclaración completa; vista previa con `efecto_de_correccion`; test del bloqueo «(ya rindió)»
- [x] R4: tabla de movimientos con saldo corrido, filtros, botón Editar / Ver detalle y marcas Corregido/Anulado — `saldo-corrido.ts` (misma regla que `efectivo_esperado_caja`, hacia atrás desde «Debería haber»); filtros Todo / Mueven el cajón / Cobros / Sangrías e ingresos / Rendiciones. Verificado en build de producción local: la línea más vieja deja fondo + su efecto.
- [x] R6: franja «Cierre del turno» (paso ③ por caja) + «Cerrar el turno» — `cierre-del-turno.test.tsx`.
- [x] R7: `canVerMiTurno` + tarjeta «Tu turno» en `/mozo` (Suspense); test que cruza el mismo número con el del encargado — `tu-turno-card.test.tsx`; se refresca al volver y cada 2 min.
- [x] R3: términos nuevos en `textos.ts`
- [x] `pnpm typecheck && pnpm test` — 4027 tests verdes (2026-10-06).
- [x] Verificado en vivo con los roles **encargado** y **mozo** reales, con dos cajas — local 2026-10-06: Pedro (mozo) ve su turno por caja; Sofía (encargada) ve tiles, cajón y rendición que cuadran. Escrituras cubiertas por los tests de integración, sin tocar el estado del demo.
- [x] Revisión fresca (code-reviewer) — 12 hallazgos; arreglados en 9d4e9b4 (0143) salvo #6 (no aplica: cerrar siempre retira) y #11 (perf de getMiTurno, anotado).

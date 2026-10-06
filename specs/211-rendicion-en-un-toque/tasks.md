# 211 · Tareas (v2)

Arranca cuando la 210 esté en la base (usa `saldo_mozo`, `efecto_de_correccion`, `cerrar_turno_tx`).

- [ ] Test rojo de la invariante de la pantalla: con datos de fixture, los cinco números de efectivo suman lo cobrado, y el saldo de la primera fila de movimientos = "Debería haber"
- [ ] R1: reordenar `caja-admin-board.tsx` (cobrado por método → efectivo → cajón → movimientos); barra apilada y tabla por mozo
- [ ] Test rojo + R2: panel de rendición (entregó justo / otro monto / no entregó / saldo negativo → "Darle $X del cajón"); borrar `RendicionEnCaja` como tarjeta y su `<details>`
- [ ] R5: extraer `DetalleSheet` → `detalle-movimiento-sheet.tsx` (lo usan el libro y la caja); campos mozo/caja/propina con la aclaración completa; vista previa con `efecto_de_correccion`; test del bloqueo «(ya rindió)»
- [ ] R4: tabla de movimientos con saldo corrido, filtros, botón Editar / Ver detalle y marcas Corregido/Anulado
- [ ] R6: franja «Cierre del turno» (paso ③ por caja) + «Cerrar el turno»
- [ ] R7: `canVerMiTurno` + tarjeta «Tu turno» en `/mozo` (Suspense); test que cruza el mismo número con el del encargado
- [ ] R3: términos nuevos en `textos.ts`
- [ ] `pnpm typecheck && pnpm test`
- [ ] Verificado en vivo con los roles **encargado** y **mozo** reales, con dos cajas
- [ ] Revisión fresca (code-reviewer)

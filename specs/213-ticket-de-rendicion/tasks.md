# Tasks · 213

- [x] Ticket `liquidacion-ticket.ts` + tests: la cuenta, sin firmas, sin acentos, con y sin cobros, saldo negativo, mesas sin cobrar, 42 columnas.
- [x] 0146: `print_jobs` admite `liquidacion` (mozo, caja, huella, payload).
- [x] `imprimirLiquidacion` + test de integración: primera vez sí, mismo saldo no, «Reimprimir» fuerza, saldo nuevo sale solo, el mozo no puede.
- [x] El agente de impresión la saca por la impresora del cierre.
- [x] Modal: imprime al abrir y tiene «Reimprimir» con «con el detalle de cobros».
- [x] El papel viejo de una entrega no imprime «TOTAL 0,00».
- [x] Pedido de Juan en el medio:
  - el cierre del turno sin botón arriba para cobrar y rendir;
  - los botones de cada fila con el estilo principal;
  - cobrar una mesa desde el cierre vuelve al cierre (`?volver=`).
- [x] `pnpm typecheck && pnpm test` (4062).
- [x] 0146 al cloud + deploy (OK de Juan, 2026-10-07; `741b55b`). Pendiente: verificar con la comandera real del golf.

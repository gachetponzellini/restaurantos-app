# Tasks · 216

- [x] R1: libro con cajas y rendiciones en la primera ronda.
- [x] R2: stats (route, getCajaLiveStats, getCajaStatsEnVentana, getPaymentsPeriodoActual) en paralelo.
- [x] R3: aviso «Abriendo el movimiento…».
- [x] `pnpm typecheck && pnpm test`: typecheck verde, unitarios verdes (los `*.integration` no corren: stack local apagado; cubren libro y stats).
- [ ] Verify en vivo: tiempos de /api/caja/stats y de «editar» antes/después en los logs del edge de Supabase.

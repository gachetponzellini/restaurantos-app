# Spec 215 · Anular una mesa que ya se cerró

**Estado:** aprobada por Juan (2026-10-08), a partir del caso de la mesa 14 de KCC. Issue #388.

## Problema

Mesa 14 de KCC (2026-10-08): el cliente pidió Factura A, que todavía no sale desde el sistema. La
encargada la cobró en MaxiRest y, para sacarla del nuestro, **anuló el cobro**. La orden quedó cerrada
con $0 pagado → aparece en «Por cobrar» como «Cerrada con saldo» y la única salida es **Cobrar**.

- «Anular mesa» (`anularMesa`) sólo actúa sobre una mesa ocupada; la 14 ya estaba libre → «La mesa no
  está en un estado anulable».
- `cancelarOrden` sólo cancela órdenes `open`.
- Una cuenta cerrada con saldo además **traba el «Rendir»** del mozo atribuido (`mesas-sin-cobrar.ts`).

Hubo que cancelarla a mano en la base.

## Decisiones

- **D1:** el camino es el que ya existe para una mesa abierta (spec 092): **primero se deshace la plata,
  después se anula la mesa.** No se agrega un concepto nuevo: «Anular mesa» pasa a servir también para
  una cuenta **cerrada sin cobros vivos**.
- **D2:** se ofrece en la fila de «Por cobrar» de una cuenta cerrada con saldo, al lado de «Cobrar».
  Motivo obligatorio. Sólo encargado o admin.
- **D3:** si la cuenta todavía tiene cobros vivos, no se anula: el mensaje de hoy («Anulá el cobro
  primero…»). La anulación de cobros sigue en el libro de caja (no cambia).
- **D4:** **una factura de sandbox no frena** (no es fiscal: en KCC todas lo son hasta que ARCA esté
  activo). Al anular, la factura de sandbox de esa orden queda `cancelled`. Una factura real
  (`authorized` o `pending` de otro provider) sigue frenando hasta emitir la nota de crédito.
- **D5:** las comandas que sigan activas se cancelan **sin** pedir ticket «ANULADA»: la mesa terminó hace
  rato y el papel en cocina confunde. (Una comanda que nunca se imprimió sigue en la cola del agente y
  sale como «ANULADA»: es rara en una mesa cerrada y se acepta.)
- **D6:** la cascada es la de siempre (`cancelDownstream`): el stock de lo ya entregado no vuelve y el
  cupón de promo, si lo hubo, se devuelve.

## Requisitos

- **R1:** `puedeAnularCuentaCerrada(order)`: pura. Sí si `lifecycle_status='closed'` y
  `status<>'cancelled'`; si no, el motivo.
- **R2:** `bloqueoPorPlata` ignora las facturas `provider='sandbox'`. Afecta también a «Anular mesa»
  sobre una mesa abierta (mismo criterio: sandbox no es fiscal).
- **R3:** `cancelarOrden` acepta `{ desdeCerrada: true }`: cancela una orden `open` o `closed` y no pide
  reimpresión de las comandas.
- **R4:** server action `anularCuentaCerrada({ orderId, motivo, slug })`: negocio + rol (encargado/admin) →
  orden del negocio → R1 → motivo → R2 → recalcula lo pagado → R3 → revalida operación.
- **R4b:** `cancelDownstream` deja `cancelled` la factura de sandbox de la orden, para todos los caminos de
  anulación (R2 la deja pasar en «Anular mesa» también).
- **R5:** UI: botón «Anular» en las filas cerradas de «Por cobrar» (`cierre-del-turno.tsx`), con
  confirmación y motivo. Al anular, la fila desaparece (y con ella el bloqueo de «Rendir»).

## Fuera de alcance

- Emitir la Factura A de verdad (depende de ARCA).
- Anular cobros y mesa en un solo paso.
- Nota de crédito automática para facturas reales.

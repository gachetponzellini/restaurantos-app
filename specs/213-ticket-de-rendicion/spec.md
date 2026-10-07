# Spec 213 · El ticket de rendición sale al tocar «Rendir»

**Estado:** aprobada por Juan (2026-10-07).

## Problema

Hoy el papel de la rendición sólo sale a mano, desde «Historial y asignaciones», después de rendir. Y
está armado para el modelo viejo de caja: en la caja v2 imprime «COBRADO EN EL TURNO · TOTAL $ 0» y no
muestra la cuenta del mozo (su propina de tarjeta, lo que traía, lo que ya entregó).

## Decisiones de Juan

- **D1:** se imprime **al tocar «Rendir»** (cuando se abre la rendición del mozo), no al confirmarla. Es
  la liquidación: lo que el mozo tiene que entregar.
- **D2:** se imprime **sola la primera vez**. Si se vuelve a abrir con el mismo saldo, no imprime; hay un
  botón **«Reimprimir»**. Si el saldo cambió (cobró otra mesa, entregó una parte), es una liquidación
  nueva y sale sola de nuevo.
- **D3:** por defecto **sin el detalle de cada cobro**. Al reimprimir se elige con o sin cobros.
- **D4:** **sin firmas** (queda la línea «Entregó: $ ____» para anotar a mano).
- **D5:** **sin acentos** (como todos los tickets: la comandera imprime símbolos raros).

## El ticket (42 columnas, condensado)

```
            RENDICION DE MOZO
             Restaurante Demo
------------------------------------------
Mozo:                         Pedro Mozo
Caja:                     Caja Principal
Turno desde:                 07/10 09:15
Impreso:          07/10 23:40 Sofia Enc.
------------------------------------------
[SUS COBROS EN EFECTIVO …]   ← sólo al reimprimir con cobros
LA CUENTA
Traia de antes                       $ 0
Cobro en efectivo              $ 177.800
- Su propina de tarjeta/QR      - $ 2.200
- Ya entrego                         $ 0
+ La caja le pago de propina         $ 0
==========================================
TIENE QUE ENTREGAR             $ 175.600
==========================================
No se rinden (posnet/MP):
Tarjeta                         $ 43.000

Entrego:            $ ___________________
```

Variantes:
- Saldo negativo: «LA CAJA LE DEBE $ X DE PROPINA» y «Recibio: $ ____».
- Con mesas sin cobrar: arriba, «OJO: tiene la mesa 4 sin cobrar».

## Requisitos

- **R1:** `print_jobs` admite `kind = 'liquidacion'` con `mozo_id`, `caja_id`, `huella` y `payload` (la
  foto de los números al imprimir).
- **R2:** `imprimirLiquidacion({ mozoId, cajaId, conCobros, forzar })`, del encargado o admin. Sin
  `forzar` no imprime si ya hay una liquidación con la misma huella.
- **R3:** el agente de impresión la saca por la impresora del cierre.
- **R4:** el modal de rendición la pide al abrirse y ofrece «Reimprimir» con el tilde «con el detalle de
  cobros».
- **R5:** el papel viejo de una entrega (historial) no imprime «TOTAL $ 0» cuando no hay detalle por
  método.

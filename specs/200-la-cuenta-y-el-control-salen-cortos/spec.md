# 200 · La cuenta y el control salen cortos

**Issue:** [#326](https://github.com/gachetponzellini/RestaurantOS-app/issues/326) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-16)

**Depende de**: `063` (control de pedido), `080` (cuenta de mesa).

---

## Por qué

**Input — KCC, 2026-09-16:** «está saliendo muy largo el ticket» del control.
Un retiro de mostrador con 2 ítems (#15, retiro #2) salía de **23 renglones**, casi
todos a doble alto. Juan mandó además la foto de una cuenta (Mesa 1, 7 ítems): cada
ítem en dos renglones y todo el texto en los 2/3 izquierdos del rollo.

La causa del ancho: `ticket.ts` asume comandera de **58 mm** (24 col). La de
cuenta/control de golf y kcc es de **80 mm** (confirmado por Juan).

## Qué cambia

| # | Cambio | Cuenta | Control |
|---|---|---|---|
| 1 | Importe en el mismo renglón del ítem (`itemConImporte`) | ✔ | ✔ |
| 2 | No imprime `Cliente: Mostrador` ni `Tel: -` | — | ✔ |
| 3 | Subtotal sólo si hay envío/descuento/propina en el medio | ✔ | ✔ |
| 4 | `PAGADO NO COBRAR` en un renglón | — | ✔ |
| 5 | En **retiro**, cabecera / emitido / pie a cuerpo normal (delivery no cambia) | — | ✔ |
| 6 | Ancho 80 mm: `COLS_80` = 36 col (xl 17), `RULE_80` | ✔ | ✔ |
| — | Leyendas pie en un renglón; lista de la cuenta con `COMPACT_SPACING` | ✔ | ✔ |

Resultado: el control del retiro #2 pasa de 23 a **15** renglones; la cuenta de la
foto, de ~27 a 19 y más bajos.

## Fuera

- **Comanda de cocina**: sus bytes están congelados contra el agente (paridad) y
  sale por otras comanderas.
- **Cierre de caja**: sigue en Font B 42 col, calcado de MaxiRest.

## Verificación

Tests en `control-ticket.test.ts` / `cuenta-ticket.test.ts` (bloque «spec 200»).
Pendiente en vivo: ver el papel en la comandera de kcc (192.168.10.210).

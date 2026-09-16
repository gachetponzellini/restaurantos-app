# 201 · La cuenta impresa muestra la división

**Issue:** [#327](https://github.com/gachetponzellini/RestaurantOS-app/issues/327) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-16)

**Depende de**: `080` (cuenta de mesa), `200` (formato 80mm), división de cuenta
(`dividir-modal.tsx`, `order_splits`).

## Por qué

KCC (2026-09-16): cuando se divide la cuenta, el papel que va a la mesa sólo decía
el TOTAL. **Juan:** «que salga un solo papel con todo, lo del redondeo manejalo vos».

## Qué

Después del TOTAL, si la mesa tiene sub-cuentas vivas:

```
------------------------------------
        CUENTA DIVIDIDA EN 3
Parte 1 - Juan              13766.68
- 1x Omelette                          (sólo por_items / por_comensal)
Parte 2                       PAGADO
Parte 3               resta 10000.00
Sin asignar:                 2000.00   (sólo si las partes no suman el total)
```

- Orden por `split_index`; las `cancelled` no salen.
- `paid` o saldo 0 → `PAGADO`; pago parcial → `resta X`.

### Redondeo (D1)

No se recalcula en el papel: la división ya lo resuelve al crearse
(`prorrateEqualSplits`, el resto de centavos va a la parte 1) y se imprime lo
guardado, que es lo que se cobra. Si se cargaron ítems **después** de dividir, las
partes no suman el total: eso sale como **«Sin asignar»**, a la vista, en vez de
repartirlo por nuestra cuenta en el papel (y que no coincida con lo que cobra la caja).

## Verificación

`cuenta-ticket.test.ts` bloque «spec 201». El endpoint del agente
(`api/print-agent/route.ts`) trae `order_splits` + `order_split_items`.
Pendiente en vivo en kcc.

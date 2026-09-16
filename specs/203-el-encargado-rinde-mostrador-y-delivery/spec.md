# 203 · El encargado rinde takeaway y delivery, por separado

**Issue:** [#331](https://github.com/gachetponzellini/RestaurantOS-app/issues/331) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-16)

**Depende de**: 139 (rendición obligatoria antes del cierre), 140 · D5 (atribución por
mesa), 151 (sólo se rinde el efectivo), 177 (propina en la rendición), #264 (el encargado
no rinde — **se revierte en parte**), #330 (otros cobros informativos).

## Por qué

Juan (2026-09-16): *"habría que agregar que el encargado tenga que rendir la plata
cobrada para takeaway y para delivery por separado, eso se le asignaría al encargado
que está trabajando, es decir al que maneja la compu en ese turno"*. Confirmado: **es el
que esté logueado**, y aplica a **los dos locales** (golf-jcr y kcc).

Hoy lo que no tiene mesa cae en `loaded_by` (el último que cargó un ítem), y el
encargado está excluido de «deben rendir» (#264): el efectivo de mostrador y delivery
se da por puesto en el cajón y **no lo rinde nadie**. En golf-jcr, además, los delivery
del último mes quedaron con `attributed_mozo_id` NULL.

## Qué

### D1 · Atribución: lo que no tiene mesa es de quien cobra

`elegirMozoAtribuido`: si la orden **tiene mesa**, nada cambia (mozo de la mesa, y si
no hay, el que cargó). Si **no tiene mesa** (takeaway, mostrador, delivery), el cobro es
del **usuario logueado que lo registra** (`operated_by`); sólo si no hay usuario cae en
`loaded_by`.

### D2 · Canal del cobro

- `salon` — la orden tiene mesa.
- `delivery` — sin mesa y `delivery_type = 'delivery'`.
- `takeaway` — sin mesa y cualquier otro tipo (`pickup`, o `dine_in` de mostrador).

### D3 · Qué rinde cada uno

- **Mozo** (y cualquier rol que no maneje caja): todo lo que se le atribuyó, como hoy.
- **Encargado / admin**: **sólo takeaway y delivery**. Lo que cobró en el salón sigue
  entrando derecho al cajón (#264 sigue valiendo para eso).
- El encargado **vuelve a aparecer en «deben rendir»** si tiene cobros de takeaway o
  delivery, **aunque esté asignado como operador de la caja** (la excepción D3 de la
  spec 139 sigue valiendo sólo para el salón).

### D4 · Se rinde por canal

La pendiente trae el desglose `por_canal` (efectivo, cobros y métodos de cada canal).
El modal de rendición pide **un monto entregado por cada canal con efectivo**, con su
diferencia. La fila guarda `por_canal` (jsonb: esperado / entregado / diferencia por
canal) y en las columnas de siempre el **total**, así el reparto del arqueo, el cierre y
el historial no cambian. Diferencia en cualquier canal → motivo obligatorio.

El ticket de rendición (spec 178) imprime el efectivo por canal cuando hay más de uno o
cuando no es salón.

### Fuera de alcance

- Repartidor como rol propio: el efectivo del delivery lo rinde quien registró el cobro.
- Reatribuir cobros ya hechos: la regla aplica a cobros nuevos.

## Tareas

- [x] Migración: `mozo_rendiciones.por_canal jsonb not null default '{}'`.
- [x] D1 `elegirMozoAtribuido` + test.
- [x] D2/D3 `getRendicionPendienteMozo`: canal por pago, filtro para encargado/admin, `por_canal`.
- [x] D3 `mozosQueDebenRendir` + test.
- [x] D4 `registrarRendicionMozo` con entregado por canal + UI del modal + test.
- [x] Ticket con efectivo por canal.
- [x] typecheck + tests; verify en vivo como Sofía.

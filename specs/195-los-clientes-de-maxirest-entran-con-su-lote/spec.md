# 195 · Los clientes de MaxiRest entran con su lote

Issue [#320](https://github.com/gachetponzellini/RestaurantOS-app/issues/320).
Hermano de la [152](../152-importar-los-receptores-de-maxirest/spec.md), que
importó los **receptores de factura** del mismo dump; esto importa a los
**clientes de delivery**.

## El problema

KCC factura el 40% por delivery y su agenda entera está en MaxiRest: 782 filas
en `mxcli` (backup del 2026-07-20). En `kcc` había 6 clientes y 13 pedidos, todos
de prueba. Para el delivery hacen falta dos datos: **el teléfono** y **el número
de lote** (spec 194 — en kcc la dirección es el lote).

Ninguno de los dos está donde uno los buscaría.

## Dónde estaba el lote

MaxiRest nunca tuvo un campo para el lote, así que quedó escrito de tres formas:

| Forma | Ejemplo | Cuántos |
|---|---|---|
| `altura` numérica | `LOS PINOS` / `43` → lote 43 | 144 |
| `calle` con el texto | `LOTE 354` | 4 |
| el `codigo` del cliente | alta vieja sin altura | el resto |

Los primeros ~700 clientes se cargaron **en orden de lote**, por eso el `codigo`
coincide con la `altura` en 500 filas. Que el código **no** sea la regla lo
prueban las altas nuevas: el cliente `707` vive en `LOS RHUS 420` — manda la
altura. La calle del barrio (Los Tilos, Las Tipas, Lapachos…) es referencia del
repartidor, no la dirección.

## Qué entra y qué no

**Sin teléfono no hay cliente.** `customers` se identifica por
`UNIQUE (business_id, phone)`: una fila sin número no tiene dónde vivir, y un
placeholder ensucia la base para siempre.

| | |
|---|---|
| Filas en `mxcli` | 782 |
| **Importables (con teléfono real)** | **152** |
| … con lote resuelto | 152 (100%) |
| … marcados para revisar | 1 (teléfono de 11 dígitos) |
| Descartados | 630 — 620 sin teléfono, 9 con un interno del barrio (`4938031`), 1 teléfono repetido |
| Con e-mail | 0 |

Los 620 sin teléfono quedan en el backup: se cargan el día que aparezcan sus
números, no antes.

## Cómo queda cada uno

- `customers`: `phone` digits-only (celular antes que fijo — es el que contesta
  y el que tiene WhatsApp), `name` limpio (MaxiRest repite el apellido en los dos
  campos y usa `xxxx` de relleno).
- `customer_addresses`: `street = "Lote 43"`, `label` = la calle del barrio. El
  formato coincide con lo que escribe el checkout de la spec 194, así que
  `lugarDeEntrega()` no duplica el prefijo.

## Dónde vive

| Archivo | Qué hace |
|---|---|
| `src/lib/customers/maxirest-import.ts` | El mapeo puro y testeado: `telefonoDeCliente`, `loteDeCliente`, `nombreDeCliente`, `planificarImportClientes`. |
| `scripts/import-maxirest-customers.ts` | Lee el JSON, imprime el reporte, escribe el CSV y —sólo con `--apply`— la base. |
| `scripts/extract-maxirest-clientes.mjs` | Ya existía (spec 152): saca `mxcli` del dump de 483 MB. |

```bash
node scripts/extract-maxirest-clientes.mjs <dump.sql> kcc-mxcli.json
npx tsx scripts/import-maxirest-customers.ts --slug kcc --json kcc-mxcli.json --csv control.csv
npx tsx scripts/import-maxirest-customers.ts --slug kcc --json kcc-mxcli.json --apply
```

## El CSV va primero

Lo que sale de acá es **el lote al que va a ir el repartidor**: si está mal, toca
el timbre equivocado. Por eso el script es dry-run por defecto y emite un CSV
(`codigo_maxirest, nombre, telefono, lote, calle, de_donde_sale_el_lote,
revisar`) para que el local confirme antes de escribir nada.

Un re-import no pisa lo editado a mano: el cliente se busca por
`(business_id, phone)`, sólo se completan campos vacíos, y la dirección se salta
si ya existe una con el mismo `street`.

## Estado

✅ **Corrido el 2026-09-15 contra la nube** (`--env .env.cloud --apply`): 152
clientes nuevos y 152 lotes. `kcc` quedó con 158 clientes (los 6 de prueba
seguían ahí) y 155 direcciones, ningún cliente sin nombre y ningún teléfono
repetido.

Se corrió sin esperar la validación del local. Lo que queda por mirar con ellos,
con el CSV en la mano:

- el lote de los que salieron del `codigo` — la regla más débil de las tres;
- la única fila marcada `revisar` (un teléfono de 11 dígitos).

Se corrige re-corriendo el script con el dato arreglado: busca por
`(business_id, phone)` y no duplica.

**Ojo con el `.env`:** `.env.local` apunta al stack local, donde `kcc` no existe.
El import a la nube va con `--env .env.cloud`.

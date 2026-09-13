# 181 · El control sale por la terminal que lo mandó

**Issue:** [#293](https://github.com/gachetponzellini/RestaurantOS-app/issues/293) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ **piezas 1–4 implementadas y verificadas en vivo** (2026-09-13,
migración `0106` en cloud y local). **Pieza 5 (el spooler) escrita y sin probar
en el fierro** — ver [Verificación](#verificación).

**Input:** KCC, reunión del 2026-09-09: *"faltaría configurar bien las
comanderas de control de las compus que no están donde está el print agent,
están conectadas por USB"*. Relevamiento de Juan (2026-09-13): son **dos
terminales** —la compu que usan los mozos para comandar, no cajas—, cada una
con **una comandera por USB que imprime sólo el control**, y **no están en la
misma red** que la compu del print-agent. Decisión: **un login de terminal por
compu**.

**Depende de**: [`140`](../140-los-mozos-en-la-compu-del-salon/spec.md) (el rol
`terminal`: el puesto compartido del salón), [`124`](../124-print-agents-por-alcance/spec.md)
(varios agentes por negocio, cada uno con su alcance),
[`046`](../046-print-agent-autoinstalador/spec.md) (el instalador por agente),
[`063`](../063-comanda-de-control-delivery/spec.md) (el control y su comandera
por negocio). **La habilita**: [`#3` de KCC](../../../../wiki/log.md) (F3 =
comandas + control de mesa), que es el primer trabajo que va a llegar por acá.

---

## Por qué

Todo el circuito de impresión razona por IP. Cada trabajo viaja con su
`printer_ip` ya resuelto, el alcance de cada agente es una lista de IPs o
rangos, y el agente abre un socket TCP 9100 y manda ESC/POS
([`agent.mjs`](../../print-agent/agent.mjs), [`agent-scope.ts`](../../src/lib/print/agent-scope.ts)).

Una impresora USB no tiene IP. Y sin red compartida, un print server tampoco
sirve: el agente de cocina no lo alcanzaría. Lo que hay hoy para USB es el modo
`windows` del agente, que es **de prueba**: manda texto plano —sin negritas ni
doble alto— a **una** impresora fija, ignorando el destino de cada papel.

Y hay un problema anterior al transporte: **el control es uno por negocio**
(`businesses.control_printer_ip`, spec 063 · D3). El sistema no sabe desde qué
compu se mandó un pedido, así que aunque la USB tuviera IP, no tendría cómo
elegir *cuál*.

## Lo que ya está construido

- **El puesto.** Spec 140 creó `terminal`: una cuenta por compu del salón, que
  opera mesas y comandas. Con un login por compu, **la sesión identifica la
  compu**. No hay que inventar nada.
- **Varios agentes por negocio**, cada uno con su key y su alcance (124), y el
  instalador que baja cada uno con su key (046). Poner un agente en cada
  terminal es una instalación más, no una feature.
- **`print_jobs.requested_by`** existe desde la 0034: «quién pidió el papel».
  Null en los que emite el sistema.
- **El pull, el acuse, la reimpresión y el fallo** son por trabajo y no saben
  de transporte.

---

## Decisiones

### D1 · El puesto es la terminal, y hay una por compu

`Terminal 1` y `Terminal 2`, cada una con su login. Es lo que hace que «la compu
que mandó el pedido» sea un dato y no una adivinanza. De paso resuelve lo que la
spec 170 anotó como riesgo: *«el audit log dice `terminal`, no quién»* — ahora
dice al menos **cuál compu**.

Se descartó la preferencia por navegador (como `use-caja-preferida`): funciona,
pero es un paso de configuración más en cada compu y el rastro no distingue.

### D2 · La impresora de control vive en el usuario terminal

`business_users.control_printer_ip` + `control_printer_port`, el mismo par que
`businesses`. `null` = la del negocio. Se configura en Usuarios, sólo para el
rol `terminal`: para una persona no significa nada.

### D3 · Un destino puede ser local

`local:NOMBRE` —el nombre de la impresora en Windows— es un destino válido en
cualquier campo que hoy acepta IP. Dos reglas lo sostienen:

- **`isValidPrinterHost` lo acepta**: esquema `local:` + nombre sin `\`, `/` ni
  control chars. No pasa por la allowlist RFC1918 porque nunca abre un socket:
  es un nombre para el spooler de la compu donde corre el agente.
- **`alcanzaLaImpresora`: un `local:` sólo lo alcanza el agente que lo lista
  textual en su alcance.** Hoy un host que no es IPv4 se sirve *a todos* (124:
  «no hay forma de saber en qué subred vive un nombre»). Con `local:` esa
  regla sería un bug: el agente de cocina recibiría el control de la Terminal
  2, no podría imprimirlo, reportaría `failed` y marcaría fallido un papel que
  la terminal sacó perfecto — el mismo bug que la 124 vino a cerrar.

Consecuencia: el agente de cocina, con alcance `192.168.10.0/24`, **no se
entera** de que existen destinos locales. El `.exe` instalado no se toca.

### D4 · El control se resuelve por quien lo pidió

Al armar los papeles de control, cada trabajo mira su `requested_by`:

| `requested_by` | Destino |
|---|---|
| un usuario `terminal` con impresora configurada | la suya |
| cualquier otro usuario, o un terminal sin impresora | la del negocio |
| null (cron de programados, webhook de MP) | la del negocio |

El «sin comandera de control configurada → `[]`» de hoy deja de ser un
cortocircuito a nivel negocio: un negocio puede no tener control central y sí
tener dos terminales con la suya.

Esto todavía no lo usa nadie: el control se emite sólo para delivery/pickup y
sin `requested_by`. **El F3 (#3 de KCC) es el primer camino que va a emitir un
control con `requested_by` = la terminal.** Esta spec deja la plomería; la otra
decide qué dice el papel.

### D5 · El agente manda ESC/POS crudo por el spooler

Cuando el destino es `local:`, el agente escribe los **bytes ESC/POS** al
spooler de Windows con datatype `RAW` (`OpenPrinter` / `WritePrinter`, vía
PowerShell como ya hace `Out-Printer`). Es cómo se imprime en una térmica USB
sin driver propietario: driver «Genérico / Solo texto» y bytes crudos. El modo
`windows` viejo (texto plano, una impresora fija) queda como estaba, para
pruebas.

⚠️ **No se puede probar desde acá.** Los bytes son los mismos que van por red
(el armado está testeado); lo que no está probado es el tramo spooler → USB en
la compu real. Primera prueba: por TeamViewer, con la térmica enchufada y el
driver genérico instalado. Dos cosas que ahí se rompen seguido: el driver
equivocado (uno propietario «interpreta» los bytes) y un puerto USB que cambia
de nombre al reconectar.

### D6 · Sólo el control

Relevamiento: por la USB sale sólo el control. Las cuentas siguen por salón, la
factura por caja, el cierre por la comandera del cierre. Nada de eso cambia.

---

## Lo que queda instalado en KCC

| Compu | Cuenta | Agente | Alcance | Imprime |
|---|---|---|---|---|
| Cocina (LAN de las comanderas) | — | el de hoy, **sin tocar** | `192.168.10.0/24` | comandas, cuentas, factura, cierre |
| Terminal 1 | `terminal1@kcc` | nuevo | `local:CONTROL-T1` | el control de lo mandado desde ahí |
| Terminal 2 | `terminal2@kcc` | nuevo | `local:CONTROL-T2` | ídem |

Cada compu necesita internet para llegar a Vercel. No necesita ver a las otras.

## Qué se construye

1. **Migración `0106`**: `business_users.control_printer_ip / _port`.
2. **`isValidPrinterHost`** acepta `local:`; **`alcanzaLaImpresora`** y
   **`normalizarScope`** lo entienden. Tests.
3. **`buildPrintableControlTickets`** resuelve por `requested_by` (D4). Test.
4. **Usuarios**: el campo, sólo para `terminal`.
5. **Agente**: `local:` → `printWindowsRaw`. Marcado «sin probar en el fierro».

## Archivos

| Archivo | Qué |
|---|---|
| `supabase/migrations/0106_el_control_sale_por_la_terminal.sql` | esquema |
| `src/lib/catalog/schemas.ts` (+ test) | `local:` válido |
| `src/lib/print/agent-scope.ts` (+ test) | alcance por nombre |
| `src/app/api/print-agent/route.ts` (+ test) | D4 |
| `src/components/admin/users/*`, `src/lib/admin/*` | el campo |
| `print-agent/agent.mjs` | D5 |

## Verificación

**Lo que sí.** 2822 tests: `local:` como host válido (y lo que lo rompe), el
alcance por nombre en sus cuatro casos (sólo el que lo lista; cocina no lo
recibe; sin alcance no es «todas las USB»; la terminal no recibe la LAN), y D4
en seis (terminal con impresora, sistema, terminal sin, negocio sin control
central, agente de cocina no lo ve, una persona no es un puesto).

En vivo, stack local: como **admin**, en Usuarios la fila de `Terminal Salón`
muestra el campo «Comandera de control de esta terminal»; se guardó
`local:CONTROL-T1`. Con un control pedido por esa terminal y dos agentes
—`Terminal 1` con alcance `local:CONTROL-T1` y `Cocina` con
`192.168.10.0/24`—: el GET le sirve el control **sólo al de la terminal**, con
`printer_ip = local:CONTROL-T1`; el de cocina no lo ve. Y el **agente real**
(`agent.mjs --once --dry-run`, con la key de la terminal) lo levanta y lo
renderiza entero.

**Lo que NO.** `printWindowsRaw` — el tramo spooler → USB — no se puede probar
desde acá (macOS, sin térmica). Está escrito con el helper clásico de RAW
printing vía `Add-Type` para no sumar módulos nativos al `.exe`. Primera
prueba: por TeamViewer en la terminal de KCC, con la térmica enchufada y el
driver «Genérico / Solo texto». El `.exe` de cocina no cambia.

**Lo que falta para que salga papel.** Nadie emite todavía un control con
`requested_by` = terminal: eso es el F3 (#3 de KCC), que sigue esperando qué
dice el papel. Esta spec deja la plomería lista.

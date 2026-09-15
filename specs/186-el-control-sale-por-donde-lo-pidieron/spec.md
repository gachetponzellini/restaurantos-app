# 186 · El control sale por donde lo pidieron

**Issue:** [#310](https://github.com/gachetponzellini/RestaurantOS-app/issues/310) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ **implementada y verificada en vivo** (2026-09-15). Sin migración:
la columna ya existía desde la `0106`.

**Input:** Juan, 2026-09-15: *"¿qué debería hacer para hacerlo desde la segunda
caja, que sería un encargado, para imprimir ahí los tickets de control?"*. Con
dos definiciones suyas: el papel que quiere en esa caja es **el control de mesa
(el F3)**, y la caja la atiende **la encargada con su cuenta personal**.

**Depende de**: [`181`](../181-el-control-sale-por-la-terminal/spec.md) (el
campo, el destino `local:` y la resolución por `requested_by`),
[`063`](../../../../wiki/specs/) (el control de delivery/pickup),
[`124`](../124-print-agents-por-alcance/spec.md) (un agente por PC, por alcance).
**La habilita**: el F3 (#3 de KCC), que es quien va a emitir el papel.

---

## Por qué

La 181 ató la comandera de control al rol `terminal`, y lo dejó escrito en el
resolver como una regla, no como un detalle:

```ts
// Sólo el rol `terminal`: es un puesto, no una persona — la impresora
// configurada en un encargado no significa nada.
if (u.role === "terminal" && ip) { … }
```

El argumento era bueno: una impresora es de un lugar físico, y una persona
camina. Pero en KCC la segunda caja **es** una persona fija en un lugar fijo, y
Juan eligió que entre con su cuenta. Con la regla actual, esa caja no tiene forma
de tener papel propio: el control le saldría por la impresora del negocio, en la
otra punta.

## Lo que ya está construido

- `business_users.control_printer_ip` / `control_printer_port` (migración
  `0106`): la columna **ya existe para cualquier miembro**; lo que la limita al
  rol `terminal` es la validación de `updateTerminalPrinter` y el `if` del
  resolver.
- `local:NOMBRE` como destino, servido **sólo** al agente que lo declara en su
  alcance (`alcanzaLaImpresora`), y `printWindowsRaw` mandándolo al spooler de
  esa PC.
- La resolución por `requested_by` con fallback a la del negocio, ya con tests.

O sea: de las cinco piezas de la 181, esta spec toca una condición y una
validación. Lo demás ya funciona.

## Decisiones

### D1 · La impresora de control es de quien puede emitir un control

Admin, encargado y terminal pueden tener la suya. Vacío —que es el caso de casi
todos— sigue significando «la del negocio».

**Lo que se acepta al cambiar la regla:** el papel sigue a la **cuenta**, no a la
compu. Si esa encargada confirma algo desde el teléfono en la cocina, el papel
igual sale en la caja 2. Para el caso de KCC eso es lo que se quiere (es su
puesto y es siempre ella); para un local donde el encargado rota, el campo se
deja vacío y todo sale por la del negocio, como hoy.

El mozo y el personal quedan afuera: no emiten controles, y un campo de
impresora en la fila de cada mozo sería ruido con forma de opción.

### D2 · El control de delivery no se mueve

`emitControlTicket` inserta hoy sin `requested_by` —lo llama el ruteo, a veces
desde el cron de marcha programada, donde no hay persona— así que todos los
controles de delivery/pickup caen a la impresora del negocio. **Se deja igual.**

Es una decisión explícita de Juan (eligió «el de mesa», no «los dos») y además
es lo prudente: KCC es 40% delivery y ese papel ya sale donde el local lo espera.
Moverlo de lugar sin que nadie lo pida es cambiarle la rutina a un local que
opera hoy.

La función pasa a aceptar un `requestedBy` opcional. No lo usa ningún caller
todavía: es el contrato que el F3 va a completar cuando se defina quién aprieta
la tecla.

### D3 · El resolver deja de mirar el rol

Mira si hay `requested_by`, busca su impresora y, si no hay, cae a la del
negocio. El rol ya no participa: quién puede tener impresora se decide al
guardarla (D1), no al imprimir. Una regla en un solo lugar.

## Alcance

1. `members-actions.ts` — `updateTerminalPrinter` → `updateControlPrinter`, con
   la lista de roles habilitados y el mensaje de error nuevo.
2. `user-row.tsx` + `terminal-printer-field.tsx` → `control-printer-field.tsx`:
   el campo aparece para esos roles, con copy que no diga «esta terminal».
3. `route.ts` — sacar la condición de rol del resolver.
4. `control-ticket-emit.ts` — `requestedBy` opcional.

## No-objetivos

- **Emitir el control de mesa.** Es el F3 (#3 de KCC), y sigue esperando qué
  dice ese papel.
- **Mover el control de delivery** (D2).
- **Una impresora por caja** (`cajas.control_printer_ip`). Sería el modelo más
  prolijo —una caja es un puesto con nombre— pero hoy KCC tiene **una sola caja
  operativa** cargada y cero asignaciones de operador, así que sería modelar un
  puesto que todavía no existe. Si mañana hay tres cajas con tres impresoras,
  esta spec se revisa.

## Verificado — 2026-09-15

Stack local, como `admin@demo.test` (el alta de empleados es del admin).

1. En Empleados, el campo **«Comandera de control de este puesto»** aparece
   ahora en las filas de admin y encargado, y la terminal conserva el suyo con
   su texto («de esta terminal»). El mozo y el personal no lo tienen.
2. Se guardó `local:CAJA2` en **Sofía Encargada**. Antes el server lo rechazaba
   con «La impresora de control es de una terminal, no de una persona»; ahora
   queda en `business_users`.
3. Con un control `requested_by` = Sofía y un agente de alcance
   `["local:CAJA2"]`, el GET del print-agent lo devuelve **con
   `printer_ip: local:CAJA2`** — la USB de su caja, no la del negocio.
4. El mismo control **no le llega** al agente de cocina (alcance
   `192.168.10.0/24`): ve 12 papeles, cero controles.

Fixtures borrados al terminar (los dos agentes temporales, el print job y la
impresora de Sofía).

### Lo que apareció verificando

El toast de confirmación decía «Los controles de **esta terminal** salen por…»
también en la fila de una persona. Se hizo condicional, igual que el título del
campo.

### Lo que esta spec NO resuelve, y hay que decirlo

Sigue sin salir papel en esa caja, porque **nadie emite un control de mesa**. El
F3 (#3 de KCC) es el que va a llamar a `emitControlTicket` con su `requestedBy`.
Esta spec deja el enchufe puesto y probado.

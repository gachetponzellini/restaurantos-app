# 190 · Las comanderas de control son una lista, y cada uno elige la suya

**Issue:** [#314](https://github.com/gachetponzellini/RestaurantOS-app/issues/314) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ **implementada y verificada** (2026-09-15, migración `0111` en
cloud y local).

**Input:** Juan, 2026-09-15: *"no debería de ser una comandera de control por
salón, sino una por usuario, y que se pueda elegir a qué usuario asignarle qué
comandera… hay que pensar un diseño, para poder manejar por USB las comanderas
de control, que estas las van a usar X encargados"*.

**Depende de**: [`181`](../181-el-control-sale-por-la-terminal/spec.md) (el
destino `local:` y la resolución por `requested_by`),
[`186`](../186-el-control-sale-por-donde-lo-pidieron/spec.md) (que la impresora
pueda ser de una persona), [`176`](../176-la-comandera-se-prueba/spec.md) (el
papel de prueba cuyo destino viaja en la fila).

---

## Por qué

La comandera de control **ya era por usuario** (181 y 186). Lo que faltaba era
poder **elegirla**: el campo de Empleados era un input de texto donde se escribe
`local:CAJA2` a mano, y un typo no se ve hasta que no sale el papel.

Para elegir, la comandera tiene que existir como cosa. No existía: era un string
repetido. Contado contra el cloud el día de la spec:

| | escrita en | veces |
|---|---|---|
| KCC `192.168.10.210` | control del negocio + cuenta del negocio + cuenta de los 3 salones | **5** |
| Golf `192.168.100.210` | control del negocio + cuenta del salón principal | 2 |

Una impresora física, cinco lugares. Con cuatro encargados serían nueve.

## Decisiones

### D1 · Una lista de comanderas de control del negocio

`control_printers`: nombre («Caja 2»), destino (IP, host o `local:NOMBRE`),
puerto, activa. El nombre es único por negocio —es lo que se elige de una lista,
y dos «Caja 2» serían una trampa— y cada fila tiene su botón **Probar**, que ya
existía (spec 176: el destino del papel de prueba viaja en la fila).

### D2 · El usuario elige de la lista, no escribe

`business_users.control_printer_id` → FK. `null` = la comandera del negocio, que
sigue siendo el default y es el caso de casi todos. En Empleados el input de
texto pasa a ser un `<select>`.

Del otro lado, cada comandera dice **cuánta gente imprime ahí**, y borrar una en
uso se niega: la FK es `on delete set null`, así que borrarla en silencio dejaría
a esa gente imprimiendo en la del negocio sin enterarse.

### D3 · Una comandera desactivada cae a la del negocio

Apagarla sin acordarse de a quién se la habías asignado no puede dejar el papel
sin salir. El resolver pide `is_active`.

### D4 · La lista es sólo de control (decisión de Juan)

No toca el sector (`stations.printer_ip`) ni la cuenta por salón
(`floor_plans.cuenta_printer_ip`), que hoy imprimen bien en un local operando.
**La deuda queda anotada**: el modelo correcto es una sola lista de impresoras
del negocio a la que apunten las tres cosas, y ahí la 10.210 de KCC pasaría de
cinco lugares a uno. Se hace cuando haya que tocar esos caminos por otra razón.

### D5 · El control de delivery no se mueve (decisión de Juan)

Sigue saliendo por la del negocio. Ver [`186 · D2`](../186-el-control-sale-por-donde-lo-pidieron/spec.md).

### D6 · Expand/contract con las columnas viejas

`business_users.control_printer_ip` / `control_printer_port` quedan en la base,
comentadas como deprecadas y **sin lectores**. Borrarlas en la misma migración
rompería el deploy viejo durante la ventana entre migrar y deployar: el resolver
las pide por nombre y PostgREST devolvería error. Se borran en una issue aparte.

## Alcance

1. Migración `0111`: tabla + RLS (misma forma que `stations`) + FK + backfill de
   los strings que hubiera (en producción no había ninguno).
2. `lib/print/control-printers.ts` (lista con el conteo de uso) y
   `control-printers-actions.ts` (ABM, gate `canManageBusiness`).
3. `members-actions.updateControlPrinter` guarda el id, con guarda cross-tenant
   y rechazo de la desactivada.
4. Empleados: selector. Configuración → Comanderas: la lista, con Probar.
5. El resolver del control resuelve por la fila elegida.

## Verificado — 2026-09-15

**Contra Postgres de verdad** (`control-printers.integration.test.ts`, 8 casos):
se crea y aparece en la lista; dos no se llaman igual; un destino que no es IP ni
`local:` se rechaza; el encargado la elige y la lista cuenta 1 persona; una
comandera de otro negocio **no** se puede asignar; borrar una en uso se niega
(«hay 1 persona que imprime acá»); desactivada no se puede reasignar; y sacándola
del usuario, se borra limpio.

**En vivo**, como `admin@demo.test` contra el stack local: la sección
«Comanderas de control por puesto» aparece en Configuración → Comanderas, se
cargó **«Caja 2 · local:CAJA2»** desde el formulario y quedó en la base; en
Empleados las tres filas que pueden tener comandera muestran el `<select>` con
«La comandera de control del negocio» + «Caja 2 · local:CAJA2».

**Lo que no se pudo hacer con el mouse:** elegir la opción del `<select>`. El
overlay de build de Next tapaba la pantalla por un error **de otra sesión**
(`horasDelDia` no existe en `plano-del-dia.ts`, spec 189 a medio hacer), y un
overlay de build no se cierra con Escape. Esa misma acción está cubierta por el
test de integración de arriba, que llama a la server action de verdad.

Suite: 266 archivos, 2899 tests en verde (sin los `*.integration` que piden
Docker).

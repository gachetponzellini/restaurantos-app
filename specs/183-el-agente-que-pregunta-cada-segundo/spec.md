# 183 · El agente que pregunta cada segundo

**Issue:** [#302](https://github.com/gachetponzellini/RestaurantOS-app/issues/302) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** implementada y verificada en producción (2026-09-15). D3, D5, D1 y
D2 hechas; D4 es un no-hacer. **El tráfico del print-agent bajó 90% sin tocar
ninguna de las dos PCs de los locales** — medido contra la base, ver «Lo medido
después» al final.

**Input:** Juan, 2026-09-14: *"esta gastando mucha plata en vercel este
projecto, revisemos porque esta pasando esto"*. Contando invocaciones en el
repo, el print-agent explica el orden de magnitud él solo.

**Depende de**: la **spec 35** (el latido y su cadencia de 15s, que es la que
acá se implementa de verdad),
[`046`](../046-print-agent-autoinstalador/spec.md) (la key por agente y el
instalador), [`124`](../124-print-agents-por-alcance/spec.md) (varios agentes por
negocio), [`051`](../051-print-agent-render-server/spec.md) (el server
pre-renderiza el ticket; el agente es un relay).

**Medido** en [`#304`](https://github.com/gachetponzellini/RestaurantOS-app/issues/304):
la cadencia de 1s y los dos agentes están confirmados contra producción (ver
«Lo medido», abajo). Falta sólo saber qué línea de la factura se dispara.

---

## Por qué

El print-agent pregunta **dos veces cada dos segundos y medio, casi todo el
día**, y el 99% de las veces la respuesta es "no hay nada para imprimir".

`config.json` trae `pollMs: 1000` y `tick()` manda dos requests por vuelta
([`agent.mjs:611`](../../print-agent/agent.mjs)):

```js
async function tick() {
  if (!DRY) await sendHeartbeat();        // POST /api/print-agent/heartbeat
  const comandas = await fetchComandas(); // GET  /api/print-agent
```

Medido contra la factura (#304): **3,24M invocaciones/mes**, 108.000 por día.
Eso son dos agentes a 0,83 req/s corriendo ~18 h por día — el turno completo de
un restaurante con almuerzo y cena, que es lo que efectivamente pasa. Y que Edge
Requests (3.22M) e Invocations (3.24M) den casi igual dice lo demás: **el
tráfico del proyecto es este loop**, no gente usando la app.

**Y cada una de esas invocaciones cuesta diez veces lo que parece.** La
invocación en sí vale $0.0006; pero arrastra **~9 eventos de Observability**
(8.96 medido sobre 30 días, 9.73 sobre 18 — la relación es estable) a $1.20 el
millón, o sea **$0.011**. Observability Events es el **70% de la factura**
($34.82 de $49.46), y lo que está ingiriendo es, casi entero, este loop: nueve
eventos cada vez que la respuesta es «no hay nada para imprimir».

Lo caro nunca fue la invocación. Es **mirarla**.

No es sólo el conteo. Cada request hace `autenticarAgente` → una query a
`print_agent_credentials` ([`agent-auth.ts:56`](../../src/app/api/print-agent/agent-auth.ts)),
**en las dos rutas**; el GET corre además un join PostgREST de seis niveles
sobre `comandas` más `loadItemsPorPedido`
([`route.ts:102`](../../src/app/api/print-agent/route.ts)); el heartbeat, un
upsert. Son ~3 roundtrips a Postgres por segundo por agente para no imprimir
nada. Se paga en invocaciones, en Edge Requests y en CPU — y encima ninguna
instancia llega nunca a apagarse, así que la memoria aprovisionada se factura
de corrido.

Un restaurante manda comandas durante cuatro o cinco horas por día, y adentro
de ese rato pasan minutos entre una y otra. La cadencia de 1s está dimensionada
para el peor segundo del año y se paga todos los demás.

**Cuánto vale esta spec:** llevar el agente de 0,83 a ~0,17 req/s (D1 + D2 + D3)
es un recorte del **~80%**, y baja la factura del proyecto de ~$49 a **~$16/mes**.
Es el único cambio de código del repo que mueve la aguja — todo lo que arregla la
[`184`](../184-nadie-pide-lo-que-no-esta-mirando/spec.md) junto suma $9.50 y
hacerlo entero no se notaría.

## Lo que ya está construido

**La spec 35 ya había decidido esto, y no se implementó.** El docstring del
endpoint dice que el agente late "cada ~15s" y que eso *"desacopla la señal de
salud del ritmo del poll del GET"*
([`heartbeat/route.ts:11`](../../src/app/api/print-agent/heartbeat/route.ts)).
El agente lo manda en cada tick. El desacople existe en la prosa, no en el
código.

**El contrato ya es aditivo y tolerante.** La 051 dejó al agente cayendo a
render local si el server no manda contenido, y la #278 metió `version` en el
latido justamente para poder razonar sobre agentes viejos. O sea: el server ya
sabe convivir con `.exe` de distintas épocas, que es la restricción real acá
(actualizar el binario en golf es una sesión de TeamViewer, no un deploy).

**Fluid Compute ya está activo y la región ya está alineada** (#304):
`resourceConfig.fluid: true`, `iad1` = us-east-1 = la de Supabase. No hay un
toggle gratis esperando, y no hay cross-region. Lo que queda por bajar es
tráfico real, que es de lo que trata esta spec.

**La identidad ya viaja en la key.** Desde la 124 el server sabe *qué* agente
está llamando sin que el agente mande nada nuevo. Eso es lo que hace posible la
D2 sin cambiar el instalador.

---

---

## Lo medido — 2026-09-14

Dos muestras de `print_agent_status` contra la base cloud:

| negocio | staleness #1 | #2 | `agent_version` |
|---|---|---|---|
| `golf-jcr` | 1.1s | 1.25s | **NULL** |
| `kcc` | 1.2s | 0.87s | **NULL** |

El latido nunca pasa de ~1,3s de viejo: la cadencia de 1s es real en los dos
locales. Son **exactamente dos agentes**, así que la cuenta de arriba no hay que
corregirla.

### El piso de red: `pollMs` no es el período

Contando latidos distintos dentro de una ventana fija (`pg_sleep` en un `do`
contra el cloud), con los dos agentes todavía en `pollMs: 1000`:

| local | latidos | ventana | período real |
|---|---|---|---|
| `golf-jcr` | 9 | 24,3 s | **2,31 s** |
| `kcc` | 11 | 24,3 s | **2,54 s** |

**El período no es 1 s: es ~2,4 s.** La diferencia son los dos HTTP del tick
—latido y pull— a ~700 ms cada uno desde el local hasta `iad1`. `pollMs` es el
*sleep entre vueltas*, no la cadencia; la cadencia es `pollMs + (requests × RTT)`.

Eso reordena el valor de las decisiones, y no en la dirección obvia:

| escenario | período | req/s por agente | recorte |
|---|---:|---:|---:|
| hoy (`pollMs` 1000, 2 requests) | 2,40 s | 0,833 | — |
| **D3 sola** (3000, 2 requests) | 4,40 s | 0,455 | **45%** |
| **D1 sola** (1000, 1 request) | 1,70 s | 0,588 | **29%** |
| **D1 + D3** (3000, 1 request) | 3,70 s | 0,270 | **68%** |
| D1 + D2 ocioso (5000, 1 request) | 5,70 s | 0,175 | 79% |
| D1 + D2 cerrado (20000, 1 request) | 20,70 s | 0,048 | 94% |

Dos cosas que hay que leer despacio:

- **D1 sola rinde 29%, no 50%.** Sacar un request de dos también *acelera el
  loop* —el tick tarda 700 ms menos— así que el agente da más vueltas por
  minuto y se come la mitad del ahorro. Una intuición de «la mitad de las
  invocaciones» acá da mal.
- **D1 y D3 se potencian.** Juntas dan 68%, más que la suma de sus partes por
  separado, justamente porque D3 diluye el piso que D1 achica.

Y `agent_version` viene **NULL en los dos**: ambos `.exe` son anteriores a
set-2026 (la #278 fue la que agregó el campo). Eso convierte el riesgo de más
abajo en un hecho — hoy, ningún local ahorraría nada — y a la vez lo abarata:
los dos binarios hay que actualizarlos igual, así que la visita ya estaba
pendiente por otro motivo.

---

## Decisiones

### D1 · El latido viaja adentro del pull — ✅ hecho (2026-09-15)

El GET pasa a registrar el latido como efecto de la misma llamada. Ya tiene todo
lo que necesita: autenticó, sabe qué agente es, y `version` puede viajar en un
header (`x-agent-version`) en vez de un body aparte.

**Mitad de las invocaciones por tick, sin perder una sola señal de salud** — el
latido queda atado al pull, que es exactamente lo que el panel quiere saber
("¿este agente está pidiendo comandas?").

Ojo con la cuenta: **mitad de los requests por tick no es mitad del tráfico**.
Sacar un HTTP también le quita ~700 ms al tick, así que el loop se acelera y
devuelve parte del ahorro — D1 sola rinde **29%** (ver «El piso de red»). Su
verdadero valor es otro: **es la única decisión que baja el piso**, y el piso es
lo que pone techo a todo lo demás. Con el latido afuera, cada aumento de
`pollMs` se traduce casi 1:1 en menos tráfico en vez de diluirse contra 1,4 s de
red. Por eso va primero, aunque D3 sola rinda más.

`POST /api/print-agent/heartbeat` **se queda y no se toca**: es lo que siguen
llamando los agentes viejos, y mientras haya uno instalado tiene que seguir
respondiendo. Se marca como deprecado en el docstring, con la fecha de la
versión que dejó de necesitarlo.

**Cómo quedó.** El upsert salió a `lib/print-agent/heartbeat.ts`
(`registrarLatido`), compartido por las dos puertas: mientras convivan agentes
viejos y nuevos, la fila tiene que significar lo mismo sin importar por dónde
entró el latido — incluida la regla de la #278 de no pisar la versión guardada
cuando no viene. Se agregó `beat=0`, que no late: el `--dry-run` del agente de
referencia antes simplemente no llamaba al heartbeat, y probar desde una máquina
de desarrollo no tiene que hacer que el panel del local diga «conectado».

### D2 · La cadencia la decide el server, no el `.exe` — ✅ hecho (2026-09-15)

El GET devuelve `next_poll_ms` junto con las comandas. El agente lo respeta si
viene; si no viene (server viejo, rollback), usa su `cfg.pollMs` de siempre.

Esto es lo importante de la decisión: **tunear la cadencia deja de requerir una
visita al local**. Si en golf resulta que 8s es mucho, se cambia en un deploy,
no en un TeamViewer.

La regla arranca simple, del lado del server:

| Situación | `next_poll_ms` |
|---|---|
| Este pull trajo comandas | 1.000 |
| Hubo alguna comanda del negocio en los últimos 3 min | 1.000 |
| El negocio está abierto pero sin movimiento | 5.000 |
| El negocio está cerrado (fuera de horario) | 20.000 |

`next_poll_ms` es el **sleep entre vueltas**, no el período: el período es eso
más el RTT del request (~700 ms con D1 aplicada). Los valores de la tabla están
elegidos como sleeps, que es lo que el agente sabe hacer — quien los toque
después tiene que acordarse de sumarle el piso antes de comparar contra una
medición.

"Hubo alguna en los últimos 3 min" sale de un `max(emitted_at)` acotado, no de
traer filas. Tres minutos es deliberadamente generoso: una mesa que pide entrada
y después plato entra entera en la ventana rápida, y el costo de equivocarse
para el lado rápido es cero.

**El peor caso empeora de 1s a 5s** y hay que decirlo en voz alta: la primera
comanda después de un rato muerto tarda hasta 5 segundos más en salir por la
comandera. Del segundo ticket en adelante el servicio ya está en la ventana
rápida. Contra el alternativo —*todo* el tiempo a 1s— es un intercambio que se
hace solo.

**Y con la D5 encima ese peor caso casi no se paga**: si el agente está
retenido, la comanda no espera el sleep — sale a los ~2-3 s (verificado: 3,2 s
de punta a punta, ver abajo). El `next_poll_ms` sólo se cobra cuando el agente
justo estaba durmiendo.

**Verificado en producción** con una credencial temporal contra el negocio
`demo`: un pull con trabajo devuelve `next_poll_ms: 1000`, y uno vacío sobre un
sector sin cola devuelve `5000` (abierto, sin movimiento). Un negocio **sin
`business_hours` cargados cuenta como abierto** — el horario es config de la
carta online, no del salón, y tratarlo como cerrado mandaría 20 s en pleno
servicio. Del lado del agente, `next_poll_ms` se acota a [500 ms, 60 s] antes de
dormirlo: este `.exe` se actualiza a mano y va a seguir corriendo contra deploys
que todavía no existen.

### D3 · El mínimo que se puede hacer hoy, sin tocar el binario — ✅ hecho

`pollMs` vive en el `config.json` de cada PC, pero **ese archivo no se escribe a
mano: lo genera el server** y el admin lo baja del panel
(`getPrintAgentInstaller`). Así que subirlo a 3000 sí es un cambio de código —
sólo que del lado que no requiere un `.exe` nuevo.

El valor se extrajo a `POLL_MS_DEFAULT` en `lib/print-agent/credentials.ts`,
junto con `buildAgentConfig`, que arma el config y es puro — para poder testear
el contrato con el `.exe` sin Supabase de por medio. El test **fija el 3000**,
no sólo la forma: que alguien lo devuelva a 1000 tiene que romper CI, no
aparecer en la factura tres semanas después.

**Deployar no alcanza.** El `.exe` lee el config una sola vez, al arrancar, y no
tiene default propio: los dos agentes ya instalados siguen a 1s hasta que
alguien les cambie el archivo. El procedimiento —bajar el config del panel y
re-correr `instalar.bat`, sin TeamViewer y sin rotar la key— quedó documentado
en [`print-agent/README.md`](../../print-agent/README.md#cambiar-la-cadencia-de-un-local-ya-instalado).

Va acá y no en una issue aparte porque es la misma decisión vista desde la
urgencia: corta **~la mitad** mientras D1 y D2 se implementan. (No dos tercios,
como decía esta spec antes de medir el piso de red.)

#### Verificado en golf — 2026-09-15

| | antes | después | req/s |
|---|---|---|---|
| `golf-jcr` | 1,71 s | **3,73 s** | 1,17 → 0,54 · **−54%** |
| `kcc` (control, sin tocar) | 1,76 s | 1,76 s | 1,14 |

**El modelo del piso quedó validado con 30 ms de error.** Con el RTT que daba el
control en ese momento (0,76 s por tick), `3,0 + 0,76 = 3,76 s` predicho contra
**3,73 s** medido. La fórmula `período = pollMs + (requests × RTT)` es correcta.

El recorte real de D3 cae entre **45% y 54%** según el RTT del momento — el piso
se mueve con la hora y la conexión del local (medimos 1,4 s por tick de noche y
0,76 s al otro día). Cuanto más bajo el piso, más rinde subir `pollMs`.

**Lo que costó llegar**, porque es parte de la decisión: tres intentos. El Bloc
de notas sobre `%PROGRAMDATA%` **guarda en otro lado sin avisar** si no se abrió
como administrador, y `instalar.bat` copia el `config.json` del ZIP encima del
instalado —o sea que pisa la edición—. El camino que funciona es PowerShell
elevado, verificando con `IsInRole` antes de tocar nada, y el `.exe` se reinicia
con `Stop-Process` (si el wrapper no lo relevanta, `schtasks /run`). Está en el
[README](../../print-agent/README.md#cambiar-la-cadencia-de-un-local-ya-instalado).

Esto es, además, el mejor argumento a favor de la D2: **cambiar un número costó
una interrupción del servicio y tres intentos.**

### D4 · Qué NO se hace: cachear las credenciales

Tentador —una query menos por request— y está mal. Un cache en memoria de
instancia significa que **revocar una key deja de tener efecto inmediato**, que
es justo lo contrario de lo que la security review #4 pidió cuando se retiró la
`PRINT_AGENT_KEY` global. Con la D1 y la D2 aplicadas la query de auth corre un
par de veces por minuto, no una vez por segundo: el problema se disuelve solo y
no hace falta pagar el riesgo.

### D5 · El server retiene la respuesta cuando no hay nada — ✅ hecho (2026-09-15)

Juan, 2026-09-15: *"creo que podríamos hacer que sea cada 30 segundos, no hace
falta que sea instantánea la comanda"*. Tiene razón sobre la comanda, y está
mal sobre el resto de la cola.

**Por qué 30 s fijos no se puede hoy.** El `GET /api/print-agent` no sirve sólo
comandas: sirve también `print_jobs`
([`route.ts:548`](../../src/app/api/print-agent/route.ts)), y ahí adentro están
la prueba de impresora, la reimpresión de factura, el control de delivery y el
papel del cierre de caja. En todos esos hay **una persona parada frente a la
impresora**. Medio minuto ahí no se lee como "tarda", se lee como "no anda", y
la reacción natural es apretar de nuevo.

Y algo se rompe de verdad: `OFFLINE_THRESHOLD_MS = 60_000`
([`print-agent-card.tsx:17`](../../src/components/admin/settings/print-agent-card.tsx)).
Con un período de 30,8 s entran **dos latidos** antes del umbral, así que un
solo tick lento hace que el panel diga «comandera sin conexión». Falsa alarma
recurrente, que es la peor clase de alarma: enseña a ignorarlas.

**La decisión.** Cuando no hay nada para imprimir, el GET **no contesta vacío al
toque: espera**. Mira la cola durante la retención y contesta apenas aparece
algo, o vacío al llegar al tope.

Eso da las dos cosas a la vez: el agente ocioso pregunta cada ~30 s —barato— y
**cuando hay trabajo la respuesta sale al instante**, o sea que la comanda y el
ticket de prueba salen *más rápido que hoy*, no más lento. Se cae el único
argumento en contra de los 30 s.

Tres cosas que la hacen posible y que hay que verificar antes de escribirla:

- **Esperar no se factura.** #304 confirmó que el proyecto está en Fluid, que
  cobra **CPU activa**: un `await` sin trabajo no consume. Y las instancias ya
  están vivas de corrido, así que retener un par de requests no agrega
  horas-instancia. Verificar igual mirando Provisioned Memory después de
  deployar: si sube, la decisión estaba mal.
- **`functionDefaultTimeout: 300`** deja lugar de sobra para una retención de
  30 s.
- **Funciona con el `.exe` que ya está instalado.** El loop del agente es
  `tick(); sleep(pollMs)` y `tick()` **espera la respuesta HTTP** — por eso el
  período medido es `pollMs + RTT`. Retener del lado del server alarga el
  período sin que el local se entere. **Esta es la única decisión de la spec que
  no necesita binario nuevo**, y por eso probablemente vaya antes que la D2.

Dos arreglos chicos la acompañan, o la cadencia lenta rompe lo que ya estaba:

1. `OFFLINE_THRESHOLD_MS` deja de ser una constante suelta y pasa a derivarse de
   la cadencia esperada (~3 períodos).
2. `FAIL_THRESHOLD` del agente se desacopla de `pollMs`: hoy la gracia es
   `pollMs × 5` ([`agent.mjs:67`](../../print-agent/agent.mjs)), que a 10 s ya
   son 50 s para avisar que una comanda no salió.

#### Cómo quedó implementada

Todos los números viven juntos en `lib/print-agent/cadence.ts` —retención,
intervalo de sondeo, la tabla de la D2 y el umbral del panel— porque se leen de
a tres y separarlos es exactamente lo que produjo el bug del umbral. Son puros y
testeados con los **valores fijados**, no sólo la forma: que alguien devuelva la
retención a cero tiene que romper CI, no aparecer en la factura tres semanas
después (la lección de la D3, donde el `pollMs: 1000` vivió un año porque nada
lo miraba).

- **Retención 25 s, sondeo cada 2 s.** El sondeo es la latencia real de una
  comanda cuando el agente está retenido: 2 s, mejor que el período de 10,99 s
  que golf tenía. `wait_ms` en la query lo acota (`0` = sin retención, lo usa
  `--once`) y es la salida de emergencia si hubiera que desactivarla sin
  revertir.
- **La sonda mira el timestamp, no sólo el estado.** Dos `count` con `head`
  contra `comandas` y `print_jobs` —las dos únicas tablas de las que sale
  papel— filtrando por «apareció después de que empezó esta retención». Sin esa
  marca de agua, una fila `pendiente` que quedó colgada de antes —comandera
  apagada, negocio sin impresora de control— haría positivo cada sondeo y
  rearmaríamos el payload cada 2 s para nada. La sintaxis del doble `or=` (que
  PostgREST combina con AND) se verificó contra el cloud antes de escribirla:
  81 ∧ 44 → 18.
- **Ante un error de sonda contesta «puede que haya»** y rearma el payload. El
  modo de fallar que importa no es gastar una query: es una sonda que dice «no
  hay» con una comanda esperando.
- **Techo de 3 reconstrucciones por request.** La sonda es del negocio y el
  payload es del agente: en un negocio con dos PCs, el papel del otro agente
  hace positiva la sonda de este, y sin techo serían 12 rearmados en una sola
  request — más caro que no retener. Al agotarse contesta vacío, o sea el
  comportamiento de antes de esta spec. (Hoy los dos negocios tienen un agente
  cada uno, así que este camino no se ejerce en producción todavía.)
- **`maxDuration = 60`** declarado en la ruta: un timeout más corto que la
  retención mataría el pull y el agente vería un 504 por vuelta (no pierde
  comandas —siguen `pendiente`— pero el ahorro se va).
- **El umbral del panel se deriva**: 3 × el peor período ocioso (25 + 20 + 1) =
  **138 s**, en vez de los 60 s que estaban clavados en *dos* componentes
  distintos. El precio es que un agente realmente muerto tarda ~2,3 min en
  cantarse en vez de 1. Si eso es mucho, lo que hay que bajar es la retención,
  no el umbral: bajarlo trae de vuelta la falsa alarma.
- **La gracia del aviso de fallo pasa a medirse en tiempo**: 10 s y al menos 2
  intentos, en vez de 5 vueltas del loop. Atarla al poll era atarla a algo que
  el local ya no controla.

## Alcance

1. ✅ `GET /api/print-agent`: registra el latido (upsert de
   `print_agent_status`) con el `agent_id` que ya resolvió, leyendo la versión
   de `x-agent-version`.
2. ✅ El mismo GET calcula y devuelve `next_poll_ms` según la tabla de D2.
3. ✅ `agent.mjs`: `tick()` deja de llamar `sendHeartbeat()`; manda
   `x-agent-version`; el `while` usa `nextPollMs ?? cfg.pollMs`.
   `AGENT_VERSION = 2026-09-15`.
4. ✅ `heartbeat/route.ts`: docstring de deprecación. Sin cambios de
   comportamiento (el upsert pasó al módulo compartido).
5. ✅ Tests: la tabla de D2 como unidad (pura, sin Supabase); el GET late; un
   agente sin `x-agent-version` no pisa la versión guardada (#278); la retención
   espera, contesta apenas aparece trabajo, respeta `wait_ms`, no rearma 12
   veces y no sigue sondeando si el agente cortó.
6. ✅ **D3, hecha:** `POLL_MS_DEFAULT = 3000` + `buildAgentConfig` (puro) en
   `lib/print-agent/credentials.ts`; `getPrintAgentInstaller` la usa; test que
   fija el valor; el README documenta cómo lo toma un local ya instalado.
   **Operativo, en curso:** golf ya está en 10 s (verificado, período 10,99 s);
   kcc sigue en 1 s. El valor de `POLL_MS_DEFAULT` queda en 3000 hasta que la
   D5 esté: con retención, lo que el config diga importa mucho menos.
7. ✅ **D5, hecha:** retención en el GET + `OFFLINE_THRESHOLD_MS` derivado de
   la cadencia + gracia del aviso de fallo medida en tiempo.

## No-objetivos

- **Pasar el agente a Realtime.** Es el final bueno de esta historia —el agente
  se suscribe a `comandas` y sólo llama a Vercel cuando hay algo que imprimir,
  con un poll de red de seguridad cada 30s— y llevaría las invocaciones a casi
  cero *mejorando* la latencia. Pero es un cambio de arquitectura del binario
  on-site, con su propio modo de fallar (evento perdido = comanda que no sale),
  y merece su spec. Esta spec deja el terreno listo: con `next_poll_ms` el
  server ya manda, y el fallback de Realtime sería ese mismo poll.
- **Tocar el render del ticket.** Es la 051 y anda.
- **Cambiar el instalador.** La key y el `businessId` siguen igual.

## Riesgos

- **Un agente viejo no ahorra nada, y hoy los dos son viejos.** Ignora
  `next_poll_ms` y sigue a 1s; la D1 tampoco lo alcanza porque él sigue mandando
  el latido aparte. El ahorro completo llega recién cuando el `.exe` está
  actualizado en golf y en kcc — por eso la D3 existe, y por eso conviene
  empaquetar esta actualización con cualquier otra que ya deba ir al local.
  `agent_version` en el panel dice contra quién estamos midiendo: mientras siga
  en NULL, no hay nada que medir.
- **`next_poll_ms` mal calculado deja al local sin imprimir rápido.** Es el modo
  de fallar que importa. Mitigación: la función es pura y testeada, el piso
  nunca baja de 1s y el techo está acotado a 20s, y cualquier pull que traiga
  comandas vuelve a la ventana rápida sin importar lo anterior.
- **"El negocio está cerrado" depende del horario cargado.** Un negocio con el
  horario mal configurado se iría a 20s en pleno servicio. Mitigación: la regla
  de los 3 minutos gana sobre la de horario — si hay comandas, es rápido,
  diga lo que diga la config.

---

## Lo medido después — 2026-09-15, en producción

El deploy de la D5 + D1 se hizo efectivo a las **12:45 UTC**. Contando requests
a la base por minuto (`edge_logs` del proyecto cloud), el escalón no necesita
interpretación:

| | antes (12:33–12:44) | después (12:45–12:59) | |
|---|---:|---:|---|
| latidos a la base (`POST print_agent_status`) | 39/min | 7,6/min | |
| pulls (`GET comandas`) | 39/min | 3,8/min | |
| **ticks de agente** (los dos locales juntos) | **39/min** | **3,8/min** | **−90%** |
| **invocaciones en Vercel** | **78/min** | **7,6/min** | **−90%** |
| sondas de la retención (`HEAD`) | 0 | ~95/min | (nuevo, va a Supabase) |

Y el período por local, contando latidos distintos en una ventana fija (el `do`
con `pg_sleep` contra el cloud):

| local | `pollMs` | antes | después | predicho |
|---|---:|---:|---:|---:|
| `golf-jcr` | 10.000 | 10,99 s | **36,25 s** | 36,2 s |
| `kcc` | 1.000 | 1,72 s | **26,8–29,3 s** | 27,4 s |

**La fórmula aguantó otra vez**: `período = retención + pollMs + RTT` predijo
36,2 s contra 36,25 s medidos en golf. Y el punto que importa: **esto se logró
sin tocar ninguna de las dos PCs.** Los dos `.exe` siguen siendo los mismos
binarios pre-set-2026 con `agent_version` NULL.

Los latidos salen de a pares separados por ~0,5 s —el `POST /heartbeat` del
binario viejo más el latido que ahora registra el GET— y después un hueco de un
período entero. Cuando los binarios se actualicen, el par se vuelve uno solo:
otro −50% de invocaciones (78 → 3,8/min contra el estado original).

### Verificado de punta a punta

Con una credencial temporal contra el negocio `demo` (creada, usada con
`beat=0` para no escribir nada, y borrada):

| qué | esperado | medido |
|---|---|---|
| pull con trabajo | rápido, `next_poll_ms: 1000` | **0,6 s**, 1000 ✅ |
| pull vacío, retención default | ~25 s | **25,74 s** ✅ |
| pull vacío, `wait_ms=6000` | ~6 s | **6,86 s** ✅ |
| pull vacío, `wait_ms=0` | inmediato | **0,9 s** ✅ |
| `next_poll_ms` sin movimiento, negocio abierto | 5000 | **5000** ✅ |
| **trabajo que aparece a mitad de la retención** | contesta ahí, no a los 25 s | pedido a los 5,1 s de empezar → **contestó a los 8,3 s**, o sea **3,2 s después**, con el ticket de reimpresión adentro ✅ |

Esa última fila es la decisión entera: **el agente ocioso pregunta cada 30 s y
la comanda igual sale en 3 s.** No hubo que elegir.

### Lo que queda por mirar

- **Provisioned Memory en el dashboard de Vercel.** La apuesta de la D5 es que
  retener no cuesta porque Fluid cobra CPU activa y las instancias ya estaban
  vivas de corrido. **Si Provisioned Memory subió, la decisión estaba mal y hay
  que revertirla.** No tengo acceso al dashboard desde acá: lo tiene que mirar
  alguien con la cuenta. El indicador es limpio — el deploy fue a las 12:45 UTC
  del 2026-09-15 y el resto del tráfico no cambió.
- **Las sondas son carga nueva sobre Supabase**: ~95 `HEAD`/min (dos por sondeo,
  cada 2 s por agente retenido) donde antes había 0. Es el intercambio
  deliberado —lo caro era mirar la invocación en Vercel, no consultar Postgres—
  pero si molesta, se baja a la mitad juntando las dos tablas en un RPC, o se
  sube `PROBE_MS` a costa de latencia.
- **Actualizar los dos `.exe`** sigue pendiente y ahora rinde menos que antes:
  vale el −50% de invocaciones que queda y el `agent_version` en el panel, no el
  ahorro grande, que ya está cobrado.
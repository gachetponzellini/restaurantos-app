# 183 · El agente que pregunta cada segundo

**Issue:** [#302](https://github.com/gachetponzellini/RestaurantOS-app/issues/302) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** propuesta

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

El print-agent pregunta **dos veces por segundo, las 24 horas**, y el 99% de las
veces la respuesta es "no hay nada para imprimir".

`config.json` trae `pollMs: 1000` y `tick()` manda dos requests por vuelta
([`agent.mjs:611`](../../print-agent/agent.mjs)):

```js
async function tick() {
  if (!DRY) await sendHeartbeat();        // POST /api/print-agent/heartbeat
  const comandas = await fetchComandas(); // GET  /api/print-agent
```

| | por agente | Golf + House |
|---|---|---|
| día | 172.800 | 345.600 |
| mes | ~5,2 M | **~10,4 M** |

Y desde la 124 golf tiene una PC por caja, así que son más de dos agentes.

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
para el peor segundo del año y se paga los otros 86.399.

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

Y `agent_version` viene **NULL en los dos**: ambos `.exe` son anteriores a
set-2026 (la #278 fue la que agregó el campo). Eso convierte el riesgo de más
abajo en un hecho — hoy, ningún local ahorraría nada — y a la vez lo abarata:
los dos binarios hay que actualizarlos igual, así que la visita ya estaba
pendiente por otro motivo.

---

## Decisiones

### D1 · El latido viaja adentro del pull

El GET pasa a registrar el latido como efecto de la misma llamada. Ya tiene todo
lo que necesita: autenticó, sabe qué agente es, y `version` puede viajar en un
header (`x-agent-version`) en vez de un body aparte.

**Mitad de las invocaciones, sin perder una sola señal de salud** — el latido
queda atado al pull, que es exactamente lo que el panel quiere saber ("¿este
agente está pidiendo comandas?").

`POST /api/print-agent/heartbeat` **se queda y no se toca**: es lo que siguen
llamando los agentes viejos, y mientras haya uno instalado tiene que seguir
respondiendo. Se marca como deprecado en el docstring, con la fecha de la
versión que dejó de necesitarlo.

### D2 · La cadencia la decide el server, no el `.exe`

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

"Hubo alguna en los últimos 3 min" sale de un `max(emitted_at)` acotado, no de
traer filas. Tres minutos es deliberadamente generoso: una mesa que pide entrada
y después plato entra entera en la ventana rápida, y el costo de equivocarse
para el lado rápido es cero.

**El peor caso empeora de 1s a 5s** y hay que decirlo en voz alta: la primera
comanda después de un rato muerto tarda hasta 5 segundos más en salir por la
comandera. Del segundo ticket en adelante el servicio ya está en la ventana
rápida. Contra el alternativo —*todo* el tiempo a 1s— es un intercambio que se
hace solo.

### D3 · El mínimo que se puede hacer hoy, sin tocar código

`pollMs` vive en el `config.json` de cada PC. **Subirlo a 3000 en los dos
locales es un cambio de archivo, no un `.exe` nuevo**, y ya corta dos tercios
de la cuenta mientras la D1 y la D2 se implementan y se despliegan.

Va acá y no en una issue aparte porque es la misma decisión vista desde la
urgencia: si la factura molesta esta semana, esto se hace el lunes.

### D4 · Qué NO se hace: cachear las credenciales

Tentador —una query menos por request— y está mal. Un cache en memoria de
instancia significa que **revocar una key deja de tener efecto inmediato**, que
es justo lo contrario de lo que la security review #4 pidió cuando se retiró la
`PRINT_AGENT_KEY` global. Con la D1 y la D2 aplicadas la query de auth corre un
par de veces por minuto, no una vez por segundo: el problema se disuelve solo y
no hace falta pagar el riesgo.

## Alcance

1. `GET /api/print-agent`: registra el latido (upsert de `print_agent_status`)
   con el `agent_id` que ya resolvió, leyendo la versión de `x-agent-version`.
2. El mismo GET calcula y devuelve `next_poll_ms` según la tabla de D2.
3. `agent.mjs`: `tick()` deja de llamar `sendHeartbeat()`; manda
   `x-agent-version`; el `while` usa `nextPollMs ?? cfg.pollMs`. Nuevo
   `AGENT_VERSION`.
4. `heartbeat/route.ts`: docstring de deprecación. Sin cambios de comportamiento.
5. Tests: la tabla de D2 como test de unidad de la función que elige la
   cadencia (pura, sin Supabase); un test de que el GET late; un test de que un
   agente sin `x-agent-version` no pisa la versión guardada (la regla de la #278).
6. Operativo: `pollMs: 3000` en los `config.json` de golf y kcc (D3).

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

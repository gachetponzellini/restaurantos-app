# 206 · La impresora se entera al toque

**Issue:** [#341](https://github.com/gachetponzellini/RestaurantOS-app/issues/341) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesta — esperando aprobación de Juan (2026-09-18).

**Input:** la encargada, vía Juan (2026-09-18): *"se está quejando que tarda
mucho en imprimir, capaz habría que pensar en un cambio de implementación del
print agent, otra tecnología u otra arquitectura"*. Juan eligió la opción B del
[análisis](../../../../wiki/analyses/print-agent-latencia.md): push.

**Depende de:** [`183`](../183-el-agente-que-pregunta-cada-segundo/spec.md) (la
retención, `next_poll_ms`, el latido adentro del pull),
[`124`](../124-print-agents-por-alcance/spec.md) (varios agentes por negocio,
alcance por impresora), [`051`](../051-print-agent-render-server/spec.md) (el
server arma el ticket; el agente es un relay),
[`046`](../046-print-agent-autoinstalador/spec.md) (key por agente, instalador).

---

## Por qué

El agente **pregunta**. Aunque la 183 lo volvió barato (retención de 25 s), un
papel que aparece mientras el agente duerme entre dos retenciones espera ese
sueño completo. Medido en `print_jobs`, de emitido a impreso, en los últimos
10 días:

| local | papel | n | p50 | p90 | max |
|---|---|---|---|---|---|
| kcc | cuenta | 16 | 2,2 s | 11,2 s | 28,6 s |
| kcc | control | 11 | 5,8 s | 51,1 s | 68,9 s |

La mediana está bien. **La cola es la queja:** kcc, 2026-09-18, la cuenta se
pide a las 14:16:11, no sale, se vuelve a pedir a las 14:16:23 y las dos salen
juntas a las 14:16:40.

Las cuatro causas están en el análisis. Ninguna es la red: la base
(`us-east-1`) y Vercel (`iad1`) están pegadas. Es la **forma**: preguntar tiene
un hueco, y achicarlo cuesta requests. Que la base **avise** no tiene hueco.

## La idea en una línea

Cuando aparece algo para imprimir, Postgres manda un aviso por **Supabase
Realtime** a un canal del negocio. El agente está escuchando por websocket y, al
recibirlo, hace **el mismo GET de hoy**. El long-poll queda como red de
seguridad.

```
insert print_job / comanda_items ──trigger──▶ realtime.send('print-agent:<biz>')
                                                     │  (~100–300 ms)
                                   agente (websocket) ◀┘
                                        │ GET /api/print-agent?wait_ms=0   (igual que hoy)
                                        ▼
                                     imprime ── report (sin bloquear el siguiente)
```

El aviso **no lleva datos**: sólo dice «hay algo». El ticket lo sigue armando
el server (051), con el alcance del agente (124) y su key. Eso es lo que hace
que el canal no pueda filtrar nada de otro negocio, ni del mismo.

---

## Decisiones

### D1 · El aviso sale de la base, por Broadcast — no Postgres Changes

Un trigger llama a `realtime.send(payload, 'trabajo', 'print-agent:<business_id>', true)`.

- **Broadcast y no Postgres Changes:** Postgres Changes evalúa la RLS de la
  tabla por cada suscriptor y cada fila, y el agente no es un usuario con
  permisos sobre `print_jobs`/`comandas`. Además es lo que Supabase recomienda
  para escala. Broadcast desde la base sólo necesita una policy sobre
  `realtime.messages`.
- **Canal por negocio, no por agente:** los triggers no saben qué impresora
  alcanza cada agente. Eso lo resuelve el GET (124). Con dos agentes (kcc), un
  aviso despierta a los dos y cada uno se lleva lo suyo. Es el mismo trade-off
  que ya acepta la sonda de la retención.
- `realtime.send` ya existe en la base cloud (verificado 2026-09-18). El
  mensaje sale **al commit** de la transacción que hizo el insert.

**Qué dispara el aviso** (statement-level, un aviso por sentencia y no por fila):

| tabla | cuándo | por qué ahí |
|---|---|---|
| `comanda_items` | `AFTER INSERT` | **No en `comandas`.** `enviarComanda` crea la comanda y sus ítems en dos viajes; el GET descarta la comanda sin ítems (`route.ts`, «comanda a medio crear», golf 2026-08-04 mesa R4). Avisar en el insert de `comandas` despertaría al agente para nada y la comanda esperaría al próximo aviso. |
| `comandas` | `AFTER UPDATE` cuando `reprint_requested_at` cambia a no-nulo, o `status` pasa a `pendiente` | reimpresión (`comandas/reprint.ts`), anulación (`cancel-order.ts`) |
| `print_jobs` | `AFTER INSERT` | cuenta, control, cierre, rendición, factura, prueba |
| `print_jobs` | `AFTER UPDATE` cuando `reprint_requested_at` cambia a no-nulo, o `status` pasa a `pendiente` | reimpresión de cierre/rendición (`caja/*-print-actions.ts`), de cuenta y de factura |

El trigger **nunca** puede tumbar el insert: el `realtime.send` va envuelto en
`exception when others then null` (con `raise warning`). Una cuenta que no se
avisa sale por la red de seguridad (D3). Una cuenta que no se guarda es un bug
de caja.

### D2 · Cómo se autentica el agente: un usuario de auth por agente

Los canales privados de Realtime autorizan con la RLS de `realtime.messages` y
el **JWT** de la conexión. El agente hoy sólo tiene su key `pak_live_…`, que es
nuestra, no de Supabase.

**No se puede firmar un JWT propio:** el proyecto firma con **ES256** (JWKS
verificado 2026-09-18) y la clave privada la guarda Supabase. No hay
`SUPABASE_JWT_SECRET` que usar. Importar una clave propia al proyecto es un
cambio de config de auth en prod: descartado.

**Decisión:** cada credencial de agente tiene un **usuario de Supabase Auth**
propio, sin membresías, sin contraseña y con
`app_metadata = { print_agent_id, business_id }` (`app_metadata` lo escribe sólo
el service role; el usuario no lo puede cambiar).

- `POST /api/print-agent/realtime` (autenticado con la key, igual que el GET)
  crea el usuario si no existe y abre una sesión con
  `auth.admin.generateLink({ type: 'magiclink' })` + `verifyOtp`. Es la misma
  mecánica que `scripts/magic-link.mjs` y la invitación de empleados. **No se
  manda ningún mail.** Devuelve
  `{ realtime_url, publishable_key, access_token, refresh_token, expires_at, topic }`.
- El agente **refresca solo** contra `/auth/v1/token?grant_type=refresh_token`
  antes de que venza (1 h) y le pasa el token nuevo al canal (`access_token`).
  Sólo vuelve a pedirle al server si reinicia o si el refresh falla. Así queda
  una sesión por agente, no una por hora.
- **Policy** sobre `realtime.messages` (`select`, rol `authenticated`):
  `realtime.topic() = 'print-agent:' || (auth.jwt() -> 'app_metadata' ->> 'business_id')`.
  Nadie tiene policy de `insert`: sólo la base (el trigger, como owner) publica.
- Rotar la key (`rotatePrintAgentKey`) o borrar el agente **cierra sus sesiones**
  (`auth.admin.signOut` / borrar el usuario). Si no, un agente dado de baja
  seguiría escuchando hasta que venza el refresh.
- Un usuario de agente **no es una persona**: no tiene membresía en ningún
  negocio, así que toda la RLS de datos lo deja afuera. El email es sintético:
  `print-agent+<credential_id>@agents.pedidos.com.ar`. Queda en `auth.users`, y
  los listados de usuarios del panel de plataforma tienen que ignorarlo (ver
  Riesgos).

**Descartado:** un canal **público** con un nombre secreto (sin JWT). Es más
simple, pero cualquiera con el nombre y la publishable key puede escuchar
cuándo imprime el local y **publicar** avisos falsos que se traducen en
invocaciones a Vercel. Va en contra de «multi-tenant estricto» por ahorrarse un
endpoint.

### D3 · El long-poll no se va: queda como red de seguridad y latido

El websocket se cae (wifi del local, deploy de Realtime, la PC que se duerme).
El agente no puede depender sólo de él.

- **Con el canal suscripto:** el agente hace un GET con `wait_ms=0` cada
  **30 s** (reconciliación + latido para el panel) y uno inmediato por cada
  aviso. Sin retención: no hace falta.
- **Sin canal** (no conectó, se cayó, el server no devolvió credenciales):
  vuelve exactamente al loop de la 183 (GET con retención + `next_poll_ms`)
  mientras reconecta con backoff (1 s → 30 s). **Peor caso = el de hoy.**
- **Avisos que se pisan:** si llega un aviso con un GET en vuelo, se marca
  «sucio» y se hace **un** GET más al terminar. Nunca dos GET en paralelo, y
  nunca se pierde el aviso de un ítem que entró en el medio.
- Al (re)suscribir hace un GET inmediato: lo que se emitió mientras estaba
  caído sale ahí.

El panel sigue leyendo `print_agent_status.last_seen_at`. Con un latido cada
30 s entra holgado en `OFFLINE_THRESHOLD_MS` (138 s). No cambia.

### D4 · Confirmar no frena el próximo papel

Hoy `tick()` hace imprimir → POST de confirmación (~0,6 s a `iad1`) → siguiente.
Pasa a: imprimir en orden (el orden de la cola importa en cocina) y mandar la
confirmación **sin esperarla** antes del siguiente papel, con un
`Promise.allSettled` al final del lote. Una cuenta detrás de cuatro comandas
deja de esperar cuatro viajes.

El reintento de fallos (spec 33, `failState`) no cambia: un papel que no
imprimió no se confirma.

### D5 · Qué NO se hace

- **Mover funciones de región.** La base está en `us-east-1` y Vercel en `iad1`.
- **Mandar el ticket por el canal.** Sería más rápido (sin GET), pero sacaría el
  armado del server (051) y el alcance (124) de su lugar. El papel viajaría por
  un canal por negocio que ven todos los agentes de ese negocio. El GET cuesta
  ~0,5–1 s y es donde vive la seguridad.
- **Sacar la retención del server.** Los `.exe` viejos (golf y uno de kcc,
  `agent_version` NULL) la siguen usando hasta que se reinstalen.
- **Imprimir desde el navegador de la caja** (opción C del análisis).

---

## Requisitos

### ADDED · Aviso desde la base

- **Dado** un negocio con un agente escuchando `print-agent:<biz>`, **cuando**
  se inserta un `print_job` de ese negocio, **entonces** el agente recibe un
  mensaje `trabajo` en menos de 1 s.
- **Dado** `enviarComanda` creando una comanda, **cuando** se inserta la
  comanda **sin** ítems, **entonces** no hay aviso. **Cuando** se insertan sus
  `comanda_items`, **entonces** hay aviso y el GET que dispara trae la comanda
  completa.
- **Dado** una comanda impresa, **cuando** se pide su reimpresión, **entonces**
  hay aviso.
- **Dado** que `realtime.send` falla, **cuando** se inserta un `print_job`,
  **entonces** el insert se guarda igual.
- **Dado** un `print_job` del negocio A, **entonces** un agente de B no recibe
  nada.

### ADDED · Credenciales de Realtime para el agente

- **Dado** un agente con key válida, **cuando** hace `POST /api/print-agent/realtime`,
  **entonces** recibe una sesión cuyo JWT tiene `app_metadata.business_id` = su
  negocio, más el `topic` de su negocio.
- **Dado** una key inválida o de otro negocio, **entonces** 401 y no se crea
  ningún usuario.
- **Dado** el JWT del agente de A, **cuando** se suscribe a
  `print-agent:<B>`, **entonces** Realtime lo rechaza. *Esto se prueba con el
  JWT real, no con el service role.*
- **Dado** un agente cuya key se rotó, **entonces** su sesión deja de poder
  refrescarse.
- Pedir credenciales dos veces para el mismo agente **no** crea un segundo
  usuario.

### MODIFIED · Loop del agente

- **Dado** el canal suscripto y nada que imprimir, **entonces** el agente hace
  exactamente un GET cada ~30 s, con `wait_ms=0`.
- **Dado** el canal suscripto, **cuando** llega un aviso, **entonces** hay un
  GET en menos de 100 ms.
- **Dado** un GET en vuelo, **cuando** llegan N avisos, **entonces** al
  terminar hay exactamente **un** GET más.
- **Dado** que el websocket se cae, **entonces** el agente vuelve al loop de la
  183 en el acto y reintenta la conexión con backoff. Cuando reconecta, hace un
  GET y vuelve al modo push.
- **Dado** un server viejo que no tiene `/api/print-agent/realtime` (404),
  **entonces** el agente corre el loop de la 183 y no reintenta más de una vez
  cada 10 min.
- **Dado** un lote de 5 papeles, **entonces** la impresión del 2.º no espera la
  confirmación del 1.º.

### Objetivo medible

En producción (kcc y golf, una semana después de instalar el `.exe` nuevo):
**p90 de `print_jobs` emitido→impreso ≤ 3 s y max ≤ 10 s** (hoy: 11–51 s y
69 s). Y las invocaciones de `/api/print-agent` de un agente ocioso **no
suben** respecto de hoy (~2 por minuto).

---

## Alcance (archivos)

| archivo | qué |
|---|---|
| `supabase/migrations/01NN_el_agente_escucha.sql` | función `notify_print_agent(business_id)`; triggers en `print_jobs`, `comandas` y `comanda_items`; policy `select` en `realtime.messages` |
| `src/lib/print-agent/realtime.ts` (nuevo) | `abrirSesionDeAgente(credential)`: crear/buscar usuario, sesión, `topic` |
| `src/app/api/print-agent/realtime/route.ts` (nuevo) | `POST`, auth con `autenticarAgente` |
| `src/lib/print-agent/credentials-actions.ts` | rotar/borrar → `signOut` + borrar usuario |
| `print-agent/agent.mjs` | cliente Realtime mínimo sobre el `WebSocket` nativo de Node 22 (join, heartbeat, `access_token`, backoff); coalescer; D4; fallback a la 183. Sin dependencias nuevas: el `.exe` sigue siendo un solo archivo |
| `print-agent/README.md`, `print-agent/build/README.md` | modo push, cómo verificar |
| panel de plataforma (listado de usuarios) | filtrar `print-agent+…` si aparece |

El GET (`route.ts`) y la retención **no cambian**.

## No-objetivos

- Tocar el armado de los tickets o el alcance por impresora.
- Medir la latencia de las comandas: no tienen `printed_at`. Queda anotado. La
  meta se mide con `print_jobs`.
- Cambiar el instalador (`instalar.bat`): el `.exe` nuevo usa el mismo
  `config.json`.

## Riesgos

| riesgo | mitigación |
|---|---|
| El `.exe` sólo se prueba en Windows real (build cross-platform → bytecode rechazado, 2026-07-24) | `build-exe.sh` con `--public`; prueba en una PC Windows antes de publicar; `print-agent.zip.backup` para volver atrás |
| Hay que ir a los locales (golf, kcc ×2) a reinstalar | Sin reinstalar no se rompe nada: siguen en la 183. Coordinar con obejax |
| El `WebSocket` global de Node 22 en `pkg` | Verificar al principio (tarea 0): un `.exe` de prueba que abra un socket a Realtime |
| Usuarios de agente en `auth.users` ensucian listados o métricas | Email sintético con prefijo fijo; revisar los listados que leen `auth.users` |
| Cuota de Realtime | 3 conexiones y un puñado de mensajes por comida: muy lejos de cualquier límite |
| Trigger lento en inserts calientes (`comanda_items`) | Statement-level, un `realtime.send` por sentencia, sin queries adicionales salvo el `business_id` |
| Staging = base cloud (nota de sync del CLAUDE.md) | Todo se prueba primero en la base local (`supabase start` trae Realtime). A la cloud va la migración con el OK de Juan |

## Preguntas abiertas

1. ¿Alcanza con canal por negocio, o golf va a tener suficientes agentes como
   para que despertarlos a todos pese? Hoy: 1 en golf, 2 en kcc.
2. ¿Quién va a los locales a reinstalar y cuándo? El plan asume golf y kcc
   antes del go-live de House.

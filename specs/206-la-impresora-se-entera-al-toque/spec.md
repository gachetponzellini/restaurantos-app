# 206 · La impresora se entera al toque — y habla con Supabase, no con Vercel

**Issue:** [#341](https://github.com/gachetponzellini/RestaurantOS-app/issues/341) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 🚧 **en producción parcial** (2026-09-18). Aprobada por Juan e
implementada el mismo día, con Juan en kcc reinstalando:
- migración `0114` y Edge Function `print-agent` publicadas en prod;
- instalador 2026-09-18.2 publicado en el bucket;
- la **Terminal Mozos** de kcc ya corre en modo push (logs: `/session` 200 y
  `/pull` cada ~30 s).

**Diferencia con el diseño (D2):** la función no importa un módulo
refactorizado. Corre la ruta de Vercel **tal cual**, empaquetada con esbuild y
con adaptadores para `next/server` y el service client
(`src/lib/print-agent/edge/`). Da lo mismo por construcción y sin refactorizar
2.100 líneas bajo presión. Verificado byte a byte contra la ruta en local.

**Pendiente:** ver `tasks.md` § Pendiente post-deploy.

**Input:**
- La encargada, vía Juan (2026-09-18): *"se está quejando que tarda mucho en
  imprimir"*. Juan eligió la opción B del
  [análisis](../../../../wiki/analyses/print-agent-latencia.md): push.
- Juan, mismo día: *"cambiar la lógica del print agent para que sea con supa en
  vez de a través de vercel"*. La v1 de este spec seguía pidiendo el ticket a
  Vercel; esta versión **saca a Vercel del camino del agente**.

**Depende de:** [`183`](../183-el-agente-que-pregunta-cada-segundo/spec.md)
(retención, `next_poll_ms`, latido en el pull),
[`124`](../124-print-agents-por-alcance/spec.md) (alcance por impresora),
[`051`](../051-print-agent-render-server/spec.md) (el server arma el ticket),
[`181`](../181-el-control-sale-por-la-terminal/spec.md) +
[#342](https://github.com/gachetponzellini/RestaurantOS-app/issues/342) (la
comandera de quien pidió), [`046`](../046-print-agent-autoinstalador/spec.md)
(key por agente, instalador).

---

## Por qué

Hay dos problemas, y la misma forma los causa.

**1. La cola de latencia.** El agente *pregunta*. Un papel que aparece mientras
el agente duerme entre dos retenciones espera ese sueño completo. En
`print_jobs`, de emitido a impreso, últimos 10 días:

| local | papel | n | p50 | p90 | max |
|---|---|---|---|---|---|
| kcc | cuenta | 16 | 2,2 s | 11,2 s | 28,6 s |
| kcc | control | 11 | 5,8 s | 51,1 s | 68,9 s |

Caso: kcc, 2026-09-18. La cuenta se pide a las 14:16:11, no sale, se vuelve a
pedir a las 14:16:23 y las dos salen juntas a las 14:16:40.

**2. El agente vive en Vercel.** El 70% de la factura de Vercel era el
print-agent (#304). La 183 la bajó un 90%, pero cada agente sigue siendo una
function de Vercel retenida 25 s, dos veces por minuto, todo el día. Y "ojo que
ahí está gastando todavía" (Discord, 2026-09-17). El agente es un proceso de
máquina a máquina que sólo lee y escribe en la base: **no tiene por qué pasar
por el deploy de Next**.

## La idea

```
server action (Vercel, como hoy) ── insert print_job / comanda_items
                                             │ trigger
                                             ▼
                          realtime.send('print-agent:<biz>')   ← Supabase
                                             │ ~100–300 ms
                     agente (websocket, Realtime) ◀┘
                                             │ POST  functions/v1/print-agent/pull   ← Supabase Edge Function
                                             ▼                 (x-region: us-east-1, pegada a la base)
                                          imprime ── POST functions/v1/print-agent/ack   (sin bloquear el siguiente)
```

**El agente habla sólo con Supabase:** Realtime para enterarse y una **Edge
Function** para pedir y confirmar. El armado del ticket (051), el alcance (124)
y la comandera de quien pidió (181/#342) son **el mismo código de hoy**, movido
a un módulo que no depende de Next y lo usan las dos puertas. Vercel sólo sigue
atendiendo a los `.exe` viejos hasta que se reinstalen.

---

## Decisiones

### D1 · El agente habla con una Edge Function de Supabase, no con Vercel

Endpoints de la Edge Function `print-agent`:
- `POST /pull`: equivale al GET de hoy, con `wait_ms=0` siempre.
- `POST /ack`: equivale al POST de hoy (`ok` / `failed`).
- `POST /session`: credenciales de Realtime (D3).

Todas se autentican con la **misma key `pak_live_…`** del agente, contra
`print_agent_credentials`, con el service role que la función ya tiene en su
entorno.

- **Región `us-east-1`, siempre.** Por defecto una Edge Function corre en la
  región más cercana a quien llama. Para Argentina es São Paulo, y el pull hace
  varias queries a una base en `us-east-1`: cada una cruzaría el continente. El
  agente manda `x-region: us-east-1` (verificado en la doc de Supabase,
  «Regional Invocations»). Latencia esperada: la de hoy contra `iad1`, que está
  al lado de la base.
- **Sin retención.** La retención de la 183 existía para que *preguntar* fuera
  barato. Con push, el pull es inmediato y la función vive milisegundos.
- **Costo:** con un latido cada 30 s por agente, ~90k invocaciones por agente
  por mes; con 3 agentes, ~260k. La cuota incluida del plan es muy superior
  (confirmar en la tarea 0 contra el plan contratado). En Vercel, en cambio, se
  paga CPU y memoria por cada retención.

**Descartado:**
- **Que el agente lea las tablas directo (RPC/PostgREST) y arme el ticket él.**
  Es lo que la 051 vino a sacar. Cada cambio de formato de un papel
  obligaría a recompilar y reinstalar el `.exe` en cada local.
- **Armar el ticket en SQL.** Son seis familias de papeles con ESC/POS: no.
- **Renderizar el ticket al encolar y guardarlo en la fila.** Obliga a tocar
  todos los lugares que crean comandas y papeles (`enviarComanda`, el ruteo, el
  cron, el webhook de MP, la caja). Además, la cuenta tiene que salir con los
  números del momento en que se imprime.

### D2 · El armado sale de la ruta de Next a un módulo compartido

`src/app/api/print-agent/route.ts` (2.100 líneas) hoy mezcla tres cosas: HTTP de
Next, retención y armado. El armado y la confirmación pasan a
`src/lib/print-agent/pull.ts` y `ack.ts`: funciones que reciben un
`SupabaseClient` y devuelven datos, **sin `next/*`, sin `server-only` y sin
`@/lib/supabase/service`**. Las dos puertas las llaman:

- la ruta de Next (los `.exe` viejos): queda con la retención y el `NextResponse`;
- la Edge Function (los nuevos): un `index.ts` fino con auth, región y JSON.

Lo que el armado importa hoy es TypeScript puro: `lib/print/*` (`ticket`,
`*-ticket`, `agent-scope`, `cuenta-printer`, `fiscal-printer`),
`orders/entrega-por-lote`, `afip/{types,condicion-iva}`, `mozo/mozo-short-name`
y `business-hours`, que usa `date-fns-tz`, disponible como `npm:` en Deno.
**Un solo armado, dos puertas: nada se duplica.**

**Cómo llega el código a la función (tarea 0, spike).** La doc de Supabase
recomienda un `deno.json` por función y no dice si el bundle de deploy sigue
imports relativos fuera de `supabase/functions/`. Si los sigue: import map
`"@/": "../../../src/"`. Si no: un script (`pnpm print-agent:sync`) copia los
módulos a `supabase/functions/_shared/print/`, y un test de CI falla si la
copia difiere del original. **Nunca se editan a mano dos copias.**

**El aviso de fallo** (`notifyPrintFailed` → notificación + WhatsApp) arrastra
el outbox de WhatsApp y su proveedor: no se porta. Cuando el agente reporta
`failed` (spec 33, después del umbral), la función marca `print_failed_at` y le
pasa el aviso a la ruta de Vercel que ya lo hace, **server a server**. Es el
único viaje a Vercel que queda, y sólo cuando falla una impresión.

### D3 · El aviso: Broadcast desde la base, con un usuario de auth por agente

(Igual que la v1.)

**El trigger** llama a `realtime.send(payload, 'trabajo', 'print-agent:<business_id>', true)`.
El aviso **no lleva datos**. Es statement-level (un aviso por sentencia) y
envuelto en `exception when others` para que nunca tumbe el insert:

| tabla | cuándo | por qué ahí |
|---|---|---|
| `comanda_items` | `AFTER INSERT` | **No en `comandas`:** `enviarComanda` crea la comanda y sus ítems en dos viajes, y el pull descarta la comanda sin ítems (golf 2026-08-04, mesa R4) |
| `comandas` | `AFTER UPDATE` cuando `reprint_requested_at` cambia a no-nulo, o `status` pasa a `pendiente` | reimpresión, anulación |
| `print_jobs` | `AFTER INSERT` | cuenta, control, cierre, rendición, factura, prueba |
| `print_jobs` | `AFTER UPDATE` cuando `reprint_requested_at` cambia a no-nulo, o `status` pasa a `pendiente` | reimpresiones de caja, cuenta y factura |

**Auth de Realtime.** Los canales privados autorizan con el JWT de la conexión.
El proyecto firma con **ES256** y la clave privada la guarda Supabase, así que
no podemos firmar un JWT propio. Entonces:

- Cada credencial de agente tiene un **usuario de Supabase Auth** propio, sin
  membresías, con `app_metadata = { print_agent_id, business_id }` y un email
  sintético (`print-agent+<id>@agents.pedidos.com.ar`).
- `POST /session` le abre una sesión con `generateLink` + `verifyOtp`, sin
  mandar ningún mail.
- El agente refresca solo contra `/auth/v1/token`.
- Policy `select` en `realtime.messages`:
  `realtime.topic() = 'print-agent:' || (auth.jwt()->'app_metadata'->>'business_id')`.
  No hay policy de `insert`.
- Rotar la key o borrar el agente borra ese usuario y cierra sus sesiones.

**Descartado:** un canal público con nombre secreto. Cualquiera con el nombre
podría escuchar cuándo imprime el local y mandar avisos falsos.

### D4 · Sin canal, el agente sigue imprimiendo

- **Con canal:** un pull por aviso y otro cada **30 s** (reconciliación y
  latido; el latido sigue siendo el upsert de `print_agent_status` que hoy hace
  el GET, ahora lo hace `/pull`). Si llegan avisos con un pull en vuelo, se
  marca «sucio» y se hace **uno** más al terminar. Al (re)conectar, pull
  inmediato.
- **Sin canal** (no conecta, se cae): pull cada **5 s** contra la Edge
  Function, con reconexión con backoff (1 → 30 s). Sin retención, porque en
  Deno no conviene tener una function colgada. Son 5 s de latencia máxima
  mientras dure el corte.
- **Sin Edge Function** (deploy roto, 404/5xx sostenido): vuelve al **loop de la
  183 contra Vercel**, que sigue vivo por los `.exe` viejos. Es la red de
  seguridad final, y queda mientras exista la ruta.

El panel sigue leyendo `print_agent_status.last_seen_at`. Con un latido cada
30 s o menos, `OFFLINE_THRESHOLD_MS` (138 s) no cambia.

### D5 · Confirmar no frena el próximo papel

Se imprime en orden y la confirmación sale **sin esperarla** antes del
siguiente papel. Al final del lote, `allSettled`. `failState` (spec 33) no
cambia.

### D6 · Config y convivencia

- `buildAgentConfig` suma `supabaseUrl` y `publishableKey` (que es pública) al
  `config.json`. El `.exe` nuevo:
  - con esos campos, corre en modo Supabase;
  - sin ellos (un config viejo), corre en modo 183 contra `serverUrl`.

  Así se puede reinstalar el `.exe` antes de bajar un config nuevo sin romper
  nada.
- Los `.exe` viejos (golf, "Agente principal" de kcc) siguen contra Vercel hasta
  que se reinstalen. **Retirar la ruta de Vercel** queda para una spec aparte,
  cuando ningún agente la haya llamado en 2 semanas (se ve por
  `x-agent-version`).

### D7 · Qué NO se hace

- Mandar el ticket por el canal de Realtime: el canal es por negocio y lo ven
  todos los agentes del negocio. El alcance vive en el pull.
- Mover Vercel de región.
- Tocar las server actions que encolan (siguen en Vercel, como toda la app).
- Imprimir desde el navegador.

---

## Requisitos

### ADDED · Edge Function `print-agent`

- **Dado** un agente con key válida, **cuando** hace `POST /pull`, **entonces**
  recibe **los mismos papeles, byte a byte**, que le daría hoy el GET de Vercel
  con `wait_ms=0` (mismo `content_escpos_b64`, mismo `printer_ip`, mismo
  alcance). *Test de contrato: las dos puertas sobre el mismo fixture.*
- **Dado** una key inválida o de otro negocio, **entonces** 401, sin leer nada.
- **Dado** `POST /ack` con `ok`, **entonces** el papel pasa a impreso (misma
  semántica que el POST de hoy, incluido el dedup de `failed`).
- **Dado** `POST /ack` con `failed` pasado el umbral, **entonces**
  `print_failed_at` queda marcado y el encargado recibe la notificación de
  siempre.
- **Dado** un `POST /pull`, **entonces** se registra el latido
  (`print_agent_status`) con la versión del agente.
- **Dado** que el agente manda `x-region: us-east-1`, **entonces** el pull de
  un negocio con 6 papeles pendientes responde en **< 800 ms** medido desde el
  local.

### ADDED · Aviso desde la base

- **Dado** un agente suscripto, **cuando** se inserta un `print_job` de su
  negocio, **entonces** recibe `trabajo` en < 1 s.
- **Dado** `enviarComanda`: la comanda sin ítems **no** avisa; al insertar sus
  `comanda_items`, **sí** avisa, y el pull trae la comanda completa.
- **Dado** que `realtime.send` falla, **entonces** el insert se guarda igual.
- **Dado** el JWT del agente de A, **entonces** no puede suscribirse a
  `print-agent:<B>`. *Probado con el JWT real, no con service role.*
- Rotar la key cierra el canal del agente.

### MODIFIED · Agente

- Con canal y nada que imprimir: exactamente un `/pull` cada ~30 s, y **cero
  requests a Vercel**.
- Con canal, cuando llega un aviso: `/pull` en < 100 ms.
- N avisos con un pull en vuelo: exactamente **un** pull más.
- Canal caído: `/pull` cada 5 s, y al reconectar vuelve al push.
- Edge Function caída: loop 183 contra Vercel.
- Config sin `supabaseUrl`: loop 183 contra Vercel, igual que hoy.
- Lote de 5: el 2.º no espera la confirmación del 1.º.

### Objetivo medible

Una semana después de reinstalar en kcc y golf:
- **p90 de `print_jobs` emitido → impreso ≤ 3 s, max ≤ 10 s** (hoy: 11–51 s y
  69 s).
- **Invocaciones de `/api/print-agent` en Vercel: 0** de los agentes nuevos.

---

## Alcance (archivos)

| archivo | qué |
|---|---|
| `src/lib/print-agent/pull.ts`, `ack.ts` (nuevos) | el armado y la confirmación sacados de `route.ts`, sin dependencias de Next |
| `src/app/api/print-agent/route.ts` | queda fino: auth + retención + llamar a `pull`/`ack` |
| `supabase/functions/print-agent/{index.ts,deno.json}` (nuevos) | `/pull`, `/ack`, `/session`; auth con la key; latido |
| `supabase/functions/_shared/print/` + `scripts/print-agent-sync` | **sólo si el spike dice que hace falta copiar** (D2), con test de sincronía |
| `supabase/migrations/01NN_el_agente_escucha.sql` | `notify_print_agent`, triggers, policy en `realtime.messages` |
| `src/lib/print-agent/credentials.ts` / `-actions.ts` | `buildAgentConfig` con `supabaseUrl`/`publishableKey`; rotar/borrar → borrar el usuario de auth |
| `print-agent/agent.mjs` | modo Supabase (Realtime mínimo sobre el `WebSocket` de Node 22, `/pull`, `/ack`, `/session`), coalescer, D5, fallbacks. Sin dependencias nuevas |
| `print-agent/README.md`, `build/README.md` | modo Supabase, cómo verificar |

## No-objetivos

- Retirar la ruta de Vercel: otra spec, cuando no la use nadie.
- Cambiar el formato de ningún papel.
- `printed_at` en comandas (anotado: sin eso no se mide la latencia de cocina).

## Riesgos

| riesgo | mitigación |
|---|---|
| El bundle de la Edge Function no sigue imports fuera de `supabase/functions` | Tarea 0. Plan B: copia generada más test de sincronía (D2) |
| Deno vs Node en el armado (Buffer, `date-fns-tz`) | Tarea 0: correr el test de contrato bajo `supabase functions serve` |
| El `.exe` sólo se prueba en Windows real | Tarea 0: spike del `WebSocket` en `pkg`; `print-agent.zip.backup` para volver |
| Reinstalar en golf y kcc (×2) | Sin reinstalar no se rompe nada: los viejos siguen en la 183 |
| Usuarios de agente en `auth.users` | Email con prefijo fijo; filtrar en los listados del panel de plataforma |
| Edge Function caída | D4: cae a Vercel mientras la ruta exista |
| Deploy de la función y la migración a prod | Con OK de Juan, vía MCP de Supabase, después de probar todo en la base local |

## Preguntas abiertas

1. ¿Canal por negocio alcanza? Hoy son 1 agente en golf y 2 en kcc, y un aviso
   despierta a todos los del negocio.
2. ¿Quién reinstala en los locales, y cuándo?
3. ¿Retiramos la ruta de Vercel apenas estén los tres reinstalados, o la dejamos
   como red de seguridad (D4) un tiempo?

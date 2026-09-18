# 206 · Tareas (v2 — el agente habla con Supabase)

TDD: test rojo → implementación → verify. Todo contra la **base local**
(`supabase start` trae Realtime y Edge Functions). A prod van la migración y la
función, con el OK de Juan.

## 0 · Spikes: lo que puede tumbar el plan

- [ ] **Edge Function + código compartido:** `supabase/functions/print-agent`
      que importe `src/lib/print/ticket.ts` vía import map `"@/": "../../../src/"`.
      Correr `supabase functions serve` y, si se puede, un deploy a una rama de
      Supabase. ¿El bundle lo sigue? Si no, plan B de D2 (copia + test de
      sincronía).
- [ ] **Deno:** el armado (`Buffer`, `date-fns-tz` como `npm:`) corre igual
      bajo Deno.
- [ ] **Windows:** `.exe` de prueba (node22-win-x64) que abra
      `new WebSocket(<realtime>)`, haga `phx_join` a un canal y loguee un
      broadcast. En una PC Windows real.
- [ ] **Auth:** en local, `generateLink` + `verifyOtp` para
      `print-agent+…@agents.pedidos.com.ar`, sin mail. El JWT trae
      `app_metadata`, y un join a un canal privado ajeno se rechaza.
- [ ] **Región y cuota:** medir un pull con `x-region: us-east-1` desde
      Argentina; confirmar la cuota de invocaciones del plan.

## 1 · Sacar el armado de la ruta (sin cambiar comportamiento)

- [ ] Test de contrato (rojo): fixture de un negocio con las seis familias,
      más comandas, alcance y comandera de quien pidió (#342) → snapshot de lo
      que devuelve el GET de hoy.
- [ ] Mover armado → `lib/print-agent/pull.ts` y POST → `ack.ts`,
      recibiendo el `SupabaseClient`. `route.ts` queda en auth + retención.
- [ ] Los tests actuales de `src/app/api/print-agent/*` y el de contrato,
      verdes **sin tocarlos**.

## 2 · Base

- [ ] Tests de integración (rojo): `print_job` insert → mensaje en
      `realtime.messages` (`topic`, `private`); comanda sin ítems → nada;
      `comanda_items` → uno por sentencia; reimpresión / `→ pendiente` → uno;
      otros updates → nada; `realtime.send` roto → el insert se guarda.
- [ ] Migración `01NN_el_agente_escucha.sql`. Tomar el número al crearla: hay
      sesiones en paralelo sumando migraciones.
- [ ] Test RLS **con el JWT real del agente**: su topic sí, el ajeno no.
- [ ] `pnpm db:types`.

## 3 · Edge Function

- [ ] `/pull`: auth con la key (401 sin leer nada), latido, `pull.ts`.
      **El test de contrato corre también contra la función** y da lo mismo
      que la ruta.
- [ ] `/ack`: `ok` / `failed` / dedup. Pasado el umbral → aviso server a
      server a la ruta de Vercel que notifica.
- [ ] `/session`: crea o reusa el usuario de auth, abre la sesión y devuelve
      `{realtime_url, access_token, refresh_token, expires_at, topic}`.
- [ ] Rotar la key / borrar el agente → borrar el usuario. Test.
- [ ] Filtrar `print-agent+…` en los listados que leen `auth.users`.

## 4 · Agente (`print-agent/agent.mjs`)

- [ ] Lógica pura extraída y testeada con vitest: coalescer, backoff, cuándo
      refrescar, elección de modo (Supabase / Supabase sin canal / 183).
- [ ] Cliente Realtime mínimo: `phx_join` (`private: true`), heartbeat de
      25 s, `access_token` al refrescar, reconexión.
- [ ] `/pull` con `x-region: us-east-1`; D5 (ack sin bloquear); fallbacks D4.
- [ ] `buildAgentConfig`: `supabaseUrl` + `publishableKey`. Test.
- [ ] `AGENT_VERSION` nueva.

## 5 · Verificar

- [ ] `pnpm typecheck` + `pnpm test` en verde.
- [ ] Local, de punta a punta, como Sofía (demo): `node agent.mjs --dry-run`
      en modo Supabase. Cobrar una mesa → la cuenta aparece en ≤ 1,5 s; cargar
      un pedido → la comanda sale completa. **Cero requests a
      `localhost:3003/api/print-agent`** en ese modo (logs del dev server).
- [ ] Cortar la red del agente → pull cada 5 s → reconecta. Frenar la función
      → cae a Vercel.
- [ ] Rotar la key → pierde canal y pull (401).
- [ ] `.exe` en Windows real.
- [ ] Prod (OK de Juan): migración + deploy de la función → reinstalar en kcc
      y golf con el config nuevo.
- [ ] Una semana después: p90/max de `print_jobs` e invocaciones de Vercel
      contra el objetivo del spec. Anotarlo en «Lo medido después».

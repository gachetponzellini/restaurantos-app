# 206 · Tareas

TDD: test rojo → implementación → verify. Todo contra la **base local**
(`supabase start` trae Realtime); a la cloud sólo la migración, con el OK de
Juan.

## 0 · Descartar lo que puede tumbar el plan (antes de escribir producción)

- [ ] **Spike Windows:** `.exe` de prueba (`build-exe.sh`, node22-win-x64) que
      abra `new WebSocket(<realtime>)`, haga `phx_join` a un canal público y
      loguee un broadcast. Correrlo en una PC Windows real. Si el `WebSocket`
      global no está en el `pkg`, D2/D3 cambian (bundlear `ws`).
- [ ] **Spike auth:** en local, `generateLink` + `verifyOtp` para un email
      `print-agent+…@agents.pedidos.com.ar` sin mail real; el JWT trae
      `app_metadata`; con ese JWT, un join a canal privado ajeno se rechaza.

## 1 · Base

- [ ] Test de integración (rojo): insertar un `print_job` → aparece una fila en
      `realtime.messages` con `topic = 'print-agent:<biz>'` y `private = true`.
- [ ] Ídem: comanda sin ítems → **ninguna**; al insertar `comanda_items` → una
      por sentencia (no una por fila).
- [ ] Ídem: `reprint_requested_at` no-nulo o `status → pendiente` en `comandas`
      y `print_jobs` → aviso; otros updates (`printed_at`, `status → impreso`)
      → nada.
- [ ] Ídem: `realtime.send` forzado a fallar → el insert se guarda.
- [ ] Migración `01NN_el_agente_escucha.sql`: `notify_print_agent`, triggers y
      policy `select` en `realtime.messages`. Tomar el número al momento de
      crearla: hay sesiones en paralelo sumando migraciones.
- [ ] Test RLS **con el JWT real del agente** (no service role): lee su topic y
      no el de otro negocio.
- [ ] `pnpm db:types`.

## 2 · Server

- [ ] `realtime.test.ts` (rojo): `abrirSesionDeAgente` crea el usuario la
      primera vez y lo reusa la segunda; `app_metadata` = `{print_agent_id, business_id}`.
- [ ] `POST /api/print-agent/realtime`: 401 con key mala o de otro negocio (sin
      crear usuario); 200 con `{realtime_url, publishable_key, access_token, refresh_token, expires_at, topic}`.
- [ ] Rotar la key / borrar el agente → `signOut` + borrar el usuario. Test.
- [ ] Revisar los listados que leen `auth.users` (panel de plataforma) y
      excluir `print-agent+…`.

## 3 · Agente (`print-agent/agent.mjs`)

- [ ] Sacar la lógica pura a funciones testeables con vitest: coalescer de
      avisos, backoff, cuándo refrescar el token, elección de modo
      (push/long-poll).
- [ ] Tests (rojo) de esas funciones: N avisos con un GET en vuelo → 1 GET
      extra; backoff 1 → 30 s; 404 del endpoint → long-poll y reintento cada
      10 min.
- [ ] Cliente Realtime mínimo: `phx_join` (`private: true`, `access_token`),
      heartbeat de 25 s, `access_token` al refrescar, reconexión.
- [ ] Loop: con canal → GET `wait_ms=0` por aviso y cada 30 s; sin canal → loop
      183 tal cual.
- [ ] D4: confirmación sin bloquear el siguiente papel; `allSettled` al final
      del lote.
- [ ] `AGENT_VERSION` nueva.

## 4 · Verificar

- [ ] `pnpm typecheck` + `pnpm test` en verde (salvo el preexistente
      `print-agent/control-tickets`).
- [ ] Local de punta a punta: agente con `node agent.mjs --dry-run` contra
      `localhost`, como Sofía (demo): cobrar una mesa → la cuenta aparece en la
      consola del agente en ≤ 1,5 s. Cargar un pedido → la comanda sale
      completa, nunca «(sin items)».
- [ ] Cortar la red del agente → vuelve a long-poll; al volver, GET inmediato.
- [ ] Rotar la key desde el panel → el agente pierde el canal y cae a
      long-poll con 401.
- [ ] `.exe` en Windows real (checklist de `print-agent/build/README.md`).
- [ ] Migración a la cloud (OK de Juan) → deploy → reinstalar en kcc y golf.
- [ ] Una semana después: p90/max de `print_jobs` contra el objetivo del spec.
      Anotarlo en «Lo medido después».

-- ────────────────────────────────────────────────────────────────────────
-- 0132 — el programado que falla siempre al marchar deja de reintentar en
-- silencio y avisa (#148 · H-42)
--
-- El cron de marcha (`march-scheduled`) corre cada 5 min y no tenía techo: un
-- pedido que fallaba SIEMPRE al marchar (`routeOrderToCocina`) se reintentaba
-- para siempre — 288 veces por día, en silencio, hasta que alguien lo notaba
-- a mano (típicamente el cliente parado en el mostrador).
--
-- `march_attempts` cuenta los intentos fallidos. Al llegar al techo
-- (`MARCH_ATTEMPTS_MAX` en march-scheduled.ts) el cron deja de tocar la orden
-- y avisa al encargado UNA vez. La idempotencia del aviso es
-- `march_alerted_at`, que la 0050 (spec 127) ya había creado para esto y
-- nunca se llegó a escribir. Marcharlo a mano («Marchar ahora» →
-- `confirmarPedido`) no pasa por este contador.
--
-- Aditiva: default 0, no cambia ninguna orden existente.
-- ────────────────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists march_attempts integer not null default 0;

comment on column public.orders.march_attempts is
  'Intentos fallidos del cron de marcha (#148 · H-42). Al llegar al techo el cron deja de reintentar y avisa (idempotencia: march_alerted_at). Una vez marchada o cancelada, la orden sale del universo del cron y el número deja de leerse.';

-- Un borrador de esta migración, aplicado al cloud por otra sesión, agregó
-- además `march_failed_at`. Quedó sin uso: la idempotencia es `march_alerted_at`.
-- Se saca acá para que el repo y el cloud terminen iguales. En una base nueva
-- no existe y esto no hace nada.
alter table public.orders
  drop column if exists march_failed_at;

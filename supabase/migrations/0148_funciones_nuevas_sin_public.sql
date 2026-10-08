-- ────────────────────────────────────────────────────────────────────────
-- 0148 — las funciones nuevas nacen sin EXECUTE para PUBLIC (SEC-04, restaurantos-brain#39)
--
-- La 0147 hizo `alter default privileges in schema public revoke ... from
-- public, anon`. Sacó el grant explícito a anon (el que Supabase define por
-- schema), pero NO el de PUBLIC: los defaults por schema se SUMAN al default
-- global, y el global de Postgres le da EXECUTE a PUBLIC en toda función
-- nueva. Probado en el cloud: una función creada después de la 0147 seguía
-- con `=X/postgres` y anon podía ejecutarla.
--
-- El revoke va global (sin IN SCHEMA) para el rol que corre las migraciones.
-- authenticated y service_role siguen recibiendo EXECUTE por el default de
-- schema de `public`; una RPC que deba llamar un anónimo necesita
-- `grant execute ... to anon` explícito.
-- ────────────────────────────────────────────────────────────────────────

alter default privileges for role postgres revoke execute on functions from public;

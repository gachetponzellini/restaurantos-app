-- ────────────────────────────────────────────────────────────────────────
-- 0133 — el auto-no_show no cierra una reserva cuya mesa está ocupada
-- (#148 · H-46)
--
-- La reserva de 8 personas llega, el mozo la sienta como walk-in (única
-- acción que tenía en su app) y `reservations.status` se queda en
-- `confirmed` para siempre — sentar por ese camino nunca lo actualizaba.
-- A los `no_show_grace_min` el cron la marcaba `no_show` con la mesa llena
-- de gente comiendo.
--
-- Defensa en profundidad: la app del mozo ya tiene «Sentar reserva» (que
-- SÍ marca `seated`), pero esto cubre cualquier otro camino que abra la
-- mesa sin pasar por ahí. Si la mesa de la reserva no está `libre`, alguien
-- la ocupó — no se cierra la reserva. Una reserva sin mesa fija (genérica,
-- `table_id is null`) sigue su regla de siempre.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.mark_overdue_reservations_no_show()
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  with upd as (
    update public.reservations r
    set status = 'no_show'
    where r.status = 'confirmed'
      and r.starts_at + make_interval(mins => coalesce(
            (select s.no_show_grace_min
               from public.reservation_settings s
              where s.business_id = r.business_id),
            30)) < now()
      and (
        r.table_id is null
        or not exists (
          select 1 from public.tables t
           where t.id = r.table_id
             and t.operational_status <> 'libre'
        )
      )
    returning 1
  )
  select count(*)::int from upd;
$function$;

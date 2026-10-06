-- ────────────────────────────────────────────────────────────────────────
-- 0144 — las funciones de trigger de la caja v2 no se exponen (advisor 0028/0029)
--
-- Un trigger corre igual sin EXECUTE para el rol que dispara; sacarlo deja
-- de listarlas en /rest/v1/rpc. Higiene: no cambia comportamiento.
-- ────────────────────────────────────────────────────────────────────────

revoke execute on function public.trg_quien_rinde() from public, anon, authenticated;
revoke execute on function public.trg_guarda_mozo_rendido() from public, anon, authenticated;
revoke execute on function public.trg_mozo_del_negocio() from public, anon, authenticated;
revoke execute on function public.trg_negocio_nuevo_abre_turno() from public, anon, authenticated;
revoke execute on function public.trg_guarda_movimiento_de_mozo() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 0106 — el control sale por la terminal que lo mandó (spec 181)
--
-- KCC tiene dos terminales —la compu que usan los mozos para comandar— con
-- una comandera USB cada una que imprime sólo el control, y en otra red que la
-- del print-agent de cocina. El control era UNO por negocio
-- (`businesses.control_printer_ip`, spec 063): el sistema no sabía desde qué
-- compu se había mandado nada.
--
-- Con un login de terminal por compu (D1), la sesión identifica la compu, y la
-- impresora de control vive en el usuario terminal. `null` = la del negocio.
-- El destino admite `local:NOMBRE` (D3): el nombre de la impresora en el
-- spooler de Windows de esa compu — no hay socket, no hay IP.
-- ────────────────────────────────────────────────────────────────────────

alter table "public"."business_users"
  add column if not exists "control_printer_ip"   text,
  add column if not exists "control_printer_port" integer;

comment on column "public"."business_users"."control_printer_ip" is
  'Spec 181: la comandera de control de ESTA terminal (rol terminal). IP o `local:NOMBRE` (impresora USB en la compu del agente). null = la del negocio.';
comment on column "public"."business_users"."control_printer_port" is
  'Spec 181: puerto de la comandera de control de la terminal. Ignorado para destinos local:.';

alter table "public"."business_users"
  drop constraint if exists "business_users_control_printer_port_check";
alter table "public"."business_users"
  add constraint "business_users_control_printer_port_check"
  check ("control_printer_port" is null or ("control_printer_port" between 1 and 65535));

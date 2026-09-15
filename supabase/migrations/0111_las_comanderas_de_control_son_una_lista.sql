-- 0111 · Las comanderas de control son una lista del negocio (spec 190).
--
-- Hasta acá la comandera de control era un STRING repetido: uno en
-- `businesses.control_printer_ip`, y desde las specs 181/186 uno más por cada
-- usuario que tuviera la suya. En KCC la 192.168.10.210 ya estaba escrita cinco
-- veces (control del negocio + cuenta del negocio + cuenta de los 3 salones), y
-- cada encargado con USB sumaba otra. Un typo no se ve hasta que no sale el
-- papel.
--
-- Acá la comandera pasa a ser una fila con nombre. El usuario la ELIGE.
-- Alcance a propósito: sólo control. El sector y la cuenta por salón siguen con
-- su string — imprimen bien hoy en un local operando y no se tocan (decisión de
-- Juan, 2026-09-15).

create table if not exists public.control_printers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- Cómo la llama el local: «Caja 2», «Mostrador». Es lo que se elige.
  name text not null,
  -- IP, host de red o `local:NOMBRE` (la USB de esa compu, spec 181).
  printer_ip text not null,
  printer_port integer not null default 9100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint control_printers_name_no_vacio check (length(btrim(name)) > 0),
  constraint control_printers_ip_no_vacio check (length(btrim(printer_ip)) > 0),
  constraint control_printers_port_rango check (printer_port between 1 and 65535)
);

-- Un nombre no se repite dentro del negocio: es lo que el encargado elige de la
-- lista, y dos «Caja 2» serían una trampa.
create unique index if not exists control_printers_nombre_uniq
  on public.control_printers (business_id, lower(btrim(name)));

create index if not exists control_printers_business_idx
  on public.control_printers (business_id) where is_active;

alter table public.control_printers enable row level security;

-- Misma forma que `stations` (0001): la lee y la escribe el miembro del
-- negocio; las mutaciones de verdad pasan por server actions con service role,
-- que chequean `canManageBusiness`.
drop policy if exists control_printers_select on public.control_printers;
create policy control_printers_select on public.control_printers
  for select to authenticated
  using (public.is_business_member(business_id) or public.is_platform_admin());

drop policy if exists control_printers_insert on public.control_printers;
create policy control_printers_insert on public.control_printers
  for insert to authenticated
  with check (public.is_business_member(business_id) or public.is_platform_admin());

drop policy if exists control_printers_update on public.control_printers;
create policy control_printers_update on public.control_printers
  for update to authenticated
  using (public.is_business_member(business_id) or public.is_platform_admin())
  with check (public.is_business_member(business_id) or public.is_platform_admin());

drop policy if exists control_printers_delete on public.control_printers;
create policy control_printers_delete on public.control_printers
  for delete to authenticated
  using (public.is_business_member(business_id) or public.is_platform_admin());

-- El usuario elige una de la lista. `null` = la del negocio, que sigue siendo
-- el default (y es el caso de casi todos).
alter table public.business_users
  add column if not exists control_printer_id uuid
    references public.control_printers(id) on delete set null;

create index if not exists business_users_control_printer_idx
  on public.business_users (control_printer_id) where control_printer_id is not null;

-- Backfill: cada destino distinto que hoy esté escrito en un usuario se
-- convierte en UNA comandera, y los usuarios que compartían ese destino quedan
-- apuntando a la misma fila. El nombre sale del propio destino: `local:CAJA2`
-- → «CAJA2», una IP → la IP. Se renombra desde el panel.
with destinos as (
  select distinct
    bu.business_id,
    btrim(bu.control_printer_ip) as ip,
    coalesce(bu.control_printer_port, 9100) as port
  from public.business_users bu
  where bu.control_printer_ip is not null
    and length(btrim(bu.control_printer_ip)) > 0
),
creadas as (
  insert into public.control_printers (business_id, name, printer_ip, printer_port)
  select
    d.business_id,
    case when lower(d.ip) like 'local:%' then btrim(substring(d.ip from 7)) else d.ip end,
    d.ip,
    d.port
  from destinos d
  on conflict do nothing
  returning id, business_id, printer_ip
)
update public.business_users bu
set control_printer_id = c.id
from public.control_printers c
where c.business_id = bu.business_id
  and c.printer_ip = btrim(bu.control_printer_ip)
  and bu.control_printer_ip is not null
  and bu.control_printer_id is null;

-- `control_printer_ip` / `control_printer_port` quedan en la tabla y SIN
-- lectores: expand/contract. Borrarlas en la misma migración rompería el deploy
-- viejo durante la ventana entre migrar y deployar — el resolver del control
-- las pide por nombre y PostgREST devolvería error. Se borran aparte, con el
-- código nuevo ya arriba.
comment on column public.business_users.control_printer_ip is
  'DEPRECADA (spec 190): la comandera vive en `control_printers` y el usuario la elige por `control_printer_id`. Sin lectores desde 2026-09-15.';
comment on column public.business_users.control_printer_port is
  'DEPRECADA (spec 190): ver `control_printer_ip`.';

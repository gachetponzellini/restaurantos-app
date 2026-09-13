-- ────────────────────────────────────────────────────────────────────────
-- 0104 — las asistencias se corrigen (spec 179)
--
-- Una fichada mal hecha era para siempre: `clock_entries` tenía sólo policy
-- de SELECT y se escribía por service-role desde `clockPunch`. Pedido de KCC
-- (2026-09-09): *"que se puedan editar las asistencias, solo por los
-- encargados"*.
--
-- Copia el molde de la 070 (corrección de líneas de caja): motivo obligatorio,
-- un renglón de audit por campo cambiado, y NUNCA borrar — anular y que quede
-- visible. Es sueldo: lo que se corrige tiene que poder reconstruirse.
-- ────────────────────────────────────────────────────────────────────────

-- ── 1) La fichada: quién la cargó, y si se anuló ─────────────────────────────

alter table "public"."clock_entries"
  add column if not exists "created_by" uuid references "public"."users"("id") on delete set null,
  add column if not exists "cancelled_at" timestamptz,
  add column if not exists "cancelled_reason" text,
  add column if not exists "cancelled_by" uuid references "public"."users"("id") on delete set null;

comment on column "public"."clock_entries"."created_by" is
  'Spec 179: null = fichó el empleado con su PIN. Con valor = la cargó a mano un encargado (la fichada que faltó).';
comment on column "public"."clock_entries"."cancelled_at" is
  'Spec 179: fichada anulada. Deja de sumar horas y de contar como abierta, pero sigue visible (tachada) en el detalle del día. La asistencia nunca borra, marca.';

alter table "public"."clock_entries"
  drop constraint if exists "clock_entries_cancelled_check";
alter table "public"."clock_entries"
  add constraint "clock_entries_cancelled_check"
  check (("cancelled_at" is null) = ("cancelled_reason" is null));

-- ── 2) Las reglas duras (D3) ─────────────────────────────────────────────────
--
-- Un empleado no puede tener dos fichadas abiertas. `clockPunch` lo asumía con
-- un `maybeSingle()` que revienta si se rompe; con edición manual se puede
-- romper desde un formulario. Verificado antes: en el cloud no hay ningún
-- empleado con dos abiertas.
create unique index if not exists "clock_entries_una_abierta_uniq"
  on "public"."clock_entries" ("business_id", "user_id")
  where "clock_out" is null and "cancelled_at" is null;

-- Sirve «las fichadas vivas de este empleado alrededor de esta fecha», que es
-- lo que la validación de superposición lee.
create index if not exists "clock_entries_vivas_idx"
  on "public"."clock_entries" ("business_id", "user_id", "clock_in")
  where "cancelled_at" is null;

-- ── 3) El rastro ─────────────────────────────────────────────────────────────

create table if not exists "public"."clock_audit_log" (
  "id"          uuid primary key default gen_random_uuid(),
  "business_id" uuid not null references "public"."businesses"("id") on delete cascade,
  "entry_id"    uuid not null references "public"."clock_entries"("id") on delete cascade,
  -- 'clock_in' | 'clock_out' | 'created' | 'cancelled'
  "field"       text not null,
  "from_value"  text,
  "to_value"    text,
  "by_user_id"  uuid references "public"."users"("id") on delete set null,
  "reason"      text not null,
  "created_at"  timestamptz not null default now(),
  constraint "clock_audit_log_field_check"
    check ("field" in ('clock_in', 'clock_out', 'created', 'cancelled')),
  constraint "clock_audit_log_reason_check"
    check (btrim("reason") <> '')
);

comment on table "public"."clock_audit_log" is
  'Spec 179: rastro de toda corrección de una fichada, un renglón por campo cambiado. Escritura sólo desde las actions (service role). Mismo molde que caja_audit_log.';

create index if not exists "clock_audit_log_entry_idx"
  on "public"."clock_audit_log" ("entry_id", "created_at" desc);
create index if not exists "clock_audit_log_business_idx"
  on "public"."clock_audit_log" ("business_id", "created_at" desc);

alter table "public"."clock_audit_log" enable row level security;

-- Lectura: admin del negocio (o platform admin). Nadie escribe desde el
-- cliente: sin policies de insert/update/delete, sólo el service role.
create policy "clock_audit_log_select" on "public"."clock_audit_log"
  for select to authenticated using (public.is_business_admin("business_id"));

grant all on table "public"."clock_audit_log" to anon, authenticated, service_role;

-- 155_assistant_sql_pro.sql
-- "Modo Pro": herramienta de SQL de SOLO LECTURA para el Asistente IA.
--
-- Seguridad por capas:
--   1) Rol de mínimos privilegios `assistant_ro` (NOLOGIN, NOINHERIT) que SOLO
--      puede leer un set curado de vistas `v_assistant_*`, nunca tablas base.
--   2) Las vistas fuerzan el filtro de organización vía GUC `app.current_org`
--      (seteado server-side por la función, jamás por el modelo).
--   3) `run_assistant_sql` (SECURITY DEFINER) valida SELECT-only, hace SET ROLE
--      a assistant_ro, fija statement_timeout y cap de 500 filas.
-- La validación de texto es defensa adicional; el límite real es el rol.

-- ── Helper: organización activa desde el GUC de sesión ───────────────
create or replace function public._assistant_current_org()
returns uuid
language sql
stable
as $$ select nullif(current_setting('app.current_org', true), '')::uuid $$;

-- ── Rol de solo lectura ──────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'assistant_ro') then
    create role assistant_ro nologin noinherit;
  end if;
end $$;

-- El dueño de la función SECURITY DEFINER debe poder SET ROLE a assistant_ro.
do $$ begin
  execute format('grant assistant_ro to %I', current_user);
exception when others then null;
end $$;
do $$ begin
  grant assistant_ro to postgres;
exception when others then null;
end $$;

grant usage on schema public to assistant_ro;

-- ── Vistas curadas (org forzada por GUC) ─────────────────────────────
create or replace view public.v_assistant_branches as
  select id, name, organization_id, address, timezone, operation_mode, is_active, created_at
  from public.branches where organization_id = public._assistant_current_org();

create or replace view public.v_assistant_visits as
  select id, organization_id, branch_id, client_id, barber_id, service_id, amount,
         commission_amount, commission_pct, tip_amount, discount_amount, payment_method,
         started_at, completed_at, created_at, notes, tags
  from public.visits where organization_id = public._assistant_current_org();

create or replace view public.v_assistant_clients as
  select id, organization_id, name, phone, instagram, notes, created_at, updated_at
  from public.clients where organization_id = public._assistant_current_org();

create or replace view public.v_assistant_loyalty as
  select id, client_id, organization_id, total_visits, current_streak, last_visit_at, next_milestone_at
  from public.client_loyalty_state where organization_id = public._assistant_current_org();

create or replace view public.v_assistant_points as
  select id, client_id, organization_id, branch_id, points_balance, total_earned, total_redeemed
  from public.client_points where organization_id = public._assistant_current_org();

create or replace view public.v_assistant_staff as
  select id, organization_id, branch_id, full_name, role, role_id, commission_pct,
         is_active, status, is_also_barber, created_at
  from public.staff where organization_id = public._assistant_current_org();

create or replace view public.v_assistant_appointments as
  select id, organization_id, branch_id, client_id, barber_id, service_id, appointment_date,
         start_time, end_time, duration_minutes, status, source, payment_status, payment_amount, created_at
  from public.appointments where organization_id = public._assistant_current_org();

create or replace view public.v_assistant_queue as
  select id, organization_id, branch_id, client_id, barber_id, status, position,
         checked_in_at, started_at, completed_at, created_at
  from public.queue_entries where organization_id = public._assistant_current_org();

create or replace view public.v_assistant_services as
  select id, branch_id, name, price, duration_minutes, is_active, availability, default_commission_pct
  from public.services
  where branch_id in (select id from public.branches where organization_id = public._assistant_current_org());

create or replace view public.v_assistant_products as
  select id, branch_id, name, cost, sale_price, stock, is_active
  from public.products
  where branch_id in (select id from public.branches where organization_id = public._assistant_current_org());

create or replace view public.v_assistant_product_sales as
  select id, branch_id, product_id, barber_id, visit_id, quantity, unit_price, commission_amount, payment_method, sold_at
  from public.product_sales
  where branch_id in (select id from public.branches where organization_id = public._assistant_current_org());

create or replace view public.v_assistant_expenses as
  select id, branch_id, amount, category, description, expense_date, source, created_at
  from public.expense_tickets
  where branch_id in (select id from public.branches where organization_id = public._assistant_current_org());

create or replace view public.v_assistant_salary_reports as
  select id, staff_id, branch_id, type, amount, status, report_date, period_start, period_end, created_at
  from public.salary_reports
  where branch_id in (select id from public.branches where organization_id = public._assistant_current_org());

create or replace view public.v_assistant_reviews as
  select id, client_id, branch_id, rating, category, improvement_categories, comment, created_at
  from public.client_reviews
  where branch_id in (select id from public.branches where organization_id = public._assistant_current_org());

-- ── Grants: SOLO assistant_ro lee las vistas; revocar API roles ──────
do $$
declare v text;
begin
  foreach v in array array[
    'v_assistant_branches','v_assistant_visits','v_assistant_clients','v_assistant_loyalty',
    'v_assistant_points','v_assistant_staff','v_assistant_appointments','v_assistant_queue',
    'v_assistant_services','v_assistant_products','v_assistant_product_sales',
    'v_assistant_expenses','v_assistant_salary_reports','v_assistant_reviews'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated, public', v);
    execute format('grant select on public.%I to assistant_ro', v);
  end loop;
end $$;

-- ── La función ejecutora ─────────────────────────────────────────────
create or replace function public.run_assistant_sql(p_org_id uuid, p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sql text;
  v_lower text;
  v_wrapped text;
  v_result jsonb;
begin
  if p_org_id is null then
    return jsonb_build_object('error', 'organización no resuelta');
  end if;

  v_sql := btrim(coalesce(p_sql, ''));
  v_sql := regexp_replace(v_sql, ';\s*$', '');   -- quitar ; final

  if v_sql = '' then
    return jsonb_build_object('error', 'consulta vacía');
  end if;
  if v_sql ~ '--' or v_sql ~ '/\*' or position(';' in v_sql) > 0 then
    return jsonb_build_object('error', 'Solo se permite una única sentencia SELECT, sin comentarios ni ";".');
  end if;

  v_lower := lower(v_sql);
  if v_lower !~ '^(select|with)[\s(]' then
    return jsonb_build_object('error', 'Solo se permiten consultas SELECT.');
  end if;
  if v_lower ~ '\m(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|analyze|reindex|comment|do|call|merge|set|reset|begin|commit|rollback|savepoint|listen|notify|execute|prepare|deallocate|lock|cluster|refresh|attach|into)\M' then
    return jsonb_build_object('error', 'La consulta contiene una palabra reservada no permitida.');
  end if;

  -- Ejecutar con mínimos privilegios + org forzada + timeout + cap de filas.
  perform set_config('role', 'assistant_ro', true);
  perform set_config('app.current_org', p_org_id::text, true);
  perform set_config('statement_timeout', '4000', true);

  v_wrapped := format(
    'select coalesce(jsonb_agg(row_to_json(_sub)), ''[]''::jsonb) from (select * from (%s) _q limit 500) _sub',
    v_sql
  );
  execute v_wrapped into v_result;
  return coalesce(v_result, '[]'::jsonb);
exception when others then
  return jsonb_build_object('error', SQLERRM);
end;
$$;

revoke all on function public.run_assistant_sql(uuid, text) from public, anon, authenticated;
grant execute on function public.run_assistant_sql(uuid, text) to service_role;

comment on function public.run_assistant_sql(uuid, text) is 'Modo Pro del Asistente IA: ejecuta SELECT de solo-lectura como assistant_ro sobre vistas v_assistant_* con org forzada por p_org_id. p_org_id se inyecta server-side.';

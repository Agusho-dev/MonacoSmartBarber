-- 156_assistant_sql_pro_fix.sql
-- Fix: Postgres prohíbe SET ROLE dentro de funciones SECURITY DEFINER.
-- Solución: run_assistant_sql pasa a SECURITY INVOKER y se ejecuta como
-- service_role (único con EXECUTE), que es miembro de assistant_ro y por ende
-- puede hacer SET LOCAL ROLE assistant_ro para bajar privilegios. assistant_ro
-- sigue siendo el límite real (solo lee las vistas v_assistant_*).

-- service_role debe poder asumir assistant_ro (membership = permite SET ROLE).
do $$ begin
  grant assistant_ro to service_role;
exception when others then null;
end $$;

create or replace function public.run_assistant_sql(p_org_id uuid, p_sql text)
returns jsonb
language plpgsql
security invoker
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
  v_sql := regexp_replace(v_sql, ';\s*$', '');

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

  -- Bajar privilegios (permitido en SECURITY INVOKER) + org forzada + límites.
  perform set_config('role', 'assistant_ro', true);
  perform set_config('app.current_org', p_org_id::text, true);
  perform set_config('statement_timeout', '4000', true);

  v_wrapped := format(
    'select coalesce(jsonb_agg(row_to_json(_sub)), ''[]''::jsonb) from (select * from (%s) _q limit 500) _sub',
    v_sql
  );
  execute v_wrapped into v_result;

  perform set_config('role', 'none', true);  -- volver al rol original dentro de la txn
  return coalesce(v_result, '[]'::jsonb);
exception when others then
  perform set_config('role', 'none', true);
  return jsonb_build_object('error', SQLERRM);
end;
$$;

revoke all on function public.run_assistant_sql(uuid, text) from public, anon, authenticated;
grant execute on function public.run_assistant_sql(uuid, text) to service_role;

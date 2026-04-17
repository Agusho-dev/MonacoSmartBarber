-- Fix en issue_benefit_redemption:
-- 1) La columna `code` en RETURNING era ambigua (columna de tabla vs. columna
--    de salida del RETURNS TABLE). Alias la tabla como `r` y qualificamos.
-- 2) `gen_random_bytes` vive en el schema `extensions` (pgcrypto), no en
--    `public`, por lo tanto hay que incluir `extensions` en el search_path
--    o qualificar la función.

create or replace function public.issue_benefit_redemption(p_benefit_id uuid)
returns table (redemption_id uuid, code text, status text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_client_id uuid;
  v_valid boolean;
  v_code text;
begin
  select id into v_client_id from public.clients where auth_user_id = auth.uid() limit 1;
  if v_client_id is null then
    raise exception 'client_not_found';
  end if;

  select true into v_valid
  from public.partner_benefits pb
  join public.clients c on c.id = v_client_id
  where pb.id = p_benefit_id
    and pb.organization_id = c.organization_id
    and pb.status = 'approved'
    and (pb.valid_until is null or pb.valid_until >= now())
    and (pb.valid_from is null or pb.valid_from <= now());

  if v_valid is not true then
    raise exception 'benefit_not_available';
  end if;

  v_code := upper(substr(replace(replace(replace(replace(encode(extensions.gen_random_bytes(8), 'hex'),'0',''),'o',''),'i',''),'l',''), 1, 6));
  if length(v_code) < 6 then
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  end if;

  return query
  insert into public.partner_benefit_redemptions as r (benefit_id, client_id, code)
  values (p_benefit_id, v_client_id, v_code)
  on conflict (benefit_id, client_id) do update
    set code = public.partner_benefit_redemptions.code
  returning r.id, r.code, r.status;
end $$;

grant execute on function public.issue_benefit_redemption(uuid) to anon, authenticated;

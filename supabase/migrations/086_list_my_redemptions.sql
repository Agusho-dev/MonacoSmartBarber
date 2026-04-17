-- =============================================================
-- Migration 086: RPC list_my_redemptions
-- Devuelve el historial completo de canjes del cliente autenticado
-- (incluye beneficios archivados/vencidos/rechazados) para la pantalla
-- "Mis canjes" en la app mobile. SECURITY DEFINER para saltear la RLS
-- approved+vigente de partner_benefits.
-- =============================================================

create or replace function public.list_my_redemptions()
returns table (
  redemption_id uuid,
  benefit_id uuid,
  code text,
  status text,
  used_at timestamptz,
  created_at timestamptz,
  benefit_title text,
  benefit_image_url text,
  benefit_discount_text text,
  benefit_valid_until timestamptz,
  partner_name text,
  partner_logo_url text
)
language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
begin
  select id into v_client_id from public.clients where auth_user_id = auth.uid() limit 1;
  if v_client_id is null then
    raise exception 'client_not_found';
  end if;

  return query
  select r.id,
         r.benefit_id,
         r.code,
         r.status,
         r.used_at,
         r.created_at,
         pb.title,
         pb.image_url,
         pb.discount_text,
         pb.valid_until,
         cp.business_name,
         cp.logo_url
  from public.partner_benefit_redemptions r
  join public.partner_benefits pb on pb.id = r.benefit_id
  join public.commercial_partners cp on cp.id = pb.partner_id
  where r.client_id = v_client_id
  order by
    case r.status when 'issued' then 0 when 'used' then 1 else 2 end,
    r.created_at desc;
end $$;

grant execute on function public.list_my_redemptions() to authenticated;
revoke all on function public.list_my_redemptions() from anon;

-- =============================================================================
-- 237b_cron_avisos_mensajeria.sql — NO APLICADA (gate: el deploy)
--
-- Programa los avisos push de «Por responder» (mig 237): cada minuto pg_cron
-- le pega a /api/cron/avisos-mensajeria, que avisa de las reseñas bajas y de
-- las consultas sin contestar a los dispositivos que activaron los avisos.
-- Sin dispositivos suscriptos la ruta contesta enseguida y no hace nada.
--
-- GATE: aplicarla DESPUÉS del deploy que trae /api/cron/avisos-mensajeria.
-- Antes, verificar que la ruta existe en producción (un 404 acá es el incidente
-- del Known Risk #26):
--
--   curl -s -w '\n%{http_code}\n' https://monacobarber.vercel.app/api/cron/avisos-mensajeria
--
-- (200 con {"ok":true,…}; de 23 a 9 contesta {"ok":true,"silencio":true}).
--
-- Known Risk #26: la URL sale del secreto `app_base_url` de Vault, como los
-- demás trigger_*. La ruta NO usa CRON_SECRET (convención del repo): es
-- idempotente, cada aviso se reclama en mensajeria_avisos antes de mandarse.
--
-- VERIFICAR DESPUÉS (net._http_response, NO cron.job_run_details):
--
--   select r.status_code, count(*)
--     from net._http_response r
--    where r.created > now() - interval '30 minutes'
--    group by 1;
--
-- ROLLBACK:
--   select cron.unschedule('avisos-mensajeria');
--   drop function if exists public.trigger_avisos_mensajeria();
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_avisos_mensajeria()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_url text;
begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'app_base_url';

    if v_url is null then
        raise warning 'trigger_avisos_mensajeria: falta el secreto app_base_url';
        return;
    end if;

    perform net.http_get(
        url                  := v_url || '/api/cron/avisos-mensajeria',
        timeout_milliseconds := 55000
    );
end $$;

comment on function public.trigger_avisos_mensajeria() is
  'Llamado por pg_cron cada minuto. GET a /api/cron/avisos-mensajeria (avisos push de «Por responder», mig 237).';

revoke all on function public.trigger_avisos_mensajeria() from public, anon, authenticated;

select cron.schedule('avisos-mensajeria', '* * * * *', $$select public.trigger_avisos_mensajeria()$$)
where not exists (select 1 from cron.job where jobname = 'avisos-mensajeria');

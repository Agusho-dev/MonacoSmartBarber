-- =============================================================================
-- 228b_cron_mp_movimientos.sql — APLICADA en prod el 24/oct/2026, después del
-- deploy 2521889 y con las variables MP_CONCILIACION_* ya cargadas en Vercel
-- (curl a la ruta: 200 con 0 cuentas; net._http_response: 192 de 192 en 200).
--
-- Programa la lectura automática de las cuentas de Mercado Pago de la
-- conciliación: cada 15 minutos pg_cron le pega a /api/cron/mp-movimientos,
-- que trae los créditos de las cuentas conectadas con más de 10 min sin leer
-- (src/lib/conciliacion-mp/sync.ts).
--
-- GATE: aplicarla DESPUÉS del deploy que trae /api/cron/mp-movimientos.
-- Antes, verificar con curl que la ruta responde 200 en producción:
--
--   curl -s -o /dev/null -w '%{http_code}\n' https://monacobarber.vercel.app/api/cron/mp-movimientos
--
-- (un 404 acá es exactamente el incidente del Known Risk #26: un cron que
-- "funciona" pegándole a una ruta que no existe). Ojo: la ruta tiene un rate
-- limit global de 6 pedidos cada 5 minutos; un 429 también prueba que existe.
--
-- Known Risk #26: nada de URL ni secretos escritos acá. La URL sale del secreto
-- `app_base_url` de Vault, como los demás trigger_* (095, 177, 208). Este repo
-- NO usa CRON_SECRET en las rutas nuevas: la ruta es idempotente, tiene candado
-- por cuenta y responde sólo contadores.
--
-- VERIFICAR DESPUÉS (mirar net._http_response, NO cron.job_run_details):
--
--   select r.status_code, count(*)
--     from net._http_response r
--    where r.created > now() - interval '1 hour'
--    group by 1;
--
-- y que las cuentas conectadas avanzan: select id, last_sync_at, last_error from mp_cuentas;
--
-- ROLLBACK:
--   select cron.unschedule('mp-movimientos');
--   drop function if exists public.trigger_mp_movimientos();
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_mp_movimientos()
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
        raise warning 'trigger_mp_movimientos: falta el secreto app_base_url';
        return;
    end if;

    -- La ruta puede trabajar hasta 240 s (30 s por cuenta): con el timeout por
    -- defecto de pg_net (5 s), net._http_response mostraría timeouts aunque la
    -- lectura haya salido bien, y ese es justo el lugar donde se mira si un
    -- cron funciona.
    perform net.http_get(
        url                  := v_url || '/api/cron/mp-movimientos',
        timeout_milliseconds := 290000
    );
end $$;

comment on function public.trigger_mp_movimientos() is
  'Llamado por pg_cron cada 15 min. GET a /api/cron/mp-movimientos (lectura de las cuentas de Mercado Pago de la conciliación).';

-- pg_cron corre como `postgres` (el dueño): revocar no toca el job, y sin esto
-- la anon key —que viaja en el bundle— podría dispararlo desde afuera (mig 190).
revoke all on function public.trigger_mp_movimientos() from public, anon, authenticated;

select cron.schedule('mp-movimientos', '*/15 * * * *', $$select public.trigger_mp_movimientos()$$)
where not exists (select 1 from cron.job where jobname = 'mp-movimientos');

-- =============================================================================
-- Migración 163: limpieza del contador roto de cuentas de cobro.
--
-- ⚠️  PUNTO DE NO RETORNO. Correr SÓLO tras un par de días con el deploy estable, NO en
--     la misma ventana. Una vez corrida, revertir el deploy de Vercel rompe la app: el
--     código viejo lee daily_limit/accumulated_today y la tablet vieja lee payment_accounts
--     como anon (policy public_read). Escribir el rollback ANTES de correr esto:
--       · re-CREATE POLICY payment_accounts_public_read (SELECT, is_active = true)
--       · re-ADD COLUMN daily_limit / accumulated_today / last_reset_date (+ backfill
--         daily_limit := monthly_limit)
--     y no correrla hasta estar seguro de que no se revierte el deploy.
--
-- Qué se va (todo era código muerto o directamente dañino):
--   · increment_account_accumulated  → la RPC rota (42702) que nunca escribió un peso.
--   · reset_monthly_payment_accounts + su cron → reseteaban un contador que siempre era 0.
--   · accumulated_today / last_reset_date / daily_limit → reemplazados por el acumulado
--     derivado de transfer_logs y por monthly_limit.
--   · payment_accounts_public_read → dejaba a CUALQUIER anónimo leer alias/CBU de todas
--     las cuentas activas de TODAS las organizaciones. La tablet del barbero ya no lo
--     necesita: usa el server action getTransferAccountsState (valida la sesión de barbero
--     y corre con service_role; las RPCs ya NO son ejecutables por anon, ver mig 162).
-- =============================================================================

-- 1. La RPC rota y el cron del contador
DROP FUNCTION IF EXISTS public.increment_account_accumulated(uuid, numeric);

SELECT cron.unschedule('reset-monthly-payment-accounts')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-monthly-payment-accounts');

DROP FUNCTION IF EXISTS public.reset_monthly_payment_accounts();

-- 2. El puente de la ventana de deploy (ya no hay dos escritores del tope)
DROP TRIGGER IF EXISTS trg_payment_accounts_limit_sync ON payment_accounts;
DROP FUNCTION IF EXISTS public.fn_sync_payment_account_limit();

-- 3. Las columnas del contador denormalizado
ALTER TABLE payment_accounts
  DROP COLUMN IF EXISTS accumulated_today,
  DROP COLUMN IF EXISTS last_reset_date,
  DROP COLUMN IF EXISTS daily_limit;

-- 4. Fuga de datos bancarios: la policy anon sin scope de organización
DROP POLICY IF EXISTS payment_accounts_public_read ON payment_accounts;

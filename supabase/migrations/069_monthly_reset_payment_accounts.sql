-- ============================================
-- Reinicio mensual automático de cuentas de cobro
-- Cada 1ro del mes a las 00:00 hora Argentina (03:00 UTC),
-- todas las cuentas arrancan con accumulated_today = 0.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Función que reinicia el acumulado de todas las cuentas de cobro.
-- Multi-tenant: recorre todas las organizaciones/sucursales.
CREATE OR REPLACE FUNCTION reset_monthly_payment_accounts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_ar DATE;
  v_rows INT;
BEGIN
  -- Fecha actual en Argentina
  v_today_ar := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;

  UPDATE payment_accounts
  SET accumulated_today = 0,
      last_reset_date = v_today_ar,
      updated_at = now()
  WHERE COALESCE(accumulated_today, 0) <> 0
     OR last_reset_date IS NULL
     OR last_reset_date < v_today_ar;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'reset_count', v_rows,
    'reset_date', v_today_ar
  );
END;
$$;

-- Desprogramar job anterior si existiera (idempotencia)
DO $$
BEGIN
  PERFORM cron.unschedule('reset-monthly-payment-accounts');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

-- Programar ejecución: día 1 de cada mes a las 03:00 UTC (00:00 AR)
SELECT cron.schedule(
  'reset-monthly-payment-accounts',
  '0 3 1 * *',
  'SELECT reset_monthly_payment_accounts()'
);

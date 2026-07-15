-- =============================================================================
-- Migración 162: hardening de las RPCs de cuentas de cobro.
--
-- 1) FUGA cross-org (crítica). El `REVOKE ALL ... FROM PUBLIC` de la 160 NO alcanzó:
--    Supabase concede EXECUTE a anon/authenticated vía DEFAULT PRIVILEGES al crear la
--    función, así que ambas RPCs quedaron ejecutables por `anon` con la anon key pública
--    del bundle. Verificado con `SET ROLE anon`: se leían alias/CBU, tope y facturación
--    mensual de CUALQUIER organización pasando un branch_id arbitrario (enumerable). Hay
--    que revocar el rol EXPLÍCITAMENTE (revocar de PUBLIC no toca los grants nominales).
--    La tablet del barbero ya no llama la RPC directo: usa el server action
--    getTransferAccountsState (valida la sesión de barbero, corre con service_role).
--
-- 2) La ventana del mes no tenía cota SUPERIOR: una visita con fecha futura sumaba al tope
--    del mes en curso además del suyo. Se agrega `< end_utc`.
--
-- 3) Histórico mensual TZ-correcto: get_payment_account_month_income calcula los bordes del
--    mes en la TZ de la sucursal (antes el server los armaba con new Date() en UTC, y el
--    número no cuadraba con el del mes en curso hasta 3h alrededor del cambio de mes).
--
-- Regla para el repo: después de cada CREATE FUNCTION en Supabase, verificar con
-- has_function_privilege('anon', ..., 'EXECUTE') que no quedó expuesta.
-- =============================================================================

-- --- get_payment_account_month_income: histórico por mes, TZ de la sucursal ---
CREATE OR REPLACE FUNCTION public.get_payment_account_month_income(
  p_account_id uuid,
  p_year int,
  p_month int
)
RETURNS TABLE (month_income numeric, month_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tz AS (
    SELECT COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires') AS name
      FROM payment_accounts pa
      JOIN branches br ON br.id = pa.branch_id
     WHERE pa.id = p_account_id
  ),
  win AS (
    SELECT
      (make_timestamp(p_year, p_month, 1, 0, 0, 0) AT TIME ZONE (SELECT name FROM tz))                            AS start_utc,
      ((make_timestamp(p_year, p_month, 1, 0, 0, 0) + interval '1 month') AT TIME ZONE (SELECT name FROM tz))     AS end_utc
  )
  SELECT COALESCE(SUM(tl.amount + COALESCE(tl.tip_amount, 0)), 0)::numeric,
         COUNT(*)::integer
    FROM transfer_logs tl, win
   WHERE tl.payment_account_id = p_account_id
     AND tl.transferred_at >= win.start_utc
     AND tl.transferred_at <  win.end_utc;
$$;

COMMENT ON FUNCTION public.get_payment_account_month_income(uuid, int, int) IS
  'Acumulado (cobros + propinas transferidas) de una cuenta en un mes calendario, en la TZ de la sucursal. Para el histórico mensual del dashboard.';

REVOKE ALL     ON FUNCTION public.get_payment_account_month_income(uuid, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_payment_account_month_income(uuid, int, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_payment_account_month_income(uuid, int, int) TO authenticated, service_role;

-- --- get_transfer_accounts_state: cota superior + sólo authenticated/service_role ---
CREATE OR REPLACE FUNCTION public.get_transfer_accounts_state(p_branch_id uuid)
RETURNS TABLE (
  id            uuid,
  name          text,
  alias_or_cbu  text,
  sort_order    integer,
  monthly_limit numeric,
  month_income  numeric,
  is_full       boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH win AS (
    SELECT
      date_trunc('month', (now() AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires')))
        AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires') AS start_utc,
      (date_trunc('month', (now() AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires'))) + interval '1 month')
        AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires') AS end_utc
      FROM branches br
     WHERE br.id = p_branch_id
  )
  SELECT pa.id,
         pa.name,
         pa.alias_or_cbu,
         pa.sort_order,
         pa.monthly_limit,
         inc.month_income,
         (pa.monthly_limit IS NOT NULL AND inc.month_income >= pa.monthly_limit) AS is_full
    FROM payment_accounts pa
    CROSS JOIN win
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(tl.amount + COALESCE(tl.tip_amount, 0)), 0)::numeric AS month_income
        FROM transfer_logs tl
       WHERE tl.payment_account_id = pa.id
         AND tl.transferred_at >= win.start_utc
         AND tl.transferred_at <  win.end_utc
    ) inc
   WHERE pa.branch_id = p_branch_id
     AND pa.is_active = true
   ORDER BY pa.sort_order, pa.name;
$$;

REVOKE ALL     ON FUNCTION public.get_transfer_accounts_state(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_transfer_accounts_state(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_transfer_accounts_state(uuid) TO authenticated, service_role;

-- --- get_payment_accounts_month_income: cota superior + sólo service_role ---
CREATE OR REPLACE FUNCTION public.get_payment_accounts_month_income(p_branch_ids uuid[])
RETURNS TABLE (
  account_id   uuid,
  month_income numeric,
  month_count  integer,
  month_start  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pa.id,
         inc.month_income,
         inc.month_count,
         win.start_utc
    FROM payment_accounts pa
    JOIN branches br ON br.id = pa.branch_id
    CROSS JOIN LATERAL (
      SELECT
        date_trunc('month', (now() AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires')))
          AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires') AS start_utc,
        (date_trunc('month', (now() AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires'))) + interval '1 month')
          AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires') AS end_utc
    ) win
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(tl.amount + COALESCE(tl.tip_amount, 0)), 0)::numeric AS month_income,
             COUNT(*)::integer                                                 AS month_count
        FROM transfer_logs tl
       WHERE tl.payment_account_id = pa.id
         AND tl.transferred_at >= win.start_utc
         AND tl.transferred_at <  win.end_utc
    ) inc
   WHERE pa.branch_id = ANY(p_branch_ids);
$$;

REVOKE ALL     ON FUNCTION public.get_payment_accounts_month_income(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_payment_accounts_month_income(uuid[]) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_payment_accounts_month_income(uuid[]) TO service_role;

-- --- Lockdown final: las RPCs las invocan SÓLO server actions con service_role ---
-- authenticated podía ejecutarlas vía PostgREST con un branch_id arbitrario (fuga cross-org
-- entre usuarios logueados de distintas orgs). El dashboard las llama con admin client, así
-- que no necesitan authenticated. Las trigger functions no son invocables por RPC igual, pero
-- les quitamos EXECUTE de PUBLIC para que no figuren como superficie (advisor get_advisors).
REVOKE EXECUTE ON FUNCTION public.get_transfer_accounts_state(uuid)                 FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_transfer_accounts_state(uuid)                 TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_payment_account_month_income(uuid, int, int)  FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_payment_account_month_income(uuid, int, int)  TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_payment_accounts_month_income(uuid[])         FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_payment_accounts_month_income(uuid[])         TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_sync_transfer_log_from_visit()                 FROM anon, authenticated, PUBLIC;

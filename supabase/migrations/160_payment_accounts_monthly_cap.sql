-- =============================================================================
-- Migración 160: Tope mensual real de las cuentas de cobro (rotación automática)
--
-- PROBLEMA (auditoría 14/jul/2026)
-- La RPC increment_account_accumulated fallaba SIEMPRE con 42702
-- ("column reference daily_limit is ambiguous": el OUT param de RETURNS TABLE
-- chocaba con la columna en el RETURNING). Como los 3 call-sites se tragaban el
-- error, payment_accounts.accumulated_today quedó en 0 en las 16 cuentas de todas
-- las sucursales desde el día uno. Consecuencias:
--   · La barra "Acumulado del mes" siempre mostró $0 (Simon/Rondeau iba $448.000
--     de su tope de $500.000 y la UI decía $0).
--   · La rotación automática por tope nunca existió: el dueño venía prendiendo y
--     apagando cuentas a mano.
--
-- DECISIÓN (dueño, 14/jul/2026)
--   1. El tope lo consume SOLO lo que ENTRA a la cuenta (acreditaciones):
--      cobros por transferencia + propinas transferidas. Los sueldos/gastos
--      pagados DESDE la cuenta son débitos: afectan el saldo, NO el tope.
--   2. Cuando una cuenta llega al tope, el sistema rota solo a la siguiente
--      cuenta activa (por sort_order) y avisa. No se auto-desactiva nada.
--
-- ENFOQUE
-- Se elimina el contador denormalizado como fuente de verdad. El acumulado se
-- deriva SIEMPRE de transfer_logs, que pasa a ser una proyección garantizada por
-- trigger de `visits` (antes se mantenía a mano desde el código y divergía: 55
-- visitas transfer sin log, 25 logs de visitas que ya no eran transferencia, 6
-- logs huérfanos, 12 con monto viejo, y el 100% de las propinas transferidas
-- afuera).
--
-- Esta migración es ADITIVA y convive con el código viejo: se puede aplicar antes
-- del deploy. La limpieza destructiva (drop del contador, de la RPC rota, del cron
-- y de la policy anon) va en la 161, DESPUÉS de que el deploy esté vivo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. transfer_logs: propina, borrado en cascada e índice del acumulado mensual
-- ---------------------------------------------------------------------------

-- La propina transferida entra a la MISMA cuenta que el cobro (el alias que ve el
-- barbero cobra servicio + propina en una sola transferencia), pero se guardaba
-- sólo en visits.tip_amount. Va en columna aparte para no ensuciar `amount`, que
-- es el que concilia caja y comprobantes contra la facturación.
ALTER TABLE transfer_logs
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN transfer_logs.tip_amount IS
  'Propina acreditada en la misma transferencia (visits.tip_amount cuando tip_payment_method=transfer). El ingreso real de la cuenta es amount + tip_amount.';
COMMENT ON COLUMN transfer_logs.amount IS
  'Monto facturado de la visita (servicios + productos - cupón - prepagos). NO incluye propina: ver tip_amount.';

-- Antes: ON DELETE SET NULL → borrar una visita dejaba el log huérfano sumando
-- plata fantasma a la cuenta (6 filas / $94.000 en prod). Si la visita no existe,
-- el cobro no existe.
ALTER TABLE transfer_logs DROP CONSTRAINT IF EXISTS transfer_logs_visit_id_fkey;
ALTER TABLE transfer_logs
  ADD CONSTRAINT transfer_logs_visit_id_fkey
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE;

-- El acumulado del mes se calcula on-the-fly: siempre es un scan por cuenta+fecha.
CREATE INDEX IF NOT EXISTS idx_transfer_logs_account_time
  ON transfer_logs (payment_account_id, transferred_at DESC);

-- ---------------------------------------------------------------------------
-- B. payment_accounts.monthly_limit — el nombre real de lo que siempre fue
--    (daily_limit + accumulated_today + el cron mensual mentían: el tope es
--     mensual, y la UI ya decía "Acumulado del mes" y "Tope diario" a la vez).
--    daily_limit se conserva hasta que el deploy esté vivo (se dropea en la 161).
-- ---------------------------------------------------------------------------
ALTER TABLE payment_accounts
  ADD COLUMN IF NOT EXISTS monthly_limit NUMERIC(12,2);

UPDATE payment_accounts
   SET monthly_limit = daily_limit
 WHERE monthly_limit IS NULL
   AND daily_limit IS NOT NULL;

COMMENT ON COLUMN payment_accounts.monthly_limit IS
  'Tope de acreditaciones del mes calendario (TZ de la sucursal). NULL = sin tope. Al alcanzarlo, el cobro rota a la siguiente cuenta activa por sort_order.';

-- ---------------------------------------------------------------------------
-- C. transfer_logs como proyección de visits (garantizada por trigger)
--
--    Cualquier camino que toque una visita —completeService, venta directa, alta
--    manual, la edición del historial (que escribe DIRECTO desde el browser),
--    un UPDATE a mano en SQL— queda reflejado en el ledger sin poder olvidarse.
--    SECURITY DEFINER porque el trigger corre con el rol del que escribe la visita
--    (authenticated desde el dashboard) y transfer_logs no tiene policy de INSERT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_transfer_log_from_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tip NUMERIC(12,2);
BEGIN
  IF NEW.payment_method::text = 'transfer' AND NEW.payment_account_id IS NOT NULL THEN
    v_tip := CASE
               WHEN NEW.tip_payment_method = 'transfer' THEN COALESCE(NEW.tip_amount, 0)
               ELSE 0
             END;

    INSERT INTO transfer_logs (visit_id, payment_account_id, amount, tip_amount, branch_id, transferred_at)
    VALUES (
      NEW.id,
      NEW.payment_account_id,
      COALESCE(NEW.amount, 0),
      v_tip,
      NEW.branch_id,
      COALESCE(NEW.completed_at, now())
    )
    ON CONFLICT (visit_id) WHERE visit_id IS NOT NULL
    DO UPDATE SET
      payment_account_id = EXCLUDED.payment_account_id,
      amount             = EXCLUDED.amount,
      tip_amount         = EXCLUDED.tip_amount,
      branch_id          = EXCLUDED.branch_id;
      -- transferred_at NO se pisa: el mes de acreditación queda anclado al cobro
      -- original aunque después se edite el monto o la cuenta.
  ELSE
    -- Dejó de ser transferencia (o le sacaron la cuenta) → sale del ledger.
    DELETE FROM transfer_logs WHERE visit_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_sync_transfer_log_from_visit() IS
  'Mantiene transfer_logs como proyección exacta de las visitas cobradas por transferencia (incluida la propina transferida). Única escritura del ledger de cuentas.';

DROP TRIGGER IF EXISTS trg_visits_sync_transfer_log ON visits;
CREATE TRIGGER trg_visits_sync_transfer_log
  AFTER INSERT OR UPDATE OF
    payment_method, payment_account_id, amount,
    tip_amount, tip_payment_method, branch_id, completed_at
  ON visits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_transfer_log_from_visit();

-- ---------------------------------------------------------------------------
-- D. Backfill: dejar el ledger igual a la verdad (visits) antes de empezar a
--    calcular topes sobre él. Todos los números salieron de la auditoría en prod.
-- ---------------------------------------------------------------------------

-- D1. Propinas transferidas que nunca entraron al ledger (~$176.400 históricos).
UPDATE transfer_logs tl
   SET tip_amount = COALESCE(v.tip_amount, 0)
  FROM visits v
 WHERE v.id = tl.visit_id
   AND v.tip_payment_method = 'transfer'
   AND COALESCE(v.tip_amount, 0) > 0
   AND tl.tip_amount = 0;

-- D2. Logs de visitas que ya NO son transferencia (se editó el método después del
--     cobro: 25 filas / $390.000 de ingresos fantasma).
DELETE FROM transfer_logs tl
 USING visits v
 WHERE v.id = tl.visit_id
   AND (v.payment_method::text <> 'transfer' OR v.payment_account_id IS NULL);

-- D3. Logs huérfanos por visitas borradas (6 filas / $94.000).
DELETE FROM transfer_logs WHERE visit_id IS NULL;

-- D4. Logs desincronizados de su visita: monto viejo (12 filas) o cuenta de otra
--     sucursal (5 filas). La visita manda.
UPDATE transfer_logs tl
   SET amount             = COALESCE(v.amount, 0),
       payment_account_id = v.payment_account_id,
       branch_id          = v.branch_id
  FROM visits v
 WHERE v.id = tl.visit_id
   AND v.payment_method::text = 'transfer'
   AND v.payment_account_id IS NOT NULL
   AND (
     round(tl.amount, 2) <> round(COALESCE(v.amount, 0), 2)
     OR tl.payment_account_id IS DISTINCT FROM v.payment_account_id
     OR tl.branch_id IS DISTINCT FROM v.branch_id
   );

-- D5. Visitas por transferencia con cuenta y sin log (alta manual desde el
--     dashboard y ediciones: 55 filas / $775.000, de las cuales 15 con cuenta).
INSERT INTO transfer_logs (visit_id, payment_account_id, amount, tip_amount, branch_id, transferred_at)
SELECT v.id,
       v.payment_account_id,
       COALESCE(v.amount, 0),
       CASE WHEN v.tip_payment_method = 'transfer' THEN COALESCE(v.tip_amount, 0) ELSE 0 END,
       v.branch_id,
       COALESCE(v.completed_at, v.created_at, now())
  FROM visits v
  LEFT JOIN transfer_logs tl ON tl.visit_id = v.id
 WHERE v.payment_method::text = 'transfer'
   AND v.payment_account_id IS NOT NULL
   AND tl.id IS NULL
ON CONFLICT (visit_id) WHERE visit_id IS NOT NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- E. Estado de las cuentas de una sucursal (tablet del barbero y dashboard).
--    El acumulado del mes se calcula en la TZ de la sucursal, sobre el ledger.
--    SECURITY DEFINER: el panel del barbero corre con el rol anon (auth por PIN,
--    no por Supabase Auth) y no puede leer transfer_logs.
-- ---------------------------------------------------------------------------
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
    SELECT date_trunc(
             'month',
             (now() AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires'))
           ) AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires') AS start_utc
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
    ) inc
   WHERE pa.branch_id = p_branch_id
     AND pa.is_active = true
   ORDER BY pa.sort_order, pa.name;
$$;

COMMENT ON FUNCTION public.get_transfer_accounts_state(uuid) IS
  'Cuentas de cobro ACTIVAS de una sucursal con su acumulado real del mes (cobros + propinas) y si llegaron al tope. La primera con is_full=false es la que recibe.';

REVOKE ALL ON FUNCTION public.get_transfer_accounts_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_transfer_accounts_state(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- F. Acumulado del mes de TODAS las cuentas (incluidas las inactivas) para el
--    dashboard. Separada de la anterior porque devuelve cuentas apagadas: no se
--    expone a anon.
-- ---------------------------------------------------------------------------
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
      SELECT date_trunc(
               'month',
               (now() AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires'))
             ) AT TIME ZONE COALESCE(NULLIF(br.timezone, ''), 'America/Argentina/Buenos_Aires') AS start_utc
    ) win
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(tl.amount + COALESCE(tl.tip_amount, 0)), 0)::numeric AS month_income,
             COUNT(*)::integer                                                 AS month_count
        FROM transfer_logs tl
       WHERE tl.payment_account_id = pa.id
         AND tl.transferred_at >= win.start_utc
    ) inc
   WHERE pa.branch_id = ANY(p_branch_ids);
$$;

COMMENT ON FUNCTION public.get_payment_accounts_month_income(uuid[]) IS
  'Acumulado del mes en curso (cobros + propinas transferidas) de todas las cuentas de las sucursales dadas, activas e inactivas. Para /dashboard/finanzas.';

REVOKE ALL ON FUNCTION public.get_payment_accounts_month_income(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_accounts_month_income(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- G. Puente daily_limit <-> monthly_limit durante la ventana de deploy.
--    El código viejo (vivo en Vercel hasta que se despliegue este cambio) escribe
--    daily_limit; el nuevo escribe monthly_limit. Si el dueño edita un tope en el
--    medio, los dos valores divergirían y la rotación usaría el número equivocado.
--    Este trigger los mantiene iguales escriba quien escriba. Se elimina junto con
--    daily_limit en la migración 161.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_payment_account_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.monthly_limit := COALESCE(NEW.monthly_limit, NEW.daily_limit);
    NEW.daily_limit   := NEW.monthly_limit;
  ELSE
    IF NEW.monthly_limit IS DISTINCT FROM OLD.monthly_limit THEN
      NEW.daily_limit := NEW.monthly_limit;
    ELSIF NEW.daily_limit IS DISTINCT FROM OLD.daily_limit THEN
      NEW.monthly_limit := NEW.daily_limit;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_sync_payment_account_limit() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_payment_accounts_limit_sync ON payment_accounts;
CREATE TRIGGER trg_payment_accounts_limit_sync
  BEFORE INSERT OR UPDATE ON payment_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_payment_account_limit();

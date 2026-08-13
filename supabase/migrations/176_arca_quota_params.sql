-- =============================================================================
-- 176_arca_quota_params.sql
-- El estado del cupo, calculable por PARÁMETROS y no sólo por política guardada.
--
-- Motivo: la pantalla del cupo tiene vista previa en vivo — el dueño mueve
-- "50 comprobantes por mes" a "80 por mes" y ve al instante qué cambiaría. Eso
-- pasa ANTES de guardar, así que no hay `policy_id` contra el cual medir.
--
-- La tentación era calcular el período y el consumo en TypeScript para la vista
-- previa. Sería una SEGUNDA implementación de la misma regla, y las dos
-- terminarían divergiendo: la pantalla mostraría un número y el cron emitiría
-- otro. Acá la lógica queda en UNA función por parámetros, y la que recibe la
-- política pasa a ser un envoltorio que le pasa los suyos.
-- =============================================================================

CREATE OR REPLACE FUNCTION arca_quota_state_params(
  p_organization_id uuid,
  p_branch_id       uuid,
  p_period          text,
  p_target_count    integer,
  p_target_amount   numeric,
  p_at              timestamptz DEFAULT now()
)
RETURNS TABLE (
  period_start     date,
  period_end       date,
  emitted_count    integer,
  emitted_amount   numeric,
  target_count     integer,
  target_amount    numeric,
  remaining_count  integer,
  remaining_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz    text;
  v_local date;
  v_start date;
  v_end   date;
BEGIN
  -- La zona horaria sale de la sucursal; si el cupo es de toda la organización,
  -- de la organización. Nunca del proceso: en Vercel es UTC y después de las
  -- 21:00 de Argentina "hoy" ya sería mañana.
  SELECT COALESCE(b.timezone, o.timezone, 'America/Argentina/Buenos_Aires')
    INTO v_tz
  FROM organizations o
  LEFT JOIN branches b ON b.id = p_branch_id
  WHERE o.id = p_organization_id;

  v_local := (p_at AT TIME ZONE COALESCE(v_tz, 'America/Argentina/Buenos_Aires'))::date;

  v_start := CASE p_period
               WHEN 'dia'    THEN v_local
               WHEN 'semana' THEN (date_trunc('week',  v_local::timestamp))::date
               ELSE               (date_trunc('month', v_local::timestamp))::date
             END;
  v_end   := CASE p_period
               WHEN 'dia'    THEN v_start + 1
               WHEN 'semana' THEN v_start + 7
               ELSE               (v_start + interval '1 month')::date
             END;

  SELECT COALESCE(COUNT(*), 0)::integer, COALESCE(SUM(i.imp_total), 0)
  INTO emitted_count, emitted_amount
  FROM arca_invoices i
  WHERE i.organization_id = p_organization_id
    AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
    AND i.fecha_cbte >= v_start
    AND i.fecha_cbte <  v_end
    -- 'reservado' y 'en_duda' cuentan a propósito: mientras no se sepa si ARCA
    -- los autorizó hay que asumir que sí. Pasarse por optimismo es peor que
    -- quedarse corto.
    AND i.status IN ('reservado','emitida','en_duda')
    -- Las notas de crédito no suman cupo.
    AND i.cbte_tipo NOT IN (3, 8, 13, 53);

  period_start     := v_start;
  period_end       := v_end;
  target_count     := p_target_count;
  target_amount    := p_target_amount;
  remaining_count  := GREATEST(COALESCE(p_target_count, 0)  - emitted_count, 0);
  remaining_amount := GREATEST(COALESCE(p_target_amount, 0) - emitted_amount, 0);

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION arca_quota_state_params IS
  'Estado del cupo calculado por parámetros. Única implementación de la regla; arca_quota_state la envuelve.';

-- La versión por política queda como envoltorio: una sola regla, dos entradas.
CREATE OR REPLACE FUNCTION arca_quota_state(
  p_policy_id uuid,
  p_at        timestamptz DEFAULT now()
)
RETURNS TABLE (
  period_start     date,
  period_end       date,
  emitted_count    integer,
  emitted_amount   numeric,
  target_count     integer,
  target_amount    numeric,
  remaining_count  integer,
  remaining_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol arca_billing_policies%ROWTYPE;
BEGIN
  SELECT * INTO v_pol FROM arca_billing_policies WHERE id = p_policy_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT * FROM arca_quota_state_params(
    v_pol.organization_id,
    v_pol.branch_id,
    v_pol.period,
    v_pol.target_count,
    v_pol.target_amount,
    p_at
  );
END;
$$;

REVOKE ALL ON FUNCTION arca_quota_state_params FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION arca_quota_state_params TO service_role;

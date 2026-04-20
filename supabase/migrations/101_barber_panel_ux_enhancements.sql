-- 101: Mejoras UX del panel de barberos
-- - Pausa de corte activo (paused_at + paused_duration_seconds)
-- - Propinas separadas en visits (tip_amount + tip_payment_method)
-- - Nota rápida del barbero por visita (barber_note)
-- - Tabla shift_closes para cierres de turno
-- - View barber_day_summary para el resumen del día
-- - RPC close_barber_shift para cerrar turno atómicamente
--
-- Aditiva: no modifica ni borra columnas existentes. Idempotente.

-- ────────────────────────────────────────────────────────────────
-- A) queue_entries: pausar corte activo sin completarlo
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_duration_seconds integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.queue_entries.paused_at IS 'Momento en que el corte se puso en pausa. NULL = no está pausado.';
COMMENT ON COLUMN public.queue_entries.paused_duration_seconds IS 'Segundos acumulados en pausa durante este corte. Se descuenta al calcular duración real.';

-- ────────────────────────────────────────────────────────────────
-- B) visits: propina y nota del barbero
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.visits
  ADD COLUMN IF NOT EXISTS tip_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_payment_method text,
  ADD COLUMN IF NOT EXISTS barber_note text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE constraint_name = 'visits_tip_payment_method_check'
  ) THEN
    ALTER TABLE public.visits
      ADD CONSTRAINT visits_tip_payment_method_check
      CHECK (tip_payment_method IS NULL OR tip_payment_method IN ('cash','card','transfer'));
  END IF;
END $$;

COMMENT ON COLUMN public.visits.tip_amount IS 'Propina del cliente, separada del amount.';
COMMENT ON COLUMN public.visits.tip_payment_method IS 'Método con que se pagó la propina (cash|card|transfer). NULL si no hubo propina.';
COMMENT ON COLUMN public.visits.barber_note IS 'Nota del barbero sobre esta visita (corta, visible solo al barbero).';

-- ────────────────────────────────────────────────────────────────
-- C) shift_closes: cierre de turno del barbero
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shift_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  total_cuts integer NOT NULL DEFAULT 0,
  total_revenue numeric NOT NULL DEFAULT 0,
  total_commission numeric NOT NULL DEFAULT 0,
  cash_expected numeric NOT NULL DEFAULT 0,
  cash_counted numeric,
  cash_diff numeric,
  tips_total numeric NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, branch_id, local_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_closes_staff_date ON public.shift_closes(staff_id, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_shift_closes_branch_date ON public.shift_closes(branch_id, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_shift_closes_org_date ON public.shift_closes(organization_id, local_date DESC);

COMMENT ON TABLE public.shift_closes IS 'Cierre de turno diario por barbero: snapshot de cuántos cortes hizo, cuánto facturó y cuánto efectivo debe entregar.';
COMMENT ON COLUMN public.shift_closes.cash_expected IS 'Efectivo que el sistema calcula que el barbero debe entregar.';
COMMENT ON COLUMN public.shift_closes.cash_counted IS 'Efectivo que el barbero dice haber contado (opcional).';
COMMENT ON COLUMN public.shift_closes.cash_diff IS 'Diferencia (counted - expected). Positivo = sobra, negativo = falta.';

ALTER TABLE public.shift_closes ENABLE ROW LEVEL SECURITY;

-- RLS: dashboard usa service role y hace bypass. Policies aquí cubren cualquier acceso
-- desde app o mobile con Auth de usuario.
DROP POLICY IF EXISTS "shift_closes_select_org" ON public.shift_closes;
CREATE POLICY "shift_closes_select_org" ON public.shift_closes
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.staff WHERE auth_user_id = auth.uid()
      UNION
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "shift_closes_insert_org" ON public.shift_closes;
CREATE POLICY "shift_closes_insert_org" ON public.shift_closes
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.staff WHERE auth_user_id = auth.uid()
      UNION
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "shift_closes_update_org" ON public.shift_closes;
CREATE POLICY "shift_closes_update_org" ON public.shift_closes
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM public.staff WHERE auth_user_id = auth.uid()
      UNION
      SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────────
-- D) View: barber_day_summary
--    Agrega visits por barbero/sucursal/día (en zona horaria de la sucursal).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.barber_day_summary AS
SELECT
  v.barber_id,
  v.branch_id,
  v.organization_id,
  (v.completed_at AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::date AS local_date,
  COUNT(*)::int AS cuts,
  COALESCE(SUM(v.amount), 0)::numeric AS revenue,
  COALESCE(SUM(v.commission_amount), 0)::numeric AS commission,
  COALESCE(SUM(v.tip_amount), 0)::numeric AS tips,
  COALESCE(SUM(CASE WHEN v.payment_method = 'cash' THEN v.amount ELSE 0 END), 0)::numeric AS cash_total,
  COALESCE(SUM(CASE WHEN v.payment_method = 'transfer' THEN v.amount ELSE 0 END), 0)::numeric AS transfer_total,
  COALESCE(SUM(CASE WHEN v.payment_method = 'card' THEN v.amount ELSE 0 END), 0)::numeric AS card_total,
  COALESCE(AVG(EXTRACT(EPOCH FROM (v.completed_at - v.started_at)) / 60.0), 0)::numeric AS avg_duration_minutes
FROM public.visits v
JOIN public.branches b ON b.id = v.branch_id
GROUP BY v.barber_id, v.branch_id, v.organization_id, local_date;

-- security_invoker=true para que la view respete los permisos del usuario que la consulta,
-- no los del creador. Importante para tablas con RLS (visits está RLS-enabled).
ALTER VIEW public.barber_day_summary SET (security_invoker = true);

COMMENT ON VIEW public.barber_day_summary IS 'Resumen diario por barbero/sucursal basado en visits.completed_at en timezone local.';

-- ────────────────────────────────────────────────────────────────
-- E) RPC: close_barber_shift
--    Calcula el resumen del día y crea/actualiza el shift_close.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_barber_shift(
  p_staff_id uuid,
  p_branch_id uuid,
  p_cash_counted numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS public.shift_closes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_org_id uuid;
  v_date date;
  v_summary record;
  v_cash_expected numeric;
  v_breakdown jsonb;
  v_result public.shift_closes%ROWTYPE;
BEGIN
  SELECT timezone, organization_id INTO v_tz, v_org_id
  FROM public.branches WHERE id = p_branch_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada';
  END IF;

  v_tz := COALESCE(v_tz, 'America/Argentina/Buenos_Aires');
  v_date := (now() AT TIME ZONE v_tz)::date;

  SELECT
    COUNT(*)::int AS cuts,
    COALESCE(SUM(amount), 0)::numeric AS revenue,
    COALESCE(SUM(commission_amount), 0)::numeric AS commission,
    COALESCE(SUM(tip_amount), 0)::numeric AS tips,
    COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END), 0)::numeric AS cash_total,
    COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN amount ELSE 0 END), 0)::numeric AS transfer_total,
    COALESCE(SUM(CASE WHEN payment_method = 'card' THEN amount ELSE 0 END), 0)::numeric AS card_total,
    COALESCE(SUM(CASE WHEN tip_payment_method = 'cash' THEN tip_amount ELSE 0 END), 0)::numeric AS tips_cash
  INTO v_summary
  FROM public.visits
  WHERE barber_id = p_staff_id
    AND branch_id = p_branch_id
    AND (completed_at AT TIME ZONE v_tz)::date = v_date;

  -- Efectivo esperado: total en efectivo + propinas en efectivo.
  -- Regla de negocio: el barbero rinde TODO el efectivo; la comisión se liquida luego.
  v_cash_expected := v_summary.cash_total + v_summary.tips_cash;

  v_breakdown := jsonb_build_object(
    'cash_total', v_summary.cash_total,
    'transfer_total', v_summary.transfer_total,
    'card_total', v_summary.card_total,
    'tips_cash', v_summary.tips_cash
  );

  INSERT INTO public.shift_closes (
    organization_id, branch_id, staff_id, local_date,
    total_cuts, total_revenue, total_commission, tips_total,
    cash_expected, cash_counted, cash_diff,
    breakdown, notes
  )
  VALUES (
    v_org_id, p_branch_id, p_staff_id, v_date,
    v_summary.cuts, v_summary.revenue, v_summary.commission, v_summary.tips,
    v_cash_expected,
    p_cash_counted,
    CASE WHEN p_cash_counted IS NULL THEN NULL ELSE (p_cash_counted - v_cash_expected) END,
    v_breakdown, p_notes
  )
  ON CONFLICT (staff_id, branch_id, local_date) DO UPDATE
  SET
    total_cuts = EXCLUDED.total_cuts,
    total_revenue = EXCLUDED.total_revenue,
    total_commission = EXCLUDED.total_commission,
    tips_total = EXCLUDED.tips_total,
    cash_expected = EXCLUDED.cash_expected,
    cash_counted = COALESCE(EXCLUDED.cash_counted, public.shift_closes.cash_counted),
    cash_diff = CASE
      WHEN EXCLUDED.cash_counted IS NOT NULL THEN EXCLUDED.cash_counted - EXCLUDED.cash_expected
      WHEN public.shift_closes.cash_counted IS NOT NULL THEN public.shift_closes.cash_counted - EXCLUDED.cash_expected
      ELSE NULL
    END,
    breakdown = EXCLUDED.breakdown,
    notes = COALESCE(EXCLUDED.notes, public.shift_closes.notes),
    closed_at = now()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_barber_shift(uuid, uuid, numeric, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.close_barber_shift IS 'Calcula el resumen del día para el barbero y registra (upsert) un shift_close.';

-- ────────────────────────────────────────────────────────────────
-- F) RPC: get_barber_day_summary
--    Resumen del día actual (para el barbero en su tablet).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_barber_day_summary(
  p_staff_id uuid,
  p_branch_id uuid
) RETURNS TABLE (
  cuts int,
  revenue numeric,
  commission numeric,
  tips numeric,
  cash_total numeric,
  transfer_total numeric,
  card_total numeric,
  tips_cash numeric,
  cash_expected numeric,
  avg_duration_minutes numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_date date;
BEGIN
  SELECT timezone INTO v_tz FROM public.branches WHERE id = p_branch_id;
  v_tz := COALESCE(v_tz, 'America/Argentina/Buenos_Aires');
  v_date := (now() AT TIME ZONE v_tz)::date;

  RETURN QUERY
  SELECT
    COUNT(*)::int AS cuts,
    COALESCE(SUM(v.amount), 0)::numeric AS revenue,
    COALESCE(SUM(v.commission_amount), 0)::numeric AS commission,
    COALESCE(SUM(v.tip_amount), 0)::numeric AS tips,
    COALESCE(SUM(CASE WHEN v.payment_method = 'cash' THEN v.amount ELSE 0 END), 0)::numeric AS cash_total,
    COALESCE(SUM(CASE WHEN v.payment_method = 'transfer' THEN v.amount ELSE 0 END), 0)::numeric AS transfer_total,
    COALESCE(SUM(CASE WHEN v.payment_method = 'card' THEN v.amount ELSE 0 END), 0)::numeric AS card_total,
    COALESCE(SUM(CASE WHEN v.tip_payment_method = 'cash' THEN v.tip_amount ELSE 0 END), 0)::numeric AS tips_cash,
    (COALESCE(SUM(CASE WHEN v.payment_method = 'cash' THEN v.amount ELSE 0 END), 0)
     + COALESCE(SUM(CASE WHEN v.tip_payment_method = 'cash' THEN v.tip_amount ELSE 0 END), 0))::numeric AS cash_expected,
    COALESCE(AVG(EXTRACT(EPOCH FROM (v.completed_at - v.started_at)) / 60.0), 0)::numeric AS avg_duration_minutes
  FROM public.visits v
  WHERE v.barber_id = p_staff_id
    AND v.branch_id = p_branch_id
    AND (v.completed_at AT TIME ZONE v_tz)::date = v_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_barber_day_summary(uuid, uuid) TO authenticated, service_role;

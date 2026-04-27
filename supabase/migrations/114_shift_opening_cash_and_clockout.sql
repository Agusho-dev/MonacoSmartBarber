-- 114: Vuelto inicial del barbero + clock_out automático al cerrar turno
--
-- Cambios:
-- 1) branches.default_opening_cash — monto que el admin entrega al barbero al inicio
--    del turno para dar vuelto. Default 0. Configurable por sucursal.
-- 2) shift_closes.opening_cash — snapshot del vuelto inicial usado en ese cierre
--    (toma el default de la sucursal pero puede ser override manual por admin).
-- 3) RPC close_barber_shift:
--    - Lee opening_cash desde branches al primer cierre del día (o conserva el
--      existente si ya había uno).
--    - cash_expected = opening_cash + cash_total + tips_cash.
--    - Inserta un clock_out en attendance_logs si el último log del día es clock_in.
-- 4) RPC get_barber_day_summary: devuelve opening_cash para el preview del barbero.
--
-- Aditiva e idempotente.

-- ────────────────────────────────────────────────────────────────
-- A) branches: vuelto inicial diario por sucursal
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS default_opening_cash numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.branches.default_opening_cash IS
  'Monto en efectivo que el admin entrega al barbero al inicio de cada turno para dar vuelto. Se usa como base al calcular el efectivo a entregar al cierre.';

-- ────────────────────────────────────────────────────────────────
-- B) shift_closes: snapshot del vuelto inicial de ese cierre
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.shift_closes
  ADD COLUMN IF NOT EXISTS opening_cash numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.shift_closes.opening_cash IS
  'Vuelto inicial con el que arrancó el turno. cash_expected = opening_cash + cobros efectivo + propinas efectivo.';

-- ────────────────────────────────────────────────────────────────
-- C) RPC close_barber_shift — incluye opening_cash + clock_out
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
  v_default_opening numeric;
  v_date date;
  v_day_start timestamptz;
  v_summary record;
  v_existing record;
  v_opening_cash numeric;
  v_cash_expected numeric;
  v_cash_diff numeric;
  v_breakdown jsonb;
  v_result public.shift_closes%ROWTYPE;
  v_last_action text;
  v_final_counted numeric;
BEGIN
  SELECT timezone, organization_id, default_opening_cash
    INTO v_tz, v_org_id, v_default_opening
  FROM public.branches WHERE id = p_branch_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada';
  END IF;

  v_tz := COALESCE(v_tz, 'America/Argentina/Buenos_Aires');
  v_date := (now() AT TIME ZONE v_tz)::date;
  v_day_start := (v_date::timestamp AT TIME ZONE v_tz);

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

  -- Conservar opening_cash y cash_counted del cierre existente si ya había uno.
  SELECT opening_cash, cash_counted INTO v_existing
  FROM public.shift_closes
  WHERE staff_id = p_staff_id AND branch_id = p_branch_id AND local_date = v_date;

  v_opening_cash := COALESCE(v_existing.opening_cash, COALESCE(v_default_opening, 0));
  v_final_counted := COALESCE(p_cash_counted, v_existing.cash_counted);

  -- Efectivo esperado = vuelto inicial + cobros efectivo + propinas efectivo.
  v_cash_expected := v_opening_cash + v_summary.cash_total + v_summary.tips_cash;
  v_cash_diff := CASE WHEN v_final_counted IS NULL THEN NULL ELSE v_final_counted - v_cash_expected END;

  v_breakdown := jsonb_build_object(
    'opening_cash', v_opening_cash,
    'cash_total', v_summary.cash_total,
    'transfer_total', v_summary.transfer_total,
    'card_total', v_summary.card_total,
    'tips_cash', v_summary.tips_cash
  );

  INSERT INTO public.shift_closes (
    organization_id, branch_id, staff_id, local_date,
    total_cuts, total_revenue, total_commission, tips_total,
    opening_cash, cash_expected, cash_counted, cash_diff,
    breakdown, notes
  )
  VALUES (
    v_org_id, p_branch_id, p_staff_id, v_date,
    v_summary.cuts, v_summary.revenue, v_summary.commission, v_summary.tips,
    v_opening_cash, v_cash_expected, v_final_counted, v_cash_diff,
    v_breakdown, p_notes
  )
  ON CONFLICT (staff_id, branch_id, local_date) DO UPDATE
  SET
    total_cuts = EXCLUDED.total_cuts,
    total_revenue = EXCLUDED.total_revenue,
    total_commission = EXCLUDED.total_commission,
    tips_total = EXCLUDED.tips_total,
    opening_cash = EXCLUDED.opening_cash,
    cash_expected = EXCLUDED.cash_expected,
    cash_counted = EXCLUDED.cash_counted,
    cash_diff = EXCLUDED.cash_diff,
    breakdown = EXCLUDED.breakdown,
    notes = COALESCE(EXCLUDED.notes, public.shift_closes.notes),
    closed_at = now()
  RETURNING * INTO v_result;

  -- Clock-out automático: si el último log del staff hoy es clock_in, marcamos salida.
  SELECT action_type INTO v_last_action
  FROM public.attendance_logs
  WHERE staff_id = p_staff_id
    AND recorded_at >= v_day_start
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_last_action = 'clock_in' THEN
    INSERT INTO public.attendance_logs (staff_id, branch_id, action_type, face_verified)
    VALUES (p_staff_id, p_branch_id, 'clock_out', false);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_barber_shift(uuid, uuid, numeric, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.close_barber_shift IS
  'Cierra el turno del barbero: snapshot diario, cash_expected con vuelto inicial, y clock_out automático.';

-- ────────────────────────────────────────────────────────────────
-- D) RPC get_barber_day_summary — agrega opening_cash
-- ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_barber_day_summary(uuid, uuid);

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
  opening_cash numeric,
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
  v_default_opening numeric;
  v_existing_opening numeric;
  v_opening numeric;
  v_date date;
BEGIN
  SELECT timezone, default_opening_cash INTO v_tz, v_default_opening
  FROM public.branches WHERE id = p_branch_id;
  v_tz := COALESCE(v_tz, 'America/Argentina/Buenos_Aires');
  v_date := (now() AT TIME ZONE v_tz)::date;

  SELECT sc.opening_cash INTO v_existing_opening
  FROM public.shift_closes sc
  WHERE sc.staff_id = p_staff_id AND sc.branch_id = p_branch_id AND sc.local_date = v_date;

  v_opening := COALESCE(v_existing_opening, COALESCE(v_default_opening, 0));

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
    v_opening AS opening_cash,
    (v_opening
     + COALESCE(SUM(CASE WHEN v.payment_method = 'cash' THEN v.amount ELSE 0 END), 0)
     + COALESCE(SUM(CASE WHEN v.tip_payment_method = 'cash' THEN v.tip_amount ELSE 0 END), 0))::numeric AS cash_expected,
    COALESCE(AVG(EXTRACT(EPOCH FROM (v.completed_at - v.started_at)) / 60.0), 0)::numeric AS avg_duration_minutes
  FROM public.visits v
  WHERE v.barber_id = p_staff_id
    AND v.branch_id = p_branch_id
    AND (v.completed_at AT TIME ZONE v_tz)::date = v_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_barber_day_summary(uuid, uuid) TO authenticated, service_role;

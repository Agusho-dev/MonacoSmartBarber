-- =============================================================================
-- 208 — Tres correcciones de la revisión adversarial de la seña (mig 207).
-- APLICADA EN PRODUCCIÓN el 3/9/2026.
--
-- 1. El cron de conciliación de Mercado Pago nunca se había programado, así que
--    toda la red de seguridad del cobro era código muerto: la seña cuyo webhook
--    no llegó quedaba como "no pagó", las devoluciones automáticas fallidas no
--    se reintentaban y la seña del ausente (que marca `mark_no_show_overdue`,
--    SQL puro que no sabe nada de señas) quedaba en el limbo.
--    La URL sale de Vault: el día que cambie el dominio se toca UN secreto. Es
--    exactamente cómo `process_appointments` quedó cuatro meses apuntando a un
--    alias muerto.
--
-- 2. `refund_on_early_cancel = 'credito'` era el default y significaba "la seña
--    te queda a favor para tu próximo turno" — una promesa que ningún camino de
--    reserva sabe imputar. Hasta que exista la billetera, el default honesto es
--    devolver. La opción queda en el CHECK para cuando se construya.
--
-- 3. `close_barber_shift` restaba la seña sin piso en cero, mientras que todos
--    los demás lectores sí acotan. Una seña mayor que el importe final (cupón
--    sobre el remanente, cambio a un servicio más barato) le habría inventado
--    un sobrante al barbero.
-- =============================================================================

create or replace function public.trigger_mp_conciliar()
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
        raise warning 'trigger_mp_conciliar: falta el secreto app_base_url';
        return;
    end if;

    perform net.http_post(
        url     := v_url || '/api/cron/mp-conciliar',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := '{}'::jsonb
    );
end $$;

-- pg_cron corre como `postgres`, así que revocar no toca el job. Sin esto, la
-- anon key —que viaja en el bundle— dispararía el cron desde afuera: es el
-- agujero que la mig 190 cerró para las otras cinco funciones trigger_*.
revoke all on function public.trigger_mp_conciliar() from public, anon, authenticated;

select cron.schedule('mp-conciliar', '*/5 * * * *', $$select public.trigger_mp_conciliar()$$)
where not exists (select 1 from cron.job where jobname = 'mp-conciliar');

alter table public.branch_deposit_settings
    alter column refund_on_early_cancel set default 'devolucion';

update public.branch_deposit_settings
   set refund_on_early_cancel = 'devolucion', updated_at = now()
 where refund_on_early_cancel = 'credito';

-- Cuerpo COMPLETO (no un diff): una migración que repara otra tiene que dejar
-- la base correcta sin importar en qué estado la encuentre.
create or replace function public.close_barber_shift(
    p_staff_id uuid,
    p_branch_id uuid,
    p_cash_counted numeric DEFAULT NULL::numeric,
    p_notes text DEFAULT NULL::text
)
 returns shift_closes
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    COALESCE(SUM(CASE WHEN payment_method = 'cash'
                      THEN GREATEST(amount - COALESCE(prepaid_amount,0), 0) ELSE 0 END), 0)::numeric AS cash_total,
    COALESCE(SUM(CASE WHEN payment_method = 'transfer'
                      THEN GREATEST(amount - COALESCE(prepaid_amount,0), 0) ELSE 0 END), 0)::numeric AS transfer_total,
    COALESCE(SUM(CASE WHEN payment_method = 'card'
                      THEN GREATEST(amount - COALESCE(prepaid_amount,0), 0) ELSE 0 END), 0)::numeric AS card_total,
    COALESCE(SUM(CASE WHEN tip_payment_method = 'cash' THEN tip_amount ELSE 0 END), 0)::numeric AS tips_cash,
    COALESCE(SUM(LEAST(COALESCE(prepaid_amount,0), COALESCE(amount,0))), 0)::numeric AS prepaid_total
  INTO v_summary
  FROM public.visits
  WHERE barber_id = p_staff_id
    AND branch_id = p_branch_id
    AND (completed_at AT TIME ZONE v_tz)::date = v_date;

  SELECT opening_cash, cash_counted INTO v_existing
  FROM public.shift_closes
  WHERE staff_id = p_staff_id AND branch_id = p_branch_id AND local_date = v_date;

  v_opening_cash := COALESCE(v_existing.opening_cash, COALESCE(v_default_opening, 0));
  v_final_counted := COALESCE(p_cash_counted, v_existing.cash_counted);

  v_cash_expected := v_opening_cash + v_summary.cash_total + v_summary.tips_cash;
  v_cash_diff := CASE WHEN v_final_counted IS NULL THEN NULL ELSE v_final_counted - v_cash_expected END;

  v_breakdown := jsonb_build_object(
    'opening_cash', v_opening_cash,
    'cash_total', v_summary.cash_total,
    'transfer_total', v_summary.transfer_total,
    'card_total', v_summary.card_total,
    'tips_cash', v_summary.tips_cash,
    'prepaid_total', v_summary.prepaid_total
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

  SELECT action_type INTO v_last_action
  FROM public.attendance_logs
  WHERE staff_id = p_staff_id AND recorded_at >= v_day_start
  ORDER BY recorded_at DESC LIMIT 1;

  IF v_last_action = 'clock_in' THEN
    INSERT INTO public.attendance_logs (staff_id, branch_id, action_type, face_verified)
    VALUES (p_staff_id, p_branch_id, 'clock_out', false);
  END IF;

  RETURN v_result;
END;
$function$;

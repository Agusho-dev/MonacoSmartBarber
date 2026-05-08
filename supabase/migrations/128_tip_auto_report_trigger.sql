-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 128 — Trigger automático: cada visita nueva o actualizada con
-- propina sincroniza un salary_report 'tip' pendiente.
--
-- Sin esto, el patch de propinas sería una bomba de tiempo: una vez aplicado
-- el backfill, las propinas nuevas seguirían siendo invisibles para sueldos.
--
-- NOTA: Originalmente intenté usar ON CONFLICT con índice parcial pero
-- PostgreSQL tiene limitaciones para inferir el índice partial dentro de
-- PL/pgSQL. Implementación final: SELECT explícito + INSERT|UPDATE|DELETE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_visits_sync_tip_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz       text;
  v_existing_id uuid;
  v_existing_status text;
BEGIN
  IF NEW.barber_id IS NULL OR NEW.completed_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Caso 1: la propina pasó a 0 → borrar report pendiente si existe (no tocar pagado)
  IF COALESCE(NEW.tip_amount, 0) = 0 THEN
    DELETE FROM public.salary_reports
     WHERE source_visit_id = NEW.id
       AND type = 'tip'
       AND status = 'pending';
    RETURN NEW;
  END IF;

  SELECT COALESCE(timezone, 'America/Argentina/Buenos_Aires')
    INTO v_tz
    FROM public.branches
   WHERE id = NEW.branch_id;

  -- Buscar report existente para esta visita
  SELECT id, status
    INTO v_existing_id, v_existing_status
    FROM public.salary_reports
   WHERE source_visit_id = NEW.id
     AND type = 'tip'
   LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.salary_reports (
      staff_id, branch_id, type, amount, notes, report_date, status,
      tip_payment_method, source_visit_id
    )
    VALUES (
      NEW.barber_id,
      NEW.branch_id,
      'tip',
      NEW.tip_amount,
      CASE NEW.tip_payment_method
        WHEN 'cash'     THEN 'Propina del cliente — efectivo'
        WHEN 'card'     THEN 'Propina del cliente — tarjeta'
        WHEN 'transfer' THEN 'Propina del cliente — transferencia'
        ELSE 'Propina del cliente'
      END,
      (NEW.completed_at AT TIME ZONE v_tz)::date,
      'pending',
      NEW.tip_payment_method,
      NEW.id
    );
  ELSIF v_existing_status = 'pending' THEN
    -- paid es histórico cerrado, no se toca
    UPDATE public.salary_reports
       SET amount             = NEW.tip_amount,
           tip_payment_method = NEW.tip_payment_method,
           notes              = CASE NEW.tip_payment_method
             WHEN 'cash'     THEN 'Propina del cliente — efectivo'
             WHEN 'card'     THEN 'Propina del cliente — tarjeta'
             WHEN 'transfer' THEN 'Propina del cliente — transferencia'
             ELSE 'Propina del cliente'
           END,
           report_date        = (NEW.completed_at AT TIME ZONE v_tz)::date,
           updated_at         = now()
     WHERE id = v_existing_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visits_sync_tip_report ON public.visits;

CREATE TRIGGER trg_visits_sync_tip_report
AFTER INSERT OR UPDATE OF tip_amount, tip_payment_method, completed_at, barber_id
ON public.visits
FOR EACH ROW
EXECUTE FUNCTION public.fn_visits_sync_tip_report();

COMMENT ON FUNCTION public.fn_visits_sync_tip_report() IS
  'Crea/actualiza salary_reports type=tip pendiente al insertar/modificar visits. No toca reports ya pagados.';

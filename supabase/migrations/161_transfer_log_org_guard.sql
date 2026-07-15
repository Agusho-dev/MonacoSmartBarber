-- =============================================================================
-- Migración 161: el ledger de cuentas no puede cruzar organizaciones.
--
-- El dashboard escribe `visits` DIRECTO desde el browser (historial-servicios.tsx,
-- rol authenticated). El payment_account_id que manda el cliente no lo validaba nadie:
-- con el trigger de la 160, una visita podía acreditarle plata a la cuenta bancaria de
-- OTRA organización. Nada en la UI lo permite, pero el invariante tiene que vivir en la
-- DB, no en la buena fe del front.
--
-- Se valida por ORGANIZACIÓN, no por sucursal, a propósito: hay 810 visitas históricas de
-- Paraná ($13,27M, mar–jun 2026) imputadas a la cuenta "Alejo Jofre", que hoy figura en
-- otra sucursal de la MISMA org (le cambiaron la sucursal a la cuenta después de usarla).
-- Exigir mismo branch rompería la edición de todas esas visitas. Cruzar orgs, en cambio,
-- no tiene ningún caso de uso legítimo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_transfer_log_from_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tip       NUMERIC(12,2);
  v_acct_org  UUID;
  v_visit_org UUID;
BEGIN
  IF NEW.payment_method::text = 'transfer' AND NEW.payment_account_id IS NOT NULL THEN

    -- La cuenta tiene que ser de la misma organización que la visita.
    SELECT br.organization_id
      INTO v_acct_org
      FROM payment_accounts pa
      JOIN branches br ON br.id = pa.branch_id
     WHERE pa.id = NEW.payment_account_id;

    IF v_acct_org IS NULL THEN
      RAISE EXCEPTION 'La cuenta de cobro % no existe', NEW.payment_account_id;
    END IF;

    v_visit_org := COALESCE(
      NEW.organization_id,
      (SELECT br.organization_id FROM branches br WHERE br.id = NEW.branch_id)
    );

    IF v_visit_org IS DISTINCT FROM v_acct_org THEN
      RAISE EXCEPTION 'La cuenta de cobro pertenece a otra organización';
    END IF;

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
      -- transferred_at NO se pisa: el mes de acreditación queda anclado al cobro original.
  ELSE
    -- Dejó de ser transferencia (o le sacaron la cuenta) → sale del ledger.
    DELETE FROM transfer_logs WHERE visit_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_sync_transfer_log_from_visit() IS
  'Mantiene transfer_logs como proyección exacta de las visitas cobradas por transferencia (incluida la propina transferida) y rechaza imputar un cobro a una cuenta de otra organización. Única escritura del ledger de cuentas.';

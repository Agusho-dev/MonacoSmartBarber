-- ============================================================
-- 165 — Guard anti sobre-asignación de cobro conjunto (mig 164)
-- ============================================================
-- Un comprobante-ancla (payment_receipts.covers_group) sólo puede respaldar cortes
-- cuya SUMA no supere su monto (el depósito real). Sin esto, dos barberos que cuelgan
-- del mismo ancla a la vez —o una llamada cruda a completeService— podían asignar de
-- más y sobre-consumir el tope mensual de la cuenta (cada corte escribe un transfer_log
-- contra la cuenta del ancla). La regla vive en la DB, no en el call-site: es la única
-- forma de cerrar la carrera entre cuelgues concurrentes (lección auditoría 14/jul).

CREATE OR REPLACE FUNCTION fn_guard_joint_receipt_coverage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount   numeric(12,2);
  v_assigned numeric(12,2);
  v_charge   numeric(12,2);
  v_tol      numeric(12,2) := 1;   -- tolerancia de redondeo (pesos)
BEGIN
  -- Lock del ancla → serializa cuelgues concurrentes sobre el MISMO comprobante:
  -- la 2ª transacción espera y recién entonces suma (viendo el corte de la 1ª).
  SELECT extracted_amount INTO v_amount
    FROM payment_receipts
   WHERE id = NEW.covering_receipt_id
   FOR UPDATE;

  -- Sin monto legible no se puede acotar la cobertura → se deja pasar; el dashboard
  -- lo marca como cobro conjunto a revisar. Sólo validamos cuando hay monto.
  IF v_amount IS NULL THEN
    RETURN NEW;
  END IF;

  v_charge := COALESCE(NEW.amount, 0)
            + CASE WHEN NEW.tip_payment_method = 'transfer' THEN COALESCE(NEW.tip_amount, 0) ELSE 0 END;

  SELECT COALESCE(SUM(
           v.amount + CASE WHEN v.tip_payment_method = 'transfer' THEN COALESCE(v.tip_amount, 0) ELSE 0 END
         ), 0)
    INTO v_assigned
    FROM visits v
   WHERE v.covering_receipt_id = NEW.covering_receipt_id
     AND v.id <> NEW.id;

  IF v_assigned + v_charge > v_amount + v_tol THEN
    RAISE EXCEPTION 'JOINT_OVER_ASSIGN: el comprobante conjunto (%) no alcanza para la suma de los cortes (%)',
      v_amount, v_assigned + v_charge
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_joint_receipt_coverage ON visits;
CREATE TRIGGER trg_guard_joint_receipt_coverage
  BEFORE INSERT OR UPDATE OF covering_receipt_id, amount, tip_amount, tip_payment_method ON visits
  FOR EACH ROW
  WHEN (NEW.covering_receipt_id IS NOT NULL)
  EXECUTE FUNCTION fn_guard_joint_receipt_coverage();

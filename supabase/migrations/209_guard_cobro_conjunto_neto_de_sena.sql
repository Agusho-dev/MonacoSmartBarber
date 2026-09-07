-- ============================================================================
-- 209 · El guard de cobro conjunto mide NETO DE SEÑA
-- ============================================================================
--
-- Problema (aparece con la seña de la mig 207):
--   `fn_guard_joint_receipt_coverage` (mig 165) compara la suma de los cortes
--   colgados de un comprobante-ancla contra `payment_receipts.extracted_amount`,
--   sumando `visits.amount` en BRUTO. Desde la 207, `visits.amount` es el precio
--   COMPLETO del servicio y la seña ya cobrada por Mercado Pago vive en
--   `visits.prepaid_amount`: el comprobante que el cliente muestra en el
--   mostrador es por el REMANENTE.
--
--   Consecuencia: un cobro conjunto donde alguno de los cortes tiene seña nunca
--   podía cerrar. El guard levantaba JOINT_OVER_ASSIGN ("el comprobante no
--   alcanza") comparando dos cosas distintas, y el barbero no tenía forma de
--   colgar su corte de un pago que el cliente SÍ había hecho entero.
--
-- Cambio (uno solo, en dos expresiones que son la misma cuenta): el cargo de
--   cada visita pasa a ser lo que se transfirió, `GREATEST(amount -
--   prepaid_amount, 0) + propina transferida`. Es el mismo piso en cero que ya
--   usan `fn_sync_transfer_log_from_visit` (el ledger), `close_barber_shift` y
--   `montoTransferido` en `src/lib/actions/receipts.ts`: con un cupón que
--   descuenta más que la seña, el remanente daría negativo.
--
-- El cuerpo se copió del vivo (`pg_get_functiondef`, 3/9/2026) para no pisar
-- nada por accidente: lo único que cambia son las dos expresiones del cargo.
--
-- El trigger se recrea agregando `prepaid_amount` a su lista de `UPDATE OF`.
-- Hoy `completeService` escribe `amount` y `prepaid_amount` en el mismo UPDATE
-- (así que el guard corre igual), pero si algún camino futuro bajara sólo la
-- seña, el neto subiría sin que nadie revalidara la cobertura.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_joint_receipt_coverage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_amount   numeric(12,2);
  v_assigned numeric(12,2);
  v_charge   numeric(12,2);
  v_tol      numeric(12,2) := 1;
BEGIN
  SELECT extracted_amount INTO v_amount
    FROM payment_receipts
   WHERE id = NEW.covering_receipt_id
   FOR UPDATE;

  IF v_amount IS NULL THEN
    RETURN NEW;
  END IF;

  -- Neto de seña: la parte prepaga entró por Mercado Pago, no por esta
  -- transferencia, y el comprobante no la incluye.
  v_charge := GREATEST(COALESCE(NEW.amount, 0) - COALESCE(NEW.prepaid_amount, 0), 0)
            + CASE WHEN NEW.tip_payment_method = 'transfer' THEN COALESCE(NEW.tip_amount, 0) ELSE 0 END;

  SELECT COALESCE(SUM(
           GREATEST(v.amount - COALESCE(v.prepaid_amount, 0), 0)
           + CASE WHEN v.tip_payment_method = 'transfer' THEN COALESCE(v.tip_amount, 0) ELSE 0 END
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
$function$;

DROP TRIGGER IF EXISTS trg_guard_joint_receipt_coverage ON public.visits;

CREATE TRIGGER trg_guard_joint_receipt_coverage
  BEFORE INSERT OR UPDATE OF covering_receipt_id, amount, prepaid_amount, tip_amount, tip_payment_method
  ON public.visits
  FOR EACH ROW
  WHEN (new.covering_receipt_id IS NOT NULL)
  EXECUTE FUNCTION fn_guard_joint_receipt_coverage();

COMMENT ON FUNCTION public.fn_guard_joint_receipt_coverage() IS
  'Impide que la suma de los cortes colgados de un comprobante-ancla supere su monto. Mide NETO DE SEÑA (mig 209): visits.amount es el precio completo y la parte prepaga no pasó por esta transferencia.';

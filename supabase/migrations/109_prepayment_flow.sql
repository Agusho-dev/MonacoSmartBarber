-- =============================================================================
-- Migración 109: Flujo de prepago (seña / pago total antes del servicio)
--
-- Cuando appointment_settings.payment_mode = 'prepago', los turnos nuevos
-- nacen con status='pending_payment'. Se envía un mensaje al cliente con
-- instrucciones de pago. El staff confirma manualmente (cash/transfer/mp
-- manual/etc.), lo que:
--   1) Marca el turno como 'confirmed'
--   2) Crea una visita (impacta caja/finanzas YA).
--
-- Cuando el servicio eventualmente se completa (trigger on_queue_completed),
-- si existe una visita prepago vinculada por appointment_id, no duplicamos
-- el cobro — la visita ya fue creada al momento del prepago; el
-- completeService() del walk-in ajusta montos del mismo record.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Nuevo status 'pending_payment' en appointments
-- ---------------------------------------------------------------------------
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_status_check
  CHECK (status IN (
    'pending_payment',
    'confirmed',
    'checked_in',
    'in_progress',
    'completed',
    'cancelled',
    'no_show'
  ));

COMMENT ON COLUMN appointments.status IS
  'Estado del turno. pending_payment = esperando confirmación de pago (solo para orgs con payment_mode=prepago).';

-- Excluir pending_payment del índice de no-overlap: si el cliente no paga,
-- el slot no debe bloquearse indefinidamente para otro cliente que sí pague.
-- Sin embargo mantenemos slot reservado mientras espera pago (semántica actual),
-- así que pending_payment SÍ debe contar como reserva activa.
-- NOTA: el índice existente usa WHERE status NOT IN ('cancelled','no_show'),
-- por lo que pending_payment queda incluido automáticamente. OK.

-- ---------------------------------------------------------------------------
-- B. Settings de prepago
-- ---------------------------------------------------------------------------
ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS prepayment_type TEXT NOT NULL DEFAULT 'fixed'
    CHECK (prepayment_type IN ('fixed', 'percentage'));

ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS prepayment_percentage NUMERIC(5,2) NOT NULL DEFAULT 50
    CHECK (prepayment_percentage > 0 AND prepayment_percentage <= 100);

ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS payment_request_template_id UUID
    REFERENCES message_templates(id) ON DELETE SET NULL;

ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS payment_instructions TEXT;

COMMENT ON COLUMN appointment_settings.prepayment_type IS
  'fixed = 100% del precio del servicio, percentage = porcentaje (seña)';
COMMENT ON COLUMN appointment_settings.prepayment_percentage IS
  'Porcentaje de seña cuando prepayment_type=percentage. 1-100.';
COMMENT ON COLUMN appointment_settings.payment_request_template_id IS
  'Template WA/IG usado para solicitar el pago al cliente. Si null, se usa mensaje libre con payment_instructions.';
COMMENT ON COLUMN appointment_settings.payment_instructions IS
  'Texto libre con instrucciones de pago (CBU, alias, link MP manual, etc.). Se envía junto al request.';

-- ---------------------------------------------------------------------------
-- C. visits.appointment_id — vincula visitas de prepago al turno
-- ---------------------------------------------------------------------------
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS appointment_id UUID
    REFERENCES appointments(id) ON DELETE SET NULL;

COMMENT ON COLUMN visits.appointment_id IS
  'Turno asociado a la visita. Se setea cuando la visita es generada por un prepago (antes del servicio) o cuando el servicio completado proviene de un turno (queue_entries.appointment_id).';

CREATE INDEX IF NOT EXISTS idx_visits_appointment
  ON visits(appointment_id)
  WHERE appointment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- D. Actualizar on_queue_completed para propagar appointment_id a la visita
--    generada por el servicio. El prepago (si lo hubo) vive como una visita
--    separada ya creada en confirmAppointmentPrepayment(); la nueva visita
--    representa el cobro del remanente al completar el servicio.
--    completeService() se encarga de computar el remanente correctamente.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.on_queue_completed()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_commission NUMERIC(5,2);
  v_visit_id UUID;
  v_points INTEGER;
  v_reward_active BOOLEAN;
  v_service_points INTEGER;
  v_org_id UUID;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    SELECT organization_id INTO v_org_id FROM branches WHERE id = NEW.branch_id;

    SELECT commission_pct INTO v_commission FROM staff WHERE id = NEW.barber_id;
    v_commission := COALESCE(v_commission, 0);

    -- Crear visita con link al turno si aplica (migración 109).
    INSERT INTO visits (
      branch_id, client_id, barber_id, queue_entry_id, appointment_id,
      amount, commission_pct, commission_amount,
      started_at, completed_at, organization_id
    )
    VALUES (
      NEW.branch_id, NEW.client_id, NEW.barber_id, NEW.id, NEW.appointment_id,
      0, v_commission, 0,
      NEW.started_at, NEW.completed_at, v_org_id
    )
    RETURNING id INTO v_visit_id;

    v_service_points := 0;
    IF NEW.service_id IS NOT NULL THEN
      SELECT COALESCE(points_per_service, 0) INTO v_service_points
      FROM services WHERE id = NEW.service_id;
    END IF;

    IF v_service_points > 0 THEN
      v_points := v_service_points;
      v_reward_active := true;
    ELSE
      SELECT rw.points_per_visit, rw.is_active INTO v_points, v_reward_active
      FROM rewards_config rw
      WHERE (rw.branch_id = NEW.branch_id OR rw.branch_id IS NULL)
        AND rw.is_active = true
      LIMIT 1;
    END IF;

    IF v_reward_active IS TRUE AND v_points > 0 AND NEW.client_id IS NOT NULL THEN
      INSERT INTO client_points (client_id, branch_id, organization_id, points_balance, total_earned)
      VALUES (NEW.client_id, NEW.branch_id, v_org_id, v_points, v_points)
      ON CONFLICT (client_id, organization_id)
      DO UPDATE SET
        points_balance = client_points.points_balance + v_points,
        total_earned = client_points.total_earned + v_points;

      INSERT INTO point_transactions (client_id, visit_id, points, type, description, organization_id)
      VALUES (NEW.client_id, v_visit_id, v_points, 'earned', 'Puntos por visita', v_org_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

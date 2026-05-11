-- =============================================================================
-- Migración 131: Push-on-complete + revert fairness gate (fix de raíz)
-- =============================================================================
-- Problema (9-may-2026): la mig 129 introdujo un fairness gate server-side en
-- assign_next_client que bloquea el claim de un cliente dinámico cuando el
-- ranking del cliente local diverge del ranking del server (criterios distintos:
-- ETA vs load count). Síntoma: el cliente dinámico queda invisible para todos
-- los paneles "Mi fila" hasta que un admin lo arrastra manualmente desde el
-- dashboard. Este es el problema reportado: "los chicos terminan un corte y
-- los clientes de la fila dinámica no se les asignan".
--
-- Solución de raíz (no patch): cambiar el modelo de PULL (cada barbero tap
-- "Atender" manual) a PUSH (al completar un corte, el server claim atómico
-- del siguiente). Con push-on-complete:
--   1. El barbero NO tiene que tocar nada después de cobrar — el siguiente
--      cliente queda asignado y en in_progress automáticamente.
--   2. La FIFO global se respeta: el primero en terminar gana el siguiente.
--   3. Eliminamos el fairness gate porque la atomicidad se garantiza con
--      FOR UPDATE SKIP LOCKED nativo de Postgres — es la única "fairness"
--      que importa cuando hay race conditions.
--   4. El idle time entre cortes se elimina: ~30-90s ahorrados por corte,
--      equivalentes a 0.5-2 cortes adicionales por barbero por día.
--
-- Esta migración:
--   A. Crea claim_next_for_barber(barber, branch, preferred?) → claim atómico
--      + arranque (sets status='in_progress' + started_at). Retorna 0 ó 1
--      filas con (entry_id, is_break, was_dynamic).
--   B. Reescribe assign_next_client SIN fairness gate. Mantiene guards 0a
--      (descanso activo, mig 127) y 0b (ghost ready, mig 128) y los filtros
--      de turno. Cualquier caller legacy que aún use assign_next_client
--      recupera el comportamiento pre-fairness-gate.
--
-- compute_fair_barber y get_fair_barber se conservan vivos (sin uso enforcing)
-- como utilidades para futuras features (hints de ETA, ranking en pool view).
-- Se pueden dropear en una mig posterior si quedan sin uso.
--
-- Hardening:
--   * SECURITY DEFINER + SET search_path = public, pg_temp (estándar Supabase).
--   * FOR UPDATE SKIP LOCKED en TODOS los lookups que terminan en UPDATE,
--     evitando deadlocks bajo concurrencia alta (varios barberos completando
--     casi simultáneamente).
--   * UPDATE con `AND status = 'waiting'` como guardia contra TOCTOU (si otro
--     transaction agarró la misma fila entre el lock y el update — no debería
--     pasar con SKIP LOCKED, pero defensa en profundidad).
--   * Los UPDATE no tocan filas ya iniciadas: si el partial UNIQUE de mig 127
--     detecta un doble in_progress, el código de aplicación lo recibe como
--     23505 y maneja el caso.
-- =============================================================================

-- ── A. Nueva función: claim_next_for_barber ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_next_for_barber(
  p_barber_id UUID,
  p_branch_id UUID,
  p_preferred_entry_id UUID DEFAULT NULL
)
RETURNS TABLE(
  entry_id UUID,
  is_break BOOLEAN,
  was_dynamic BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
-- `is_break` colisiona entre nombre de columna y OUT param. La directiva
-- `#variable_conflict use_column` resuelve referencias ambiguas al nombre de
-- columna (que es lo que queremos en cada SELECT/UPDATE de queue_entries).
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_entry_id UUID;
  v_entry_barber_id UUID;
  v_entry_priority TIMESTAMPTZ;
  v_branch_tz TEXT;
  v_org_id UUID;
  v_today DATE;
  v_walkin_mode TEXT;
  v_buffer_minutes INTEGER;
  v_next_appt_start TIMESTAMPTZ;
  v_protection_window INTERVAL;
  v_avg_service_minutes INTEGER := 45;
  v_pending_break_id UUID;
  v_pending_break_priority TIMESTAMPTZ;
BEGIN
  -- Guard 0a: si el barbero ya está en descanso activo, no claim de nada.
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
  ) THEN
    RETURN;
  END IF;

  SELECT b.timezone, b.organization_id INTO v_branch_tz, v_org_id
  FROM branches b WHERE b.id = p_branch_id;
  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

  -- Lookup ghost de descanso pendiente con lock para evitar dobles claims.
  SELECT id, priority_order
    INTO v_pending_break_id, v_pending_break_priority
  FROM queue_entries
  WHERE barber_id = p_barber_id
    AND branch_id = p_branch_id
    AND is_break = true
    AND status = 'waiting'
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- Auto-start del ghost si está listo (ningún cliente asignado con priority
  -- menor lo "tapa"). Los dinámicos NO tapan: pueden ser tomados por otros.
  IF v_pending_break_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND priority_order < v_pending_break_priority
  ) THEN
    UPDATE queue_entries
    SET status = 'in_progress', started_at = v_now
    WHERE id = v_pending_break_id
      AND status = 'waiting';

    RETURN QUERY SELECT v_pending_break_id, true, false;
    RETURN;
  END IF;

  -- Modo appointments_only: este barbero no toma walkins.
  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff WHERE staff_id = p_barber_id;
  IF v_walkin_mode = 'appointments_only' THEN
    RETURN;
  END IF;

  -- Protección por turno inminente (avg_service + buffer).
  SELECT s.buffer_minutes INTO v_buffer_minutes
  FROM appointment_settings s
  WHERE s.organization_id = v_org_id AND s.branch_id IS NULL;
  v_buffer_minutes := COALESCE(v_buffer_minutes, 10);
  v_protection_window := ((v_avg_service_minutes + v_buffer_minutes) || ' minutes')::INTERVAL;

  SELECT (a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz
    INTO v_next_appt_start
  FROM appointments a
  WHERE a.barber_id = p_barber_id
    AND a.branch_id = p_branch_id
    AND a.appointment_date = v_today
    AND a.status IN ('confirmed', 'checked_in')
    AND ((a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz) > v_now
  ORDER BY (a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz ASC
  LIMIT 1;

  IF v_next_appt_start IS NOT NULL
     AND v_next_appt_start <= v_now + v_protection_window THEN
    RETURN;
  END IF;

  -- Path preferido: el caller pasó el id que vio en su UI.
  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order, barber_id
      INTO v_entry_id, v_entry_priority, v_entry_barber_id
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      AND (barber_id = p_barber_id OR barber_id IS NULL)
      AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
      -- Si hay ghost waiting con priority <= candidato, gana el ghost.
      IF v_pending_break_priority IS NOT NULL
         AND v_entry_priority >= v_pending_break_priority THEN
        RETURN;
      END IF;

      UPDATE queue_entries
      SET barber_id = p_barber_id,
          is_dynamic = false,
          status = 'in_progress',
          started_at = v_now
      WHERE id = v_entry_id
        AND status = 'waiting';

      RETURN QUERY SELECT v_entry_id, false, (v_entry_barber_id IS NULL);
      RETURN;
    END IF;
    -- Si el preferred no es elegible, caemos al fallback FIFO.
  END IF;

  -- Fallback FIFO: oldest waiting elegible (mío o dinámico).
  -- Sin fairness gate: el primero en llegar (= el barbero que recién terminó)
  -- gana el siguiente cliente. La concurrencia se resuelve con SKIP LOCKED.
  SELECT id, priority_order, barber_id
    INTO v_entry_id, v_entry_priority, v_entry_barber_id
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = false
    AND (barber_id = p_barber_id OR barber_id IS NULL)
    AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    AND (v_pending_break_priority IS NULL OR priority_order < v_pending_break_priority)
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_entry_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE queue_entries
  SET barber_id = p_barber_id,
      is_dynamic = false,
      status = 'in_progress',
      started_at = v_now
  WHERE id = v_entry_id
    AND status = 'waiting';

  RETURN QUERY SELECT v_entry_id, false, (v_entry_barber_id IS NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_for_barber(UUID, UUID, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_next_for_barber(UUID, UUID, UUID) IS
  'Claim atómico + arranque del próximo entry para un barbero. Decide entre: ghost de descanso listo, asignado o dinámico (FIFO global). Sin fairness gate — atomicidad por FOR UPDATE SKIP LOCKED. Returns (entry_id, is_break, was_dynamic) o vacío si no hay nada elegible.';

-- ── B. Reescritura de assign_next_client SIN fairness gate (mig 131) ────────
-- Revierte el guard 0c de mig 129. El bug "dinámico invisible" desaparece para
-- cualquier code path que aún use esta función (no debería quedar ninguno
-- después del refactor de TS, pero defensa en profundidad).
CREATE OR REPLACE FUNCTION public.assign_next_client(
  p_barber_id UUID,
  p_branch_id UUID,
  p_preferred_entry_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry_id UUID;
  v_branch_tz TEXT;
  v_org_id UUID;
  v_today DATE;
  v_now TIMESTAMPTZ;
  v_walkin_mode TEXT;
  v_buffer_minutes INTEGER;
  v_next_appt_start TIMESTAMPTZ;
  v_protection_window INTERVAL;
  v_avg_service_minutes INTEGER := 45;
  v_pending_break_priority TIMESTAMPTZ;
  v_candidate_priority TIMESTAMPTZ;
BEGIN
  v_now := NOW();

  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT priority_order
    INTO v_pending_break_priority
  FROM queue_entries
  WHERE barber_id = p_barber_id
    AND branch_id = p_branch_id
    AND is_break = true
    AND status = 'waiting'
  ORDER BY priority_order ASC
  LIMIT 1;

  IF v_pending_break_priority IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM queue_entries
      WHERE barber_id = p_barber_id
        AND branch_id = p_branch_id
        AND status = 'waiting'
        AND is_break = false
        AND priority_order < v_pending_break_priority
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT b.timezone, b.organization_id INTO v_branch_tz, v_org_id
  FROM branches b WHERE b.id = p_branch_id;
  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff WHERE staff_id = p_barber_id;
  IF v_walkin_mode = 'appointments_only' THEN
    RETURN NULL;
  END IF;

  SELECT s.buffer_minutes INTO v_buffer_minutes
  FROM appointment_settings s
  WHERE s.organization_id = v_org_id AND s.branch_id IS NULL;
  v_buffer_minutes := COALESCE(v_buffer_minutes, 10);
  v_protection_window := ((v_avg_service_minutes + v_buffer_minutes) || ' minutes')::INTERVAL;

  SELECT (a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz
    INTO v_next_appt_start
  FROM appointments a
  WHERE a.barber_id = p_barber_id
    AND a.branch_id = p_branch_id
    AND a.appointment_date = v_today
    AND a.status IN ('confirmed', 'checked_in')
    AND ((a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz) > v_now
  ORDER BY (a.appointment_date + a.start_time) AT TIME ZONE v_branch_tz ASC
  LIMIT 1;

  IF v_next_appt_start IS NOT NULL
     AND v_next_appt_start <= v_now + v_protection_window THEN
    RETURN NULL;
  END IF;

  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order INTO v_entry_id, v_candidate_priority
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      AND (barber_id = p_barber_id OR barber_id IS NULL)
      AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
      IF v_pending_break_priority IS NOT NULL
         AND v_candidate_priority >= v_pending_break_priority THEN
        RETURN NULL;
      END IF;

      UPDATE queue_entries
      SET barber_id = p_barber_id, is_dynamic = false
      WHERE id = v_entry_id;
      RETURN v_entry_id;
    END IF;
  END IF;

  SELECT id, priority_order INTO v_entry_id, v_candidate_priority
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = false
    AND (barber_id = p_barber_id OR barber_id IS NULL)
    AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
  ORDER BY priority_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_entry_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_pending_break_priority IS NOT NULL
     AND v_candidate_priority >= v_pending_break_priority THEN
    RETURN NULL;
  END IF;

  UPDATE queue_entries
  SET barber_id = p_barber_id, is_dynamic = false
  WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.assign_next_client(UUID, UUID, UUID) IS
  'Claim atómico de próximo cliente, sin fairness gate (mig 131 revierte mig 129). Mantiene guards 0a (descanso activo) y 0b (ghost ready). Usado como fallback legacy; el nuevo path primario es claim_next_for_barber.';

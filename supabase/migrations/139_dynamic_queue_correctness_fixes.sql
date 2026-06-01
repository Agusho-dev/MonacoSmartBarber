-- 139_dynamic_queue_correctness_fixes.sql
-- ---------------------------------------------------------------------------
-- Fixes de correctitud del sistema de FILA DINÁMICA (auditoría jun-2026).
-- Aplicado a prod gzsfoqpxvnwmvngfoqqk el 2026-06-01 vía MCP apply_migration.
--
-- Incluye:
--   PARTE 0 — Reconciliación: de-dup de transfer_logs (revierte el reporte de
--             caja inflado en +272.000 ARS por el doble-complete). DESTRUCTIVO,
--             one-shot, idempotente (re-correr borra 0).
--   PARTE 1 — #1: UNIQUE parcial transfer_logs(visit_id) — evita que el
--             doble-complete vuelva a duplicar el log/incremento de caja.
--   PARTE 2 — #13: claim_next_for_barber gana un guard de servicio in_progress
--             (evita el 23505 crudo de idx_queue_one_in_progress_per_barber).
--   PARTE 3 — #4+#5: get_client_queue_position con TZ por sucursal, divisor de
--             barberos "capaces de tomar dinámicos" (excluye descanso y
--             appointments_only, incluye is_also_barber) y suma el corte propio
--             en curso (no más "Sos el siguiente" con el barbero ocupado).
--   PARTE 4 — #2: cron expire_stale_queue_entries — cancela waiting de días
--             anteriores (limbo post-medianoche), TZ-aware por sucursal.
--
-- NO incluye el #9 (RLS queue_entries_public_read): acotarla rompería la
-- ocupación cross-org del mobile (clientes ven branches de otras orgs). Va en
-- una 140 separada + RPC agregado de ocupación.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- PARTE 0 — RECONCILIACIÓN transfer_logs (de-dup) — DESTRUCTIVO / ONE-SHOT
-- Contexto para el dueño: el cliente transfirió UNA sola vez al banco; el corte
-- se "Finalizó" 2-3 veces (doble-tap / reintento por la red), y cada finalización
-- volvía a anotar la transferencia en NUESTRO registro (transfer_logs). Eso NO es
-- plata perdida ni doble-cobro: es el REPORTE de "total transferido" inflado en
-- +272.000 ARS sobre 14 cortes. Acá borramos las anotaciones repetidas, dejando
-- la primera de cada corte. Después el reporte vuelve a coincidir con la realidad.
-- (Idempotente: si se re-corre, ya no hay duplicados → borra 0.)
-- =============================================================================

DO $reconcile$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY visit_id
             ORDER BY transferred_at ASC NULLS LAST, id ASC
           ) AS rn
    FROM transfer_logs
    WHERE visit_id IS NOT NULL
  )
  DELETE FROM transfer_logs t
  USING ranked r
  WHERE t.id = r.id
    AND r.rn > 1;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '[139 PARTE 0] transfer_logs duplicados borrados: %', v_deleted;
END
$reconcile$;


-- =============================================================================
-- PARTE 1 — FIX #1: transfer_logs idempotente
-- UNIQUE parcial sobre visit_id (excluye NULL: las transferencias manuales sin
-- visit_id deben poder coexistir). Junto al early-return de completeService y al
-- manejo de 23505 en recordTransfer, cierra el doble-conteo de caja.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_logs_visit_id
  ON public.transfer_logs (visit_id)
  WHERE visit_id IS NOT NULL;

-- El índice plano previo queda redundante para lookups por visit_id no-null.
-- Verificado: ninguna query filtra transfer_logs por visit_id IS NULL.
DROP INDEX IF EXISTS public.idx_transfer_logs_visit_id;


-- =============================================================================
-- PARTE 2 — FIX #13: claim_next_for_barber
-- Guard temprano: si el barbero ya tiene un SERVICIO (no-break) in_progress, no
-- reclamar otro. Evita el 23505 crudo de idx_queue_one_in_progress_per_barber
-- (UNIQUE(barber_id) WHERE in_progress — un barbero sólo puede tener 1 in_progress
-- total). Defensa en profundidad: reduce la ventana de carrera; el índice único
-- sigue siendo la garantía dura. Body completo re-emitido (preserva todo lo demás).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_next_for_barber(p_barber_id uuid, p_branch_id uuid, p_preferred_entry_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entry_id uuid, is_break boolean, was_dynamic boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_entry_id UUID;
  v_entry_barber_id UUID;
  v_entry_priority TIMESTAMPTZ;
  v_entry_is_dynamic BOOLEAN;
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
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
  ) THEN
    RETURN;
  END IF;

  -- FIX #13: si el barbero ya tiene un SERVICIO (no-break) in_progress, no
  -- reclamar otro. Evita el 23505 crudo de idx_queue_one_in_progress_per_barber
  -- ante doble click / requests concurrentes con preferred_entry distintos.
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = false
      AND status = 'in_progress'
  ) THEN
    RETURN;
  END IF;

  SELECT b.timezone, b.organization_id INTO v_branch_tz, v_org_id
  FROM branches b WHERE b.id = p_branch_id;
  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

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

  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff WHERE staff_id = p_barber_id;
  IF v_walkin_mode = 'appointments_only' THEN
    RETURN;
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
    RETURN;
  END IF;

  -- Path preferred. Pool NO bloqueante (mig 134): especifico mio |
  -- dinamico de pool (NULL) | dinamico legacy con barber_id viejo
  -- (is_dynamic = true) -> robable por cualquier barbero libre.
  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id, priority_order, barber_id, is_dynamic
      INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND is_appointment = false
      AND (
        barber_id = p_barber_id
        OR barber_id IS NULL
        OR is_dynamic = true
      )
      AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
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

      RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
      RETURN;
    END IF;
  END IF;

  SELECT id, priority_order, barber_id, is_dynamic
    INTO v_entry_id, v_entry_priority, v_entry_barber_id, v_entry_is_dynamic
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND is_appointment = false
    AND (
      barber_id = p_barber_id
      OR barber_id IS NULL
      OR is_dynamic = true
    )
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

  RETURN QUERY SELECT v_entry_id, false, COALESCE(v_entry_is_dynamic, v_entry_barber_id IS NULL);
END;
$function$;


-- =============================================================================
-- PARTE 3 — FIX #4 + #5: get_client_queue_position
-- (#5) TZ por sucursal (antes hardcode BA — rompía "hoy" tras 21:00 AR u otra TZ).
--      ⚠️ El body NUEVO carga v_entry ANTES de derivar v_today (el viejo calculaba
--         v_today primero). Es CREATE OR REPLACE con body completo, OK.
-- (#5/divisor) v_active_barbers excluye ghost-break y appointments_only e incluye
--      is_also_barber (un admin que también corta cuenta como capacidad).
-- (#4) suma el corte in_progress del barbero específico como +1 adelante.
-- Nota: el divisor del front (countActiveDynamicCapableBarbers) además excluye
--      shift-end y exige clock-in explícito; replicar eso en SQL es frágil, así que
--      mobile puede mostrar un número levemente distinto de TV/kiosk (aceptado).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_client_queue_position(p_queue_entry_id uuid)
 RETURNS TABLE("position" integer, effective_ahead integer, status text, label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_entry RECORD;
  v_branch_tz TEXT;
  v_today DATE;
  v_total_ahead INT;
  v_specifics_ahead INT;
  v_dynamics_ahead INT;
  v_active_barbers INT;
  v_self_busy INT := 0;
  v_effective INT;
BEGIN
  SELECT qe.id, qe.branch_id, qe.barber_id, qe.priority_order,
         qe.status AS entry_status, qe.position AS entry_position
  INTO v_entry
  FROM queue_entries qe
  WHERE qe.id = p_queue_entry_id;

  IF v_entry IS NULL THEN
    RETURN QUERY SELECT 0, 0, 'not_found'::TEXT, 'Turno no encontrado'::TEXT;
    RETURN;
  END IF;

  v_branch_tz := COALESCE(
    (SELECT b.timezone FROM branches b WHERE b.id = v_entry.branch_id),
    'America/Argentina/Buenos_Aires'
  );
  v_today := (NOW() AT TIME ZONE v_branch_tz)::DATE;

  IF v_entry.entry_status = 'in_progress' THEN
    RETURN QUERY SELECT v_entry.entry_position, 0, 'in_progress'::TEXT, 'Es tu turno'::TEXT;
    RETURN;
  END IF;

  IF v_entry.entry_status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT v_entry.entry_position, 0, v_entry.entry_status::TEXT, ''::TEXT;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_active_barbers
  FROM staff s
  WHERE s.branch_id = v_entry.branch_id
    AND (s.role = 'barber' OR s.is_also_barber = true)
    AND s.is_active = true
    AND s.hidden_from_checkin = false
    AND (
      SELECT al.action_type FROM attendance_logs al
      WHERE al.staff_id = s.id
        AND (al.recorded_at AT TIME ZONE v_branch_tz)::DATE = v_today
      ORDER BY al.recorded_at DESC LIMIT 1
    ) IS DISTINCT FROM 'clock_out'::attendance_action
    AND NOT EXISTS (
      SELECT 1 FROM queue_entries qb
      WHERE qb.barber_id = s.id
        AND qb.branch_id = v_entry.branch_id
        AND qb.is_break = true
        AND qb.status = 'in_progress'
    )
    AND NOT EXISTS (
      SELECT 1 FROM appointment_staff aps
      WHERE aps.staff_id = s.id
        AND aps.walkin_mode = 'appointments_only'
    );

  IF v_active_barbers < 1 THEN
    v_active_barbers := 1;
  END IF;

  IF v_entry.barber_id IS NULL THEN
    SELECT COUNT(*) INTO v_total_ahead
    FROM queue_entries qe
    WHERE qe.branch_id = v_entry.branch_id
      AND qe.status = 'waiting'
      AND qe.is_break = false
      AND qe.id != v_entry.id
      AND qe.priority_order < v_entry.priority_order
      AND (qe.checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today;

    v_effective := CEIL(v_total_ahead::numeric / v_active_barbers);
  ELSE
    SELECT COUNT(*) INTO v_specifics_ahead
    FROM queue_entries qe
    WHERE qe.branch_id = v_entry.branch_id
      AND qe.status = 'waiting'
      AND qe.is_break = false
      AND qe.id != v_entry.id
      AND qe.barber_id = v_entry.barber_id
      AND qe.priority_order < v_entry.priority_order
      AND (qe.checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today;

    SELECT COUNT(*) INTO v_dynamics_ahead
    FROM queue_entries qe
    WHERE qe.branch_id = v_entry.branch_id
      AND qe.status = 'waiting'
      AND qe.is_break = false
      AND qe.id != v_entry.id
      AND qe.barber_id IS NULL
      AND qe.priority_order < v_entry.priority_order
      AND (qe.checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today;

    -- FIX #4: el corte que el barbero específico está atendiendo AHORA cuenta como
    -- +1 adelante (antes daba "Sos el siguiente" con alguien físicamente en la silla).
    SELECT COUNT(*) INTO v_self_busy
    FROM queue_entries qe
    WHERE qe.branch_id = v_entry.branch_id
      AND qe.barber_id = v_entry.barber_id
      AND qe.is_break = false
      AND qe.status = 'in_progress';

    v_effective := v_specifics_ahead + v_self_busy
                   + CEIL(v_dynamics_ahead::numeric / v_active_barbers);
  END IF;

  IF v_effective = 0 THEN
    RETURN QUERY SELECT v_entry.entry_position, 0, 'waiting'::TEXT, 'Sos el siguiente'::TEXT;
  ELSIF v_effective = 1 THEN
    RETURN QUERY SELECT v_entry.entry_position, 1, 'waiting'::TEXT, 'Aprox. 1 persona antes'::TEXT;
  ELSE
    RETURN QUERY SELECT v_entry.entry_position, v_effective, 'waiting'::TEXT, ('Aprox. ' || v_effective || ' personas antes')::TEXT;
  END IF;
END;
$function$;


-- =============================================================================
-- PARTE 4 — FIX #2: cron de limbo
-- expire_stale_queue_entries(): cancela 'waiting' no-break de días anteriores,
-- TZ-aware por sucursal. NO toca in_progress ni breaks. Mirror del cancel del
-- dashboard (sólo status='cancelled'; el schema no tiene cancelled_at).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.expire_stale_queue_entries()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  WITH stale AS (
    SELECT qe.id
    FROM queue_entries qe
    JOIN branches b ON b.id = qe.branch_id
    WHERE qe.status = 'waiting'
      AND qe.is_break = false
      AND (qe.checked_in_at AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::DATE
          < (NOW() AT TIME ZONE COALESCE(b.timezone, 'America/Argentina/Buenos_Aires'))::DATE
  )
  UPDATE queue_entries qe
  SET status = 'cancelled'
  FROM stale
  WHERE qe.id = stale.id
    AND qe.status = 'waiting';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Registro pg_cron idempotente (cada 10 min).
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-queue-entries') THEN
    PERFORM cron.schedule(
      'expire-stale-queue-entries',
      '*/10 * * * *',
      $$SELECT public.expire_stale_queue_entries();$$
    );
  END IF;
END
$cron$;

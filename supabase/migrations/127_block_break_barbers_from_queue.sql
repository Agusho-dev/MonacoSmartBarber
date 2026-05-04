-- =============================================================================
-- Migración 127: Barbero en descanso NO puede recibir clientes
-- =============================================================================
-- Problema: el flujo "fila dinámica" tiene tres caminos por los que un cliente
-- puede llegar a un barbero (RPC assign_next_client, util cliente
-- assignDynamicBarbers, kiosk renderBarberList). Ninguno chequea si el barbero
-- tiene un ghost de descanso `is_break=true AND status='in_progress'`. Esta
-- migración cierra el camino servidor (RPC) y agrega el último seguro
-- estructural (partial unique index). Las capas de UI se arreglan en código TS.
--
-- Capa A — Guard en RPC: assign_next_client retorna NULL si el barbero está en
-- descanso activo en la sucursal actual.
-- Capa B — Index parcial pequeño para hacer la EXISTS del guard O(1).
-- Capa Z — Partial UNIQUE: garantiza que un barbero no puede tener dos
-- `in_progress` simultáneos (un break + un corte) — defensa de DB final.
-- =============================================================================

-- ── Pre-check de seguridad ──────────────────────────────────────────────────
-- Si hubiera barberos con más de un in_progress, el partial UNIQUE fallaría.
-- Abortamos antes de tocar nada para no dejar la migración a medio aplicar.
DO $pre_check$
DECLARE
  v_violations INT;
BEGIN
  SELECT COUNT(*) INTO v_violations
  FROM (
    SELECT barber_id
    FROM public.queue_entries
    WHERE status = 'in_progress' AND barber_id IS NOT NULL
    GROUP BY barber_id
    HAVING COUNT(*) > 1
  ) x;

  IF v_violations > 0 THEN
    RAISE EXCEPTION
      'Pre-check 127 falló: % barbero(s) con más de un queue_entry in_progress. Resolvé manualmente antes de aplicar.',
      v_violations;
  END IF;
END
$pre_check$;

-- ── Capa B: índice parcial para el guard ────────────────────────────────────
-- Cardinalidad <= número de barberos con descanso activo (≈ 0-2 por sucursal).
-- Tamaño despreciable, hace que la EXISTS del guard sea O(1).
CREATE INDEX IF NOT EXISTS idx_queue_active_break_per_barber
  ON public.queue_entries (barber_id, branch_id)
  WHERE is_break = true AND status = 'in_progress';

-- ── Capa Z: último seguro estructural ───────────────────────────────────────
-- Prohíbe que un mismo barbero tenga dos queue_entries `in_progress` a la vez.
-- Cubre cualquier camino que falle aguas arriba (UI con cache stale, lógica de
-- aplicación rota, jobs concurrentes, etc.). Las violaciones surfacean como
-- 23505 (unique_violation) que el código de aplicación ya maneja.
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_one_in_progress_per_barber
  ON public.queue_entries (barber_id)
  WHERE status = 'in_progress' AND barber_id IS NOT NULL;

COMMENT ON INDEX public.idx_queue_one_in_progress_per_barber IS
  'Defensa estructural (mig 127): impide a un barbero tener dos queue_entries in_progress en simultáneo (un break + un corte, o doble asignación por race).';

-- ── Capa A: guard en assign_next_client ─────────────────────────────────────
-- Reescribe la función agregando el chequeo de descanso activo al inicio,
-- antes que cualquier lookup de cliente. Conserva la semántica anterior:
-- walkin_mode='appointments_only' y protección por turno inminente.
-- search_path explícito (incluye pg_temp por hardening estándar de Supabase).
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
BEGIN
  v_now := NOW();

  -- ── Guard 0: barbero en descanso activo (mig 127) ────────────────────────
  -- Si hay un ghost is_break=true && status='in_progress' para este barbero
  -- en esta sucursal, no se le asigna nada. Es la última línea de defensa
  -- del servidor: aunque la UI de barber-panel/kiosk/TV mande pedidos
  -- (cache stale, race entre tabs, regresión), el RPC los rechaza.
  IF EXISTS (
    SELECT 1 FROM queue_entries
    WHERE barber_id = p_barber_id
      AND branch_id = p_branch_id
      AND is_break = true
      AND status = 'in_progress'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT b.timezone, b.organization_id
    INTO v_branch_tz, v_org_id
  FROM branches b
  WHERE b.id = p_branch_id;

  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff
  WHERE staff_id = p_barber_id;

  IF v_walkin_mode = 'appointments_only' THEN
    RETURN NULL;
  END IF;

  SELECT s.buffer_minutes INTO v_buffer_minutes
  FROM appointment_settings s
  WHERE s.organization_id = v_org_id
    AND s.branch_id IS NULL;

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
    SELECT id INTO v_entry_id
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
      UPDATE queue_entries
      SET barber_id = p_barber_id,
          is_dynamic = false
      WHERE id = v_entry_id;
      RETURN v_entry_id;
    END IF;
  END IF;

  SELECT id INTO v_entry_id
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

  UPDATE queue_entries
  SET barber_id = p_barber_id,
      is_dynamic = false
  WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.assign_next_client(UUID, UUID, UUID) IS
  'Asigna atómicamente el próximo cliente a un barbero. Retorna NULL si: barbero en descanso activo (mig 127), modo appointments_only, turno inminente dentro de la ventana de protección, o no hay clientes esperando.';

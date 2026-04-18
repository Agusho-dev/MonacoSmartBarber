-- =============================================================================
-- Migración 086: Branding del turnero público y coexistencia con fila walk-in
-- - Campos de branding (colores + mensaje) en appointment_settings
-- - Campos de scheduling: buffer_minutes, lead_time_minutes
-- - walkin_mode en appointment_staff (un barbero puede estar dedicado a turnos)
-- - Reescritura de assign_next_client para proteger turnos futuros del FIFO
--   walk-in: si el barbero tiene un turno confirmado/checked_in que empieza
--   dentro de (avg_service_duration + buffer_minutes) desde ahora, NO recibe
--   un nuevo walk-in. Devuelve NULL y el walk-in queda en espera / otro
--   barbero lo toma.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Branding + scheduling en appointment_settings
-- ---------------------------------------------------------------------------
ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS brand_primary_color TEXT NOT NULL DEFAULT '#0f172a',
  ADD COLUMN IF NOT EXISTS brand_bg_color      TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS brand_text_color    TEXT NOT NULL DEFAULT '#0f172a',
  ADD COLUMN IF NOT EXISTS welcome_message     TEXT,
  ADD COLUMN IF NOT EXISTS buffer_minutes      INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS lead_time_minutes   INTEGER NOT NULL DEFAULT 30;

COMMENT ON COLUMN appointment_settings.brand_primary_color IS 'Color principal del turnero público (botones, acentos)';
COMMENT ON COLUMN appointment_settings.brand_bg_color IS 'Color de fondo del turnero público';
COMMENT ON COLUMN appointment_settings.brand_text_color IS 'Color de texto principal del turnero público';
COMMENT ON COLUMN appointment_settings.welcome_message IS 'Mensaje de bienvenida mostrado arriba del wizard del turnero';
COMMENT ON COLUMN appointment_settings.buffer_minutes IS 'Minutos de buffer post-servicio (limpieza/preparación). Usado para proteger el turno siguiente de un walk-in que podría extenderse';
COMMENT ON COLUMN appointment_settings.lead_time_minutes IS 'Minutos mínimos de anticipación para reservar online (desde ahora)';

-- Constraint de sanidad sobre los campos numéricos nuevos
ALTER TABLE appointment_settings
  DROP CONSTRAINT IF EXISTS chk_appointment_settings_buffer_range,
  DROP CONSTRAINT IF EXISTS chk_appointment_settings_lead_time_range;

ALTER TABLE appointment_settings
  ADD CONSTRAINT chk_appointment_settings_buffer_range
    CHECK (buffer_minutes >= 0 AND buffer_minutes <= 120),
  ADD CONSTRAINT chk_appointment_settings_lead_time_range
    CHECK (lead_time_minutes >= 0 AND lead_time_minutes <= 1440);

-- ---------------------------------------------------------------------------
-- 2. walkin_mode en appointment_staff
-- ---------------------------------------------------------------------------
ALTER TABLE appointment_staff
  ADD COLUMN IF NOT EXISTS walkin_mode TEXT NOT NULL DEFAULT 'both';

-- Drop & re-create para idempotencia (si la migración corrió parcial antes)
ALTER TABLE appointment_staff
  DROP CONSTRAINT IF EXISTS chk_appointment_staff_walkin_mode;

ALTER TABLE appointment_staff
  ADD CONSTRAINT chk_appointment_staff_walkin_mode
    CHECK (walkin_mode IN ('both', 'appointments_only'));

COMMENT ON COLUMN appointment_staff.walkin_mode IS
  'both = recibe walk-ins y turnos (default); appointments_only = barbero dedicado, fuera del FIFO walk-in';

-- ---------------------------------------------------------------------------
-- 3. Reescritura de assign_next_client
--    - Saltea staff con walkin_mode=appointments_only
--    - Protege turnos futuros: si hay un turno confirmed/checked_in que empieza
--      dentro de (avg_service_duration + buffer_minutes) desde ahora para este
--      barbero en esta sucursal, devuelve NULL (no asigna walk-in)
--    - Calcula v_today usando la timezone de la sucursal (antes estaba
--      hardcodeado a Buenos_Aires)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS assign_next_client(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION assign_next_client(
  p_barber_id UUID,
  p_branch_id UUID,
  p_preferred_entry_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_avg_service_minutes INTEGER := 45;  -- heurística conservadora
BEGIN
  v_now := NOW();

  SELECT b.timezone, b.organization_id
    INTO v_branch_tz, v_org_id
  FROM branches b
  WHERE b.id = p_branch_id;

  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (v_now AT TIME ZONE v_branch_tz)::DATE;

  -- Guard A: barbero dedicado a turnos nunca recibe walk-ins
  SELECT walkin_mode INTO v_walkin_mode
  FROM appointment_staff
  WHERE staff_id = p_barber_id;

  IF v_walkin_mode = 'appointments_only' THEN
    RETURN NULL;
  END IF;

  -- Guard B: proteger turnos futuros del barbero
  -- buffer_minutes default 10 si la org no tiene settings
  SELECT s.buffer_minutes INTO v_buffer_minutes
  FROM appointment_settings s
  WHERE s.organization_id = v_org_id;

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

  -- Ruta 1: entry preferida
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

  -- Ruta 2: FIFO global excluyendo turnos
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

COMMENT ON FUNCTION assign_next_client IS
  'Asigna el siguiente cliente walk-in al barbero. Saltea barberos appointments_only y protege turnos futuros que empiezan dentro de (avg_service + buffer_minutes). Devuelve NULL si no hay candidato válido.';

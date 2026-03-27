-- ============================================================
-- Migración 041: Nueva lógica de ocupación para sucursales
-- Actualiza la lógica de niveles de ocupación: sin_espera / baja / media / alta
-- ============================================================

-- ============================================================
-- 1. Agregar valor 'sin_espera' al enum occupancy_level
--    Nota: ADD VALUE no se puede ejecutar dentro de una transacción,
--    pero Supabase aplica migraciones con autocommit para ALTER TYPE.
-- ============================================================
ALTER TYPE public.occupancy_level ADD VALUE IF NOT EXISTS 'sin_espera';

-- ============================================================
-- 2. Agregar columnas nuevas a branch_signals
--    - waiting_count: clientes en estado 'waiting'
--    - available_barbers: barberos activos sin cliente en atención
-- ============================================================
ALTER TABLE public.branch_signals
  ADD COLUMN IF NOT EXISTS waiting_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.branch_signals
  ADD COLUMN IF NOT EXISTS available_barbers INT NOT NULL DEFAULT 0;

-- ============================================================
-- 3. Reemplazar función refresh_branch_signals_for_branch
--    con la nueva lógica de ocupación:
--    - sin_espera: hay al menos 1 barbero disponible
--    - baja: todos los barberos ocupados, nadie esperando
--    - media: hay espera, pero menos de 2 clientes por barbero
--    - alta: 2 o más clientes esperando por barbero activo
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_branch_signals_for_branch(p_branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_waiting_count     INT;
  v_in_progress_count INT;
  v_active_barbers    INT;
  v_available_barbers INT;
  v_eta               INT;
  v_occupancy         occupancy_level;
  v_today             DATE;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;

  -- Clientes esperando (solo 'waiting')
  SELECT COUNT(*) INTO v_waiting_count
    FROM queue_entries qe
   WHERE qe.branch_id = p_branch_id
     AND qe.status = 'waiting'
     AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;

  -- Clientes en atención (solo 'in_progress')
  SELECT COUNT(*) INTO v_in_progress_count
    FROM queue_entries qe
   WHERE qe.branch_id = p_branch_id
     AND qe.status = 'in_progress'
     AND (qe.checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today;

  -- Barberos activos (fichados hoy sin clock_out posterior)
  SELECT COUNT(*) INTO v_active_barbers
    FROM staff s
   WHERE s.branch_id = p_branch_id
     AND s.role = 'barber'
     AND s.is_active = true
     AND s.hidden_from_checkin = false
     AND (
       SELECT al.action_type
         FROM attendance_logs al
        WHERE al.staff_id = s.id
          AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
        ORDER BY al.recorded_at DESC
        LIMIT 1
     ) IS DISTINCT FROM 'clock_out'::attendance_action;

  -- Barberos disponibles (activos y sin cliente en atención)
  SELECT COUNT(*) INTO v_available_barbers
    FROM staff s
   WHERE s.branch_id = p_branch_id
     AND s.role = 'barber'
     AND s.is_active = true
     AND s.hidden_from_checkin = false
     AND (
       SELECT al.action_type
         FROM attendance_logs al
        WHERE al.staff_id = s.id
          AND (al.recorded_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
        ORDER BY al.recorded_at DESC
        LIMIT 1
     ) IS DISTINCT FROM 'clock_out'::attendance_action
     AND s.id NOT IN (
       SELECT qe.barber_id
         FROM queue_entries qe
        WHERE qe.branch_id = p_branch_id
          AND qe.status = 'in_progress'
          AND qe.barber_id IS NOT NULL
     );

  -- ETA estimado: 25 minutos por cada cliente en espera
  v_eta := v_waiting_count * 25;

  -- Nueva lógica de ocupación
  IF v_available_barbers >= 1 THEN
    v_occupancy := 'sin_espera';
  ELSIF v_waiting_count = 0 THEN
    v_occupancy := 'baja';
  ELSIF v_active_barbers = 0 OR v_waiting_count < (2 * v_active_barbers) THEN
    v_occupancy := 'media';
  ELSE
    v_occupancy := 'alta';
  END IF;

  -- Upsert en branch_signals (branch_id tiene constraint UNIQUE)
  INSERT INTO branch_signals (
    branch_id, queue_size, active_barbers, waiting_count, available_barbers,
    eta_minutes, occupancy_level, updated_at
  )
  VALUES (
    p_branch_id,
    v_waiting_count + v_in_progress_count,
    v_active_barbers,
    v_waiting_count,
    v_available_barbers,
    v_eta,
    v_occupancy,
    NOW()
  )
  ON CONFLICT (branch_id) DO UPDATE
    SET queue_size         = EXCLUDED.queue_size,
        active_barbers     = EXCLUDED.active_barbers,
        waiting_count      = EXCLUDED.waiting_count,
        available_barbers  = EXCLUDED.available_barbers,
        eta_minutes        = EXCLUDED.eta_minutes,
        occupancy_level    = EXCLUDED.occupancy_level,
        updated_at         = EXCLUDED.updated_at;
END;
$$;

-- ============================================================
-- 4. Reemplazar función get_client_branch_signals
--    Se requiere DROP porque la firma de retorno cambia
--    (nuevos campos: is_open, waiting_count, in_progress_count,
--    available_barbers, total_barbers)
-- ============================================================
DROP FUNCTION IF EXISTS public.get_client_branch_signals();

CREATE OR REPLACE FUNCTION public.get_client_branch_signals()
RETURNS TABLE(
  branch_id             uuid,
  branch_name           text,
  branch_address        text,
  occupancy_level       occupancy_level,
  is_open               boolean,
  waiting_count         integer,
  in_progress_count     integer,
  available_barbers     integer,
  total_barbers         integer,
  eta_minutes           integer,
  best_arrival_in_minutes integer,
  suggestion_text       text,
  updated_at            timestamp with time zone
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    b.id                AS branch_id,
    b.name              AS branch_name,
    b.address           AS branch_address,
    COALESCE(bs.occupancy_level, 'baja'::occupancy_level),
    true                AS is_open,
    COALESCE(bs.waiting_count, 0)::integer,
    COALESCE(bs.queue_size - bs.waiting_count, 0)::integer AS in_progress_count,
    COALESCE(bs.available_barbers, 0)::integer,
    COALESCE(bs.active_barbers, 0)::integer AS total_barbers,
    bs.eta_minutes,
    bs.best_arrival_in_minutes,
    bs.suggestion_text,
    bs.updated_at
  FROM branches b
  LEFT JOIN branch_signals bs ON bs.branch_id = b.id
  WHERE b.is_active = true
  ORDER BY b.name;
$$;

-- ============================================================
-- 5. Refrescar señales de todas las sucursales activas
--    para recalcular con la nueva lógica inmediatamente
-- ============================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM branches WHERE is_active = true LOOP
    PERFORM refresh_branch_signals_for_branch(r.id);
  END LOOP;
END;
$$;

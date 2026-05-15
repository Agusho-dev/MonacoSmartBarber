-- 135_next_queue_position_branch_tz.sql
-- ---------------------------------------------------------------------------
-- FIX correctness: next_queue_position calculaba "hoy" con DATE(checked_in_at)
-- = CURRENT_DATE, ambos en UTC. En Argentina (UTC-3), después de las 21:00
-- local el CURRENT_DATE de UTC ya es "mañana", así que MAX(position) del día
-- devolvía 0 y la posición del kiosco se reseteaba a 1 todas las noches.
--
-- Todo el resto del sistema (claim_next_for_barber, compute_fair_barber,
-- is_barber_blocked_by_shift_end) usa (ts AT TIME ZONE branches.timezone)::DATE.
-- Alineamos esta función al mismo patrón multi-tenant TZ-aware y le agregamos
-- search_path explícito (best practice + advisor function_search_path_mutable).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.next_queue_position(p_branch_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch_tz TEXT;
  v_today DATE;
  max_pos INTEGER;
BEGIN
  SELECT COALESCE(timezone, 'America/Argentina/Buenos_Aires')
    INTO v_branch_tz
  FROM branches WHERE id = p_branch_id;
  v_branch_tz := COALESCE(v_branch_tz, 'America/Argentina/Buenos_Aires');
  v_today := (NOW() AT TIME ZONE v_branch_tz)::DATE;

  SELECT COALESCE(MAX(position), 0) INTO max_pos
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status IN ('waiting', 'in_progress')
    AND (checked_in_at AT TIME ZONE v_branch_tz)::DATE = v_today;

  RETURN max_pos + 1;
END;
$function$;

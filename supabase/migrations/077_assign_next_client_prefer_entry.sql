-- =============================================================================
-- Migración 077: Agrega parámetro p_preferred_entry_id a assign_next_client
-- Permite que el panel de barberos indique qué cliente específico quiere atender.
-- Si el preferido no está disponible (ya tomado por otro barbero), hace fallback
-- al FIFO global por priority_order (comportamiento anterior).
-- Retrocompatible: sin p_preferred_entry_id funciona idéntico a la versión anterior.
-- =============================================================================

-- Eliminar la sobrecarga anterior de 2 parámetros para evitar ambigüedad en PostgREST
DROP FUNCTION IF EXISTS assign_next_client(UUID, UUID);

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
  v_today DATE;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;

  -- Si hay preferencia, intentar tomar ese cliente específico
  IF p_preferred_entry_id IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM queue_entries
    WHERE id = p_preferred_entry_id
      AND branch_id = p_branch_id
      AND status = 'waiting'
      AND is_break = false
      AND (barber_id = p_barber_id OR barber_id IS NULL)
      AND (checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
    FOR UPDATE SKIP LOCKED;

    IF v_entry_id IS NOT NULL THEN
      UPDATE queue_entries
      SET barber_id = p_barber_id,
          is_dynamic = false
      WHERE id = v_entry_id;

      RETURN v_entry_id;
    END IF;
    -- Si no se pudo tomar el preferido, continuar con FIFO global
  END IF;

  -- Fallback: FIFO global (lógica original sin cambios)
  SELECT id INTO v_entry_id
  FROM queue_entries
  WHERE branch_id = p_branch_id
    AND status = 'waiting'
    AND is_break = false
    AND (barber_id = p_barber_id OR barber_id IS NULL)
    AND (checked_in_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE = v_today
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

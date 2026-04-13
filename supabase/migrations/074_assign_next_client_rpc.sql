-- =============================================================================
-- Migración 074: RPC atómica para asignar el próximo cliente a un barbero
-- Usa SELECT ... FOR UPDATE SKIP LOCKED para prevenir race conditions (F4)
-- Implementa FIFO global: el cliente con menor priority_order tiene prioridad
-- =============================================================================

CREATE OR REPLACE FUNCTION assign_next_client(
  p_barber_id UUID,
  p_branch_id UUID
)
RETURNS UUID  -- retorna el queue_entry_id asignado, o NULL si no hay nadie
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id UUID;
  v_today DATE;
BEGIN
  v_today := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE;

  -- Buscar el cliente con mayor prioridad (menor priority_order) que:
  --   a) Está asignado a ESTE barbero específicamente, O
  --   b) Es dinámico (barber_id IS NULL)
  -- Ordenado globalmente por priority_order (FIFO de sucursal)
  -- FOR UPDATE SKIP LOCKED: si otro barbero está tomando un cliente al mismo tiempo,
  -- se salta esa fila y toma la siguiente disponible
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

  -- Asignar barbero y marcar como no dinámico
  UPDATE queue_entries
  SET barber_id = p_barber_id,
      is_dynamic = false
  WHERE id = v_entry_id;

  RETURN v_entry_id;
END;
$$;

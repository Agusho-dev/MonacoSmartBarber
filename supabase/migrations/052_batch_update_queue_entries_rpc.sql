-- =============================================================================
-- Migración 052: RPC para actualizar múltiples queue_entries en una sola transacción.
-- Reemplaza N llamadas individuales por una sola llamada atómica.
-- =============================================================================

CREATE OR REPLACE FUNCTION batch_update_queue_entries(
  p_updates JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE queue_entries
    SET
      position   = (item->>'position')::int,
      barber_id  = CASE
                     WHEN item ? 'barber_id' THEN
                       NULLIF(item->>'barber_id', '')::uuid
                     ELSE barber_id
                   END,
      is_dynamic = CASE
                     WHEN item ? 'is_dynamic' THEN
                       (item->>'is_dynamic')::boolean
                     ELSE is_dynamic
                   END
    WHERE id = (item->>'id')::uuid
      AND status = 'waiting';
  END LOOP;
END;
$$;

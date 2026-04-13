-- =============================================================================
-- Migración 073: FIFO Global — columna priority_order + índices + RPC update
-- Unifica el criterio de orden en un solo campo para resolver conflictos
-- entre dashboard (position), panel barbero (checked_in_at) y breaks (position)
-- =============================================================================

-- 1. Agregar columna priority_order (timestamptz, misma semántica que checked_in_at)
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS priority_order TIMESTAMPTZ;

-- 2. Backfill: copiar checked_in_at como priority_order para entradas existentes
UPDATE queue_entries
SET priority_order = checked_in_at
WHERE priority_order IS NULL;

-- 3. Hacer NOT NULL tras backfill
ALTER TABLE queue_entries
  ALTER COLUMN priority_order SET NOT NULL;

-- 4. Valor por defecto para nuevas entradas
ALTER TABLE queue_entries
  ALTER COLUMN priority_order SET DEFAULT now();

-- 5. Índice principal para FIFO global (ordenamiento por sucursal)
CREATE INDEX IF NOT EXISTS idx_queue_priority_order
  ON queue_entries (branch_id, status, priority_order)
  WHERE status IN ('waiting', 'in_progress');

-- 6. Índice para SELECT ... FOR UPDATE de asignación atómica
CREATE INDEX IF NOT EXISTS idx_queue_waiting_for_assignment
  ON queue_entries (branch_id, status, is_break, priority_order)
  WHERE status = 'waiting' AND is_break = false;

-- 7. Actualizar batch_update_queue_entries para soportar priority_order en drag-and-drop
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
  v_caller_org UUID;
  v_entry_id UUID;
BEGIN
  v_caller_org := get_user_org_id();

  -- Validar que el caller es staff de una org
  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado: no se pudo determinar la organización del usuario';
  END IF;

  -- Validar que TODOS los queue_entry IDs pertenecen a branches de la org del caller
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_entry_id := (item->>'id')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM queue_entries qe
      JOIN branches b ON b.id = qe.branch_id
      WHERE qe.id = v_entry_id
        AND b.organization_id = v_caller_org
    ) THEN
      RAISE EXCEPTION 'Acceso denegado: queue_entry % no pertenece a tu organización', v_entry_id;
    END IF;
  END LOOP;

  -- Ejecutar las actualizaciones (ya validadas)
  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE queue_entries
    SET
      position   = (item->>'position')::int,
      priority_order = CASE
                         WHEN item ? 'priority_order' THEN
                           (item->>'priority_order')::timestamptz
                         ELSE priority_order
                       END,
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

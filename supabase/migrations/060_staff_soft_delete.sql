-- Soft-delete para staff: permite eliminar barberos sin perder historial
ALTER TABLE staff ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Índice parcial para filtrar staff no eliminados eficientemente
CREATE INDEX IF NOT EXISTS idx_staff_not_deleted ON staff (organization_id, is_active) WHERE deleted_at IS NULL;

COMMENT ON COLUMN staff.deleted_at IS 'Fecha de eliminación lógica. Si es NULL, el staff está activo en el sistema.';

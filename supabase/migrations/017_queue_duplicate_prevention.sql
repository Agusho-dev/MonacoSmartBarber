-- ============================================
-- Control de clientes duplicados en la fila
-- ============================================

-- Índice parcial único: un cliente solo puede tener un turno activo por sucursal
CREATE UNIQUE INDEX idx_queue_unique_active_client
  ON queue_entries (client_id, branch_id)
  WHERE status IN ('waiting', 'in_progress');

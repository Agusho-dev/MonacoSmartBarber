-- 143: Índices para foreign keys sin cubrir en tablas de CRM/mensajería.
--
-- Hallazgo (advisors de performance, 02/jun/2026): varias FKs no tienen índice,
-- lo que vuelve lentos los JOINs y los DELETE/UPDATE con cascada. Todos aditivos
-- e idempotentes (IF NOT EXISTS). CONCURRENTLY no se usa porque corre dentro de
-- la transacción de migración; las tablas son chicas.

CREATE INDEX IF NOT EXISTS idx_crm_alerts_conversation_id
  ON public.crm_alerts (conversation_id);
CREATE INDEX IF NOT EXISTS idx_crm_alerts_read_by
  ON public.crm_alerts (read_by);
CREATE INDEX IF NOT EXISTS idx_crm_alerts_workflow_execution_id
  ON public.crm_alerts (workflow_execution_id);

CREATE INDEX IF NOT EXISTS idx_crm_cases_branch_id
  ON public.crm_cases (branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_cases_client_id
  ON public.crm_cases (client_id);
CREATE INDEX IF NOT EXISTS idx_crm_cases_review_id
  ON public.crm_cases (review_id);

CREATE INDEX IF NOT EXISTS idx_workflow_edges_target_node_id
  ON public.workflow_edges (target_node_id);

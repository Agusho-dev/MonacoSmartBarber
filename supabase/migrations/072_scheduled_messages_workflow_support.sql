-- Migración 072: Soporte de workflows en scheduled_messages
-- Permite que un mensaje programado esté vinculado a un automation_workflow
-- para que el cron pueda crear workflow_executions al enviarlo.

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES automation_workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_trigger_data JSONB;

CREATE INDEX IF NOT EXISTS idx_sched_msg_workflow
  ON scheduled_messages(workflow_id) WHERE workflow_id IS NOT NULL;

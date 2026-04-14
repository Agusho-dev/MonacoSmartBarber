-- Migración 081: Política de solapamiento y ventana Meta en workflows
-- Añade category + overlap_policy + fallback_template para manejar
-- coexistencia de workflows y respetar la ventana de 24h de Meta.

-- ═══════════════════════════════════════════════════════════════════
-- 1. Columnas nuevas en automation_workflows
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE automation_workflows
  ADD COLUMN IF NOT EXISTS category                  text,
  ADD COLUMN IF NOT EXISTS overlap_policy            text NOT NULL DEFAULT 'skip_if_active',
  ADD COLUMN IF NOT EXISTS interrupts_categories     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS wait_reply_timeout_minutes int NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS fallback_template_name    text,
  ADD COLUMN IF NOT EXISTS requires_meta_window      boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN automation_workflows.category IS
  'Categoría lógica: review, reengagement, support, promo. Usado por overlap_policy.';
COMMENT ON COLUMN automation_workflows.overlap_policy IS
  'Cómo convivir con otras ejecuciones: skip_if_active (default), queue, replace, parallel.';
COMMENT ON COLUMN automation_workflows.interrupts_categories IS
  'Sólo con overlap_policy=replace: categorías cuyas ejecuciones puede cancelar para arrancar.';
COMMENT ON COLUMN automation_workflows.wait_reply_timeout_minutes IS
  'Minutos máximos en waiting_reply antes de expirar. Default 1440 (24h = ventana Meta).';
COMMENT ON COLUMN automation_workflows.fallback_template_name IS
  'Si al ejecutar el workflow la conv está fuera de la ventana Meta, se envía este template HSM.';
COMMENT ON COLUMN automation_workflows.requires_meta_window IS
  'Si true, validar can_reply_until antes de enviar mensajes no-template.';

-- Constraint de valores válidos para overlap_policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'automation_workflows_overlap_policy_check'
  ) THEN
    ALTER TABLE automation_workflows
      ADD CONSTRAINT automation_workflows_overlap_policy_check
      CHECK (overlap_policy IN ('skip_if_active','queue','replace','parallel'));
  END IF;
END$$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Columnas en workflow_executions para tracking de expiración
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE workflow_executions
  ADD COLUMN IF NOT EXISTS waiting_since timestamptz;

COMMENT ON COLUMN workflow_executions.waiting_since IS
  'Timestamp de cuando la ejecución entró en waiting_reply. Se usa para el timeout.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. Función para expirar ejecuciones colgadas
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION expire_stale_workflow_executions()
RETURNS TABLE(expired_count int)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  WITH upd AS (
    UPDATE workflow_executions e
       SET status       = 'expired',
           completed_at = now(),
           updated_at   = now()
      FROM automation_workflows w
     WHERE w.id = e.workflow_id
       AND e.status = 'waiting_reply'
       AND e.waiting_since IS NOT NULL
       AND e.waiting_since < now() - (w.wait_reply_timeout_minutes || ' minutes')::interval
    RETURNING e.id
  )
  SELECT count(*)::int INTO v_count FROM upd;

  RETURN QUERY SELECT v_count;
END;
$$;

COMMENT ON FUNCTION expire_stale_workflow_executions IS
  'Marca como expired las ejecuciones waiting_reply que superaron el timeout del workflow. Llamar desde cron.';

-- ═══════════════════════════════════════════════════════════════════
-- 4. Defaults razonables para workflows existentes
-- ═══════════════════════════════════════════════════════════════════
-- Workflows de review (post_service / days_after_visit) → category='review'
UPDATE automation_workflows
   SET category = 'review'
 WHERE category IS NULL
   AND trigger_type IN ('post_service','days_after_visit');

-- Resto sin categorizar se mantiene como NULL (skip_if_active igualmente aplica)

-- Migración 082: Trigger type conversation_reopened
-- Permite disparar workflows cuando el cliente vuelve a escribir después de X horas,
-- o cuando la conversación estaba inactive/closed.

-- trigger_config sugerido:
-- {
--   "reopen_mode": "inactivity" | "status_closed" | "either",
--   "min_hours_since_client_msg": 12,
--   "min_hours_since_shop_msg": null,      -- opcional
--   "exclude_first_ever_contact": true
-- }

-- ═══════════════════════════════════════════════════════════════════
-- 1. Función de matching
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION match_conversation_reopened_workflows(
  p_org_id          UUID,
  p_conversation_id UUID,
  p_platform        TEXT
)
RETURNS SETOF automation_workflows
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_conv          conversations%ROWTYPE;
  v_msg_count     int;
BEGIN
  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Cantidad de mensajes previos (para exclude_first_ever_contact)
  SELECT count(*)::int INTO v_msg_count FROM messages WHERE conversation_id = p_conversation_id;

  RETURN QUERY
  SELECT w.*
    FROM automation_workflows w
   WHERE w.organization_id = p_org_id
     AND w.is_active = true
     AND w.trigger_type = 'conversation_reopened'
     AND (w.channels @> ARRAY['all']::text[] OR w.channels @> ARRAY[p_platform]::text[])
     AND (
       -- Modo: status closed/inactive
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('status_closed','either')
         AND v_conv.status IN ('inactive','closed')
       )
       OR
       -- Modo: inactividad del cliente
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('inactivity','either')
         AND (w.trigger_config->>'min_hours_since_client_msg') IS NOT NULL
         AND (
           v_conv.last_inbound_at IS NULL
           OR v_conv.last_inbound_at < now() - ((w.trigger_config->>'min_hours_since_client_msg')::int || ' hours')::interval
         )
       )
       OR
       -- Modo: inactividad de la barbería
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('inactivity','either')
         AND (w.trigger_config->>'min_hours_since_shop_msg') IS NOT NULL
         AND (
           v_conv.last_outbound_at IS NULL
           OR v_conv.last_outbound_at < now() - ((w.trigger_config->>'min_hours_since_shop_msg')::int || ' hours')::interval
         )
       )
     )
     -- Excluir primer contacto si está configurado (más de 1 mensaje previo)
     AND (
       COALESCE((w.trigger_config->>'exclude_first_ever_contact')::boolean, true) = false
       OR v_msg_count > 1
     )
   ORDER BY w.priority DESC
   LIMIT 1;
END;
$$;

COMMENT ON FUNCTION match_conversation_reopened_workflows IS
  'Devuelve el workflow de mayor prioridad que matchea una conversación reabierta por inbound.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. Helper para chequear si hay ejecución activa que bloquea
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION has_blocking_workflow_execution(
  p_conversation_id UUID,
  p_incoming_workflow_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_policy       text;
  v_interrupts   text[];
  v_exists_block boolean;
BEGIN
  SELECT overlap_policy, interrupts_categories
    INTO v_policy, v_interrupts
    FROM automation_workflows
   WHERE id = p_incoming_workflow_id;

  IF v_policy = 'parallel' THEN
    RETURN false;
  END IF;

  -- skip_if_active y queue: cualquier ejecución activa bloquea
  IF v_policy IN ('skip_if_active','queue') THEN
    SELECT EXISTS (
      SELECT 1 FROM workflow_executions
       WHERE conversation_id = p_conversation_id
         AND status IN ('active','waiting_reply')
    ) INTO v_exists_block;
    RETURN v_exists_block;
  END IF;

  -- replace: sólo bloquea si la activa NO es de una categoría interrumpible
  IF v_policy = 'replace' THEN
    SELECT EXISTS (
      SELECT 1
        FROM workflow_executions e
        JOIN automation_workflows w ON w.id = e.workflow_id
       WHERE e.conversation_id = p_conversation_id
         AND e.status IN ('active','waiting_reply')
         AND (w.category IS NULL OR NOT (w.category = ANY(v_interrupts)))
    ) INTO v_exists_block;
    RETURN v_exists_block;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION has_blocking_workflow_execution IS
  'True si el workflow entrante no puede disparar por overlap_policy con ejecuciones activas.';

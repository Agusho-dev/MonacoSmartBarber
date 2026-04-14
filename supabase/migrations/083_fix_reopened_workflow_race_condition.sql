-- Migración 083: Fix race condition + defaults en match_conversation_reopened_workflows
--
-- Problema 1 (race condition): el trigger trg_conversation_on_message_insert actualiza
-- conversations.last_inbound_at = now() ANTES de que el workflow engine llame a esta RPC.
-- La condición last_inbound_at < now() - X hours nunca se cumple.
-- Solución: usar el penúltimo mensaje inbound en vez de last_inbound_at.
--
-- Problema 2 (config incompleta): al cambiar trigger_type a conversation_reopened en el UI,
-- no se inyectaban los defaults (reopen_mode, min_hours_since_client_msg).
-- Solución: COALESCE con default 12 horas, y fix en el componente TriggerConfig.

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
  v_conv              conversations%ROWTYPE;
  v_msg_count         int;
  v_prev_inbound_at   timestamptz;
BEGIN
  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*)::int INTO v_msg_count FROM messages WHERE conversation_id = p_conversation_id;

  -- Penúltimo mensaje inbound (el último es el que acaba de llegar)
  SELECT created_at INTO v_prev_inbound_at
    FROM messages
   WHERE conversation_id = p_conversation_id
     AND direction = 'inbound'
   ORDER BY created_at DESC
   OFFSET 1
   LIMIT 1;

  RETURN QUERY
  SELECT w.*
    FROM automation_workflows w
   WHERE w.organization_id = p_org_id
     AND w.is_active = true
     AND w.trigger_type = 'conversation_reopened'
     AND (w.channels @> ARRAY['all']::text[] OR w.channels @> ARRAY[p_platform]::text[])
     AND (
       -- Modo: status closed/inactive (usa reopened_at porque el trigger de DB ya cambió status a open)
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('status_closed','either')
         AND v_conv.reopened_at IS NOT NULL
         AND v_conv.reopened_at >= now() - interval '5 seconds'
       )
       OR
       -- Modo: inactividad del cliente — default 12 horas si falta min_hours_since_client_msg
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('inactivity','either')
         AND (
           v_prev_inbound_at IS NULL
           OR v_prev_inbound_at < now() - (COALESCE((w.trigger_config->>'min_hours_since_client_msg')::int, 12) || ' hours')::interval
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
     -- Excluir primer contacto si está configurado
     AND (
       COALESCE((w.trigger_config->>'exclude_first_ever_contact')::boolean, true) = false
       OR v_msg_count > 1
     )
   ORDER BY w.priority DESC
   LIMIT 1;
END;
$$;

COMMENT ON FUNCTION match_conversation_reopened_workflows IS
  'Devuelve el workflow de mayor prioridad que matchea conversación reabierta. Usa penúltimo inbound para evitar race condition con trigger de lifecycle. Default 12h si falta config.';

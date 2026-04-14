-- Migración 083: Fix race condition en match_conversation_reopened_workflows
--
-- Problema: el trigger trg_conversation_on_message_insert actualiza
-- conversations.last_inbound_at = now() ANTES de que el workflow engine
-- llame a esta RPC. Entonces la condición
--   last_inbound_at < now() - X hours
-- nunca se cumple porque last_inbound_at ya fue actualizado al momento actual.
--
-- Solución: en vez de leer last_inbound_at de la tabla conversations (que ya
-- fue actualizado por el trigger), buscamos el penúltimo mensaje inbound
-- para determinar la inactividad real del cliente.

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

  -- Cantidad de mensajes previos (para exclude_first_ever_contact)
  SELECT count(*)::int INTO v_msg_count FROM messages WHERE conversation_id = p_conversation_id;

  -- Obtener el timestamp del penúltimo mensaje inbound.
  -- El último inbound es el que acaba de llegar (y ya actualizó last_inbound_at via trigger),
  -- así que necesitamos el anterior para calcular la inactividad real.
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
       -- Modo: status closed/inactive
       -- Nota: el trigger de DB ya cambió el status a 'open', así que chequeamos
       -- reopened_at (que se setea cuando el status ERA inactive/closed)
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('status_closed','either')
         AND v_conv.reopened_at IS NOT NULL
         AND v_conv.reopened_at >= now() - interval '5 seconds'
       )
       OR
       -- Modo: inactividad del cliente (usa penúltimo inbound, NO last_inbound_at)
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('inactivity','either')
         AND (w.trigger_config->>'min_hours_since_client_msg') IS NOT NULL
         AND (
           v_prev_inbound_at IS NULL
           OR v_prev_inbound_at < now() - ((w.trigger_config->>'min_hours_since_client_msg')::int || ' hours')::interval
         )
       )
       OR
       -- Modo: inactividad de la barbería (last_outbound_at no se ve afectado por mensajes inbound)
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
  'Devuelve el workflow de mayor prioridad que matchea una conversación reabierta por inbound. Usa el penúltimo mensaje inbound para evitar race condition con el trigger de lifecycle.';

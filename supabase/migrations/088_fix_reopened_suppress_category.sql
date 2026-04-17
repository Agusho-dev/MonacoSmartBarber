-- 088_fix_reopened_suppress_category.sql
-- Parcha match_conversation_reopened_workflows para respetar
-- trigger_config.suppress_if_category_within_hours. Antes se aplicaba
-- solo en el branch message_received del engine, así que un cliente
-- podía recibir reseña y, al responder tras >12h, recibía Bienvenida.

CREATE OR REPLACE FUNCTION public.match_conversation_reopened_workflows(
  p_org_id uuid,
  p_conversation_id uuid,
  p_platform text
)
RETURNS SETOF automation_workflows
LANGUAGE plpgsql
STABLE
AS $function$
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
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('status_closed','either')
         AND v_conv.reopened_at IS NOT NULL
         AND v_conv.reopened_at >= now() - interval '5 seconds'
       )
       OR
       (
         COALESCE(w.trigger_config->>'reopen_mode','inactivity') IN ('inactivity','either')
         AND (
           v_prev_inbound_at IS NULL
           OR v_prev_inbound_at < now() - (COALESCE((w.trigger_config->>'min_hours_since_client_msg')::int, 12) || ' hours')::interval
         )
       )
       OR
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
     -- Supresión por categoría reciente: si en esta conversación corrió un workflow
     -- con una categoría listada en suppress_if_category_within_hours dentro de la
     -- ventana de horas indicada, NO se dispara este workflow.
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_each_text(
           COALESCE(w.trigger_config->'suppress_if_category_within_hours', '{}'::jsonb)
         ) s(category, hours)
        WHERE EXISTS (
          SELECT 1
            FROM workflow_executions e
            JOIN automation_workflows w2 ON w2.id = e.workflow_id
           WHERE e.conversation_id = p_conversation_id
             AND e.status <> 'cancelled'
             AND w2.category = s.category
             AND e.started_at >= now() - (s.hours::int || ' hours')::interval
        )
     )
   ORDER BY w.priority DESC
   LIMIT 1;
END;
$function$;

COMMENT ON FUNCTION public.match_conversation_reopened_workflows(uuid, uuid, text) IS
  'Devuelve el workflow conversation_reopened que aplica. Respeta trigger_config.suppress_if_category_within_hours para no pisar conversaciones donde ya corrió otra categoría reciente (p.ej. review).';

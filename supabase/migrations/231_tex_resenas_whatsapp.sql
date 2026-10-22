-- =============================================================================
-- 231 — Las reseñas REALES para Tex (22/oct/2026)
--
-- Las calificaciones de los clientes NO están en client_reviews ni en
-- review_requests (legado vacío): viven en el flujo de WhatsApp post-servicio.
-- Cadena (verificada en prod el 22/oct: 798 de 801 calificaciones de octubre
-- llegan hasta el barbero):
--   workflow_executions (triggered_by = 'post_service')
--     → context->>'last_button_id' = la nota ('1'..'5', el botón que tocó)
--     → la org sale de automation_workflows (la ejecución no tiene org)
--   scheduled_messages del mismo cliente y workflow, enviado a ±30 s del
--   inicio de la ejecución (el cron crea los dos juntos)
--     → workflow_trigger_data->>'visit_id' → visits (sucursal y barbero) → staff
--   Lo que la persona escribió: mensajes inbound de texto de esa conversación
--   en las 48 h siguientes (el botón llega como 'interactive').
--   Etiquetas del CRM ("No Satisfecho", "Reclamo / mala experiencia"…)
--   asignadas a la conversación entre 1 h antes y 7 días después.
--
-- Del cliente sólo sale el nombre de pila y los últimos 4 del teléfono: es lo
-- que Tex le manda al modelo. Sólo service_role (el servidor ya verificó
-- permiso, org y alcance; p_sucursales es el alcance del rol).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tex_resenas_whatsapp(
  p_org uuid,
  p_desde timestamptz,
  p_hasta timestamptz,
  p_sucursales uuid[] DEFAULT NULL,
  p_barberos uuid[] DEFAULT NULL
)
RETURNS TABLE (
  ejecucion_id uuid,
  enviada_at timestamptz,
  nota integer,
  visit_id uuid,
  sucursal_id uuid,
  barbero_id uuid,
  barbero text,
  cliente_nombre text,
  cliente_tel_ult4 text,
  comentario text,
  etiquetas text[],
  conversacion_id uuid
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ej AS (
    SELECT we.id, we.conversation_id, we.workflow_id, we.started_at,
           (we.context->>'last_button_id')::int AS nota, c.client_id
    FROM workflow_executions we
    JOIN automation_workflows aw ON aw.id = we.workflow_id AND aw.organization_id = p_org
    JOIN conversations c ON c.id = we.conversation_id
    WHERE we.triggered_by = 'post_service'
      AND we.context->>'last_button_id' IN ('1', '2', '3', '4', '5')
      AND we.started_at >= p_desde
      AND we.started_at < p_hasta
  )
  SELECT ej.id,
         ej.started_at,
         ej.nota,
         v.id,
         v.branch_id,
         v.barber_id,
         s.full_name,
         NULLIF(split_part(btrim(cl.name), ' ', 1), ''),
         NULLIF(right(regexp_replace(coalesce(cl.phone, ''), '\D', '', 'g'), 4), ''),
         com.texto,
         coalesce(et.nombres, '{}'::text[]),
         ej.conversation_id
  FROM ej
  LEFT JOIN LATERAL (
    SELECT sm.workflow_trigger_data->>'visit_id' AS visit_id
    FROM scheduled_messages sm
    WHERE sm.client_id = ej.client_id
      AND sm.workflow_id = ej.workflow_id
      AND sm.sent_at BETWEEN ej.started_at - interval '30 seconds' AND ej.started_at + interval '30 seconds'
    ORDER BY abs(extract(epoch FROM (sm.sent_at - ej.started_at)))
    LIMIT 1
  ) sm ON true
  LEFT JOIN visits v
    ON v.id = (CASE WHEN sm.visit_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN sm.visit_id::uuid END)
  LEFT JOIN staff s ON s.id = v.barber_id
  LEFT JOIN clients cl ON cl.id = ej.client_id
  LEFT JOIN LATERAL (
    SELECT left(string_agg(btrim(m.content), ' / ' ORDER BY m.created_at), 600) AS texto
    FROM messages m
    WHERE m.conversation_id = ej.conversation_id
      AND m.direction = 'inbound'
      AND m.content_type = 'text'
      AND m.created_at > ej.started_at
      AND m.created_at < ej.started_at + interval '48 hours'
      AND coalesce(btrim(m.content), '') <> ''
  ) com ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT ct.name ORDER BY ct.name) AS nombres
    FROM conversation_tag_assignments cta
    JOIN conversation_tags ct ON ct.id = cta.tag_id
    WHERE cta.conversation_id = ej.conversation_id
      AND cta.created_at >= ej.started_at - interval '1 hour'
      AND cta.created_at < ej.started_at + interval '7 days'
  ) et ON true
  WHERE (p_sucursales IS NULL OR v.branch_id = ANY (p_sucursales))
    AND (p_barberos IS NULL OR v.barber_id = ANY (p_barberos))
  ORDER BY ej.started_at;
$$;

COMMENT ON FUNCTION public.tex_resenas_whatsapp(uuid, timestamptz, timestamptz, uuid[], uuid[]) IS
  'Calificaciones del WhatsApp post-servicio (1-5) con su visita, barbero, comentario posterior y etiquetas del CRM. Para Tex. Sólo service_role.';

REVOKE EXECUTE ON FUNCTION public.tex_resenas_whatsapp(uuid, timestamptz, timestamptz, uuid[], uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tex_resenas_whatsapp(uuid, timestamptz, timestamptz, uuid[], uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tex_resenas_whatsapp(uuid, timestamptz, timestamptz, uuid[], uuid[]) TO service_role;

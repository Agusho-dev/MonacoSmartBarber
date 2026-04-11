-- Migración 071: Sistema de workflows de automatización
-- Reemplaza auto_reply_rules con un sistema visual de nodos/edges tipo n8n
-- Soporta: keyword triggers, continuidad de templates (botones), condiciones, etiquetas, alertas CRM

-- ═══════════════════════════════════════════════════════════════════
-- 1. Tabla principal: definición del workflow
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS automation_workflows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  -- Canales donde aplica: '{whatsapp}', '{instagram}', '{whatsapp,instagram}', '{all}'
  channels         TEXT[] NOT NULL DEFAULT '{all}',
  -- Tipo de trigger: keyword, button_response, template_reply, post_service, days_after_visit
  trigger_type     TEXT NOT NULL DEFAULT 'keyword',
  -- Configuración del trigger (JSON flexible)
  -- keyword: { keywords: ["hola","info"], match_mode: "contains"|"exact" }
  -- template_reply: { template_name: "review_template" }
  -- button_response: { parent_workflow_id: "uuid" }
  -- post_service: { delay_minutes: 15 }
  -- days_after_visit: { delay_days: 7 }
  trigger_config   JSONB NOT NULL DEFAULT '{}',
  priority         INTEGER NOT NULL DEFAULT 0,
  created_by       UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE automation_workflows IS 'Workflows de automatización configurables visualmente (estilo n8n)';
COMMENT ON COLUMN automation_workflows.channels IS 'Canales donde se activa: whatsapp, instagram, facebook, o all';
COMMENT ON COLUMN automation_workflows.trigger_type IS 'keyword: palabra clave. template_reply: respuesta a template (botones). post_service: post-servicio. days_after_visit: seguimiento.';

-- ═══════════════════════════════════════════════════════════════════
-- 2. Nodos del workflow (cada paso/acción)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  -- Tipo de nodo
  -- trigger: nodo de entrada (visual, no ejecutable)
  -- send_message: enviar texto
  -- send_media: enviar imagen/video/documento
  -- send_buttons: enviar mensaje interactivo con botones (WPP)
  -- send_list: enviar mensaje con lista de opciones (WPP)
  -- send_template: enviar template de Meta
  -- add_tag: agregar etiqueta a la conversación
  -- remove_tag: quitar etiqueta
  -- condition: bifurcación condicional (button_reply, text_match, tag_check)
  -- wait_reply: esperar respuesta del usuario
  -- crm_alert: crear alerta en el CRM
  -- delay: esperar X segundos/minutos
  -- http_request: llamar a un endpoint externo (futuro)
  node_type        TEXT NOT NULL,
  -- Label visible en el canvas
  label            TEXT NOT NULL DEFAULT '',
  -- Configuración específica del nodo (depende del type)
  config           JSONB NOT NULL DEFAULT '{}',
  -- Posición visual en el canvas (para el builder estilo n8n)
  position_x       INTEGER NOT NULL DEFAULT 0,
  position_y       INTEGER NOT NULL DEFAULT 0,
  -- Dimensiones del nodo (para render)
  width            INTEGER DEFAULT 200,
  height           INTEGER DEFAULT 80,
  -- Es el punto de entrada del workflow
  is_entry_point   BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE workflow_nodes IS 'Nodos individuales del workflow. Cada nodo es un paso/acción.';
COMMENT ON COLUMN workflow_nodes.config IS 'JSON config por tipo. send_message: {text}. send_buttons: {body, buttons:[{id,title}]}. condition: {type, conditions:[{value,next}]}. add_tag: {tag_id}. crm_alert: {message, alert_type}.';

-- ═══════════════════════════════════════════════════════════════════
-- 3. Conexiones entre nodos (edges del grafo)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflow_edges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  source_node_id   UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  target_node_id   UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  -- Handle de salida del source (para nodos con múltiples salidas como condition)
  source_handle    TEXT DEFAULT 'default',
  -- Etiqueta visual de la conexión
  label            TEXT,
  -- Para condition nodes: valor que activa esta ruta
  condition_value  TEXT,
  sort_order       INTEGER DEFAULT 0,
  UNIQUE(workflow_id, source_node_id, source_handle, target_node_id)
);

COMMENT ON TABLE workflow_edges IS 'Conexiones entre nodos. Define el flujo de ejecución del workflow.';

-- ═══════════════════════════════════════════════════════════════════
-- 4. Ejecuciones activas de workflows (estado por conversación)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflow_executions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- Nodo actual donde está la ejecución
  current_node_id  UUID REFERENCES workflow_nodes(id) ON DELETE SET NULL,
  -- Estado de la ejecución
  -- active: ejecutando nodos
  -- waiting_reply: esperando respuesta del usuario (botón, texto, etc.)
  -- completed: terminó correctamente
  -- cancelled: cancelado manualmente
  -- error: falló
  status           TEXT NOT NULL DEFAULT 'active',
  -- Contexto de ejecución (datos acumulados: últimas respuestas, variables, etc.)
  context          JSONB DEFAULT '{}',
  -- Metadata: quién lo triggeró, desde qué mensaje, etc.
  triggered_by     TEXT,  -- 'keyword', 'template_reply', 'manual', etc.
  triggered_message_id UUID,
  started_at       TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE workflow_executions IS 'Estado de ejecución de workflows por conversación. Solo 1 activo por conversación.';

-- ═══════════════════════════════════════════════════════════════════
-- 5. Log de ejecución (historial de qué nodo se ejecutó)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workflow_execution_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id     UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  node_id          UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  node_type        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'success',  -- 'success' | 'error' | 'skipped'
  input_data       JSONB DEFAULT '{}',
  output_data      JSONB DEFAULT '{}',
  error_message    TEXT,
  executed_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE workflow_execution_log IS 'Log detallado de cada nodo ejecutado en un workflow.';

-- ═══════════════════════════════════════════════════════════════════
-- 6. Alertas CRM generadas por workflows
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS crm_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  workflow_execution_id UUID REFERENCES workflow_executions(id) ON DELETE SET NULL,
  -- Tipo de alerta
  alert_type       TEXT NOT NULL DEFAULT 'info',  -- 'info' | 'warning' | 'urgent'
  title            TEXT NOT NULL,
  message          TEXT,
  -- Metadata adicional (workflow name, client info, etc.)
  metadata         JSONB DEFAULT '{}',
  is_read          BOOLEAN DEFAULT false,
  read_by          UUID REFERENCES staff(id) ON DELETE SET NULL,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE crm_alerts IS 'Alertas del CRM generadas automáticamente por workflows o manualmente.';

-- ═══════════════════════════════════════════════════════════════════
-- 7. Índices para performance
-- ═══════════════════════════════════════════════════════════════════

-- Workflows activos por org
CREATE INDEX IF NOT EXISTS idx_workflows_org_active
  ON automation_workflows(organization_id) WHERE is_active = true;

-- Workflows por trigger type (para matching eficiente)
CREATE INDEX IF NOT EXISTS idx_workflows_trigger
  ON automation_workflows(organization_id, trigger_type) WHERE is_active = true;

-- Nodos por workflow
CREATE INDEX IF NOT EXISTS idx_wf_nodes_workflow
  ON workflow_nodes(workflow_id);

-- Nodo de entrada por workflow
CREATE INDEX IF NOT EXISTS idx_wf_nodes_entry
  ON workflow_nodes(workflow_id) WHERE is_entry_point = true;

-- Edges por workflow y source
CREATE INDEX IF NOT EXISTS idx_wf_edges_workflow
  ON workflow_edges(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wf_edges_source
  ON workflow_edges(source_node_id);

-- Ejecuciones activas por conversación (crítico para matching de replies)
CREATE INDEX IF NOT EXISTS idx_wf_exec_active
  ON workflow_executions(conversation_id, status) WHERE status IN ('active', 'waiting_reply');

-- Ejecuciones por workflow
CREATE INDEX IF NOT EXISTS idx_wf_exec_workflow
  ON workflow_executions(workflow_id);

-- Log por ejecución
CREATE INDEX IF NOT EXISTS idx_wf_exec_log
  ON workflow_execution_log(execution_id);

-- Alertas no leídas por org
CREATE INDEX IF NOT EXISTS idx_crm_alerts_unread
  ON crm_alerts(organization_id, is_read) WHERE is_read = false;

-- ═══════════════════════════════════════════════════════════════════
-- 8. RLS Policies
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE automation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_execution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_alerts ENABLE ROW LEVEL SECURITY;

-- Policies para automation_workflows
CREATE POLICY "workflows_org_select" ON automation_workflows
  FOR SELECT USING (organization_id = (SELECT get_user_org_id()));
CREATE POLICY "workflows_org_insert" ON automation_workflows
  FOR INSERT WITH CHECK (organization_id = (SELECT get_user_org_id()));
CREATE POLICY "workflows_org_update" ON automation_workflows
  FOR UPDATE USING (organization_id = (SELECT get_user_org_id()));
CREATE POLICY "workflows_org_delete" ON automation_workflows
  FOR DELETE USING (organization_id = (SELECT get_user_org_id()));

-- Policies para workflow_nodes (via workflow.organization_id)
CREATE POLICY "wf_nodes_org_select" ON workflow_nodes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );
CREATE POLICY "wf_nodes_org_insert" ON workflow_nodes
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );
CREATE POLICY "wf_nodes_org_update" ON workflow_nodes
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );
CREATE POLICY "wf_nodes_org_delete" ON workflow_nodes
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );

-- Policies para workflow_edges (via workflow.organization_id)
CREATE POLICY "wf_edges_org_select" ON workflow_edges
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );
CREATE POLICY "wf_edges_org_insert" ON workflow_edges
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );
CREATE POLICY "wf_edges_org_update" ON workflow_edges
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );
CREATE POLICY "wf_edges_org_delete" ON workflow_edges
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );

-- Policies para workflow_executions (via workflow.organization_id)
CREATE POLICY "wf_exec_org_select" ON workflow_executions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );
CREATE POLICY "wf_exec_org_insert" ON workflow_executions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );
CREATE POLICY "wf_exec_org_update" ON workflow_executions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM automation_workflows w WHERE w.id = workflow_id AND w.organization_id = (SELECT get_user_org_id()))
  );

-- Policies para workflow_execution_log (via execution.workflow.organization_id)
CREATE POLICY "wf_log_org_select" ON workflow_execution_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workflow_executions e
      JOIN automation_workflows w ON w.id = e.workflow_id
      WHERE e.id = execution_id AND w.organization_id = (SELECT get_user_org_id())
    )
  );

-- Policies para crm_alerts
CREATE POLICY "crm_alerts_org_select" ON crm_alerts
  FOR SELECT USING (organization_id = (SELECT get_user_org_id()));
CREATE POLICY "crm_alerts_org_insert" ON crm_alerts
  FOR INSERT WITH CHECK (organization_id = (SELECT get_user_org_id()));
CREATE POLICY "crm_alerts_org_update" ON crm_alerts
  FOR UPDATE USING (organization_id = (SELECT get_user_org_id()));

-- ═══════════════════════════════════════════════════════════════════
-- 9. Service role bypass (para webhooks que usan createAdminClient)
-- ═══════════════════════════════════════════════════════════════════

-- El dashboard usa createAdminClient() que bypass RLS con service_role key
-- Los webhooks también usan service_role, así que las policies solo afectan
-- al anon key (mobile app / público). Para estas tablas no hay acceso público.

-- ═══════════════════════════════════════════════════════════════════
-- 10. Función helper para trigger_config de keywords
-- ═══════════════════════════════════════════════════════════════════

-- Función para buscar workflows que matcheen un mensaje entrante por keyword
CREATE OR REPLACE FUNCTION match_keyword_workflows(
  p_org_id UUID,
  p_text TEXT,
  p_platform TEXT
)
RETURNS SETOF automation_workflows
LANGUAGE sql
STABLE
AS $$
  SELECT w.*
  FROM automation_workflows w
  WHERE w.organization_id = p_org_id
    AND w.is_active = true
    AND w.trigger_type = 'keyword'
    AND (w.channels @> ARRAY['all']::text[] OR w.channels @> ARRAY[p_platform]::text[])
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(w.trigger_config->'keywords', '[]'::jsonb)) kw
      WHERE CASE
        WHEN COALESCE(w.trigger_config->>'match_mode', 'contains') = 'exact'
        THEN lower(p_text) = lower(kw)
        ELSE lower(p_text) LIKE '%' || lower(kw) || '%'
      END
    )
  ORDER BY w.priority DESC
  LIMIT 1;
$$;

-- Función para buscar workflows que matcheen por template reply
CREATE OR REPLACE FUNCTION match_template_reply_workflows(
  p_org_id UUID,
  p_template_name TEXT,
  p_platform TEXT
)
RETURNS SETOF automation_workflows
LANGUAGE sql
STABLE
AS $$
  SELECT w.*
  FROM automation_workflows w
  WHERE w.organization_id = p_org_id
    AND w.is_active = true
    AND w.trigger_type = 'template_reply'
    AND (w.channels @> ARRAY['all']::text[] OR w.channels @> ARRAY[p_platform]::text[])
    AND w.trigger_config->>'template_name' = p_template_name
  ORDER BY w.priority DESC
  LIMIT 1;
$$;

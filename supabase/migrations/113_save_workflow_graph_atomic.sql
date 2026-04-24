-- 113_save_workflow_graph_atomic.sql
-- Guardado atómico del grafo de un workflow.
--
-- Motivación: saveWorkflowGraph() hacía DELETE de edges+nodes y luego INSERT
-- desde el server action. No era transaccional, así que en la ventana entre
-- el DELETE y el INSERT el workflow quedaba sin nodos/edges. Si una visita
-- se completaba justo ahí, queue.ts → completeService encontraba
-- `edges.length === 0` en el chequeo post_service y skippeaba silenciosamente
-- el envío del template de reseña. Resultado: se perdían reseñas cada vez
-- que alguien editaba un workflow.
--
-- Esta función empaqueta todo en una sola transacción + lock explícito a nivel
-- de workflow, así lectores nunca ven un estado intermedio y ediciones
-- concurrentes no pisan el grafo.

CREATE OR REPLACE FUNCTION save_workflow_graph(
  p_workflow_id UUID,
  p_organization_id UUID,
  p_nodes JSONB,
  p_edges JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node_count INT;
  v_edge_count INT;
BEGIN
  -- Lock advisory por workflow para serializar saves concurrentes.
  -- hashtext evita colisiones entre UUIDs distintos con suficiente entropía.
  PERFORM pg_advisory_xact_lock(hashtext('save_workflow_graph:' || p_workflow_id::text));

  -- Verificar que el workflow existe y pertenece a la org.
  IF NOT EXISTS (
    SELECT 1 FROM automation_workflows
    WHERE id = p_workflow_id AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Workflow no encontrado o no pertenece a la organización';
  END IF;

  -- Borrar edges y nodos actuales. Todo dentro de la misma transacción, así
  -- ningún lector ve el grafo vacío (SELECTs externos ven el estado anterior
  -- hasta el COMMIT gracias a REPEATABLE READ implícito por transacción).
  DELETE FROM workflow_edges WHERE workflow_id = p_workflow_id;
  DELETE FROM workflow_nodes WHERE workflow_id = p_workflow_id;

  -- Insertar nuevos nodos desde el array JSONB.
  IF jsonb_array_length(p_nodes) > 0 THEN
    INSERT INTO workflow_nodes (
      id, workflow_id, node_type, label, config,
      position_x, position_y, width, height, is_entry_point
    )
    SELECT
      (n->>'id')::uuid,
      p_workflow_id,
      n->>'node_type',
      n->>'label',
      COALESCE(n->'config', '{}'::jsonb),
      COALESCE((n->>'position_x')::numeric, 0),
      COALESCE((n->>'position_y')::numeric, 0),
      COALESCE((n->>'width')::int, 200),
      COALESCE((n->>'height')::int, 80),
      COALESCE((n->>'is_entry_point')::boolean, false)
    FROM jsonb_array_elements(p_nodes) AS n;
  END IF;

  v_node_count := jsonb_array_length(p_nodes);

  -- Insertar nuevos edges.
  IF jsonb_array_length(p_edges) > 0 THEN
    INSERT INTO workflow_edges (
      workflow_id, source_node_id, target_node_id,
      source_handle, label, condition_value, sort_order
    )
    SELECT
      p_workflow_id,
      (e->>'source_node_id')::uuid,
      (e->>'target_node_id')::uuid,
      COALESCE(e->>'source_handle', 'default'),
      NULLIF(e->>'label', ''),
      NULLIF(e->>'condition_value', ''),
      COALESCE((e->>'sort_order')::int, (row_number() OVER () - 1)::int)
    FROM jsonb_array_elements(p_edges) WITH ORDINALITY AS arr(e, ord);
  END IF;

  v_edge_count := jsonb_array_length(p_edges);

  -- Actualizar timestamp para que la UI invalide caches.
  UPDATE automation_workflows
     SET updated_at = now()
   WHERE id = p_workflow_id;

  RETURN jsonb_build_object(
    'success', true,
    'nodes', v_node_count,
    'edges', v_edge_count
  );
END;
$$;

COMMENT ON FUNCTION save_workflow_graph IS
  'Reemplaza atómicamente nodos+edges de un workflow. Evita la race condition '
  'entre DELETE y INSERT que hacía perder disparos post_service cuando se '
  'editaba un workflow mientras entraban visitas.';

-- Solo roles autenticados pueden ejecutarlo; la función valida la org adentro.
GRANT EXECUTE ON FUNCTION save_workflow_graph(UUID, UUID, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION save_workflow_graph(UUID, UUID, JSONB, JSONB) TO service_role;

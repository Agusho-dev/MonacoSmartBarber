-- =============================================================================
-- 214 — Correcciones de la revisión adversarial de RRHH (sobre la mig 213)
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `enviando` era un estado SIN SALIDA
--
--    El claim marcaba la fila 'enviando' y sólo el propio lote la sacaba de ahí.
--    Si el proceso moría después de mandar el WhatsApp y antes del UPDATE (un
--    lote son 8 mensajes × hasta 3 reintentos de 10 s de `sendToMeta`, y la ruta
--    no declaraba `maxDuration`), esas filas quedaban en 'enviando' PARA SIEMPRE:
--    `rrhh_claim_destinatarios` sólo tomaba 'pendiente', `reintentarFallidos`
--    sólo 'fallido', y `rrhh_recalcular_difusion` las contaba como pendientes,
--    así que `terminado` nunca daba true y el browser giraba 200 veces
--    reclamando 0 filas. Peor: si el dueño rearmaba la difusión, a esas personas
--    les llegaba DOS veces la plantilla de marketing.
--
--    Se sella el claim con tiempo: pasados 5 minutos la fila vuelve a ser
--    reclamable. Mismo patrón que `claim_pending_messages` + el backoff de la
--    edge function.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE rrhh_difusion_destinatarios
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN rrhh_difusion_destinatarios.claimed_at IS
  'Cuándo lo tomó un lote. Pasados 5 minutos en estado enviando se vuelve a reclamar: sin esto, un proceso que muere a mitad de lote dejaba la fila trabada para siempre.';

CREATE OR REPLACE FUNCTION rrhh_claim_destinatarios(p_org uuid, p_difusion uuid, p_limite integer)
RETURNS TABLE (id uuid, conversation_id uuid, canal text, nombre text, destino text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Gate de organización adentro: es SECURITY DEFINER y el id viaja del browser.
  IF NOT EXISTS (SELECT 1 FROM rrhh_difusiones d WHERE d.id = p_difusion AND d.organization_id = p_org) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH elegidos AS (
    SELECT d.id FROM rrhh_difusion_destinatarios d
    WHERE d.difusion_id = p_difusion
      AND (d.estado = 'pendiente'
           -- Rescate de los que quedaron colgados: el proceso que los tomó ya no existe.
           OR (d.estado = 'enviando' AND d.claimed_at < now() - interval '5 minutes'))
    ORDER BY d.created_at
    LIMIT GREATEST(COALESCE(p_limite, 8), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE rrhh_difusion_destinatarios dd
     SET estado = 'enviando', claimed_at = now()
    FROM elegidos e WHERE dd.id = e.id
  RETURNING dd.id, dd.conversation_id, dd.canal, dd.nombre, dd.destino;
END;
$fn$;

-- El recálculo distingue lo que espera de lo que está EN VUELO, y devuelve
-- `omitidos` para que la barra de progreso pueda descontarlos del denominador:
-- con los omitidos adentro, una difusión completa mostraba 59 %.
CREATE OR REPLACE FUNCTION rrhh_recalcular_difusion(p_org uuid, p_difusion uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_total int; v_env int; v_fall int; v_omit int; v_pend int; v_vuelo int; v_estado text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rrhh_difusiones d WHERE d.id = p_difusion AND d.organization_id = p_org) THEN
    RETURN jsonb_build_object('error', 'no_encontrada');
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE estado = 'enviado'),
         count(*) FILTER (WHERE estado = 'fallido'),
         count(*) FILTER (WHERE estado = 'omitido'),
         count(*) FILTER (WHERE estado IN ('pendiente','enviando')),
         count(*) FILTER (WHERE estado = 'enviando')
    INTO v_total, v_env, v_fall, v_omit, v_pend, v_vuelo
    FROM rrhh_difusion_destinatarios WHERE difusion_id = p_difusion;

  v_estado := CASE WHEN v_pend = 0 THEN 'enviada' ELSE 'enviando' END;

  UPDATE rrhh_difusiones
     SET total = v_total, enviados = v_env, fallidos = v_fall, omitidos = v_omit,
         estado = CASE WHEN estado = 'cancelada' THEN 'cancelada' ELSE v_estado END,
         started_at = COALESCE(started_at, now()),
         completed_at = CASE WHEN v_pend = 0 THEN COALESCE(completed_at, now()) ELSE NULL END
   WHERE id = p_difusion;

  RETURN jsonb_build_object('total', v_total, 'enviados', v_env, 'fallidos', v_fall,
                            'omitidos', v_omit, 'pendientes', v_pend, 'en_vuelo', v_vuelo,
                            'estado', v_estado);
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `es_candidato` lo podía escribir CUALQUIER staff logueado con la anon key
--
--    `conversation_tags` tiene una policy ALL para el rol `public` scopeada por
--    org (`conversation_tags_manage_by_org`) y el GRANT de UPDATE era a nivel
--    TABLA, o sea todas las columnas. Con la anon key, un
--    `PATCH /rest/v1/conversation_tags {"es_candidato": true}` sobre la etiqueta
--    "Precios / servicios" metía 1.146 conversaciones de clientes en la
--    audiencia de una difusión de búsqueda de barberos.
--
--    Se pasa a permisos por COLUMNA: las que edita el CRUD de etiquetas siguen
--    abiertas, `es_candidato` queda sólo para `service_role`, que es por donde
--    escribe `setEtiquetaEsCandidato` (con gate de `rrhh.manage`). En Postgres un
--    GRANT de tabla implica todas las columnas, así que primero hay que revocar
--    el de tabla.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE UPDATE ON conversation_tags FROM anon, authenticated;
GRANT UPDATE (name, color, description, ai_auto_assign) ON conversation_tags TO anon, authenticated;

-- Y en INSERT: una etiqueta nueva ya nace con `es_candidato = false` por default;
-- poder setearla en el INSERT sería el mismo agujero por la otra puerta.
REVOKE INSERT ON conversation_tags FROM anon, authenticated;
GRANT INSERT (id, organization_id, name, color, description, ai_auto_assign, created_at)
  ON conversation_tags TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El conteo de conversaciones por etiqueta mentía por el tope de PostgREST
--
--    `getEtiquetasRrhh` traía las asignaciones con `.limit(20000)` y las contaba
--    en JS, pero el `db-max-rows` del servidor es 1.000 y no avisa: la pantalla
--    donde el dueño ELIGE qué etiqueta alimenta RRHH decía "69 conversaciones"
--    para "Posible Barbero", que tiene 206 — y el reparto entre etiquetas era
--    arbitrario (las 1.000 filas que el planner devolviera primero). Es el mismo
--    Known Risk que la mig 213 invoca para resolver el listado en SQL; esta
--    cuenta se había quedado en TS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rrhh_conteo_etiquetas(p_org uuid)
RETURNS TABLE (tag_id uuid, conversaciones bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT t.id, count(cta.conversation_id)
  FROM conversation_tags t
  LEFT JOIN conversation_tag_assignments cta ON cta.tag_id = t.id
  WHERE t.organization_id = p_org
  GROUP BY t.id;
$fn$;

REVOKE ALL ON FUNCTION rrhh_conteo_etiquetas(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rrhh_conteo_etiquetas(uuid) TO service_role;

COMMIT;

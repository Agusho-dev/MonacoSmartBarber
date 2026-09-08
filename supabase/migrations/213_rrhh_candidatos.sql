-- =============================================================================
-- 213 — Recursos Humanos: candidatos a barbero que llegan por el CRM
-- =============================================================================
--
-- QUÉ RESUELVE
-- El etiquetado automático con IA (`conversation_tags.ai_auto_assign`) ya marca
-- como "Posible Barbero" a quien escribe buscando trabajo: al 8/sep/2026 son 206
-- conversaciones (123 WhatsApp + 83 Instagram). Ese material no era consultable:
-- el chip de etiqueta del inbox filtra EN EL CLIENTE sobre las 200 conversaciones
-- ya cargadas (`mensajeria-context.tsx:604` + `INBOX_PAGE_SIZE` en
-- `src/lib/inbox.ts`), así que el dueño veía una porción arbitraria del conjunto
-- y no tenía forma de saber que era una porción.
--
-- DECISIONES QUE NO HAY QUE DESHACER
--
-- 1. LA ETIQUETA ES LA FUENTE, ESTA TABLA ES EL OVERLAY. `rrhh_candidatos` NO se
--    puebla con un import: guarda sólo lo que agrega una persona (estado, notas,
--    puntaje, teléfono cargado a mano). El listado es un LEFT JOIN contra las
--    conversaciones etiquetadas, así que un candidato nuevo aparece solo, sin
--    cron ni sincronización, y la fila del overlay se materializa recién cuando
--    alguien lo toca.
--
-- 2. NO SE FABRICAN CLIENTES. El pipeline de `broadcasts` exige `client_id NOT
--    NULL` en `scheduled_messages` y `broadcast_recipients`, así que difundir por
--    ahí obliga a crear una ficha de `clients` por candidato. Ya se hizo una vez:
--    la difusión del 27/07/2026 creó 134 fichas, 114 quedaron en
--    `broadcast_recipients`, sólo 19 tienen alguna visita, y 80 son justamente
--    estos candidatos. Esas fichas suman al total de /dashboard/clientes, entran
--    en cualquier campaña "a todos" y serían destinatarias de las reglas de
--    fidelización. Acá el destinatario es la CONVERSACIÓN.
--
-- 3. INSTAGRAM NO ES DIFUNDIBLE Y SE DICE CON PALABRAS. Meta no tiene plantillas
--    en Instagram: fuera de la ventana de 24 h el único mecanismo es el tag
--    HUMAN_AGENT (7 días, respuesta humana a una consulta, requiere App Review),
--    que no cubre prospección. De las 83 conversaciones de IG etiquetadas, 82
--    tienen la ventana cerrada. `rrhh_listar_candidatos` devuelve `alcance` para
--    que la UI lo muestre en vez de ofrecer un botón que muera con el error crudo
--    de Meta (code 10 / subcode 2534022, ya hay 4 casos en prod).
--
-- 4. `ventana_abierta` SE INFORMA COMO ESPEJO OPTIMISTA. El webhook de IG abre
--    +24 h ante CUALQUIER inbound, incluidos stickers, reacciones y menciones de
--    historia, que Meta no cuenta como apertura. Sirve para ordenar y para
--    habilitar un intento, nunca como promesa.
--
-- 5. `n_media_rota` SE INFORMA PERO NO SE PROMETE RESCATAR. Ver el bloque largo
--    en `src/lib/actions/rrhh.ts`: la API de Instagram Login no devuelve
--    `attachments` para ningún mensaje, ni siquiera uno de hace 4 horas cuya URL
--    original sigue viva. Lo que se arregló es el webhook, que ahora persiste el
--    archivo en `chat-media` como el de WhatsApp.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Overlay del candidato
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rrhh_candidatos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- La conversación ES la identidad del candidato. No hay `client_id` a
  -- propósito (decisión 2 del encabezado).
  conversation_id   uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,

  estado            text NOT NULL DEFAULT 'nuevo'
                      CHECK (estado IN ('nuevo','contactado','entrevista','prueba','contratado','descartado')),
  -- 1..5. NULL = sin puntuar; no se asume 0, que se leería como "malo".
  puntaje           smallint CHECK (puntaje IS NULL OR puntaje BETWEEN 1 AND 5),
  notas             text,
  -- Para los de Instagram: el teléfono que el dueño consiguió por otra vía.
  -- Cargarlo es lo único que vuelve difundible a un candidato de IG.
  telefono_manual   text,
  nombre_override   text,
  motivo_descarte   text,
  -- Se completa al contratar; apunta a la fila de `staff` que se creó.
  staff_id          uuid REFERENCES staff(id) ON DELETE SET NULL,

  contactado_at     timestamptz,
  actualizado_por   uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rrhh_candidatos_org_estado ON rrhh_candidatos(organization_id, estado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rrhh_candidatos_staff ON rrhh_candidatos(staff_id) WHERE staff_id IS NOT NULL;

COMMENT ON TABLE rrhh_candidatos IS
  'Overlay de triage sobre las conversaciones etiquetadas como candidatos. La etiqueta es la fuente de verdad; esta tabla solo guarda lo que agrega una persona.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Difusiones de RRHH
--    Tabla propia y NO `broadcasts`: aquélla encola en `scheduled_messages`, que
--    exige `client_id`. Acá el destinatario es una conversación.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rrhh_difusiones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre              text NOT NULL,

  -- El idioma se copia del sync de Meta y NO tiene default: mandar 'es_AR' a una
  -- plantilla registrada como 'es' devuelve 132001 y el mensaje muere sin
  -- reintento (Known Risk #4).
  template_name       text NOT NULL,
  template_language   text NOT NULL,
  template_components jsonb,
  -- Instagram: texto libre para los que tengan la ventana abierta.
  -- NULL = no se intenta por Instagram.
  texto_instagram     text,

  estado              text NOT NULL DEFAULT 'borrador'
                        CHECK (estado IN ('borrador','enviando','enviada','cancelada')),
  total               integer NOT NULL DEFAULT 0,
  enviados            integer NOT NULL DEFAULT 0,
  fallidos            integer NOT NULL DEFAULT 0,
  omitidos            integer NOT NULL DEFAULT 0,

  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rrhh_difusiones_org ON rrhh_difusiones(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rrhh_difusion_destinatarios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  difusion_id     uuid NOT NULL REFERENCES rrhh_difusiones(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  canal           text NOT NULL CHECK (canal IN ('whatsapp','instagram')),
  -- Snapshot para que la difusión se pueda leer aunque después cambie la ficha.
  nombre          text,
  destino         text,
  estado          text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','enviando','enviado','fallido','omitido')),
  motivo          text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (difusion_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_rrhh_dest_pendientes
  ON rrhh_difusion_destinatarios(difusion_id, estado) WHERE estado = 'pendiente';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Qué etiqueta marca a un candidato
--    Va en `conversation_tags` y no en `app_settings` porque son varias posibles
--    (hoy "Posible Barbero"; mañana una de "Recomendado por el equipo") y porque
--    `app_settings` es una tabla de columnas nombradas, no un key/value.
--    El backfill por nombre sirve en cualquier organización.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE conversation_tags
  ADD COLUMN IF NOT EXISTS es_candidato boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN conversation_tags.es_candidato IS
  'Las conversaciones con esta etiqueta aparecen en /dashboard/rrhh como candidatos a barbero.';

UPDATE conversation_tags
   SET es_candidato = true
 WHERE es_candidato = false
   AND norm_text(name) LIKE '%barber%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS: prendida y sin políticas. Sólo `service_role`, como las tablas arca_*.
--    Todo lo que lee o escribe pasa por server actions con gate de permisos.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE rrhh_candidatos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rrhh_difusiones              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rrhh_difusion_destinatarios  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON rrhh_candidatos, rrhh_difusiones, rrhh_difusion_destinatarios FROM anon, authenticated;
GRANT ALL ON rrhh_candidatos, rrhh_difusiones, rrhh_difusion_destinatarios TO service_role;

CREATE OR REPLACE FUNCTION rrhh_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_rrhh_candidatos_updated ON rrhh_candidatos;
CREATE TRIGGER trg_rrhh_candidatos_updated
  BEFORE UPDATE ON rrhh_candidatos
  FOR EACH ROW EXECUTE FUNCTION rrhh_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Miniaturas del trabajo del candidato
--    Para un barbero el CV son las fotos de sus cortes (de 206 candidatos hay 8
--    documentos vivos contra 242 imágenes), así que la tarjeta las muestra antes
--    que cualquier texto. Resolverlas acá evita un N+1 sobre 206 fichas.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rrhh_muestras(p_conversation_id uuid, p_max integer DEFAULT 4)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('url', t.media_url, 'tipo', t.content_type)
                            ORDER BY t.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT m.media_url, m.content_type, m.created_at
    FROM messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.direction = 'inbound'
      AND m.media_url IS NOT NULL
      AND m.content_type IN ('image','video')
      -- Las de lookaside vencidas no se dibujan: sería una imagen rota sin aviso.
      AND NOT (m.media_url LIKE 'https://lookaside%' AND m.created_at < now() - interval '3 days')
      -- Los `instagram.com/...` que guarda el webhook son links a un reel o a un
      -- perfil, no archivos: en un <img> dan una imagen rota.
      AND m.media_url NOT LIKE 'https://www.instagram.com/%'
      AND m.media_url NOT LIKE 'https://instagram.com/%'
      AND m.content IS DISTINCT FROM '[Mención en Historia]'
    ORDER BY m.created_at DESC
    LIMIT GREATEST(p_max, 1)
  ) t;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Listado
--    Una sola consulta devuelve todo lo que la pantalla necesita: identidad,
--    canal, alcance, material y estado de triage. Va en SQL y no en TS por la
--    trampa de PostgREST: los adjuntos de estas conversaciones son ~2.700 filas
--    de `messages` y un `.in()` sin `.range()` se corta en 1.000 sin avisar (es
--    lo que le pasa a `getFilteredClients`, 13 de 14 lotes truncados).
--    Medido: 34 ms con 206 candidatos.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rrhh_listar_candidatos(
  p_org uuid, p_tags uuid[], p_estados text[] DEFAULT NULL, p_canal text DEFAULT NULL,
  p_busqueda text DEFAULT NULL, p_solo_con_material boolean DEFAULT false,
  p_solo_alcanzables boolean DEFAULT false, p_orden text DEFAULT 'reciente',
  p_limit integer DEFAULT 60, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  conversation_id uuid, canal text, platform_user_id text, nombre text, handle text,
  avatar_url text, client_id uuid, telefono text, estado text, puntaje smallint,
  notas text, motivo_descarte text, staff_id uuid, contactado_at timestamptz,
  primer_mensaje text, primer_contacto_at timestamptz, ultimo_mensaje_at timestamptz,
  ventana_abierta boolean, n_fotos integer, n_videos integer, n_docs integer,
  n_audios integer, n_media_rota integer, es_staff boolean, es_cliente_real boolean,
  alcance text, muestras jsonb, total_rows bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
WITH canales AS (
  SELECT sc.id, sc.platform FROM social_channels sc
  LEFT JOIN branches b ON b.id = sc.branch_id
  WHERE COALESCE(sc.organization_id, b.organization_id) = p_org
),
-- Base: las conversaciones etiquetadas MÁS las que ya tienen overlay. Lo segundo
-- evita que un candidato desaparezca (con su estado y sus notas) si alguien le
-- saca la etiqueta a mano.
base AS (
  SELECT c.id AS conv_id FROM conversation_tag_assignments cta
  JOIN conversations c ON c.id = cta.conversation_id
  JOIN canales ch ON ch.id = c.channel_id
  WHERE cta.tag_id = ANY(p_tags)
  UNION
  SELECT rc.conversation_id FROM rrhh_candidatos rc
  JOIN conversations c2 ON c2.id = rc.conversation_id
  JOIN canales ch2 ON ch2.id = c2.channel_id
  WHERE rc.organization_id = p_org
),
-- Un solo barrido de mensajes para todas las conversaciones de la base.
med AS (
  SELECT m.conversation_id,
    COUNT(*) FILTER (WHERE m.content_type='image'    AND m.direction='inbound')::int AS n_fotos,
    COUNT(*) FILTER (WHERE m.content_type='video'    AND m.direction='inbound')::int AS n_videos,
    COUNT(*) FILTER (WHERE m.content_type='document' AND m.direction='inbound')::int AS n_docs,
    COUNT(*) FILTER (WHERE m.content_type='audio'    AND m.direction='inbound')::int AS n_audios,
    -- Rota = URL del CDN de Meta, que caduca a los ~3 días. Las de WhatsApp
    -- viven en el bucket `chat-media` y no vencen.
    COUNT(*) FILTER (WHERE m.direction='inbound' AND m.media_url LIKE 'https://lookaside%'
                       AND m.created_at < now() - interval '3 days')::int AS n_media_rota
  FROM messages m JOIN base ON base.conv_id = m.conversation_id
  GROUP BY m.conversation_id
),
-- El primer mensaje entrante con texto es, en los hechos, la carta de
-- presentación del candidato ("soy barbero hace 5 años, tengo disponibilidad…").
primer AS (
  SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.content, m.created_at
  FROM messages m JOIN base ON base.conv_id = m.conversation_id
  WHERE m.direction='inbound' AND m.content IS NOT NULL AND btrim(m.content) <> ''
    AND m.content NOT LIKE '[Mención en Historia]%'
  ORDER BY m.conversation_id, m.created_at ASC
),
filas AS (
  SELECT
    c.id AS conversation_id, ch.platform AS canal, c.platform_user_id,
    COALESCE(NULLIF(btrim(rc.nombre_override),''), NULLIF(btrim(cl.name),''),
             NULLIF(btrim(c.platform_user_name),''), c.platform_user_id) AS nombre,
    c.platform_user_handle AS handle, c.platform_user_avatar AS avatar_url, c.client_id,
    -- Teléfono efectivo: el cargado a mano manda; si no, el del cliente; si no,
    -- el propio wa_id (en WhatsApp el `platform_user_id` ES el teléfono).
    COALESCE(NULLIF(btrim(rc.telefono_manual),''), NULLIF(btrim(cl.phone),''),
             CASE WHEN ch.platform='whatsapp' THEN c.platform_user_id END) AS telefono,
    COALESCE(rc.estado,'nuevo') AS estado, rc.puntaje, rc.notas, rc.motivo_descarte,
    rc.staff_id, rc.contactado_at, p.content AS primer_mensaje,
    p.created_at AS primer_contacto_at, c.last_message_at AS ultimo_mensaje_at,
    (c.can_reply_until IS NOT NULL AND c.can_reply_until > now()) AS ventana_abierta,
    COALESCE(md.n_fotos,0) AS n_fotos, COALESCE(md.n_videos,0) AS n_videos,
    COALESCE(md.n_docs,0) AS n_docs, COALESCE(md.n_audios,0) AS n_audios,
    COALESCE(md.n_media_rota,0) AS n_media_rota,
    -- El etiquetador de IA a veces marca al propio equipo (hoy, 3 casos): si el
    -- teléfono coincide con un miembro activo del staff, la ficha lo avisa en
    -- vez de mandarle una convocatoria a alguien que ya trabaja ahí.
    EXISTS (SELECT 1 FROM staff s WHERE s.organization_id=p_org AND s.deleted_at IS NULL
              AND length(regexp_replace(COALESCE(s.phone,''),'\D','','g')) >= 10
              AND phone_tail(s.phone) = phone_tail(c.platform_user_id)) AS es_staff,
    EXISTS (SELECT 1 FROM visits v WHERE v.client_id = c.client_id) AS es_cliente_real,
    rrhh_muestras(c.id, 4) AS muestras
  FROM base
  JOIN conversations c ON c.id = base.conv_id
  JOIN canales ch ON ch.id = c.channel_id
  LEFT JOIN clients cl ON cl.id = c.client_id
  LEFT JOIN rrhh_candidatos rc ON rc.conversation_id = c.id AND rc.organization_id = p_org
  LEFT JOIN med md ON md.conversation_id = c.id
  LEFT JOIN primer p ON p.conversation_id = c.id
),
con_alcance AS (
  SELECT f.*, CASE
    -- WhatsApp con teléfono: la plantilla llega siempre, dentro o fuera de ventana.
    WHEN f.canal='whatsapp'  AND f.telefono IS NOT NULL THEN 'whatsapp'
    -- Instagram con teléfono cargado a mano: pasa a la audiencia de WhatsApp.
    WHEN f.canal='instagram' AND f.telefono IS NOT NULL THEN 'whatsapp'
    -- Instagram sin teléfono pero con ventana abierta: DM de texto libre.
    WHEN f.canal='instagram' AND f.ventana_abierta       THEN 'instagram'
    ELSE 'no' END AS alcance
  FROM filas f
),
filtradas AS (
  SELECT * FROM con_alcance ca
  WHERE (p_estados IS NULL OR ca.estado = ANY(p_estados))
    AND (p_canal IS NULL OR ca.canal = p_canal)
    AND (NOT p_solo_con_material OR (ca.n_fotos + ca.n_videos + ca.n_docs) > 0)
    AND (NOT p_solo_alcanzables OR ca.alcance <> 'no')
    AND (p_busqueda IS NULL OR btrim(p_busqueda) = '' OR
      norm_text(ca.nombre) LIKE '%' || norm_text(btrim(p_busqueda)) || '%' OR
      norm_text(COALESCE(ca.handle,'')) LIKE '%' || norm_text(btrim(p_busqueda)) || '%' OR
      norm_text(COALESCE(ca.primer_mensaje,'')) LIKE '%' || norm_text(btrim(p_busqueda)) || '%' OR
      (length(regexp_replace(p_busqueda,'\D','','g')) >= 6
        AND COALESCE(ca.telefono,'') LIKE '%' || regexp_replace(p_busqueda,'\D','','g') || '%'))
),
-- Las claves de orden se materializan como columnas: un ORDER BY CASE se
-- reevalúa en cada comparación del sort (Known Risk #20).
ordenadas AS (
  SELECT f.*, CASE p_orden
      WHEN 'material' THEN (f.n_fotos + f.n_videos + f.n_docs)::numeric
      WHEN 'puntaje'  THEN COALESCE(f.puntaje,0)::numeric
      ELSE 0::numeric END AS k_num,
    COUNT(*) OVER () AS total_rows
  FROM filtradas f
)
SELECT o.conversation_id, o.canal, o.platform_user_id, o.nombre, o.handle, o.avatar_url,
  o.client_id, o.telefono, o.estado, o.puntaje, o.notas, o.motivo_descarte, o.staff_id,
  o.contactado_at, o.primer_mensaje, o.primer_contacto_at, o.ultimo_mensaje_at,
  o.ventana_abierta, o.n_fotos, o.n_videos, o.n_docs, o.n_audios, o.n_media_rota,
  o.es_staff, o.es_cliente_real, o.alcance, o.muestras, o.total_rows
FROM ordenadas o
ORDER BY
  CASE WHEN p_orden IN ('material','puntaje') THEN o.k_num END DESC NULLS LAST,
  CASE WHEN p_orden = 'antiguo' THEN o.ultimo_mensaje_at END ASC NULLS LAST,
  CASE WHEN p_orden <> 'antiguo' THEN o.ultimo_mensaje_at END DESC NULLS LAST
LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0);
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Métricas de cabecera (los tiles, que además son filtro)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rrhh_metricas(p_org uuid, p_tags uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
WITH f AS (SELECT * FROM rrhh_listar_candidatos(p_org, p_tags, NULL, NULL, NULL, false, false, 'reciente', 100000, 0))
SELECT jsonb_build_object(
  'total',(SELECT count(*) FROM f),
  'nuevo',(SELECT count(*) FROM f WHERE estado='nuevo'),
  'contactado',(SELECT count(*) FROM f WHERE estado='contactado'),
  'entrevista',(SELECT count(*) FROM f WHERE estado='entrevista'),
  'prueba',(SELECT count(*) FROM f WHERE estado='prueba'),
  'contratado',(SELECT count(*) FROM f WHERE estado='contratado'),
  'descartado',(SELECT count(*) FROM f WHERE estado='descartado'),
  'whatsapp',(SELECT count(*) FROM f WHERE canal='whatsapp'),
  'instagram',(SELECT count(*) FROM f WHERE canal='instagram'),
  'alcanzables_wa',(SELECT count(*) FROM f WHERE alcance='whatsapp'),
  'alcanzables_ig',(SELECT count(*) FROM f WHERE alcance='instagram'),
  'sin_alcance',(SELECT count(*) FROM f WHERE alcance='no'),
  'con_material',(SELECT count(*) FROM f WHERE (n_fotos+n_videos+n_docs)>0),
  'del_equipo',(SELECT count(*) FROM f WHERE es_staff),
  'media_vencida',(SELECT COALESCE(sum(n_media_rota),0) FROM f),
  'nuevos_30d',(SELECT count(*) FROM f WHERE ultimo_mensaje_at > now() - interval '30 days'));
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Ficha: la conversación completa del candidato
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rrhh_candidato_mensajes(p_org uuid, p_conversation_id uuid)
RETURNS TABLE (
  id uuid, direction text, content_type text, content text, media_url text,
  media_vencida boolean, status text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT
    m.id, m.direction, m.content_type, m.content, m.media_url,
    -- Vencida = link del CDN de Meta con más de 3 días. Las de WhatsApp viven en
    -- el bucket `chat-media` y no vencen nunca.
    (m.media_url LIKE 'https://lookaside%' AND m.created_at < now() - interval '3 days') AS media_vencida,
    m.status, m.created_at
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  JOIN social_channels sc ON sc.id = c.channel_id
  LEFT JOIN branches b ON b.id = sc.branch_id
  WHERE m.conversation_id = p_conversation_id
    AND COALESCE(sc.organization_id, b.organization_id) = p_org
  ORDER BY m.created_at ASC;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Envío por lotes
--    El envío corre desde el browser lote a lote (request corta, barra de
--    progreso real, reanudable). El claim tiene que ser atómico o un doble click
--    manda el mismo mensaje dos veces: es el problema que `sendBroadcast`
--    resolvió con su claim draft→sending, acá con FOR UPDATE SKIP LOCKED.
-- ─────────────────────────────────────────────────────────────────────────────

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
    WHERE d.difusion_id = p_difusion AND d.estado = 'pendiente'
    ORDER BY d.created_at
    LIMIT GREATEST(COALESCE(p_limite, 8), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE rrhh_difusion_destinatarios dd
     SET estado = 'enviando'
    FROM elegidos e WHERE dd.id = e.id
  RETURNING dd.id, dd.conversation_id, dd.canal, dd.nombre, dd.destino;
END;
$fn$;

-- Los contadores se DERIVAN de los destinatarios; no se incrementan a mano
-- (Known Risk #13: un contador denormalizado que nadie verifica miente, y el
-- `delivered_count` de `broadcasts` es literalmente una copia de `sent_count`).
CREATE OR REPLACE FUNCTION rrhh_recalcular_difusion(p_org uuid, p_difusion uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_total int; v_env int; v_fall int; v_omit int; v_pend int; v_estado text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rrhh_difusiones d WHERE d.id = p_difusion AND d.organization_id = p_org) THEN
    RETURN jsonb_build_object('error', 'no_encontrada');
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE estado = 'enviado'),
         count(*) FILTER (WHERE estado = 'fallido'),
         count(*) FILTER (WHERE estado = 'omitido'),
         count(*) FILTER (WHERE estado IN ('pendiente','enviando'))
    INTO v_total, v_env, v_fall, v_omit, v_pend
    FROM rrhh_difusion_destinatarios WHERE difusion_id = p_difusion;

  v_estado := CASE WHEN v_pend = 0 THEN 'enviada' ELSE 'enviando' END;

  UPDATE rrhh_difusiones
     SET total = v_total, enviados = v_env, fallidos = v_fall, omitidos = v_omit,
         estado = CASE WHEN estado = 'cancelada' THEN 'cancelada' ELSE v_estado END,
         started_at = COALESCE(started_at, now()),
         completed_at = CASE WHEN v_pend = 0 THEN COALESCE(completed_at, now()) ELSE NULL END
   WHERE id = p_difusion;

  RETURN jsonb_build_object('total', v_total, 'enviados', v_env, 'fallidos', v_fall,
                            'omitidos', v_omit, 'pendientes', v_pend, 'estado', v_estado);
END;
$fn$;

-- Materializa el overlay y deja la marca de contacto. Sólo AVANZA desde 'nuevo':
-- si alguien ya lo puso en entrevista, una difusión no lo retrocede.
CREATE OR REPLACE FUNCTION rrhh_marcar_contactado(p_org uuid, p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO rrhh_candidatos (organization_id, conversation_id, estado, contactado_at)
  VALUES (p_org, p_conversation_id, 'contactado', now())
  ON CONFLICT (conversation_id) DO UPDATE
    SET contactado_at = now(),
        estado = CASE WHEN rrhh_candidatos.estado = 'nuevo' THEN 'contactado' ELSE rrhh_candidatos.estado END
  WHERE rrhh_candidatos.organization_id = p_org;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Grants: sólo `service_role`. Las funciones son SECURITY DEFINER sin RLS de
--     contención, así que `p_org` no se puede confiar del browser: lo resuelve el
--     server action con `getCurrentOrgId()`. Mismo criterio que
--     `search_clients_page` (mig 167).
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION rrhh_muestras(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rrhh_listar_candidatos(uuid, uuid[], text[], text, text, boolean, boolean, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rrhh_metricas(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rrhh_candidato_mensajes(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rrhh_claim_destinatarios(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rrhh_recalcular_difusion(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rrhh_marcar_contactado(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION rrhh_muestras(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION rrhh_listar_candidatos(uuid, uuid[], text[], text, text, boolean, boolean, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION rrhh_metricas(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION rrhh_candidato_mensajes(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION rrhh_claim_destinatarios(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION rrhh_recalcular_difusion(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION rrhh_marcar_contactado(uuid, uuid) TO service_role;

COMMIT;

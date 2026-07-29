-- 167_clients_directory_search.sql
-- Motor de búsqueda / segmentación / paginación de la base de clientes.
--
-- POR QUÉ: /dashboard/clientes traía TODOS los clientes (5.537) + las visitas de los
-- últimos 90 días (7.583) al browser y filtraba en JS. Eso producía tres bugs graves:
--   1. "Total visitas" contaba sólo 90 días (la misma fila decía "1" en la tabla y "23"
--      al abrir el sheet, que sí lee el histórico).
--   2. Con una sucursal seleccionada se ocultaba a todo cliente sin visitas EN ESA
--      SUCURSAL EN 90 DÍAS: 1.106 clientes invisibles (482 Parana, 487 Rondeau, 129
--      Caseros), justo los que hace rato que no vuelven — los únicos accionables.
--   3. La búsqueda era `name.toLowerCase().includes(q)`: sin plegado de acentos
--      (949 de 5.537 nombres tienen tilde; "agustin" encontraba 31 de 133 clientes),
--      sin multi-token y sin normalizar el teléfono.
--
-- Acá vive el ÚNICO motor: agrega desde `visits` (exacto, y funciona con o sin filtro
-- de sucursal), calcula el segmento en SQL y pagina server-side.

-- ---------------------------------------------------------------------------
-- 1. Extensiones
-- ---------------------------------------------------------------------------
-- Van a `extensions`, que es el schema que Supabase provisiona para esto y donde ya
-- viven pg_net/pgcrypto/uuid-ossp. Ojo: toda función que las use tiene que declarar
-- `SET search_path = public, extensions, pg_temp` o resolver schema-calificado, o
-- compila y falla en runtime con 42883.
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 2. Normalizador de texto (indexable)
-- ---------------------------------------------------------------------------
-- `unaccent(text)` (1 argumento) es STABLE porque resuelve el diccionario por
-- search_path => Postgres la rechaza en un índice ("functions in index expression
-- must be marked IMMUTABLE"). La variante de 2 argumentos con el diccionario
-- explícito SÍ es IMMUTABLE. Por eso este wrapper.
CREATE OR REPLACE FUNCTION public.norm_text(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = extensions, public, pg_temp
AS $$
  SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, t))
$$;

COMMENT ON FUNCTION public.norm_text(text) IS
  'Minúsculas + sin acentos. IMMUTABLE para que se la pueda usar en un índice.';

-- Últimos 10 dígitos del teléfono. Es la forma canónica de comparar teléfonos en la
-- base: conviven "3512125249", "+54 9 351 212-5249" y "5493512125249" para la misma
-- persona, y los tres tienen el mismo tail.
CREATE OR REPLACE FUNCTION public.phone_tail(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- ¿Es un teléfono con el que se puede contactar a alguien?
-- La fila (queue.ts) crea "clientes especiales" (walk-in sin teléfono) con teléfonos
-- virtuales que empiezan en 0. En la org grande: 5.111 teléfonos reales y 428
-- placeholders (410 arrancan en "00", 17 en "0"). Ningún teléfono real de la base
-- empieza en 0 ni tiene menos de 8 dígitos.
CREATE OR REPLACE FUNCTION public.is_real_phone(p text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^[1-9][0-9]{7,}$'
$$;

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------
-- Ordenar por nombre era el 80% del costo de cada página (seq scan + top-N heapsort,
-- 3,4 ms de 4,2 ms). Con este índice el ORDER BY desaparece del plan: 0,12 ms.
CREATE INDEX IF NOT EXISTS idx_clients_org_name
  ON public.clients (organization_id, name);

-- NO se crea índice GIN trigram sobre el nombre, aunque parezca la jugada obvia.
-- Medido contra prod: el predicado de búsqueda es un OR de cuatro formas (nombre,
-- teléfono, notas, instagram) y sólo una es indexable, así que el planner resuelve
-- todo con un Seq Scan igual y el índice queda con idx_scan = 0 mientras se paga en
-- cada INSERT/UPDATE de `clients`. Sobre 5.541 clientes el scan cuesta ~40 ms, que
-- para una búsqueda debounced está bien. Si una organización crece a decenas de
-- miles, el arreglo NO es agregar el índice sino reescribir el filtro como UNION de
-- las cuatro formas (una rama por índice) — recién ahí el GIN sirve.
-- `unaccent` sí es necesaria: la usa public.norm_text.

-- Match exacto por teléfono normalizado (el `idx_clients_org_phone_last10` que ya
-- existe indexa la misma expresión inline, pero el planner no la reconoce a través
-- del wrapper `phone_tail`).
CREATE INDEX IF NOT EXISTS idx_clients_org_phone_tail
  ON public.clients (organization_id, public.phone_tail(phone));

-- No hace falta ningún índice nuevo sobre `visits`: `idx_visits_client`,
-- `idx_visits_org_branch` e `idx_visits_org_completed` alcanzan.

-- ---------------------------------------------------------------------------
-- 4. Listado paginado + búsqueda + segmentación
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_clients_page(uuid, uuid[], text, text[], boolean, boolean, int, int, int, text, text, int, int);

CREATE OR REPLACE FUNCTION public.search_clients_page(
  p_organization_id  uuid,
  p_branch_ids       uuid[]  DEFAULT NULL,   -- NULL = métricas de toda la organización
  p_query            text    DEFAULT NULL,
  p_segments         text[]  DEFAULT NULL,
  p_only_with_visits boolean DEFAULT false,  -- opt-in: recortar a los que visitaron el scope
  p_hide_walkins     boolean DEFAULT false,  -- ocultar los "especiales" sin teléfono real
  p_risk_days        int     DEFAULT 25,
  p_lost_days        int     DEFAULT 40,
  p_vip_visits       int     DEFAULT 6,
  p_sort             text    DEFAULT 'relevance',
  p_sort_dir         text    DEFAULT 'desc',
  p_limit            int     DEFAULT 50,
  p_offset           int     DEFAULT 0
)
RETURNS TABLE (
  id                 uuid,
  name               text,
  phone              text,
  instagram          text,
  notes              text,
  created_at         timestamptz,
  is_walkin          boolean,
  visit_count        int,
  last_visit_at      timestamptz,
  first_visit_at     timestamptz,
  total_spent        numeric,
  avg_ticket         numeric,
  cadence_days       int,
  global_visit_count int,
  branch_count       int,
  segment            text,
  top_barber_id      uuid,
  top_barber_name    text,
  top_branch_name    text,
  total_rows         bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_q       text;
  v_norm    text;
  v_digits  text;
  v_tail    text;
  v_tokens  text[];
  v_limit   int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset  int  := greatest(coalesce(p_offset, 0), 0);
  v_dir     text := CASE WHEN lower(coalesce(p_sort_dir, 'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_sort    text := lower(coalesce(p_sort, 'relevance'));
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'search_clients_page: p_organization_id es obligatorio';
  END IF;

  v_q      := btrim(coalesce(p_query, ''));
  -- Se escapan los comodines de LIKE: buscar "100%" tiene que buscar "100%", no
  -- "cualquier cosa que empiece con 100". Sin esto, escribir "%%" o "_" en el
  -- buscador devolvía la base entera como si todo matcheara.
  v_norm   := replace(replace(replace(public.norm_text(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  v_digits := regexp_replace(v_q, '\D', '', 'g');
  -- Si el usuario pegó el número con prefijo internacional ("+54 9 351…"), los
  -- últimos 10 dígitos son los que comparan contra la base.
  v_tail   := right(v_digits, 10);
  -- Tokens del nombre: se exigen TODOS (AND), en cualquier orden. El 82% de los
  -- nombres de la base es multi-token, así que "baldovino ignacio" tiene que
  -- encontrar a "Ignacio Baldovino".
  v_tokens := ARRAY(
    SELECT t FROM unnest(string_to_array(v_norm, ' ')) AS t WHERE btrim(t) <> ''
  );

  RETURN QUERY
  WITH agg AS (
    -- Una sola pasada por `visits`: métricas del scope elegido (FILTER por sucursal)
    -- y, en paralelo, el total global del cliente en la organización.
    -- `client_id IS NOT NULL` es obligatorio: hay 35 visitas huérfanas que si no
    -- forman un grupo fantasma.
    SELECT
      v.client_id,
      count(*) FILTER (
        WHERE p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids)
      )::int AS visit_count,
      max(v.completed_at) FILTER (
        WHERE p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids)
      ) AS last_visit_at,
      min(v.completed_at) FILTER (
        WHERE p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids)
      ) AS first_visit_at,
      coalesce(sum(v.amount) FILTER (
        WHERE p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids)
      ), 0)::numeric AS total_spent,
      count(*)::int AS global_visit_count
      -- `count(DISTINCT branch_id)` acá costaba 6 ms sobre los 5.193 grupos y sólo
      -- se muestra en las 50 filas visibles: se resuelve abajo, en el LATERAL.
    FROM public.visits v
    WHERE v.organization_id = p_organization_id
      AND v.client_id IS NOT NULL
    GROUP BY v.client_id
  ),
  base AS (
    SELECT
      c.id,
      c.name,
      c.phone,
      c.instagram,
      c.notes,
      c.created_at,
      -- "Especiales": walk-ins que la fila registra sin teléfono real. Son 428 en la
      -- org grande y hoy ensucian la base sin que nada los distinga.
      (NOT public.is_real_phone(c.phone)) AS is_walkin,
      coalesce(a.visit_count, 0)        AS visit_count,
      a.last_visit_at,
      a.first_visit_at,
      coalesce(a.total_spent, 0)        AS total_spent,
      coalesce(a.global_visit_count, 0) AS global_visit_count
    FROM public.clients c
    -- LEFT JOIN, siempre: 347 clientes no tienen ninguna visita y tienen que
    -- aparecer igual. Un INNER JOIN acá reintroduce el bug que esto arregla.
    LEFT JOIN agg a ON a.client_id = c.id
    WHERE c.organization_id = p_organization_id
      AND (NOT p_hide_walkins OR public.is_real_phone(c.phone))
      AND (NOT p_only_with_visits OR coalesce(a.visit_count, 0) > 0)
      AND (
        v_q = ''
        -- nombre: todos los tokens, sin acentos
        OR (
          cardinality(v_tokens) > 0
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_tokens) AS tok
            WHERE public.norm_text(c.name) NOT LIKE '%' || tok || '%'
          )
        )
        -- teléfono: "3512378085", "+54 9 351 237-8085" y "237 8085" tienen que dar
        -- todos el mismo cliente. El LIKE cubre prefijo/substring; el phone_tail
        -- cubre el caso inverso (la consulta trae más dígitos que lo guardado).
        OR (
          length(v_digits) >= 4
          AND (
            regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
            OR public.phone_tail(c.phone) = v_tail
          )
        )
        -- observaciones internas e instagram
        OR (c.notes IS NOT NULL AND public.norm_text(c.notes) LIKE '%' || v_norm || '%')
        OR (c.instagram IS NOT NULL AND public.norm_text(c.instagram) LIKE '%' || v_norm || '%')
      )
  ),
  classified AS (
    SELECT
      b.*,
      CASE
        WHEN b.visit_count = 0 THEN 'sin_visitas'
        WHEN b.last_visit_at >= now() - make_interval(days => p_risk_days) THEN
          CASE
            WHEN b.visit_count >= p_vip_visits THEN 'vip'
            WHEN b.visit_count >= 2            THEN 'activo'
            ELSE 'nuevo'
          END
        -- Vino una sola vez y no volvió. Es el bucket más grande (1.719 = 31% de la
        -- base) y el más accionable; antes quedaba escondido dentro de "perdido".
        WHEN b.visit_count = 1 THEN 'probo_no_volvio'
        WHEN b.last_visit_at >= now() - make_interval(days => p_lost_days) THEN 'en_riesgo'
        ELSE 'perdido'
      END AS segment,
      -- Relevancia: teléfono exacto gana siempre, después nombre que empieza con lo
      -- buscado, después nombre que lo contiene, y último las notas.
      CASE
        WHEN v_q = '' THEN NULL
        WHEN length(v_digits) >= 4 AND public.phone_tail(b.phone) = v_tail            THEN 100
        WHEN length(v_digits) >= 4
             AND regexp_replace(coalesce(b.phone, ''), '\D', '', 'g')
                 LIKE '%' || v_digits || '%'                                          THEN 90
        WHEN public.norm_text(b.name) LIKE v_norm || '%'                              THEN 80
        WHEN public.norm_text(b.name) LIKE '% ' || v_norm || '%'                      THEN 70
        WHEN public.norm_text(b.name) LIKE '%' || v_norm || '%'                       THEN 60
        ELSE 30
      END::numeric AS relevance
    FROM base b
  ),
  filtered AS (
    SELECT
      c.*,
      CASE WHEN c.visit_count > 0
           THEN round(c.total_spent / c.visit_count, 0)
      END AS avg_ticket,
      -- Cadencia propia del cliente: cada cuántos días vuelve. Es lo que convierte
      -- "hace 34 días" en un juicio (normal para uno, alarma para otro).
      CASE WHEN c.visit_count >= 3 AND c.first_visit_at IS NOT NULL
           THEN greatest(
                  round(
                    extract(epoch FROM (c.last_visit_at - c.first_visit_at))
                    / 86400.0 / (c.visit_count - 1)
                  )::int,
                  1)
      END AS cadence_days
    FROM classified c
    WHERE p_segments IS NULL
       OR cardinality(p_segments) = 0
       OR c.segment = ANY (p_segments)
  ),
  -- Las claves de orden se materializan como COLUMNAS, no como expresiones dentro
  -- del ORDER BY. Un `ORDER BY CASE … END` se reevalúa en CADA comparación del sort
  -- (n·log n ≈ 70.000 veces sobre 5.539 filas), y eso costaba ~40 ms de los 68 ms
  -- totales. Como columna, la expresión se evalúa una sola vez por fila.
  counted AS (
    SELECT
      f.*,
      count(*) OVER () AS total_rows,
      CASE WHEN v_sort = 'name' AND v_dir = 'asc'  THEN f.name END AS sort_txt_asc,
      CASE WHEN v_sort = 'name' AND v_dir = 'desc' THEN f.name END AS sort_txt_desc,
      -- Una sola clave numérica con el signo ya aplicado: el ORDER BY queda siempre
      -- ASC y no hace falta una rama por dirección.
      (
        CASE v_sort
          WHEN 'relevance'  THEN f.relevance
          WHEN 'visits'     THEN f.visit_count::numeric
          WHEN 'spent'      THEN f.total_spent
          WHEN 'ticket'     THEN f.avg_ticket
          WHEN 'last_visit' THEN extract(epoch FROM f.last_visit_at)
          WHEN 'created'    THEN extract(epoch FROM f.created_at)
        END
      ) * CASE WHEN v_dir = 'asc' THEN 1 ELSE -1 END AS sort_num
    FROM filtered f
  ),
  page AS (
    SELECT p.*
    FROM counted p
    ORDER BY
      p.sort_txt_asc  ASC  NULLS LAST,
      p.sort_txt_desc DESC NULLS LAST,
      p.sort_num      ASC  NULLS LAST,
      -- A igualdad gana el que vino hace menos: el que buscás suele ser el que
      -- estuvo hace poco.
      p.last_visit_at DESC NULLS LAST,
      p.name          ASC
    LIMIT v_limit OFFSET v_offset
  )
  -- El barbero y la sucursal habitual se resuelven SÓLO para las filas de la página
  -- (máx. 200), no para los 5.537 candidatos.
  SELECT
    pg.id,
    pg.name,
    pg.phone,
    pg.instagram,
    pg.notes,
    pg.created_at,
    pg.is_walkin,
    pg.visit_count,
    pg.last_visit_at,
    pg.first_visit_at,
    pg.total_spent,
    pg.avg_ticket,
    pg.cadence_days,
    pg.global_visit_count,
    coalesce(tbr.branch_count, 0),
    pg.segment,
    tb.barber_id,
    tb.full_name,
    tbr.branch_name,
    pg.total_rows
  FROM page pg
  LEFT JOIN LATERAL (
    SELECT v.barber_id, s.full_name
    FROM public.visits v
    JOIN public.staff s ON s.id = v.barber_id
    WHERE v.client_id = pg.id
      AND v.organization_id = p_organization_id
      AND (p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids))
    GROUP BY v.barber_id, s.full_name
    ORDER BY count(*) DESC, max(v.completed_at) DESC
    LIMIT 1
  ) tb ON true
  -- Sucursal habitual + en cuántas sucursales estuvo, en una sola pasada.
  LEFT JOIN LATERAL (
    SELECT
      (array_agg(t.bname ORDER BY t.cnt DESC, t.last_at DESC))[1] AS branch_name,
      count(*)::int AS branch_count
    FROM (
      SELECT br.name AS bname, count(*) AS cnt, max(v.completed_at) AS last_at
      FROM public.visits v
      JOIN public.branches br ON br.id = v.branch_id
      WHERE v.client_id = pg.id
        AND v.organization_id = p_organization_id
      GROUP BY br.name
    ) t
  ) tbr ON true
  -- Re-ordena sólo las filas de la página: un JOIN no preserva el orden del CTE.
  ORDER BY
    pg.sort_txt_asc  ASC  NULLS LAST,
    pg.sort_txt_desc DESC NULLS LAST,
    pg.sort_num      ASC  NULLS LAST,
    pg.last_visit_at DESC NULLS LAST,
    pg.name          ASC;
END;
$$;

COMMENT ON FUNCTION public.search_clients_page(uuid, uuid[], text, text[], boolean, boolean, int, int, int, text, text, int, int) IS
  'Directorio de clientes: búsqueda tolerante (acentos, multi-token, teléfono por sufijo), '
  'segmentación y paginación server-side. El filtro de sucursal cambia las MÉTRICAS, '
  'no oculta clientes (para recortar está p_only_with_visits).';

-- ---------------------------------------------------------------------------
-- 5. Conteo por segmento (chips + tarjetas del header)
-- ---------------------------------------------------------------------------
-- Respeta los mismos filtros que el listado EXCEPTO el de segmento, así los chips
-- dicen cuántos de la búsqueda actual caen en cada bucket.
DROP FUNCTION IF EXISTS public.client_segment_counts(uuid, uuid[], text, boolean, boolean, int, int, int);

CREATE OR REPLACE FUNCTION public.client_segment_counts(
  p_organization_id  uuid,
  p_branch_ids       uuid[]  DEFAULT NULL,
  p_query            text    DEFAULT NULL,
  p_only_with_visits boolean DEFAULT false,
  p_hide_walkins     boolean DEFAULT false,
  p_risk_days        int     DEFAULT 25,
  p_lost_days        int     DEFAULT 40,
  p_vip_visits       int     DEFAULT 6
)
RETURNS TABLE (
  segment      text,
  client_count bigint,
  total_spent  numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_q      text;
  v_norm   text;
  v_digits text;
  v_tail   text;
  v_tokens text[];
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'client_segment_counts: p_organization_id es obligatorio';
  END IF;

  v_q      := btrim(coalesce(p_query, ''));
  -- Se escapan los comodines de LIKE: buscar "100%" tiene que buscar "100%", no
  -- "cualquier cosa que empiece con 100". Sin esto, escribir "%%" o "_" en el
  -- buscador devolvía la base entera como si todo matcheara.
  v_norm   := replace(replace(replace(public.norm_text(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  v_digits := regexp_replace(v_q, '\D', '', 'g');
  v_tail   := right(v_digits, 10);
  v_tokens := ARRAY(
    SELECT t FROM unnest(string_to_array(v_norm, ' ')) AS t WHERE btrim(t) <> ''
  );

  RETURN QUERY
  WITH agg AS (
    SELECT
      v.client_id,
      count(*) FILTER (
        WHERE p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids)
      )::int AS visit_count,
      max(v.completed_at) FILTER (
        WHERE p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids)
      ) AS last_visit_at,
      coalesce(sum(v.amount) FILTER (
        WHERE p_branch_ids IS NULL OR v.branch_id = ANY (p_branch_ids)
      ), 0)::numeric AS total_spent
    FROM public.visits v
    WHERE v.organization_id = p_organization_id
      AND v.client_id IS NOT NULL
    GROUP BY v.client_id
  ),
  base AS (
    SELECT
      coalesce(a.visit_count, 0) AS visit_count,
      a.last_visit_at,
      coalesce(a.total_spent, 0) AS total_spent
    FROM public.clients c
    LEFT JOIN agg a ON a.client_id = c.id
    WHERE c.organization_id = p_organization_id
      AND (NOT p_hide_walkins OR public.is_real_phone(c.phone))
      AND (NOT p_only_with_visits OR coalesce(a.visit_count, 0) > 0)
      AND (
        v_q = ''
        OR (
          cardinality(v_tokens) > 0
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_tokens) AS tok
            WHERE public.norm_text(c.name) NOT LIKE '%' || tok || '%'
          )
        )
        OR (
          length(v_digits) >= 4
          AND (
            regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
            OR public.phone_tail(c.phone) = v_tail
          )
        )
        OR (c.notes IS NOT NULL AND public.norm_text(c.notes) LIKE '%' || v_norm || '%')
        OR (c.instagram IS NOT NULL AND public.norm_text(c.instagram) LIKE '%' || v_norm || '%')
      )
  )
  SELECT
    seg.segment,
    count(*)::bigint,
    coalesce(sum(seg.total_spent), 0)::numeric
  FROM (
    SELECT
      b.total_spent,
      CASE
        WHEN b.visit_count = 0 THEN 'sin_visitas'
        WHEN b.last_visit_at >= now() - make_interval(days => p_risk_days) THEN
          CASE
            WHEN b.visit_count >= p_vip_visits THEN 'vip'
            WHEN b.visit_count >= 2            THEN 'activo'
            ELSE 'nuevo'
          END
        WHEN b.visit_count = 1 THEN 'probo_no_volvio'
        WHEN b.last_visit_at >= now() - make_interval(days => p_lost_days) THEN 'en_riesgo'
        ELSE 'perdido'
      END AS segment
    FROM base b
  ) seg
  GROUP BY seg.segment;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Búsqueda rápida (typeahead) — fila, mensajería, asistente IA, kiosko
-- ---------------------------------------------------------------------------
-- Reemplaza el doble `ilike` de `searchClients` (src/lib/actions/clients.ts), que no
-- plegaba acentos ni normalizaba el teléfono. Misma tolerancia que el directorio.
DROP FUNCTION IF EXISTS public.quick_search_clients(uuid, text, int);

CREATE OR REPLACE FUNCTION public.quick_search_clients(
  p_organization_id uuid,
  p_query           text,
  p_limit           int DEFAULT 10
)
RETURNS TABLE (
  id    uuid,
  name  text,
  phone text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_q      text;
  v_norm   text;
  v_digits text;
  v_tail   text;
  v_tokens text[];
  v_limit  int := least(greatest(coalesce(p_limit, 10), 1), 50);
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'quick_search_clients: p_organization_id es obligatorio';
  END IF;

  v_q := btrim(coalesce(p_query, ''));
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  -- Se escapan los comodines de LIKE: buscar "100%" tiene que buscar "100%", no
  -- "cualquier cosa que empiece con 100". Sin esto, escribir "%%" o "_" en el
  -- buscador devolvía la base entera como si todo matcheara.
  v_norm   := replace(replace(replace(public.norm_text(v_q), '\', '\\'), '%', '\%'), '_', '\_');
  v_digits := regexp_replace(v_q, '\D', '', 'g');
  v_tail   := right(v_digits, 10);
  v_tokens := ARRAY(
    SELECT t FROM unnest(string_to_array(v_norm, ' ')) AS t WHERE btrim(t) <> ''
  );

  RETURN QUERY
  SELECT c.id, c.name, c.phone
  FROM public.clients c
  WHERE c.organization_id = p_organization_id
    AND (
      (
        cardinality(v_tokens) > 0
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_tokens) AS tok
          WHERE public.norm_text(c.name) NOT LIKE '%' || tok || '%'
        )
      )
      OR (
        length(v_digits) >= 4
        AND (
          regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
          OR public.phone_tail(c.phone) = v_tail
        )
      )
    )
  ORDER BY
    CASE
      WHEN length(v_digits) >= 4 AND public.phone_tail(c.phone) = v_tail          THEN 0
      WHEN length(v_digits) >= 4
           AND regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
               LIKE '%' || v_digits || '%'                                        THEN 1
      WHEN public.norm_text(c.name) LIKE v_norm || '%'                            THEN 2
      WHEN public.norm_text(c.name) LIKE '% ' || v_norm || '%'                    THEN 3
      ELSE 4
    END,
    c.name
  LIMIT v_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER sin RLS de red de contención => `p_organization_id` NO se puede
-- confiar del cliente. Si estas funciones fueran ejecutables por `authenticated`,
-- cualquiera pasaría el UUID de otra organización y se llevaría su base entera.
-- Sólo service_role, como get_transfer_accounts_state / get_payment_accounts_month_income:
-- la org la resuelve el server action con getCurrentOrgId().
REVOKE ALL ON FUNCTION public.search_clients_page(uuid, uuid[], text, text[], boolean, boolean, int, int, int, text, text, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_segment_counts(uuid, uuid[], text, boolean, boolean, int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quick_search_clients(uuid, text, int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_clients_page(uuid, uuid[], text, text[], boolean, boolean, int, int, int, text, text, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.client_segment_counts(uuid, uuid[], text, boolean, boolean, int, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.quick_search_clients(uuid, text, int) TO service_role;

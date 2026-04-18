-- ============================================================
-- Migración 093: Fix de ranking en match_face_descriptor /
--                match_staff_face_descriptor
-- ============================================================
--
-- Problema detectado el 2026-04-18:
--   En Parana varios clientes ya enrolados no eran reconocidos
--   por el kiosco (ej.: "Joaquín narvay" enrolado con 4 descriptores
--   a las 20:47 y no matcheado a las 20:52, generando duplicado
--   con teléfono placeholder). La RPC combinaba
--     SELECT DISTINCT ON (c.id) ... ORDER BY c.id, distance
--     LIMIT max_results
--   — con max_results=1 (como llama el kiosco) el LIMIT aplica
--   sobre el orden por UUID de cliente, no por distancia, así que
--   el mejor candidato podía caer fuera del LIMIT.
--
-- Fix: calcular el mejor descriptor por cliente dentro de la CTE
--   y recién después filtrar por umbral, ordenar por distancia
--   ascendente y limitar. El primer resultado queda garantizado
--   como el match más cercano.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_face_descriptor(
  query_descriptor vector,
  match_threshold double precision DEFAULT 0.5,
  max_results integer DEFAULT 3,
  p_org_id uuid DEFAULT NULL
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_phone text,
  face_photo_url text,
  distance double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  v_org_id := COALESCE(p_org_id, get_user_org_id());
  RETURN QUERY
  WITH per_client AS (
    SELECT DISTINCT ON (c.id)
      c.id             AS cid,
      c.name           AS cname,
      c.phone          AS cphone,
      c.face_photo_url AS cphoto,
      (cfd.descriptor <-> query_descriptor)::FLOAT AS dist
    FROM client_face_descriptors cfd
    JOIN clients c ON c.id = cfd.client_id
    WHERE v_org_id IS NULL OR c.organization_id = v_org_id
    ORDER BY c.id, cfd.descriptor <-> query_descriptor
  )
  SELECT cid, cname, cphone, cphoto, dist
  FROM per_client
  WHERE dist < match_threshold
  ORDER BY dist ASC
  LIMIT max_results;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_staff_face_descriptor(
  query_descriptor vector,
  match_threshold double precision DEFAULT 0.5,
  max_results integer DEFAULT 3,
  p_org_id uuid DEFAULT NULL
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_phone text,
  face_photo_url text,
  distance double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  v_org_id := COALESCE(p_org_id, get_user_org_id());
  RETURN QUERY
  WITH per_staff AS (
    SELECT DISTINCT ON (s.id)
      s.id                  AS sid,
      s.full_name            AS sname,
      COALESCE(s.phone, '')  AS sphone,
      NULL::text             AS sphoto,
      (sfd.descriptor <-> query_descriptor)::FLOAT AS dist
    FROM staff_face_descriptors sfd
    JOIN staff s ON s.id = sfd.staff_id
    WHERE v_org_id IS NULL OR s.organization_id = v_org_id
    ORDER BY s.id, sfd.descriptor <-> query_descriptor
  )
  SELECT sid, sname, sphone, sphoto, dist
  FROM per_staff
  WHERE dist < match_threshold
  ORDER BY dist ASC
  LIMIT max_results;
END;
$$;

COMMENT ON FUNCTION public.match_face_descriptor IS
  'Devuelve los clientes mas cercanos al descriptor consultado, ordenados por distancia ascendente y filtrados por umbral. SECURITY DEFINER: unica via de matching para anon porque client_face_descriptors esta lockeada a service_role.';

COMMENT ON FUNCTION public.match_staff_face_descriptor IS
  'Devuelve los staff mas cercanos al descriptor consultado, ordenados por distancia ascendente y filtrados por umbral.';

COMMIT;

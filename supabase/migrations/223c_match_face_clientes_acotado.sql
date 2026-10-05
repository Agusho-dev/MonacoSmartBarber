-- APLICADA en prod el 4/10/2026 (schema_migrations «223c_match_face_clientes_acotado»).
-- ============================================================================
-- 223c — El reconocimiento facial de CLIENTES deja de servir para volcar la base
-- ============================================================================
-- APLICAR AHORA. Compatible con el bundle viejo (HEAD) y con el nuevo.
--
-- HALLAZGO NUEVO, fuera de la lista de la revisión (encontrado el 4/10/2026 al
-- arreglar su gemela de staff, match_staff_face_descriptor, en la 223a).
-- match_face_descriptor es SECURITY DEFINER con EXECUTE para PUBLIC y anon, y:
--   · sin p_org_id (y sin JWT de staff) busca en TODAS las organizaciones;
--   · el umbral y la cantidad los elige el que llama;
--   · devuelve id, nombre, TELÉFONO y la URL de la foto de la cara.
-- Verificado contra prod ejecutando como `anon` (sólo conteos): con un vector en
-- cero, umbral 10 y cantidad 100000 devuelve los 6.094 clientes con cara, los
-- 6.094 con teléfono. Una sola request con la anon key del bundle.
--
-- Qué hace esta migración (mitigación, NO el arreglo completo):
--   · org obligatoria (la que llega o la del JWT);
--   · umbral como mucho 0,5 (el kiosko usa 0,48) y como mucho 3 resultados.
-- MISMA firma, MISMO tipo de retorno y MISMOS permisos (CREATE OR REPLACE): el
-- kiosko viejo y el nuevo llaman con 0,48, 1 resultado y la org de la sucursal
-- (checkin-walk-in.tsx y turnos-flow.tsx la pasan siempre), así que para ellos
-- no cambia nada. Y el kiosko SÍ usa el teléfono del match (lo precarga para el
-- check-in), por eso acá NO se saca.
--
-- Lo que queda abierto (y por qué esto es mitigación): la "cara promedio" de
-- face-api queda a menos de 0,48 de la MITAD de los clientes (medido: 3.087 de
-- 6.094) y a menos de 0,6 de casi todos. Con el LIMIT, cada llamada entrega
-- como mucho 3, pero la RPC no tiene límite de llamadas: un script que mueva el
-- vector de prueba alrededor de esa cara sigue juntando nombres y teléfonos, de
-- a 3. El arreglo de verdad es el mismo que el del staff (223): que el kiosko
-- identifique por un server action con límite por IP, que la respuesta no
-- traiga el teléfono (el check-in por cara tendría que ir por client_id) y,
-- con gate, sacarle el EXECUTE a anon. Eso toca el kiosko y no es de esta área.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_face_descriptor(
  query_descriptor vector,
  match_threshold double precision DEFAULT 0.5,
  max_results integer DEFAULT 3,
  p_org_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(client_id uuid, client_name text, client_phone text, face_photo_url text, distance double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id  uuid;
  v_umbral  double precision;
  v_limite  integer;
BEGIN
  -- La org es obligatoria. Antes, sin ella, `v_org_id IS NULL` habilitaba la
  -- búsqueda en todas las organizaciones.
  v_org_id := COALESCE(p_org_id, get_user_org_id());
  IF v_org_id IS NULL OR query_descriptor IS NULL THEN
    RETURN;
  END IF;

  -- Umbral y cantidad los acota la base: con umbral 10 y cien mil filas, una
  -- sola llamada devolvía todos los clientes con cara, con su teléfono.
  v_umbral := LEAST(GREATEST(COALESCE(match_threshold, 0.5), 0), 0.5);
  v_limite := LEAST(GREATEST(COALESCE(max_results, 1), 1), 3);

  RETURN QUERY
  WITH per_client AS (
    SELECT DISTINCT ON (c.id)
      c.id             AS cid,
      c.name           AS cname,
      c.phone          AS cphone,
      c.face_photo_url AS cphoto,
      (cfd.descriptor <-> query_descriptor)::double precision AS dist
    FROM client_face_descriptors cfd
    JOIN clients c ON c.id = cfd.client_id
    WHERE c.organization_id = v_org_id
    ORDER BY c.id, cfd.descriptor <-> query_descriptor
  )
  SELECT cid, cname, cphone, cphoto, dist
  FROM per_client
  WHERE dist < v_umbral
  ORDER BY dist ASC
  LIMIT v_limite;
END;
$function$;

COMMENT ON FUNCTION public.match_face_descriptor(vector, double precision, integer, uuid) IS
  'Reconoce a un cliente de UNA organización por su descriptor facial (kiosko). Org obligatoria, '
  'umbral <= 0.5 y como mucho 3 resultados (mig 223c). Sigue con EXECUTE para anon porque el '
  'kiosko la llama con la anon key: ver la mig 223c para lo que queda abierto.';

DO $$
DECLARE
  v_org   uuid;
  v_n     integer;
  v_cero  vector := array_fill(0::real, ARRAY[128])::vector;
BEGIN
  PERFORM set_config('request.jwt.claim', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT count(*) INTO v_n FROM public.match_face_descriptor(v_cero, 10, 100000, NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '223c: sin org la RPC devolvió % filas', v_n;
  END IF;

  SELECT c.organization_id INTO v_org
    FROM public.client_face_descriptors d JOIN public.clients c ON c.id = d.client_id LIMIT 1;
  IF v_org IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.match_face_descriptor(v_cero, 10, 100000, v_org);
    IF v_n > 3 THEN
      RAISE EXCEPTION '223c: con org la RPC devolvió % filas (máximo 3)', v_n;
    END IF;
  END IF;

  -- El kiosko la sigue pudiendo llamar con la anon key.
  IF NOT has_function_privilege('anon', 'public.match_face_descriptor(vector,double precision,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '223c: anon perdió match_face_descriptor (el kiosko la usa)';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN POST-APLICACIÓN (anon key; imprimir sólo conteos)
-- ============================================================================
--   set -a; source MonacoSmartBarber/.env; set +a
--   CERO="[$(printf '0,%.0s' $(seq 1 127))0]"
--   curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/match_face_descriptor" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d "{\"query_descriptor\":\"$CERO\",\"match_threshold\":10,\"max_results\":100000}" \
--     | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'      # 0 (antes 6094)
-- Y en el local: un cliente con cara cargada se reconoce en la tablet igual que antes.
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.match_face_descriptor(query_descriptor vector, match_threshold double precision DEFAULT 0.5, max_results integer DEFAULT 3, p_org_id uuid DEFAULT NULL::uuid)
--  RETURNS TABLE(client_id uuid, client_name text, client_phone text, face_photo_url text, distance double precision)
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_org_id UUID;
-- BEGIN
--   v_org_id := COALESCE(p_org_id, get_user_org_id());
--   RETURN QUERY
--   WITH per_client AS (
--     SELECT DISTINCT ON (c.id)
--       c.id             AS cid,
--       c.name           AS cname,
--       c.phone          AS cphone,
--       c.face_photo_url AS cphoto,
--       (cfd.descriptor <-> query_descriptor)::FLOAT AS dist
--     FROM client_face_descriptors cfd
--     JOIN clients c ON c.id = cfd.client_id
--     WHERE v_org_id IS NULL OR c.organization_id = v_org_id
--     ORDER BY c.id, cfd.descriptor <-> query_descriptor
--   )
--   SELECT cid, cname, cphone, cphoto, dist
--   FROM per_client
--   WHERE dist < match_threshold
--   ORDER BY dist ASC
--   LIMIT max_results;
-- END;
-- $function$;
-- COMMENT ON FUNCTION public.match_face_descriptor(vector, double precision, integer, uuid) IS NULL;
-- COMMIT;

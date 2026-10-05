-- APLICADA en prod el 4/10/2026 (schema_migrations «223a_fugas_staff_ahora»).
-- ============================================================================
-- 223a — Fugas del staff: la parte que se puede aplicar YA (antes del deploy)
-- ============================================================================
-- APLICAR AHORA. Compatible con el bundle viejo (HEAD) y con el nuevo.
-- La 223 (con gate) la repite entera, así que si sólo se aplica la 223 queda
-- todo igual de bien.
--
-- Verificado contra producción el 4/10/2026, ejecutando como rol `anon`:
--
--  1) staff_face_descriptors.staff_face_anon_read (SELECT TO anon USING true):
--     la anon key —la que viaja en el bundle de cualquier página pública— lee
--     los 177 descriptores biométricos (128 floats cada uno) de 25 personas del
--     staff de 2 organizaciones. No queda ningún lector anónimo legítimo:
--     el único (BarberFaceCheck) no se importa en ningún lado, el kiosko
--     identifica por la RPC, y el INSERT del kiosko viejo va con
--     `Prefer: return=minimal` (postgrest-js 2.98 no pide la fila sin
--     `.select()`; PostgREST arma `RETURNING 1`, que no lee columnas y por eso
--     no evalúa policies de SELECT). Sacar la policy no rompe ese INSERT.
--
--  2) match_staff_face_descriptor (SECURITY DEFINER, EXECUTE para PUBLIC y anon):
--       · sin p_org_id (y sin JWT de staff) buscaba en TODAS las orgs;
--       · el umbral y la cantidad los elegía el que llamaba;
--       · devolvía el teléfono del barbero.
--     Con un vector en cero, umbral 10, cantidad 100000 y sin org, anon listaba
--     a los 25 barberos con cara, 17 con teléfono. Ahora: org obligatoria (la
--     que llega o la del JWT), umbral como mucho 0,5, como mucho 3 resultados,
--     sólo staff activo y sin baja, y el teléfono vuelve NULL.
--     MISMA firma y MISMO tipo de retorno (CREATE OR REPLACE conserva los
--     GRANT): el kiosko viejo llama con umbral 0,48, 1 resultado y la org de la
--     sucursal elegida, así que para él no cambia nada; del match de staff no
--     usa el teléfono (sólo id y nombre).
--
--  3) calculate_barber_salary (SECURITY DEFINER, EXECUTE para PUBLIC, anon y
--     authenticated): con la anon key y el id de cualquier barbero —la lista de
--     staff es legible con esa clave— devolvía cuánto cobra en un período, de
--     cualquier organización. Los dos únicos llamadores son
--     calculateAndSaveSalary y getCalculatedSalary (src/lib/actions/salary.ts),
--     con service role. Ninguno en la app mobile ni en las edge functions.
--
--  4) generate_commission_report (SECURITY DEFINER, EXECUTE para PUBLIC, anon y
--     authenticated) no lee: ESCRIBE una fila de comisión en salary_reports para
--     el barbero, sucursal y día que le pasen. No la llama nadie (ni el código,
--     ni otra función, ni un cron) y nunca generó un reporte.
--
-- Qué NO toca (va en la 223, con gate): el INSERT anónimo de descriptores y el
-- EXECUTE de anon sobre la RPC. El kiosko viejo usa los dos.
-- ============================================================================

BEGIN;

-- 1) Lectura anónima de biometría: fuera. Sin policy, anon recibe 200 con []
--    (no un 42501), así que nada que la nombre se rompe de golpe.
DROP POLICY IF EXISTS staff_face_anon_read ON public.staff_face_descriptors;

-- 2) La RPC, acotada. Partí del cuerpo VIVO (pg_get_functiondef, 4/10/2026).
CREATE OR REPLACE FUNCTION public.match_staff_face_descriptor(
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

  -- Umbral y cantidad los acota la base, no el que llama: con umbral alto y
  -- cantidad grande la función devolvía el staff entero sin necesitar una cara.
  -- Techo 0,5 (el default de siempre de esta función): el kiosko usa 0,48, así
  -- que para él no cambia nada. Con 0,6 la "cara promedio" de face-api queda a
  -- menos de esa distancia de casi cualquiera.
  v_umbral := LEAST(GREATEST(COALESCE(match_threshold, 0.5), 0), 0.5);
  v_limite := LEAST(GREATEST(COALESCE(max_results, 1), 1), 3);

  RETURN QUERY
  WITH por_staff AS (
    SELECT DISTINCT ON (s.id)
      s.id        AS sid,
      s.full_name AS snombre,
      (sfd.descriptor <-> query_descriptor)::double precision AS dist
    FROM staff_face_descriptors sfd
    JOIN staff s ON s.id = sfd.staff_id
    WHERE s.organization_id = v_org_id
      AND s.is_active = true
      AND s.deleted_at IS NULL
    ORDER BY s.id, sfd.descriptor <-> query_descriptor
  )
  -- El teléfono ya no sale: la tablet sólo necesita id y nombre. Las columnas
  -- se conservan (NULL) para no cambiar el tipo de retorno.
  SELECT sid, snombre, NULL::text, NULL::text, dist
  FROM por_staff
  WHERE dist < v_umbral
  ORDER BY dist ASC
  LIMIT v_limite;
END;
$function$;

COMMENT ON FUNCTION public.match_staff_face_descriptor(vector, double precision, integer, uuid) IS
  'Identifica a un miembro ACTIVO del staff de UNA organización por su descriptor facial. '
  'Org obligatoria, umbral <= 0.5, como mucho 3 resultados, nunca el teléfono (mig 223a). '
  'Desde la 223 sólo la ejecuta service_role (identificarStaffPorRostro).';

-- 3) Lo que cobra cada barbero: sólo el servidor.
REVOKE EXECUTE ON FUNCTION public.calculate_barber_salary(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_barber_salary(uuid, date, date) TO service_role;

-- 4) generate_commission_report: SECURITY DEFINER con EXECUTE para anon que
--    ESCRIBE en salary_reports (una comisión "auto-generada" para cualquier
--    barbero de cualquier org y cualquier día con cortes). Sin ningún llamador:
--    ni en el código, ni en SQL, ni en cron; nunca generó un reporte. Se le saca
--    el EXECUTE en vez de borrarla (borrar es otra decisión).
REVOKE EXECUTE ON FUNCTION public.generate_commission_report(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_commission_report(uuid, uuid, date) TO service_role;

-- ── Autoverificación: si algo no quedó, la migración entera se revierte ─────
DO $$
DECLARE
  v_org   uuid;
  v_n     integer;
  v_tel   integer;
  v_cero  vector := array_fill(0::real, ARRAY[128])::vector;
BEGIN
  -- Sin JWT en esta transacción: get_user_org_id() tiene que dar NULL para que
  -- la prueba "sin org" pruebe eso y no la org de quien aplica la migración.
  PERFORM set_config('request.jwt.claim', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename = 'staff_face_descriptors' AND policyname = 'staff_face_anon_read') THEN
    RAISE EXCEPTION '223a: staff_face_anon_read sigue existiendo';
  END IF;

  IF has_function_privilege('anon', 'public.calculate_barber_salary(uuid,date,date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.calculate_barber_salary(uuid,date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION '223a: anon/authenticated todavía ejecutan calculate_barber_salary';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.calculate_barber_salary(uuid,date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION '223a: service_role perdió calculate_barber_salary';
  END IF;
  IF has_function_privilege('anon', 'public.generate_commission_report(uuid,uuid,date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.generate_commission_report(uuid,uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION '223a: anon/authenticated todavía ejecutan generate_commission_report';
  END IF;

  -- El kiosko viejo llama con anon: tiene que poder seguir haciéndolo hasta la 223.
  IF NOT has_function_privilege('anon', 'public.match_staff_face_descriptor(vector,double precision,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '223a: anon perdió match_staff_face_descriptor (eso es de la 223, con gate)';
  END IF;

  -- Sin org no devuelve nada, aunque pidan umbral 10 y cien mil filas.
  SELECT count(*) INTO v_n FROM public.match_staff_face_descriptor(v_cero, 10, 100000, NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '223a: sin org la RPC devolvió % filas', v_n;
  END IF;

  -- Con org, como mucho 3 filas y nunca el teléfono.
  SELECT s.organization_id INTO v_org
    FROM public.staff_face_descriptors d JOIN public.staff s ON s.id = d.staff_id
   WHERE s.is_active LIMIT 1;
  IF v_org IS NOT NULL THEN
    SELECT count(*), count(client_phone) INTO v_n, v_tel
      FROM public.match_staff_face_descriptor(v_cero, 10, 100000, v_org);
    IF v_n > 3 OR v_tel > 0 THEN
      RAISE EXCEPTION '223a: la RPC devolvió % filas y % teléfonos', v_n, v_tel;
    END IF;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN POST-APLICACIÓN (con la anon key del bundle)
-- ============================================================================
--   set -a; source MonacoSmartBarber/.env; set +a
--   H=(-H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY")
--   CERO="[$(printf '0,%.0s' $(seq 1 127))0]"
--
--   # Biometría: 200 con content-range */0 (antes */177)
--   curl -s -o /dev/null -D - "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/staff_face_descriptors?select=id" \
--        -H "Prefer: count=exact" -H "Range: 0-0" "${H[@]}" | grep -i content-range
--
--   # RPC sin org, umbral 10: [] (antes 25 barberos, 17 con teléfono)
--   curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/match_staff_face_descriptor" "${H[@]}" \
--        -H "Content-Type: application/json" \
--        -d "{\"query_descriptor\":\"$CERO\",\"match_threshold\":10,\"max_results\":100000}"
--
--   # RPC con org: como mucho 3 filas, client_phone null
--   curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/match_staff_face_descriptor" "${H[@]}" \
--        -H "Content-Type: application/json" \
--        -d "{\"query_descriptor\":\"$CERO\",\"match_threshold\":10,\"max_results\":100000,\"p_org_id\":\"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11\"}"
--
--   # Sueldos y comisiones: 401 permission denied (antes 200)
--   curl -s -w ' HTTP %{http_code}\n' "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/calculate_barber_salary" "${H[@]}" \
--        -H "Content-Type: application/json" \
--        -d '{"p_staff_id":"00000000-0000-0000-0000-000000000000","p_period_start":"2026-09-01","p_period_end":"2026-09-30"}'
--
-- Y en el local, con el kiosko VIEJO: "Soy barbero" -> la cara de un barbero
-- con rostro cargado lo tiene que reconocer igual que antes. Para el registro
-- (PIN -> cara), mirar que el POST anónimo siga dando 201:
--   select log_attributes['response.status_code'] as st, count(*) from logs
--    where source = 'edge_logs' and log_attributes['request.method'] = 'POST'
--      and log_attributes['request.path'] = '/rest/v1/staff_face_descriptors'
--    group by 1
-- Si aparece cualquier 4xx ahí, recrear la policy (primera línea del rollback).
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- BEGIN;
-- CREATE POLICY staff_face_anon_read ON public.staff_face_descriptors
--   FOR SELECT TO anon USING (true);
-- GRANT EXECUTE ON FUNCTION public.calculate_barber_salary(uuid, date, date) TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.generate_commission_report(uuid, uuid, date) TO PUBLIC, anon, authenticated;
-- CREATE OR REPLACE FUNCTION public.match_staff_face_descriptor(query_descriptor vector, match_threshold double precision DEFAULT 0.5, max_results integer DEFAULT 3, p_org_id uuid DEFAULT NULL::uuid)
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
--   WITH per_staff AS (
--     SELECT DISTINCT ON (s.id)
--       s.id                   AS sid,
--       s.full_name            AS sname,
--       COALESCE(s.phone, '')  AS sphone,
--       NULL::text             AS sphoto,
--       (sfd.descriptor <-> query_descriptor)::FLOAT AS dist
--     FROM staff_face_descriptors sfd
--     JOIN staff s ON s.id = sfd.staff_id
--     WHERE v_org_id IS NULL OR s.organization_id = v_org_id
--     ORDER BY s.id, sfd.descriptor <-> query_descriptor
--   )
--   SELECT sid, sname, sphone, sphoto, dist
--   FROM per_staff
--   WHERE dist < match_threshold
--   ORDER BY dist ASC
--   LIMIT max_results;
-- END;
-- $function$;
-- COMMENT ON FUNCTION public.match_staff_face_descriptor(vector, double precision, integer, uuid) IS NULL;
-- COMMIT;

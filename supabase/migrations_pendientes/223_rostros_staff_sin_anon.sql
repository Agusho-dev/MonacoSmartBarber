-- NO APLICADA. Ver supabase/migrations_pendientes/README.md para el orden y el gate.
-- ============================================================================
-- 223 — La biometría del staff sólo la toca el servidor
-- ============================================================================
-- APLICAR CON GATE. NO ANTES DEL DEPLOY NI CON UNA TABLET SIN RECARGAR.
--
-- Hallazgo productos-y-fugas-06 (revisión del 4/10/2026, confirmado en prod):
-- `staff_face_descriptors` y `match_staff_face_descriptor` estaban abiertas a la
-- anon key que viaja en el bundle:
--   · staff_face_anon_read      SELECT TO anon USING (true): 177 descriptores
--                               biométricos de 25 personas de 2 organizaciones.
--   · staff_face_insert_active_staff  INSERT TO public, WITH CHECK "el staff
--                               está activo", sin org ni sesión: cualquiera
--                               cargaba SU cara a nombre de cualquier barbero
--                               activo de cualquiera de las 14 organizaciones,
--                               y el kiosko pasaba a reconocerlo como ese barbero.
--   · match_staff_face_descriptor  SECURITY DEFINER con EXECUTE para PUBLIC y
--                               anon: sin org buscaba en todas, umbral y cantidad
--                               a elección y devolvía el teléfono (buscador facial).
--
-- Desde este deploy el kiosko no toca nada de eso con la anon key: identifica
-- con `identificarStaffPorRostro`, verifica el PIN con `verificarPinStaffEnKiosko`
-- (emite un permiso HMAC de 5 minutos) y registra la cara con
-- `registrarRostroStaff`, todo en src/lib/actions/rostro-staff.ts con service
-- role. `loginWithPin` ya contaba las caras con service role. Queda igual que
-- `client_face_descriptors`: sin policies y sin permisos para anon ni authenticated.
--
-- Esta migración incluye la 223a entera (idempotente): aplicada sola deja todo bien.
--
-- GATE (obligatorio, en este orden):
--  1) Que el deploy con rostro-staff.ts Y el kiosko migrado esté en producción
--     (monacobarber.vercel.app lo deploya Trinkmax/monaco.barber). El kiosko
--     migrado es el que ya no importa `verifyBarberPin` ni
--     `enrollStaffFaceDescriptor`: si sigue usándolos, con esta migración el
--     registro de cara falla y un barbero NUEVO no puede entrar nunca al panel
--     (loginWithPin exige al menos una cara). Chequeo en el commit deployado:
--       grep -n "enrollStaffFaceDescriptor\|verifyBarberPin" \
--         "src/app/(tablet)/checkin/checkin-walk-in.tsx"      -> sin resultados
--     (La identificación por cara ya va por el servidor sin tocar el kiosko:
--     el cambio está en face-recognition.ts. El registro, no: por eso este paso.)
--  2) Recargar las tres tablets y las PCs (el bundle viejo inserta con anon).
--  2b) Prueba positiva, porque los registros de cara son raros y que no
--     aparezcan en los logs no prueba nada: en la tablet de la sucursal Test,
--     "Soy barbero" -> "Ingresar con PIN" -> registrar la cara de un staff de
--     prueba. Tiene que crear 3 filas en staff_face_descriptors y NO dejar un
--     POST anónimo a /rest/v1/staff_face_descriptors en edge_logs.
--  3) Correr en query_logs, sobre una ventana de local abierto posterior a la
--     recarga, y exigir 0 filas (anon, o authenticated si en una tablet quedó
--     abierta una sesión del dashboard: esta migración les saca el acceso a los dos):
--
--       select log_attributes['request.path'] as ruta,
--              log_attributes['request.method'] as metodo,
--              log_attributes['request.sb.jwt.authorization.payload.role'] as rol,
--              log_attributes['response.status_code'] as status,
--              count(*) as n
--         from logs
--        where source = 'edge_logs'
--          and log_attributes['request.sb.jwt.authorization.payload.role'] in ('anon', 'authenticated')
--          and log_attributes['request.method'] <> 'OPTIONS'
--          and log_attributes['request.path'] in ('/rest/v1/staff_face_descriptors',
--                                                 '/rest/v1/rpc/match_staff_face_descriptor')
--        group by 1, 2, 3, 4
--
--     (El 4/10/2026, antes del deploy, daba 45 POST anónimos a la RPC en 24 h:
--     cada "Soy barbero" de las tablets.) Mientras aparezca alguno, hay un
--     bundle viejo vivo: NO aplicar.
--  4) Fuera del horario del local (9 a 21), con el rollback a mano.
-- ============================================================================

BEGIN;

-- ── Lo de la 223a (idempotente) ─────────────────────────────────────────────
DROP POLICY IF EXISTS staff_face_anon_read ON public.staff_face_descriptors;

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

REVOKE EXECUTE ON FUNCTION public.calculate_barber_salary(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_barber_salary(uuid, date, date) TO service_role;

-- 4) generate_commission_report: SECURITY DEFINER con EXECUTE para anon que
--    ESCRIBE en salary_reports (una comisión "auto-generada" para cualquier
--    barbero de cualquier org y cualquier día con cortes). Sin ningún llamador:
--    ni en el código, ni en SQL, ni en cron; nunca generó un reporte. Se le saca
--    el EXECUTE en vez de borrarla (borrar es otra decisión).
REVOKE EXECUTE ON FUNCTION public.generate_commission_report(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_commission_report(uuid, uuid, date) TO service_role;

-- ── Lo propio de la 223 ─────────────────────────────────────────────────────
-- Ninguna policy: con RLS prendida y sin policies, anon y authenticated no ven
-- ni escriben nada; service_role no pasa por RLS (es el único camino legítimo:
-- rostro-staff.ts y el conteo de caras de loginWithPin).
DROP POLICY IF EXISTS staff_face_insert_active_staff ON public.staff_face_descriptors;
DROP POLICY IF EXISTS staff_face_auth_read ON public.staff_face_descriptors;
DROP POLICY IF EXISTS staff_face_delete_by_org ON public.staff_face_descriptors;
ALTER TABLE public.staff_face_descriptors ENABLE ROW LEVEL SECURITY;

-- Y sin permisos, como client_face_descriptors: no hay lector ni escritor
-- legítimo con esas claves (ni en el dashboard, ni en la app mobile, ni en las
-- edge functions). Un 42501 acá es un llamador viejo que hay que encontrar,
-- no algo que deba "andar vacío" en silencio.
REVOKE ALL ON public.staff_face_descriptors FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.staff_face_descriptors TO service_role;

-- La RPC: sólo el servidor.
REVOKE EXECUTE ON FUNCTION public.match_staff_face_descriptor(vector, double precision, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_staff_face_descriptor(vector, double precision, integer, uuid) TO service_role;

COMMENT ON TABLE public.staff_face_descriptors IS
  'Descriptores faciales del staff (biometría). Sin policies ni permisos para anon/authenticated '
  '(mig 223): se leen y escriben sólo con service role desde src/lib/actions/rostro-staff.ts '
  'y src/lib/actions/auth.ts.';

-- ── Autoverificación ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_rol   text;
  v_priv  text;
  v_org   uuid;
  v_n     integer;
  v_tel   integer;
  v_cero  vector := array_fill(0::real, ARRAY[128])::vector;
BEGIN
  PERFORM set_config('request.jwt.claim', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'staff_face_descriptors') THEN
    RAISE EXCEPTION '223: staff_face_descriptors todavía tiene policies';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.staff_face_descriptors'::regclass) THEN
    RAISE EXCEPTION '223: staff_face_descriptors quedó sin RLS';
  END IF;

  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(v_rol, 'public.staff_face_descriptors', v_priv) THEN
        RAISE EXCEPTION '223: % conserva % sobre staff_face_descriptors', v_rol, v_priv;
      END IF;
    END LOOP;
    IF has_function_privilege(v_rol, 'public.match_staff_face_descriptor(vector,double precision,integer,uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '223: % todavía ejecuta match_staff_face_descriptor', v_rol;
    END IF;
    IF has_function_privilege(v_rol, 'public.calculate_barber_salary(uuid,date,date)', 'EXECUTE') THEN
      RAISE EXCEPTION '223: % todavía ejecuta calculate_barber_salary', v_rol;
    END IF;
    IF has_function_privilege(v_rol, 'public.generate_commission_report(uuid,uuid,date)', 'EXECUTE') THEN
      RAISE EXCEPTION '223: % todavía ejecuta generate_commission_report', v_rol;
    END IF;
  END LOOP;

  IF NOT (has_table_privilege('service_role', 'public.staff_face_descriptors', 'SELECT')
          AND has_table_privilege('service_role', 'public.staff_face_descriptors', 'INSERT')
          AND has_function_privilege('service_role', 'public.match_staff_face_descriptor(vector,double precision,integer,uuid)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.calculate_barber_salary(uuid,date,date)', 'EXECUTE')) THEN
    RAISE EXCEPTION '223: service_role perdió algo que necesita';
  END IF;

  SELECT count(*) INTO v_n FROM public.match_staff_face_descriptor(v_cero, 10, 100000, NULL);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '223: sin org la RPC devolvió % filas', v_n;
  END IF;
  SELECT s.organization_id INTO v_org
    FROM public.staff_face_descriptors d JOIN public.staff s ON s.id = d.staff_id
   WHERE s.is_active LIMIT 1;
  IF v_org IS NOT NULL THEN
    SELECT count(*), count(client_phone) INTO v_n, v_tel
      FROM public.match_staff_face_descriptor(v_cero, 10, 100000, v_org);
    IF v_n > 3 OR v_tel > 0 THEN
      RAISE EXCEPTION '223: la RPC devolvió % filas y % teléfonos', v_n, v_tel;
    END IF;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- ============================================================================
-- Con la anon key (las dos tienen que dar 401 "permission denied"; después de
-- la 223a y antes de ésta daban 200 [] y 200 con a lo sumo 3 filas):
--   set -a; source MonacoSmartBarber/.env; set +a
--   H=(-H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY")
--   CERO="[$(printf '0,%.0s' $(seq 1 127))0]"
--   curl -s -w ' HTTP %{http_code}\n' "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/staff_face_descriptors?select=id&limit=1" "${H[@]}"
--   curl -s -w ' HTTP %{http_code}\n' "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/match_staff_face_descriptor" "${H[@]}" \
--        -H "Content-Type: application/json" -d "{\"query_descriptor\":\"$CERO\",\"p_org_id\":\"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11\"}"
-- (No se prueba un INSERT anónimo con curl: antes y después daría 401 igual
--  —antes por el WITH CHECK, ahora por el permiso— y no distingue nada.)
--
-- En SQL:
--   select policyname from pg_policies where tablename = 'staff_face_descriptors';   -- 0 filas
--   select relacl from pg_class where oid = 'public.staff_face_descriptors'::regclass; -- sólo postgres y service_role
--   select proacl from pg_proc where proname = 'match_staff_face_descriptor';          -- sólo postgres y service_role
--
-- En el local, con el kiosko NUEVO (después de recargar):
--   · "Soy barbero" -> mirar la cámara: un barbero con cara cargada entra a
--     "¿Qué querés registrar?" igual que antes.
--   · "Soy barbero" -> "Ingresar con PIN" -> PIN -> registrar la cara -> fichar.
--     Después, en SQL: select count(*) from staff_face_descriptors
--     where created_at > now() - interval '10 minutes';   -- las 3 capturas nuevas
--   · Un barbero nuevo (sin cara) entra a /barbero/login con su PIN después de
--     registrarse en la tablet (loginWithPin cuenta las caras con service role).
--
-- ============================================================================
-- ROLLBACK (vuelve al estado de la 223a; para volver más atrás, el de la 223a)
-- ============================================================================
-- BEGIN;
-- GRANT ALL ON public.staff_face_descriptors TO anon, authenticated;
-- CREATE POLICY staff_face_auth_read ON public.staff_face_descriptors FOR SELECT TO authenticated
--   USING (staff_id IN (SELECT staff.id FROM staff WHERE staff.organization_id = get_user_org_id()));
-- CREATE POLICY staff_face_delete_by_org ON public.staff_face_descriptors FOR DELETE TO public
--   USING (staff_id IN (SELECT staff.id FROM staff WHERE staff.organization_id = get_user_org_id()));
-- CREATE POLICY staff_face_insert_active_staff ON public.staff_face_descriptors FOR INSERT TO public
--   WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = staff_face_descriptors.staff_id AND staff.is_active = true));
-- GRANT EXECUTE ON FUNCTION public.match_staff_face_descriptor(vector, double precision, integer, uuid) TO PUBLIC, anon, authenticated;
-- COMMENT ON TABLE public.staff_face_descriptors IS NULL;
-- COMMIT;

-- NO APLICADA. Ver supabase/migrations_pendientes/README.md para el orden y el gate.
-- ============================================================================
-- 224 — El teléfono y la comisión del staff dejan de ser legibles con la anon key
-- ============================================================================
-- APLICAR CON GATE. NO ANTES DEL DEPLOY NI CON UNA TABLET SIN RECARGAR.
--
-- Hallazgos productos-y-fugas-07 y seguridad-y-despliegue-08 (revisión del
-- 4/10/2026, confirmados en prod): con la anon key que viaja en el bundle,
--   GET /rest/v1/staff?select=organization_id,phone,commission_pct
--   → 200 · 52 filas · 14 organizaciones · 24 teléfonos personales · 52 comisiones.
-- La causa es la misma que la de la mig 212: la policy staff_read_by_org deja a
-- anon ver el staff activo de TODAS las orgs (get_user_org_id() es NULL), y la
-- 212 le volvió a otorgar `phone` y `commission_pct` columna por columna.
-- Ninguna pantalla anónima los usa: el kiosko, el login y el panel del barbero
-- dibujan nombre, foto y estado.
--
-- `anon` ya no tiene SELECT de TABLA sobre staff (mig 212), así que esto es un
-- REVOKE por columna, que sí surte efecto (no es el no-op del primer intento de
-- la 212).
--
-- Lo que se revisó para que no se repita el 10/9 (Known Risk #34):
--  · Toda consulta anónima que NOMBRE una columna revocada da 42501 y se lleva
--    la lista entera. Las que las nombraban (todas del bundle viejo):
--      src/app/barbero/login/page.tsx            staff: phone, commission_pct
--      src/app/(tablet)/checkin/checkin-walk-in.tsx  staff (PIN): phone, commission_pct
--                                                QUEUE_ENTRY_SELECT: commission_pct
--      src/components/barber/queue-panel.tsx     staff: phone, commission_pct
--    El deploy de esta ola tiene que sacarlas de las cuatro: la del login ya
--    está; las del kiosko y la del panel son cambios exactos que aplican esas
--    áreas (y la del panel necesita que Staff.phone/commission_pct pasen a
--    opcionales en src/lib/types/database.ts). Ninguna otra consulta anónima de
--    staff (directa o embebida) las pide; `select('*')` de anon ya no existe
--    desde la 212.
--  · Policies: ninguna lee staff.phone ni staff.commission_pct (pg_policies).
--  · Funciones SECURITY INVOKER: la única que lee staff.commission_pct es el
--    trigger on_queue_completed, que corre con el rol del UPDATE de
--    queue_entries; anon no puede actualizar queue_entries (la policy
--    queue_entries_manage_by_org exige la org del JWT o service_role) y el
--    cobro (completeService) va con service role.
--  · Vistas: branch_occupancy (security_invoker, legible por anon) no usa esas
--    columnas; queue_abandonos y v_assistant_staff no son legibles por anon.
--  · Realtime (postgres_changes sobre staff desde el kiosko y el panel):
--    realtime.apply_rls descarta las columnas que el rol no puede leer
--    (has_column_privilege) en vez de cortar la suscripción; es lo que ya pasa
--    con pin/email/auth_user_id desde la 212.
--
-- Fuera de alcance, a propósito: `authenticated` sigue leyendo estas columnas
-- (las usa el dashboard). Ver la 224b para el PIN, que es lo urgente ahí.
--
-- GATE (obligatorio, en este orden):
--  1) Deploy en producción con las cuatro consultas de arriba sin phone ni
--     commission_pct (login, kiosko x2, panel). Chequeo en el commit deployado:
--       node scratchpad/arreglos/fugas-staff/inventario_staff.mjs --sensibles | grep BROWSER
--     no puede listar ninguna consulta con phone ni commission_pct (antes de
--     esta ola listaba las cuatro).
--  2) Recargar las tres tablets y las PCs.
--  2b) Prueba positiva en la tablet de Test (el paso del PIN y "ya estás en la
--     fila" se usan poco y su ausencia en los logs no prueba nada): abrir
--     "Soy barbero" -> "Ingresar con PIN" (tiene que listar los barberos) y
--     anotar un cliente de prueba y volver a identificarlo ("ya estás en la fila").
--  3) Correr en query_logs, sobre una ventana de local abierto posterior a la
--     recarga, y exigir 0 filas:
--
--       select log_attributes['request.path'] as ruta, count(*) as n
--         from logs
--        where source = 'edge_logs'
--          and log_attributes['request.sb.jwt.authorization.payload.role'] = 'anon'
--          and log_attributes['request.method'] in ('GET', 'HEAD')
--          and match(multiIf(
--                log_attributes['request.path'] = '/rest/v1/staff',
--                  extract(decodeURLComponent(log_attributes['request.search']), 'select=([^&]*)'),
--                extract(decodeURLComponent(log_attributes['request.search']), 'staff(?:![a-z_]+)?\\(([^)]*)\\)')),
--              '(^|[,(])\\s*(phone|commission_pct)\\s*([,)]|$)')
--        group by 1
--
--     El 4/10/2026, antes del deploy, daba 137 GET a /rest/v1/staff y 4 a
--     /rest/v1/queue_entries en 24 h. Cualquier fila = bundle viejo vivo: NO aplicar.
--  4) Antes y después, las consultas REALES con la anon key (lista al pie):
--     antes tienen que dar 200, y después también.
--  5) Fuera del horario del local (9 a 21), con el GRANT de vuelta a mano.
-- ============================================================================

BEGIN;

REVOKE SELECT (phone, commission_pct) ON public.staff FROM anon;

-- ── Autoverificación ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_col text;
BEGIN
  IF has_table_privilege('anon', 'public.staff', 'SELECT') THEN
    -- Con SELECT de tabla, el REVOKE por columna no sirve de nada (lo que pasó
    -- con el primer intento de la 212).
    RAISE EXCEPTION '224: anon tiene SELECT de TABLA sobre staff: el REVOKE por columna sería un no-op';
  END IF;

  FOREACH v_col IN ARRAY ARRAY['phone', 'commission_pct', 'pin', 'email', 'auth_user_id'] LOOP
    IF has_column_privilege('anon', 'public.staff', v_col, 'SELECT') THEN
      RAISE EXCEPTION '224: anon todavía lee staff.%', v_col;
    END IF;
  END LOOP;

  -- Lo que el kiosko, el login y el panel siguen pidiendo tiene que seguir ahí.
  FOREACH v_col IN ARRAY ARRAY['id', 'full_name', 'branch_id', 'role', 'role_id', 'status',
                               'avatar_url', 'hidden_from_checkin', 'hidden_from_mobile',
                               'is_active', 'is_also_barber', 'organization_id',
                               'created_at', 'updated_at', 'deleted_at'] LOOP
    IF NOT has_column_privilege('anon', 'public.staff', v_col, 'SELECT') THEN
      RAISE EXCEPTION '224: anon perdió staff.% (la necesitan el kiosko y el panel)', v_col;
    END IF;
  END LOOP;

  -- Ninguna policy puede depender de las columnas revocadas: para anon daría
  -- 42501 en cualquier consulta que la evalúe (lo que le pasó a products con la 212).
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE (coalesce(qual, '') || coalesce(with_check, '')) ~* '\mstaff\M'
                AND (coalesce(qual, '') || coalesce(with_check, '')) ~* '\m(phone|commission_pct)\M') THEN
    RAISE EXCEPTION '224: hay una policy que lee staff.phone o staff.commission_pct';
  END IF;

  -- Ni una vista security_invoker legible por anon que las use.
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
                AND coalesce(c.reloptions::text, '') ~* 'security_invoker=(true|on|1)'
                AND has_table_privilege('anon', c.oid, 'SELECT')
                AND pg_get_viewdef(c.oid) ~* '\mstaff\M'
                AND pg_get_viewdef(c.oid) ~* '\m(phone|commission_pct)\M') THEN
    RAISE EXCEPTION '224: una vista security_invoker legible por anon usa esas columnas';
  END IF;
END $$;

COMMENT ON COLUMN public.staff.phone IS
  'Teléfono personal del miembro del staff. NO legible por anon (mig 224): el kiosko, '
  'el login y el panel del barbero piden columnas explícitas sin esta.';
COMMENT ON COLUMN public.staff.commission_pct IS
  'Comisión global del barbero (fallback de salary_configs). NO legible por anon (mig 224).';

COMMIT;

-- ============================================================================
-- CONSULTAS REALES CON LA ANON KEY (antes y después: 200 las cinco)
-- ============================================================================
--   set -a; source MonacoSmartBarber/.env; set +a
--   A() { curl -s -G "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/$1" "${@:2}" \
--         -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--         -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" -o /dev/null -w "%{http_code}\n"; }
--   B=1264eb6e-bb7e-4c71-9110-a8b3f3acec12   # Rondeau
--   ORG=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11
--
--   # 1. Login del barbero (src/app/barbero/login/page.tsx)
--   A staff --data-urlencode "select=id,full_name" --data-urlencode "branch_id=eq.$B" \
--     --data-urlencode "role=eq.barber" --data-urlencode "is_active=eq.true" --data-urlencode "order=full_name"
--   # 2. Kiosko, lista para el PIN (checkin-walk-in.tsx, paso staff_pin)
--   A staff --data-urlencode "select=id,full_name,branch_id,role,role_id,status,avatar_url,hidden_from_checkin,hidden_from_mobile,is_active,is_also_barber,organization_id,created_at,updated_at,deleted_at" \
--     --data-urlencode "branch_id=eq.$B" --data-urlencode "role=in.(barber,admin,owner)" --data-urlencode "is_active=eq.true" --data-urlencode "order=full_name"
--   # 3. Kiosko, "ya estás en la fila" (QUEUE_ENTRY_SELECT sin commission_pct)
--   A queue_entries --data-urlencode "select=*,barber:staff!queue_entries_barber_id_fkey(id,full_name,status,is_active,branch_id,role,avatar_url,created_at,updated_at)" \
--     --data-urlencode "branch_id=eq.$B" --data-urlencode "status=in.(waiting,in_progress)"
--   # 4. Panel del barbero, lista de barberos (queue-panel.tsx)
--   A staff --data-urlencode "select=id,full_name,branch_id,role,role_id,status,avatar_url,hidden_from_checkin,hidden_from_mobile,is_active,is_also_barber,organization_id,created_at,updated_at,deleted_at" \
--     --data-urlencode "branch_id=eq.$B" --data-urlencode "or=(role.eq.barber,is_also_barber.eq.true)" --data-urlencode "is_active=eq.true" --data-urlencode "order=full_name"
--   # 5. Panel del barbero, la fila (queue-panel.tsx, embed sin columnas sensibles)
--   A queue_entries --data-urlencode "select=*,client:clients(id,name,phone,loyalty:client_loyalty_state(total_visits,tier_code,visits_in_window)),barber:staff(id,full_name,avatar_url),service:services(id,name,duration_minutes,price)" \
--     --data-urlencode "branch_id=eq.$B" --data-urlencode "status=in.(waiting,in_progress)"
--
-- Y las que tienen que pasar a 401 DESPUÉS (antes daban 200):
--   A staff --data-urlencode "select=full_name,phone"
--   A staff --data-urlencode "select=full_name,commission_pct"
--   A staff --data-urlencode "select=id,full_name,branch_id,role,role_id,status,avatar_url,hidden_from_checkin,hidden_from_mobile,is_active,is_also_barber,organization_id,phone,commission_pct,created_at,updated_at,deleted_at" \
--     --data-urlencode "branch_id=eq.$B"     # la del bundle VIEJO: por eso el gate
--
-- El script completo, con la comparación de antes y después, está en
-- scratchpad/arreglos/fugas-staff/curls_224.sh.
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- GRANT SELECT (phone, commission_pct) ON public.staff TO anon;
-- COMMENT ON COLUMN public.staff.phone IS NULL;
-- COMMENT ON COLUMN public.staff.commission_pct IS NULL;

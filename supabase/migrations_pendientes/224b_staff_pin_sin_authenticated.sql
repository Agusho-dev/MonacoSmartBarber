-- NO APLICADA. Ver supabase/migrations_pendientes/README.md para el orden y el gate.
-- ============================================================================
-- 224b — El PIN del staff deja de ser legible con CUALQUIER sesión de la app
-- ============================================================================
-- APLICAR DESPUÉS DEL DEPLOY que cambia src/app/dashboard/equipo/page.tsx
-- (sus dos `select('*')` de staff pasan a columnas explícitas sin `pin`).
-- Sin ese cambio, /dashboard/equipo da 42501 y no carga. Chequeo en el commit
-- deployado: ninguna lectura de staff con la sesión (createClient) puede pedir
-- `*` ni `pin`:
--   node scratchpad/arreglos/fugas-staff/inventario_por_cliente.mjs \
--     | grep -E "^(SERVER-RLS|BROWSER)" | grep -E "\-> (\*|.*\bpin\b)"   -> sin resultados
--   (antes del cambio lista equipo/page.tsx:53 y :88)
-- Con Skew Protection, una pestaña del dashboard abierta desde antes del deploy
-- sigue pegándole al deployment viejo: /dashboard/equipo le falla hasta que
-- recarga. Los kioskos y el panel no se enteran (no leen staff como authenticated).
--
-- HALLAZGO NUEVO (no estaba en la revisión; encontrado el 4/10/2026 al cerrar
-- la 224 y confirmado contra prod ejecutando como `authenticated` con un JWT de
-- cliente de la app, `app_metadata.user_type = 'client'`):
--
--   select count(*), count(pin), count(email), count(phone),
--          count(distinct organization_id) from staff;
--   → 52 filas · 38 PINs · 39 emails · 24 teléfonos · 14 organizaciones
--
-- La 212 le sacó el PIN a `anon` y dejó a `authenticated` adentro a propósito,
-- con esta justificación: "para ese rol get_user_org_id() NO es NULL, así que la
-- policy ya lo acota a su propia organización". Es falso desde la mig 192:
-- get_user_org_id() devuelve NULL para los JWT de clientes (y para cualquier
-- usuario autenticado sin staff ni membresía), así que la segunda rama de
-- staff_read_by_org —la que existe para el kiosko anónimo— los deja ver el staff
-- activo de TODAS las organizaciones, y `authenticated` tiene SELECT de TABLA
-- (todas las columnas). Desde la mig 210 cualquiera crea esa cuenta con Google o
-- Apple. Con un PIN robado y en horario de trabajo (loginWithPin exige cara
-- cargada y fichada abierta, que un barbero activo tiene), se entra a /barbero
-- como ese barbero: es exactamente el escenario de la 212.
--
-- Qué hace: `authenticated` pasa de SELECT de tabla a SELECT por columna, con
-- todas las columnas MENOS `pin`. Mismo mecanismo que la 212 para anon.
--
-- Lo que se revisó para que no se repita el 10/9 (Known Risk #34):
--  · Consultas con `authenticated` que piden `pin` o `*` sobre staff:
--      src/app/dashboard/equipo/page.tsx:53   select('*')                  <- prerrequisito
--      src/app/dashboard/equipo/page.tsx:88   select('*, branch:branches(*)') <- prerrequisito
--    Las demás (layout, caja, comprobantes, finanzas, receipts, roles,
--    fila-client) piden columnas explícitas sin pin. La app mobile embebe
--    `barber:barber_id(id, full_name, avatar_url)` y `staff:barber_id(full_name,
--    avatar_url)`. Las edge functions no leen staff. Todo lo que lee el PIN
--    (loginWithPin, verifyBarberPin, verificarPinStaffEnKiosko, /dashboard/barberos)
--    va con service role.
--  · UPDATE de staff con authenticated (assignRoleToStaff) no pide la fila de
--    vuelta (`return=minimal`) y filtra por id/organization_id, que siguen.
--  · Policies: ninguna lee staff.pin. Las que leen staff.auth_user_id,
--    organization_id, role, is_active, branch_id o id (muchas) siguen andando.
--  · Funciones SECURITY INVOKER que leen staff (enforce_staff_limit,
--    get_available_barbers_today, on_queue_completed, menor_espera_nombre_barbero):
--    ninguna toca pin.
--  · Realtime descarta la columna (has_column_privilege) en vez de cortar.
--
-- Consecuencia para el futuro (igual que con anon desde la 212): una columna
-- NUEVA en staff no la lee nadie con sesión hasta que su migración haga
-- `GRANT SELECT (columna) ON public.staff TO authenticated` (y a anon si la usa
-- el kiosko o el panel). Sin eso, el select del dashboard que la nombre da 42501.
--
-- Fuera de alcance, y anotado como deuda: email y phone del staff siguen
-- legibles para un JWT de cliente (el dashboard los lee con authenticated:
-- layout.tsx lee email). Cerrarlos es mover esas lecturas a service role primero.
-- ============================================================================

BEGIN;

REVOKE SELECT ON public.staff FROM authenticated;
GRANT SELECT (
  id, auth_user_id, branch_id, role, full_name, email, commission_pct,
  is_active, created_at, updated_at, status, phone, role_id, avatar_url,
  hidden_from_checkin, organization_id, deleted_at, is_also_barber,
  hidden_from_mobile
) ON public.staff TO authenticated;

DO $$
DECLARE
  v_col text;
  v_faltan text;
BEGIN
  IF has_table_privilege('authenticated', 'public.staff', 'SELECT') THEN
    RAISE EXCEPTION '224b: authenticated conserva SELECT de TABLA sobre staff';
  END IF;
  IF has_column_privilege('authenticated', 'public.staff', 'pin', 'SELECT') THEN
    RAISE EXCEPTION '224b: authenticated todavía lee staff.pin';
  END IF;
  IF has_column_privilege('anon', 'public.staff', 'pin', 'SELECT') THEN
    RAISE EXCEPTION '224b: anon lee staff.pin (se revirtió la 212?)';
  END IF;

  -- Todas las demás columnas, incluidas las que agregue una migración futura
  -- antes de ésta, tienen que seguir legibles: si falta alguna, un select
  -- explícito del dashboard daría 42501.
  SELECT string_agg(a.attname, ', ') INTO v_faltan
    FROM pg_attribute a
   WHERE a.attrelid = 'public.staff'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'pin'
     AND NOT has_column_privilege('authenticated', 'public.staff', a.attname, 'SELECT');
  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION '224b: authenticated perdió staff.(%): agregalas al GRANT', v_faltan;
  END IF;

  -- Las escrituras del dashboard no cambian.
  IF NOT (has_table_privilege('authenticated', 'public.staff', 'UPDATE')
          AND has_table_privilege('authenticated', 'public.staff', 'INSERT')) THEN
    RAISE EXCEPTION '224b: authenticated perdió INSERT/UPDATE sobre staff';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE (coalesce(qual, '') || coalesce(with_check, '')) ~* '\mstaff\M'
                AND (coalesce(qual, '') || coalesce(with_check, '')) ~* '\mpin\M') THEN
    RAISE EXCEPTION '224b: hay una policy que lee staff.pin';
  END IF;
END $$;

COMMENT ON COLUMN public.staff.pin IS
  'Credencial del panel del barbero. NO legible por anon (mig 212) ni por authenticated '
  '(mig 224b: los JWT de clientes de la app tienen get_user_org_id() NULL y veían el staff '
  'de todas las orgs). Se verifica server-side con service role. Nunca select(*) de staff '
  'con un cliente que no sea service role.';

COMMIT;

-- ============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- ============================================================================
-- En SQL, simulando un cliente de la app (sólo lectura):
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000000","app_metadata":{"user_type":"client"}}', true);
--   select count(*) from staff;                -- sigue andando (52)
--   select count(pin) from staff;              -- ERROR 42501 permission denied
--   rollback;
--
-- En el dashboard (con un owner logueado): /dashboard/equipo carga la lista y
-- los perfiles; /dashboard/caja y /dashboard/comprobantes abren; asignar un rol
-- desde Equipo -> Roles guarda.
-- En la app mobile: "Mis turnos" sigue mostrando "Te atiende <barbero>" y el
-- historial de visitas el nombre del barbero.
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- BEGIN;
-- GRANT SELECT ON public.staff TO authenticated;
-- COMMENT ON COLUMN public.staff.pin IS
--   'Credencial del panel del barbero. NO legible por `anon` (mig 212): se verifica '
--   'server-side con service role en loginWithPin / verifyBarberPin. Cualquier consulta '
--   'del kiosko o del panel tiene que pedir columnas explícitas, nunca select(*).';
-- COMMIT;

-- 212 — El PIN de los barberos deja de ser legible con la anon key
--
-- Verificado contra producción el 4/9/2026 con un `curl` usando la MISMA clave que
-- viaja en el bundle de JavaScript de la app:
--
--   GET /rest/v1/staff?select=id,full_name,pin,organization_id&limit=200
--   → 200 OK · 50 filas · 36 con PIN legible · 14 organizaciones distintas
--
-- Con eso cualquiera entra a /barbero de cualquier local de cualquier cliente de la
-- plataforma, toma clientes, cobra y cancela gente de la fila. Y envenena la
-- auditoría que agregó la mig 211: un `cancelled_by` escrito con un PIN robado apunta
-- al barbero suplantado, que es peor que no tener auditoría.
--
-- La causa es la policy `staff_read_by_org`:
--     (organization_id = get_user_org_id())
--     OR (is_active AND NOT hidden_from_checkin AND get_user_org_id() IS NULL)
-- Para `anon`, `get_user_org_id()` es NULL, así que entra por la segunda rama y ve el
-- staff activo de TODAS las organizaciones. Esa rama existe por una razón legítima: la
-- tablet de check-in y el panel del barbero corren con `anon` (se autentican por PIN,
-- no por Supabase Auth) y necesitan listar los barberos de la sucursal.
--
-- Lo que NO necesitan es la credencial. RLS filtra filas, no columnas: el corte por
-- columna se hace con GRANT.

BEGIN;

-- `anon` ya no puede leer la credencial ni los identificadores de cuenta. El resto de
-- las columnas (nombre, avatar, rol, estado) siguen disponibles: es lo que dibuja la
-- tablet y el panel.
REVOKE SELECT (pin, email, auth_user_id) ON public.staff FROM anon;

-- Nota deliberada sobre `authenticated`: NO se le revoca acá. Para ese rol
-- `get_user_org_id()` NO es NULL, así que la policy ya lo acota a su propia
-- organización, y hay varios `select('*')` en el dashboard (p. ej.
-- src/app/dashboard/equipo/page.tsx) que un REVOKE por columna rompería en el acto —
-- en Postgres, `SELECT *` exige el permiso sobre TODAS las columnas. Cerrarlo también
-- para `authenticated` es correcto, pero es un cambio con call-sites que hay que
-- migrar uno por uno; va aparte y no en caliente.

COMMENT ON COLUMN public.staff.pin IS
  'Credencial del panel del barbero. NO legible por `anon` (mig 212): se verifica '
  'server-side con service role en loginWithPin / verifyBarberPin. Cualquier consulta '
  'del kiosko o del panel tiene que pedir columnas explícitas, nunca select(*).';

COMMIT;

-- ── Corrección aplicada minutos después (la de arriba NO alcanzó) ────────────
-- El REVOKE por columna fue un no-op: `anon` tenía además un GRANT SELECT sobre la
-- TABLA, y en Postgres ése se evalúa por encima del permiso de columna. Verificado
-- después de aplicarla: los 36 PINs seguían saliendo. La forma correcta es quitar el
-- permiso de tabla y volver a otorgarlo columna por columna.
BEGIN;

REVOKE SELECT ON public.staff FROM anon;

GRANT SELECT (
  id, full_name, branch_id, role, role_id, status, avatar_url,
  hidden_from_checkin, hidden_from_mobile, is_active, is_also_barber,
  organization_id, phone, commission_pct, created_at, updated_at, deleted_at
) ON public.staff TO anon;

COMMIT;

-- Call-sites que hubo que migrar en el mismo commit, porque con este GRANT un
-- `select('*')` de `anon` pasa a devolver 42501 "permission denied for table staff":
--   src/app/barbero/login/page.tsx          (listaba barberos con select("*") — habría
--                                            dejado la pantalla de login VACÍA)
--   src/app/(tablet)/checkin/checkin-walk-in.tsx  (select('*') + QUEUE_ENTRY_SELECT,
--                                            que pedía email/pin/auth_user_id a mano)
--   src/components/barber/queue-panel.tsx   (select('*'))
--   src/lib/actions/auth.ts                 (loginWithPin leía el PIN con el cliente RLS)

-- (schema_migrations «225_sucursales_alta_desde_dashboard»)
-- ============================================================================
-- 225 — El alta de sucursales desde /dashboard/sucursales vuelve a andar
-- ============================================================================
-- APLICADA en prod el 4/10/2026 (domingo, local cerrado).
--
-- Síntoma (reportado por el dueño): "completo el formulario pero no se crea".
-- Causa, confirmada en edge_logs: POST /rest/v1/branches → 403 (4/10, 21:20).
-- El formulario (src/app/dashboard/sucursales/sucursales-client.tsx en HEAD)
-- insertaba DESDE EL BROWSER, sin organization_id y sin mirar el error. La
-- policy branches_manage_by_org_admin exige organization_id = get_user_org_id()
-- y la fila llegaba con NULL: RLS la rechazaba y el diálogo se cerraba como si
-- hubiera guardado. branches era de las pocas tablas con organization_id sin el
-- trigger set_org_from_session (lo tienen app_settings, appointments, roles…).
--
-- Además, el slug (UNIQUE global) se elegía en fn_branches_set_slug con los
-- permisos de quien inserta: por RLS un usuario del dashboard no ve las
-- sucursales de otras organizaciones, así que un nombre repetido en otra org
-- chocaba contra el índice único (otro 409 mudo).
--
-- El código nuevo (createBranch/updateBranch/deleteBranch, server actions con
-- service role, validación y errores visibles) ya no depende de esto, pero el
-- trigger deja andando el formulario de HEAD sin esperar el deploy, y no le
-- cambia nada a las altas que ya traen la org (WHEN NEW.organization_id IS NULL).
--
-- Verificado contra prod, en transacciones revertidas: con el JWT del owner el
-- INSERT del formulario viejo crea la sucursal con la org de Monaco, slug y
-- timezone; y el armado completo de una sucursal nueva (barbero, horario,
-- servicio, cuenta de cobro, descanso y sueldo) entra sin errores.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- 1) La org de la sesión cuando el alta no la manda. "trg_00_…" para correr
--    ANTES que los triggers de límite (leen NEW.organization_id) y que el del
--    slug: los BEFORE se disparan por orden alfabético del nombre.
CREATE OR REPLACE TRIGGER trg_00_branches_set_org
  BEFORE INSERT ON public.branches
  FOR EACH ROW
  WHEN (NEW.organization_id IS NULL)
  EXECUTE FUNCTION public.set_org_from_session();

-- 2) El slug se elige mirando TODAS las sucursales (es UNIQUE global).
ALTER FUNCTION public.fn_branches_set_slug() SECURITY DEFINER;
ALTER FUNCTION public.fn_branches_set_slug() SET search_path = public, pg_temp;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.branches'::regclass
     AND t.tgname = 'trg_00_branches_set_org'
     AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF v_def IS NULL OR v_def NOT LIKE '%BEFORE INSERT%' OR v_def NOT LIKE '%set_org_from_session%' THEN
    RAISE EXCEPTION '225: el trigger de org en branches no quedó: %', v_def;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_branches_set_slug()'::regprocedure) THEN
    RAISE EXCEPTION '225: fn_branches_set_slug no quedó SECURITY DEFINER';
  END IF;
  IF (SELECT min(tgname) FROM pg_trigger WHERE tgrelid = 'public.branches'::regclass AND NOT tgisinternal) <> 'trg_00_branches_set_org' THEN
    RAISE EXCEPTION '225: el trigger de org no es el primero en dispararse';
  END IF;
END $$;

COMMIT;

-- Rollback (no hace falta con el código nuevo, pero el formulario de HEAD
-- vuelve a fallar sin el trigger):
--   (sacar el trigger trg_00_branches_set_org de public.branches)
--   ALTER FUNCTION public.fn_branches_set_slug() SECURITY INVOKER;
--   ALTER FUNCTION public.fn_branches_set_slug() RESET search_path;

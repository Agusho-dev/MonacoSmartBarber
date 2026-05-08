-- =============================================================================
-- Migración 130: wrapper público get_fair_barber para que el cliente lea quién
-- es el "más justo" según el server y filtre las asignaciones locales.
-- =============================================================================
-- Contexto: la mig 129 agregó `compute_fair_barber(branch_id, branch_tz)` para
-- el fairness gate del RPC. El cliente necesita poder leer ese valor para
-- ocultar dinámicas en "Mi fila" cuando el server diga que otro barbero es el
-- más justo. Este wrapper resuelve la TZ desde el branch automáticamente y
-- expone un GRANT EXECUTE público para anon/authenticated/service_role.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_fair_barber(p_branch_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_tz TEXT;
BEGIN
  SELECT COALESCE(timezone, 'America/Argentina/Buenos_Aires')
    INTO v_branch_tz
  FROM branches WHERE id = p_branch_id;

  IF v_branch_tz IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.compute_fair_barber(p_branch_id, v_branch_tz);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_fair_barber(UUID) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.get_fair_barber(UUID) IS
  'Wrapper público de compute_fair_barber. Resuelve la TZ del branch y devuelve el id del barbero "más justo" elegible para tomar el próximo cliente dinámico, o NULL si no hay elegibles.';

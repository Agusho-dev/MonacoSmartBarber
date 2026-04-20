-- F6: RPCs para contar clientes nuevos y totales por sucursal
-- "Nuevo": cliente cuya PRIMERA visita (en toda la org, o en la sucursal si se filtra) cae en el periodo

CREATE OR REPLACE FUNCTION count_new_clients_scoped(
  p_org_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH org_branches AS (
    SELECT id FROM branches WHERE organization_id = p_org_id
  ),
  first_visits AS (
    SELECT v.client_id, MIN(v.completed_at) AS first_visit
    FROM visits v
    WHERE v.branch_id IN (SELECT id FROM org_branches)
      AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
      AND v.client_id IS NOT NULL
    GROUP BY v.client_id
  )
  SELECT COUNT(*)::int
  FROM first_visits
  WHERE first_visit >= p_from AND first_visit <= p_to;
$$;

CREATE OR REPLACE FUNCTION count_clients_scoped(
  p_org_id uuid,
  p_branch_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_branch_id IS NULL THEN
      (SELECT COUNT(*)::int FROM clients WHERE organization_id = p_org_id)
    ELSE
      (SELECT COUNT(DISTINCT v.client_id)::int
       FROM visits v
       JOIN branches b ON b.id = v.branch_id
       WHERE b.organization_id = p_org_id
         AND v.branch_id = p_branch_id
         AND v.client_id IS NOT NULL)
  END;
$$;

GRANT EXECUTE ON FUNCTION count_new_clients_scoped(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION count_clients_scoped(uuid, uuid) TO authenticated, service_role;

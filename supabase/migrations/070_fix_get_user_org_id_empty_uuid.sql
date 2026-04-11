-- ============================================================
-- Migracion 070: Fix get_user_org_id() - UUID vacio
-- ============================================================
-- Problema: cuando app_metadata.organization_id es un string vacio (""),
-- el cast ::UUID falla con "invalid input syntax for type uuid: ''".
-- Esto rompe TODAS las RLS policies que llaman a get_user_org_id(),
-- causando timeouts en cascada y errores 500 en auth.
--
-- Solucion: usar NULLIF para convertir '' a NULL antes del cast.
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (NULLIF(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::UUID),
    (SELECT organization_id FROM staff
     WHERE auth_user_id = auth.uid() AND is_active = true
     ORDER BY created_at ASC LIMIT 1),
    (SELECT organization_id FROM clients
     WHERE auth_user_id = auth.uid()
     ORDER BY created_at ASC LIMIT 1)
  );
$$;

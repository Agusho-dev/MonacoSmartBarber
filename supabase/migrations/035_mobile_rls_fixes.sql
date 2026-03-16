-- ============================================================
-- 035: Correcciones de RLS para app móvil de clientes
-- - Permite a clientes actualizar su propio perfil
-- - Segmenta lectura de visits (staff vs cliente propio)
-- - Agrega branch_signals a Realtime
-- ============================================================

-- ============================================================
-- 1. Clientes pueden actualizar su propio registro
--    (pin_hash, last_login_at, etc.)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clients' AND policyname = 'clients_update_own'
  ) THEN
    CREATE POLICY clients_update_own ON clients
      FOR UPDATE
      USING (auth_user_id = auth.uid())
      WITH CHECK (auth_user_id = auth.uid());
  END IF;
END
$$;

-- ============================================================
-- 2. Lectura de visits: separar staff (todas) vs cliente (propias)
--    La policy visits_read_all es permisiva pero puede crear
--    ambigüedad — la reemplazamos con políticas explícitas.
-- ============================================================
DROP POLICY IF EXISTS visits_read_all ON visits;

-- Staff ve todas las visitas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'visits' AND policyname = 'visits_read_staff'
  ) THEN
    CREATE POLICY visits_read_staff ON visits
      FOR SELECT
      USING (EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()));
  END IF;
END
$$;

-- Cliente ve solo sus propias visitas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'visits' AND policyname = 'visits_read_own_client'
  ) THEN
    CREATE POLICY visits_read_own_client ON visits
      FOR SELECT
      USING (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
      );
  END IF;
END
$$;

-- ============================================================
-- 3. branch_signals a Realtime (ocupación en tiempo real)
-- ============================================================
DO $$
BEGIN
  -- Verificar si ya está en la publicación antes de agregar
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'branch_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE branch_signals;
  END IF;
END
$$;

-- ============================================================
-- 4. Actualizar queue_update_all: sólo staff puede actualizar cola
--    (el sistema web actual tiene una policy muy permisiva)
-- ============================================================
-- NOTA: No modificamos queue_update_all ya que el sistema interno
-- la usa con permiso amplio. Solo verificamos que exista.
-- En una revisión futura se puede restringir si se implementa
-- check-in móvil de clientes en la cola.

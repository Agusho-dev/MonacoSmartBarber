-- =============================================================================
-- Migración 104: appointment_settings pasa a ser per-sucursal con fallback org
--
-- Hoy: UNIQUE(organization_id) — una sola config por org.
-- Problema: sucursales distintas pueden tener horarios de turnos distintos
-- (ej. Rondeau atiende 9-22, Caseros 10-20, Paraná solo de martes a sábado).
--
-- Cambio: agregar branch_id nullable y cambiar UNIQUE a (org_id, branch_id)
-- donde branch_id IS NULL representa la configuración default de la org.
-- Helper SQL resuelve la config efectiva haciendo COALESCE(branch, org).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Agregar branch_id nullable
-- ---------------------------------------------------------------------------
ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;

COMMENT ON COLUMN appointment_settings.branch_id IS 'NULL = configuración default de la org. Si se setea, override para esa sucursal específica.';

-- ---------------------------------------------------------------------------
-- 2. Cambiar constraint único
-- ---------------------------------------------------------------------------
ALTER TABLE appointment_settings
  DROP CONSTRAINT IF EXISTS appointment_settings_organization_id_key;

-- UNIQUE(org_id, branch_id) — PostgreSQL trata NULLs como distintos, pero queremos
-- que (org, NULL) sea único (máximo un default por org). Usamos índice parcial.
CREATE UNIQUE INDEX IF NOT EXISTS appointment_settings_org_default_unique
  ON appointment_settings (organization_id)
  WHERE branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS appointment_settings_org_branch_unique
  ON appointment_settings (organization_id, branch_id)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointment_settings_org ON appointment_settings(organization_id);

-- ---------------------------------------------------------------------------
-- 3. Helper: resolver settings efectivos (override de sucursal o default de org)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_effective_appointment_settings(
  p_org_id UUID,
  p_branch_id UUID DEFAULT NULL
)
RETURNS appointment_settings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result appointment_settings;
BEGIN
  -- 1) Primero intentamos override de sucursal
  IF p_branch_id IS NOT NULL THEN
    SELECT * INTO v_result
    FROM appointment_settings
    WHERE organization_id = p_org_id
      AND branch_id = p_branch_id;

    IF FOUND THEN
      RETURN v_result;
    END IF;
  END IF;

  -- 2) Fallback al default de la org
  SELECT * INTO v_result
  FROM appointment_settings
  WHERE organization_id = p_org_id
    AND branch_id IS NULL;

  RETURN v_result;
END $$;

COMMENT ON FUNCTION get_effective_appointment_settings IS 'Retorna la config de turnos efectiva para una sucursal: override de sucursal si existe, sino default de la org.';

-- ---------------------------------------------------------------------------
-- 4. RLS: la policy existente (organization_id = get_user_org_id()) sigue aplicando
-- tanto para filas default como para overrides por sucursal (branch_id no
-- participa en la RLS, solo organization_id).
-- ---------------------------------------------------------------------------
-- No cambios de RLS en esta migración.

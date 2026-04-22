-- =============================================================================
-- Migración 103: social_channels pasa a org-scope
-- Contexto: una organización configura un canal (WhatsApp/Instagram) que sirve
-- para TODAS sus sucursales (ej. Monaco: 1 número WA, 4 sucursales).
-- El esquema original ataba social_channels.branch_id, forzando duplicación
-- y complicando queries multi-branch.
--
-- Cambios:
--   1. Agregar social_channels.organization_id (NOT NULL, backfill desde branches)
--   2. Relajar social_channels.branch_id a NULL (canal org-default) manteniendo
--      compat para canales específicos de sucursal si se necesitaran en el futuro.
--   3. Nuevo UNIQUE(organization_id, platform) WHERE branch_id IS NULL
--      (un canal-default por plataforma por org).
--   4. Actualizar RLS: lectura por organization_id (sin navegar branches).
--   5. Simplificar RLS de message_templates (channel.organization_id directo).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Agregar organization_id a social_channels
-- ---------------------------------------------------------------------------
ALTER TABLE social_channels
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill desde branches (cada canal existente estaba pegado a una sucursal)
UPDATE social_channels sc
SET organization_id = b.organization_id
FROM branches b
WHERE sc.branch_id = b.id
  AND sc.organization_id IS NULL;

-- Hacer NOT NULL una vez poblado
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM social_channels WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'Hay social_channels sin organization_id después del backfill. Revisar datos antes de continuar.';
  END IF;

  ALTER TABLE social_channels ALTER COLUMN organization_id SET NOT NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Relajar branch_id a nullable
-- ---------------------------------------------------------------------------
ALTER TABLE social_channels ALTER COLUMN branch_id DROP NOT NULL;

COMMENT ON COLUMN social_channels.organization_id IS 'Organización dueña del canal. Un canal con branch_id NULL sirve como default para toda la org (caso habitual para WhatsApp).';
COMMENT ON COLUMN social_channels.branch_id IS 'NULL = canal org-default (aplica a todas las sucursales de la org). Si se setea, el canal es exclusivo de esa sucursal.';

-- ---------------------------------------------------------------------------
-- 3. Constraints únicos
-- ---------------------------------------------------------------------------
-- Drop el UNIQUE(branch_id, platform) antiguo porque branch_id ahora puede ser NULL
ALTER TABLE social_channels
  DROP CONSTRAINT IF EXISTS social_channels_branch_platform_unique;

-- Permitir UNIQUE parcial: un canal-default (branch_id IS NULL) por (org, platform)
CREATE UNIQUE INDEX IF NOT EXISTS social_channels_org_platform_default_unique
  ON social_channels (organization_id, platform)
  WHERE branch_id IS NULL;

-- Permitir UNIQUE parcial: un canal por (branch, platform) cuando branch_id no es NULL
CREATE UNIQUE INDEX IF NOT EXISTS social_channels_branch_platform_unique_idx
  ON social_channels (branch_id, platform)
  WHERE branch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Consolidar canales existentes al modelo org-default
-- Lógica: si una org tiene un canal WA pegado a una sucursal, lo "liftamos" a
-- org-default (branch_id = NULL) porque el modelo es "un canal por org". Si por
-- alguna razón hubiera múltiples canales de la misma plataforma por org (no
-- debería por migración 054), conservamos el primero como default y los demás
-- quedan branch-scoped.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT id, organization_id, platform,
         ROW_NUMBER() OVER (PARTITION BY organization_id, platform ORDER BY created_at ASC) AS rn
  FROM social_channels
  WHERE branch_id IS NOT NULL
)
UPDATE social_channels sc
SET branch_id = NULL
FROM ranked r
WHERE sc.id = r.id AND r.rn = 1;

-- ---------------------------------------------------------------------------
-- 5. Índices de consulta
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_social_channels_org ON social_channels(organization_id);
CREATE INDEX IF NOT EXISTS idx_social_channels_org_platform_active
  ON social_channels(organization_id, platform)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 6. RLS policies: simplificar usando organization_id directo
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "social_channels_read_by_org" ON social_channels;
DROP POLICY IF EXISTS "social_channels_manage_by_admin" ON social_channels;

CREATE POLICY "social_channels_read_by_org" ON social_channels FOR SELECT
USING (organization_id = get_user_org_id());

CREATE POLICY "social_channels_manage_by_admin" ON social_channels FOR ALL
USING (
  is_admin_or_owner()
  AND organization_id = get_user_org_id()
)
WITH CHECK (
  is_admin_or_owner()
  AND organization_id = get_user_org_id()
);

-- ---------------------------------------------------------------------------
-- 7. RLS policies de message_templates: simplificar (un hop menos)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "message_templates_read_by_org" ON message_templates;
DROP POLICY IF EXISTS "message_templates_manage_by_staff" ON message_templates;

CREATE POLICY "message_templates_read_by_org" ON message_templates FOR SELECT
USING (
  channel_id IN (
    SELECT id FROM social_channels WHERE organization_id = get_user_org_id()
  )
);

CREATE POLICY "message_templates_manage_by_staff" ON message_templates FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM staff
    WHERE auth_user_id = auth.uid()
      AND is_active = true
      AND organization_id = get_user_org_id()
  )
  AND channel_id IN (
    SELECT id FROM social_channels WHERE organization_id = get_user_org_id()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM staff
    WHERE auth_user_id = auth.uid()
      AND is_active = true
      AND organization_id = get_user_org_id()
  )
  AND channel_id IN (
    SELECT id FROM social_channels WHERE organization_id = get_user_org_id()
  )
);

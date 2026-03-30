-- ============================================================
-- Migracion 047: Sistema Multi-Tenant (BarberOS)
-- ============================================================
-- Convierte el sistema single-tenant en multi-tenant.
-- Monaco pasa a ser la primera organizacion dentro de BarberOS.
-- CRITICO: No se pierde ningun dato existente.
--
-- Estrategia:
--   1. Crear tablas organizations + organization_members
--   2. Insertar org "Monaco Smart Barber" con UUID fijo
--   3. Agregar organization_id (nullable) a tablas Tier 1
--   4. Migrar datos existentes a Monaco
--   5. Aplicar NOT NULL + FK + indices
-- ============================================================

-- UUID fijo para Monaco (determinista, permite referenciarlo en migraciones futuras)
-- Generado una sola vez: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

-- ============================================================
-- 1. TABLA organizations
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  logo_url      TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  settings      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS 'Organizaciones/empresas del sistema BarberOS (multi-tenant root)';
COMMENT ON COLUMN organizations.slug IS 'Identificador URL-friendly unico para la organizacion';
COMMENT ON COLUMN organizations.settings IS 'Configuracion general de la organizacion (JSON libre)';

-- Trigger updated_at
CREATE TRIGGER set_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. TABLA organization_members (mapea auth users -> orgs)
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role              TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('owner', 'admin', 'member')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

COMMENT ON TABLE organization_members IS 'Membresía de usuarios de auth a organizaciones';
COMMENT ON COLUMN organization_members.role IS 'Rol a nivel org: owner (dueno), admin, member';

-- Indices
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);

-- RLS
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. INSERTAR organizacion Monaco
-- ============================================================
INSERT INTO organizations (id, name, slug)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Monaco Smart Barber', 'monaco')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. AGREGAR organization_id A TABLAS TIER 1 (nullable primero)
-- ============================================================

-- 4a. branches (anchor principal)
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- 4b. staff (denormalizado para queries rapidos)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- 4c. clients (org-scoped)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- 4d. roles (org-scoped)
ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- 4e. app_settings (de singleton a per-org)
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- 4f. reward_catalog (org-scoped)
ALTER TABLE reward_catalog
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- 4g. service_tags (org-scoped)
ALTER TABLE service_tags
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- 4h. client_loyalty_state (org-scoped via client)
ALTER TABLE client_loyalty_state
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- 4i. client_goals (org-scoped via client)
ALTER TABLE client_goals
  ADD COLUMN IF NOT EXISTS organization_id UUID;

-- ============================================================
-- 5. MIGRAR DATOS EXISTENTES A MONACO
-- ============================================================
-- Todos los registros existentes pertenecen a Monaco

UPDATE branches
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

UPDATE staff
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

UPDATE clients
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

UPDATE roles
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

UPDATE app_settings
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

UPDATE reward_catalog
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

UPDATE service_tags
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

UPDATE client_loyalty_state
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

UPDATE client_goals
  SET organization_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  WHERE organization_id IS NULL;

-- ============================================================
-- 6. INSERTAR organization_members PARA STAFF CON auth_user_id
-- ============================================================
-- Todos los staff que tienen auth_user_id se agregan como members de Monaco
-- Los owner/admin se mapean a su rol correspondiente a nivel org

INSERT INTO organization_members (organization_id, user_id, role)
SELECT
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  s.auth_user_id,
  CASE
    WHEN s.role = 'owner' THEN 'owner'
    WHEN s.role = 'admin' THEN 'admin'
    ELSE 'member'
  END
FROM staff s
WHERE s.auth_user_id IS NOT NULL
  AND s.is_active = true
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- ============================================================
-- 7. APLICAR NOT NULL CONSTRAINTS
-- ============================================================
-- Solo despues de que todos los datos fueron migrados

ALTER TABLE branches
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE staff
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE clients
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE roles
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE app_settings
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE reward_catalog
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE service_tags
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE client_loyalty_state
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE client_goals
  ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 8. AGREGAR FOREIGN KEYS
-- ============================================================

ALTER TABLE branches
  ADD CONSTRAINT fk_branches_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE staff
  ADD CONSTRAINT fk_staff_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE clients
  ADD CONSTRAINT fk_clients_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE roles
  ADD CONSTRAINT fk_roles_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE app_settings
  ADD CONSTRAINT fk_app_settings_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE reward_catalog
  ADD CONSTRAINT fk_reward_catalog_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE service_tags
  ADD CONSTRAINT fk_service_tags_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE client_loyalty_state
  ADD CONSTRAINT fk_client_loyalty_state_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE client_goals
  ADD CONSTRAINT fk_client_goals_organization
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

-- ============================================================
-- 9. CREAR INDICES PARA PERFORMANCE
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_branches_org_id ON branches(organization_id);
CREATE INDEX IF NOT EXISTS idx_staff_org_id ON staff(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org_id ON clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_roles_org_id ON roles(organization_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_org_id ON app_settings(organization_id);
CREATE INDEX IF NOT EXISTS idx_reward_catalog_org_id ON reward_catalog(organization_id);
CREATE INDEX IF NOT EXISTS idx_service_tags_org_id ON service_tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_client_loyalty_state_org_id ON client_loyalty_state(organization_id);
CREATE INDEX IF NOT EXISTS idx_client_goals_org_id ON client_goals(organization_id);

-- Indice compuesto para queries comunes
CREATE INDEX IF NOT EXISTS idx_branches_org_active ON branches(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_staff_org_active ON staff(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);

-- ============================================================
-- 10. UNIQUE CONSTRAINT: app_settings 1 por org
-- ============================================================
-- app_settings era singleton global, ahora es 1 por org
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_org_unique
  ON app_settings(organization_id);

-- ============================================================
-- 11. ACTUALIZAR app_metadata DE AUTH USERS EXISTENTES
-- ============================================================
-- Esto se hace via SQL directo a auth.users para setear organization_id en app_metadata
-- Necesario para que las RLS policies puedan leer el org del JWT

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('organization_id', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
WHERE id IN (
  SELECT auth_user_id FROM staff WHERE auth_user_id IS NOT NULL
)
AND (raw_app_meta_data ->> 'organization_id') IS NULL;

-- Tambien para clientes con auth_user_id
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('organization_id', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
WHERE id IN (
  SELECT auth_user_id FROM clients WHERE auth_user_id IS NOT NULL
)
AND (raw_app_meta_data ->> 'organization_id') IS NULL;

-- ============================================================
-- 12. RLS BASICO PARA organizations y organization_members
-- ============================================================

-- organizations: lectura publica para login/seleccion, gestion solo owner
CREATE POLICY "org_read_active"
  ON organizations FOR SELECT
  USING (is_active = true);

CREATE POLICY "org_manage_own"
  ON organizations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
  );

-- organization_members: ver miembros de tu propia org
CREATE POLICY "org_members_read_own"
  ON organization_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth.uid()
    )
  );

CREATE POLICY "org_members_manage_owner"
  ON organization_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- 13. HABILITAR REALTIME PARA organizations (opcional, util para admin)
-- ============================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE organizations;

-- ============================================================
-- FIN Migracion 047
-- ============================================================

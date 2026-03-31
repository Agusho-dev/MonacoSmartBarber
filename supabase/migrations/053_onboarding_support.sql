-- ============================================================
-- Migración 053: Soporte de Onboarding para Organizaciones
-- ============================================================
-- Agrega la función setup_organization() para crear una nueva
-- organización completa: org + organization_members + staff +
-- app_metadata del auth user.
--
-- El estado de onboarding se rastrea en organizations.settings:
--   settings.onboarding_completed: boolean
--   settings.onboarding_step: number (0-4)
--
-- Estructura:
--   1. Función setup_organization (SECURITY DEFINER)
--   2. Función update_onboarding_progress (SECURITY DEFINER)
--   3. Función complete_onboarding (SECURITY DEFINER)
--   4. Índice GIN sobre organizations.settings
-- ============================================================

-- ============================================================
-- 1. FUNCIÓN setup_organization
-- ============================================================
-- Crea una organización nueva y configura al usuario como owner.
-- El auth user DEBE existir previamente (creado por la Server Action
-- via Supabase Auth API antes de llamar esta función).
--
-- Parámetros:
--   p_user_id    - UUID del auth user ya creado
--   p_org_name   - Nombre de la organización
--   p_org_slug   - Slug URL-friendly (debe ser único)
--   p_owner_name - Nombre completo del owner (para staff record)
--
-- Retorna: UUID del nuevo organization_id
--
-- Errores:
--   'SLUG_TAKEN' - si el slug ya existe
--   'USER_ALREADY_IN_ORG' - si el user ya pertenece a una organización

CREATE OR REPLACE FUNCTION setup_organization(
  p_user_id    UUID,
  p_org_name   TEXT,
  p_org_slug   TEXT,
  p_owner_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  -- Validaciones básicas
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id no puede ser NULL';
  END IF;

  IF p_org_name IS NULL OR trim(p_org_name) = '' THEN
    RAISE EXCEPTION 'p_org_name no puede estar vacío';
  END IF;

  IF p_org_slug IS NULL OR trim(p_org_slug) = '' THEN
    RAISE EXCEPTION 'p_org_slug no puede estar vacío';
  END IF;

  IF p_owner_name IS NULL OR trim(p_owner_name) = '' THEN
    RAISE EXCEPTION 'p_owner_name no puede estar vacío';
  END IF;

  -- Verificar que el slug no esté tomado
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = lower(trim(p_org_slug))) THEN
    RAISE EXCEPTION 'SLUG_TAKEN';
  END IF;

  -- Verificar que el usuario no pertenezca ya a una organización
  IF EXISTS (SELECT 1 FROM organization_members WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'USER_ALREADY_IN_ORG';
  END IF;

  -- 1. Crear la organización con estado de onboarding inicial
  INSERT INTO organizations (name, slug, settings)
  VALUES (
    trim(p_org_name),
    lower(trim(p_org_slug)),
    jsonb_build_object(
      'onboarding_completed', false,
      'onboarding_step', 0
    )
  )
  RETURNING id INTO v_org_id;

  -- 2. Crear membresía del owner
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_org_id, p_user_id, 'owner');

  -- 3. Crear registro de staff como owner (sin branch_id aún, se asigna en onboarding)
  INSERT INTO staff (auth_user_id, role, full_name, organization_id, is_active)
  VALUES (p_user_id, 'owner', trim(p_owner_name), v_org_id, true);

  -- 4. Actualizar app_metadata del auth user con organization_id
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('organization_id', v_org_id::text)
  WHERE id = p_user_id;

  RETURN v_org_id;
END;
$$;

COMMENT ON FUNCTION setup_organization IS 'Crea una organización nueva con owner. El auth user debe existir previamente via Supabase Auth API.';

-- ============================================================
-- 2. FUNCIÓN update_onboarding_progress
-- ============================================================
-- Actualiza el progreso de onboarding en settings de la organización.
-- Solo el owner puede avanzar el onboarding.

CREATE OR REPLACE FUNCTION update_onboarding_progress(
  p_org_id     UUID,
  p_step       INT,
  p_completed  BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar que el paso esté en rango
  IF p_step < 0 OR p_step > 4 THEN
    RAISE EXCEPTION 'El paso de onboarding debe estar entre 0 y 4';
  END IF;

  -- Verificar que el usuario sea owner de la organización
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Solo el owner puede actualizar el onboarding';
  END IF;

  -- Actualizar settings con el progreso
  UPDATE organizations
  SET settings = settings
    || jsonb_build_object(
         'onboarding_step', p_step,
         'onboarding_completed', p_completed
       )
  WHERE id = p_org_id;
END;
$$;

COMMENT ON FUNCTION update_onboarding_progress IS 'Actualiza el progreso de onboarding. Solo el owner de la organización puede hacerlo.';

-- ============================================================
-- 3. FUNCIÓN complete_onboarding
-- ============================================================
-- Marca el onboarding como completado. Función de conveniencia.

CREATE OR REPLACE FUNCTION complete_onboarding(
  p_org_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verificar que el usuario sea owner de la organización
  IF NOT EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Solo el owner puede completar el onboarding';
  END IF;

  UPDATE organizations
  SET settings = settings
    || jsonb_build_object(
         'onboarding_step', 4,
         'onboarding_completed', true
       )
  WHERE id = p_org_id;
END;
$$;

COMMENT ON FUNCTION complete_onboarding IS 'Marca el onboarding de una organización como completado.';

-- ============================================================
-- 4. ÍNDICE GIN PARA QUERIES SOBRE settings JSONB
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_organizations_settings
  ON organizations USING gin (settings);

-- ============================================================
-- FIN Migración 053
-- ============================================================

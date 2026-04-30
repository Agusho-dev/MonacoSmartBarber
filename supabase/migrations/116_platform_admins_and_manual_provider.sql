-- ============================================================
-- Migración 116: Versionar platform_admins + provider manual default
-- ============================================================
--
-- 1) `platform_admins` y `platform_admin_actions` existen en producción
--    pero nunca se versionaron. Esta migración las codifica para
--    reproducir el entorno desde cero. Idempotente.
--
-- 2) Toda org sin `provider` queda en 'manual' — es el default mientras
--    no haya pasarela.
--
-- 3) Bajar trial_days a 3 para start/pro/enterprise. monaco_internal y
--    free quedan en 0.
-- ============================================================

BEGIN;

-- -------------------------------------------------------------------
-- 1) platform_admins
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'support' CHECK (role IN ('owner','admin','support')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.platform_admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pa_actions_admin ON public.platform_admin_actions(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pa_actions_org ON public.platform_admin_actions(target_org_id, created_at DESC);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_actions ENABLE ROW LEVEL SECURITY;

-- Sólo platform_admins pueden leer la tabla de admins
DROP POLICY IF EXISTS pa_select_self ON public.platform_admins;
CREATE POLICY pa_select_self ON public.platform_admins
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins x WHERE x.user_id = auth.uid()));

-- Sólo owners de plataforma escriben
DROP POLICY IF EXISTS pa_write_owner ON public.platform_admins;
CREATE POLICY pa_write_owner ON public.platform_admins
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins x WHERE x.user_id = auth.uid() AND x.role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins x WHERE x.user_id = auth.uid() AND x.role = 'owner'));

DROP POLICY IF EXISTS pa_actions_select ON public.platform_admin_actions;
CREATE POLICY pa_actions_select ON public.platform_admin_actions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins x WHERE x.user_id = auth.uid()));

DROP POLICY IF EXISTS pa_actions_insert ON public.platform_admin_actions;
CREATE POLICY pa_actions_insert ON public.platform_admin_actions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins x WHERE x.user_id = auth.uid()));

-- -------------------------------------------------------------------
-- 2) Default provider='manual' para orgs sin provider
-- -------------------------------------------------------------------

UPDATE public.organization_subscriptions
   SET provider = 'manual'
 WHERE provider IS NULL;

ALTER TABLE public.organization_subscriptions
  ALTER COLUMN provider SET DEFAULT 'manual';

-- -------------------------------------------------------------------
-- 3) Trial 3 días en planes públicos
-- -------------------------------------------------------------------

UPDATE public.plans SET trial_days = 3, updated_at = now()
 WHERE id IN ('start','pro','enterprise');

-- monaco_internal y free quedan en 0 (no aplican trial).
UPDATE public.plans SET trial_days = 0, updated_at = now()
 WHERE id IN ('free','monaco_internal');

-- -------------------------------------------------------------------
-- 4) Helpers SQL para platform admin checks
-- -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id);
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;

COMMIT;

-- =============================================================
-- 057: Correcciones de mensajería — seguridad, indexes, RLS
-- =============================================================

-- 1. Agregar app_secret para verificación HMAC de webhooks de Meta
ALTER TABLE organization_whatsapp_config
  ADD COLUMN IF NOT EXISTS app_secret TEXT;

ALTER TABLE organization_instagram_config
  ADD COLUMN IF NOT EXISTS app_secret TEXT;

-- 2. UNIQUE constraint en verify_token para evitar colisiones entre orgs
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_config_verify_token_unique
  ON organization_whatsapp_config (verify_token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_config_verify_token_unique
  ON organization_instagram_config (verify_token);

-- 3. Indexes faltantes para performance
CREATE INDEX IF NOT EXISTS idx_social_channels_branch_id
  ON social_channels (branch_id);

CREATE INDEX IF NOT EXISTS idx_conversation_tag_assignments_conversation_id
  ON conversation_tag_assignments (conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_tag_assignments_tag_id
  ON conversation_tag_assignments (tag_id);

CREATE INDEX IF NOT EXISTS idx_wa_config_org_id
  ON organization_whatsapp_config (organization_id);

CREATE INDEX IF NOT EXISTS idx_ig_config_org_id
  ON organization_instagram_config (organization_id);

CREATE INDEX IF NOT EXISTS idx_conversation_tags_org_id
  ON conversation_tags (organization_id);

-- 4. RLS policies faltantes

-- organization_instagram_config
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'organization_instagram_config' AND policyname = 'ig_config_by_org') THEN
    CREATE POLICY "ig_config_by_org" ON organization_instagram_config
      FOR ALL
      USING (
        organization_id IN (
          SELECT om.organization_id FROM organization_members om
          WHERE om.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- conversation_tags
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_tags' AND policyname = 'conversation_tags_manage_by_org') THEN
    CREATE POLICY "conversation_tags_manage_by_org" ON conversation_tags
      FOR ALL
      USING (
        organization_id IN (
          SELECT om.organization_id FROM organization_members om
          WHERE om.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- conversation_tag_assignments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_tag_assignments' AND policyname = 'cta_manage_by_org') THEN
    CREATE POLICY "cta_manage_by_org" ON conversation_tag_assignments
      FOR ALL
      USING (
        tag_id IN (
          SELECT ct.id FROM conversation_tags ct
          WHERE ct.organization_id IN (
            SELECT om.organization_id FROM organization_members om
            WHERE om.user_id = auth.uid()
          )
        )
      );
  END IF;
END $$;

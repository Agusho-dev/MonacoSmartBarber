-- =============================================================================
-- Migración 054: Constraint única en social_channels (branch_id, platform)
-- Permite hacer upsert al guardar credenciales de WhatsApp.
-- =============================================================================

ALTER TABLE social_channels
  DROP CONSTRAINT IF EXISTS social_channels_branch_platform_unique;

ALTER TABLE social_channels
  ADD CONSTRAINT social_channels_branch_platform_unique
  UNIQUE (branch_id, platform);

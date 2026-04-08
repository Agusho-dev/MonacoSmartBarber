-- Constraint único para poder hacer upsert de templates sincronizados desde Meta
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'message_templates_channel_id_name_key'
  ) THEN
    ALTER TABLE message_templates ADD CONSTRAINT message_templates_channel_id_name_key UNIQUE (channel_id, name);
  END IF;
END $$;

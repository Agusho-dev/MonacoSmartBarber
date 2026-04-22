-- =============================================================================
-- Migración 105: Template pickers por turno + contexto en scheduled_messages
--
-- A) appointment_settings: reemplazar campos TEXT con FK a message_templates
--    y habilitar múltiples recordatorios.
-- B) scheduled_messages: agregar organization_id (corrige un gap multi-tenant)
--    y appointment_id (permite cancelar selectivamente solo los mensajes de un
--    turno específico en lugar de todos los mensajes pendientes del cliente).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. appointment_settings: template FKs + lista de recordatorios
-- ---------------------------------------------------------------------------

-- Foreign keys a message_templates (seleccionables desde el picker)
ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS confirmation_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;

ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS reminder_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;

ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS reschedule_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;

ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS cancellation_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;

ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS waitlist_template_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN appointment_settings.confirmation_template_id IS 'Template de confirmación (seleccionado con picker). Mantiene confirmation_template_name TEXT como fallback legacy.';
COMMENT ON COLUMN appointment_settings.reminder_template_id IS 'Template de recordatorio genérico (se usa para todos los items de reminder_hours_before_list).';
COMMENT ON COLUMN appointment_settings.reschedule_template_id IS 'Template informativo cuando staff reprograma un turno.';
COMMENT ON COLUMN appointment_settings.cancellation_template_id IS 'Template informativo cuando se cancela un turno.';
COMMENT ON COLUMN appointment_settings.waitlist_template_id IS 'Template enviado al primer candidato de la lista de espera cuando se libera un slot.';

-- Múltiples recordatorios (ej. [24, 2] = 24h antes + 2h antes)
ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS reminder_hours_before_list INTEGER[] NOT NULL DEFAULT ARRAY[24, 2];

COMMENT ON COLUMN appointment_settings.reminder_hours_before_list IS 'Lista de horas antes del turno para enviar recordatorios. Cada entrada genera un scheduled_message separado. Default: [24, 2].';

-- Backfill: copiar el valor legacy reminder_hours_before como primer item de la lista
-- (solo si la lista quedó en el default)
UPDATE appointment_settings
SET reminder_hours_before_list = ARRAY[reminder_hours_before]
WHERE reminder_hours_before IS NOT NULL
  AND reminder_hours_before > 0
  AND reminder_hours_before_list = ARRAY[24, 2]
  AND reminder_hours_before NOT IN (24);

-- Nota: mantenemos reminder_hours_before (INTEGER) sin drop para compat durante el deploy.
-- Se removerá en migración futura una vez validado.

-- ---------------------------------------------------------------------------
-- B. scheduled_messages: organization_id + appointment_id
-- ---------------------------------------------------------------------------

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL;

COMMENT ON COLUMN scheduled_messages.organization_id IS 'Organización dueña del mensaje. Evita que el edge function tenga que resolver via client_id en cada envío.';
COMMENT ON COLUMN scheduled_messages.appointment_id IS 'Si el mensaje proviene de un turno (confirmación/recordatorio/reprogramación/cancelación), acá referencia al turno. Permite cancelar solo los mensajes de ese turno sin afectar otros.';

-- Backfill organization_id via clients
UPDATE scheduled_messages sm
SET organization_id = c.organization_id
FROM clients c
WHERE sm.client_id = c.id
  AND sm.organization_id IS NULL;

-- Índices útiles para el cron de envío y para cancelación selectiva
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_org_pending
  ON scheduled_messages (organization_id, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_appointment
  ON scheduled_messages (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C. RLS adicional para scheduled_messages (lectura por org, si no existe)
-- La policy de SELECT existente ya filtra por org via client_id; agregamos
-- verificación adicional por organization_id directo cuando está seteado.
-- ---------------------------------------------------------------------------
-- (La policy "scheduled_messages_read_by_org" definida en 049_multi_tenant_rls_tier2
-- sigue funcionando — navega por client_id. Esta columna es solo optimización.)

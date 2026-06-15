-- 154_assistant_config.sql
-- Extiende organization_ai_config con la configuración del Asistente IA (copiloto).
-- Separado del modelo de auto-tag/workflows para no interferir. Aditivo.

alter table public.organization_ai_config
  add column if not exists assistant_model text default 'claude-sonnet-4-6',
  add column if not exists embedding_model text default 'text-embedding-3-small',
  add column if not exists assistant_temperature numeric(3,2) default 0.4,
  add column if not exists assistant_max_tokens integer default 1800,
  add column if not exists assistant_persona text,
  add column if not exists assistant_system_prompt text,
  add column if not exists assistant_data_access jsonb
    default '{"finanzas":true,"salarios":true,"estadisticas":true,"clientes":true,"resenas":true,"turnos":true,"fidelizacion":true}'::jsonb,
  add column if not exists assistant_suggested_prompts jsonb,
  add column if not exists assistant_pro_mode boolean default false;

comment on column public.organization_ai_config.assistant_model is 'Modelo de chat del Asistente IA (claude-sonnet-4-6 | claude-opus-4-8 | claude-opus-4-7 | gpt-4o ...).';
comment on column public.organization_ai_config.assistant_data_access is 'Allow-list de dominios que el asistente puede leer. El backend lo enforce además de los permisos de rol.';
comment on column public.organization_ai_config.assistant_pro_mode is 'Modo Pro: habilita la herramienta de SQL de solo-lectura (consulta_sql).';

-- =============================================================================
-- 227_tex_asistente.sql
-- Tex: la IA del dashboard pasa a Claude Haiku 5.5 con el SDK oficial.
--
-- 1. assistant_messages.model_messages
--    Lo que VIO EL MODELO en ese mensaje, en bloques de Anthropic (texto,
--    tool_use, tool_result y el `role: 'system'` de contexto del turno). El
--    historial que se le manda a Claude se arma concatenando esta columna en
--    orden: es append-only, nunca se reescribe.
--    Los bloques `thinking` NO se guardan: Haiku 5.5 invalida un bloque de
--    pensamiento si cambia cualquier cosa antes de él (el system cambia con la
--    fecha, los permisos o el Modo Pro), y reenviarlo después de ese cambio es
--    un 400. Dentro de un mismo turno sí viajan, en memoria.
--    `parts` (que existía y nadie usaba) pasa a guardar lo que ve la persona:
--    texto, herramientas con su resultado, gráficos e informes. Antes, al
--    reabrir una conversación sólo volvía el texto.
-- 2. assistant_messages.usage
--    Tokens de cada respuesta (entrada, salida, caché leída y escrita).
-- 3. organization_ai_config.assistant_effort
--    Cuánto piensa Tex: low / medium / high (Haiku 5.5 arranca en medium).
-- 4. organization_ai_config.anthropic_api_key_cifrada
--    La clave de Anthropic de Tex, CIFRADA (AES-256-GCM con la clave maestra
--    de Vault, `src/lib/crypto/secretos.ts`). La columna vieja
--    `anthropic_api_key` es texto plano y /dashboard/mensajeria la manda
--    entera al navegador: Tex no la escribe, sólo la lee como último recurso.
--
-- Es aditiva: el build deployado no lee ninguna de estas columnas.
-- =============================================================================

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS model_messages jsonb,
  ADD COLUMN IF NOT EXISTS usage jsonb;

COMMENT ON COLUMN public.assistant_messages.model_messages IS
  'Mensajes de Anthropic de este turno, sin bloques thinking. El historial de Tex es la concatenación en orden (append-only).';
COMMENT ON COLUMN public.assistant_messages.parts IS
  'Partes de UI (AI SDK UIMessage.parts) para volver a dibujar el mensaje: texto, herramientas, gráficos, informes.';
COMMENT ON COLUMN public.assistant_messages.usage IS
  'Tokens del turno: {entrada, salida, cacheLeido, cacheEscrito}.';

ALTER TABLE public.organization_ai_config
  ADD COLUMN IF NOT EXISTS assistant_effort text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS anthropic_api_key_cifrada text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_ai_config_assistant_effort_check'
  ) THEN
    ALTER TABLE public.organization_ai_config
      ADD CONSTRAINT organization_ai_config_assistant_effort_check
      CHECK (assistant_effort IN ('low', 'medium', 'high'));
  END IF;
END $$;

COMMENT ON COLUMN public.organization_ai_config.assistant_effort IS
  'Esfuerzo de Tex (output_config.effort de Claude Haiku 5.5): low | medium | high.';
COMMENT ON COLUMN public.organization_ai_config.anthropic_api_key_cifrada IS
  'Clave de Anthropic de Tex cifrada con cifrarSecreto (v1.iv.tag.ct). Nunca viaja al navegador.';

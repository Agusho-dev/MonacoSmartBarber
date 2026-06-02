-- 141: Permitir content_type = 'interactive' en messages.
--
-- Contexto (incidente 02/jun/2026): el workflow-engine (sendWhatsAppButtons /
-- sendWhatsAppList) y el webhook de Instagram (respuestas de botón inbound)
-- insertan mensajes con content_type='interactive', pero el CHECK constraint
-- sólo permitía {text,image,video,audio,document,template,location}. Cada insert
-- violaba el constraint y fallaba SILENCIOSAMENTE (el error nunca se chequeaba):
-- el botón se enviaba al cliente pero NUNCA quedaba registrado en el inbox, y el
-- componente <InteractiveButtonsBubble> del chat-view era código muerto.
--
-- La UI ya sabe renderizar content_type='interactive' (lee template_params.buttons),
-- así que el fix correcto es habilitar el tipo en el constraint.
-- Idempotente: dropea el constraint viejo si existe y recrea con el set ampliado.

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type = ANY (ARRAY[
    'text'::text,
    'image'::text,
    'video'::text,
    'audio'::text,
    'document'::text,
    'template'::text,
    'location'::text,
    'interactive'::text
  ]));

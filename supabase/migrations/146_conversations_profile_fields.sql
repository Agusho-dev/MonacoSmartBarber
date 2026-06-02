-- 146: Guardar foto de perfil y @usuario del contacto en conversations.
--
-- Pedido: mostrar nombre + foto reales (en vez de "Usuario de Instagram").
-- Instagram Messaging API expone name/username/profile_pic del usuario que
-- escribió; lo guardamos para renderizar el avatar y un mejor display name.
-- (WhatsApp Cloud API NO expone foto de perfil — solo el nombre/pushname.)

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS platform_user_avatar text;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS platform_user_handle text;

COMMENT ON COLUMN public.conversations.platform_user_avatar IS 'URL de la foto de perfil del contacto (IG profile_pic). Puede expirar; se refresca al recibir mensajes.';
COMMENT ON COLUMN public.conversations.platform_user_handle IS 'Username/@handle del contacto (IG username).';

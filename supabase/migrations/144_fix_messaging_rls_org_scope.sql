-- 144: Corregir RLS de conversations/messages — scope por organización real.
--
-- Dos problemas en las políticas actuales (auditoría 02/jun/2026):
--
-- 1) CROSS-TENANT (seguridad): `*_manage_by_staff` (FOR ALL) usa
--      EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid()
--              AND is_active AND organization_id = get_user_org_id())
--    que NO referencia la fila: es TRUE para cualquier staff activo, sin atar la
--    conversación/mensaje a su org. Resultado: un staff logueado podía leer/editar
--    mensajes de CUALQUIER organización (incluido el feed de Realtime, que corre
--    como `authenticated`).
--
-- 2) ORG-WIDE CHANNELS (correctitud): `*_read_by_org` resuelve la org con un
--    JOIN INNER a `branches` vía `branch_id`. Los canales org-wide tienen
--    branch_id=NULL → el join no produce filas → esas conversaciones/mensajes
--    quedaban FUERA de la política de lectura. El inbox sólo funcionaba por la
--    política permisiva (1). Al cerrar (1) hay que arreglar (2) o el inbox
--    (loadMessages usa el cliente browser authenticated) deja de leer.
--
-- Fix: scopear ambas políticas por `social_channels.organization_id`
-- (fuente de verdad post-migración 103; cubre org-wide y legacy por-sucursal).
-- El dashboard server-side usa service_role (bypassa RLS) y no se ve afectado.

-- ── conversations ───────────────────────────────────────────────
DROP POLICY IF EXISTS conversations_read_by_org ON public.conversations;
DROP POLICY IF EXISTS conversations_manage_by_staff ON public.conversations;

CREATE POLICY conversations_read_by_org ON public.conversations
  FOR SELECT
  USING (
    channel_id IN (
      SELECT id FROM public.social_channels
      WHERE organization_id = get_user_org_id()
    )
  );

CREATE POLICY conversations_manage_by_staff ON public.conversations
  FOR ALL
  USING (
    channel_id IN (
      SELECT id FROM public.social_channels
      WHERE organization_id = get_user_org_id()
    )
    AND EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = (SELECT auth.uid())
        AND staff.is_active = true
        AND staff.organization_id = get_user_org_id()
    )
  )
  WITH CHECK (
    channel_id IN (
      SELECT id FROM public.social_channels
      WHERE organization_id = get_user_org_id()
    )
  );

-- ── messages ────────────────────────────────────────────────────
DROP POLICY IF EXISTS messages_read_by_org ON public.messages;
DROP POLICY IF EXISTS messages_manage_by_staff ON public.messages;

CREATE POLICY messages_read_by_org ON public.messages
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT c.id
      FROM public.conversations c
      JOIN public.social_channels sc ON sc.id = c.channel_id
      WHERE sc.organization_id = get_user_org_id()
    )
  );

CREATE POLICY messages_manage_by_staff ON public.messages
  FOR ALL
  USING (
    conversation_id IN (
      SELECT c.id
      FROM public.conversations c
      JOIN public.social_channels sc ON sc.id = c.channel_id
      WHERE sc.organization_id = get_user_org_id()
    )
    AND EXISTS (
      SELECT 1 FROM staff
      WHERE staff.auth_user_id = (SELECT auth.uid())
        AND staff.is_active = true
        AND staff.organization_id = get_user_org_id()
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT c.id
      FROM public.conversations c
      JOIN public.social_channels sc ON sc.id = c.channel_id
      WHERE sc.organization_id = get_user_org_id()
    )
  );

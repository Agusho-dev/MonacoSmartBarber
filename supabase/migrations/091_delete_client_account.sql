-- 091_delete_client_account.sql
--
-- Función para soportar el requisito de Apple App Store Review Guideline 5.1.1(v):
-- el cliente debe poder eliminar su cuenta y datos personales desde dentro de la app.
--
-- Estrategia:
--   - Elimina datos PII del cliente (face descriptors, tokens push, notificaciones,
--     puntos, rewards, reviews, cases, etc.).
--   - Anonimiza (client_id = NULL) registros con valor histórico para el negocio
--     donde la columna lo permite (visits, queue_entries).
--   - El registro en auth.users se elimina desde la Edge Function (con service role),
--     porque desde aquí no tenemos permisos de schema auth.

CREATE OR REPLACE FUNCTION public.delete_client_account(p_auth_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id UUID;
BEGIN
  -- Buscar cliente por auth_user_id (no por phone: evitamos ambiguedad multi-tenant).
  SELECT id INTO v_client_id
  FROM public.clients
  WHERE auth_user_id = p_auth_user_id;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'client_not_found';
  END IF;

  -- -------- Eliminaciones puras (PII) --------
  DELETE FROM public.client_face_descriptors     WHERE client_id = v_client_id;
  DELETE FROM public.client_device_tokens        WHERE client_id = v_client_id;
  DELETE FROM public.client_notifications        WHERE client_id = v_client_id;
  DELETE FROM public.client_goals                WHERE client_id = v_client_id;
  DELETE FROM public.client_loyalty_state        WHERE client_id = v_client_id;
  DELETE FROM public.client_points               WHERE client_id = v_client_id;
  DELETE FROM public.client_rewards              WHERE client_id = v_client_id;
  DELETE FROM public.crm_cases                   WHERE client_id = v_client_id;
  DELETE FROM public.broadcast_recipients        WHERE client_id = v_client_id;
  DELETE FROM public.review_requests             WHERE client_id = v_client_id;
  DELETE FROM public.scheduled_messages          WHERE client_id = v_client_id;
  DELETE FROM public.appointments                WHERE client_id = v_client_id;
  DELETE FROM public.partner_benefit_redemptions WHERE client_id = v_client_id;
  DELETE FROM public.client_reviews              WHERE client_id = v_client_id;
  DELETE FROM public.point_transactions          WHERE client_id = v_client_id;

  -- Conversaciones + mensajes asociados (los mensajes se eliminan por cascade de conversations)
  DELETE FROM public.conversations               WHERE client_id = v_client_id;

  -- -------- Anonimización (valor contable del negocio) --------
  UPDATE public.visits        SET client_id = NULL WHERE client_id = v_client_id;
  UPDATE public.queue_entries SET client_id = NULL WHERE client_id = v_client_id;

  -- -------- Finalmente el cliente --------
  DELETE FROM public.clients WHERE id = v_client_id;

  RETURN v_client_id;
END;
$$;

-- Solo service role puede ejecutarla (la llamamos desde la Edge Function
-- con service_role, después de validar el JWT del cliente).
REVOKE ALL ON FUNCTION public.delete_client_account(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_client_account(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_account(UUID) TO service_role;

COMMENT ON FUNCTION public.delete_client_account(UUID) IS
  'Apple App Store Guideline 5.1.1(v): elimina la cuenta del cliente y datos PII.
   Invocar desde Edge Function delete-client-account con service role.';

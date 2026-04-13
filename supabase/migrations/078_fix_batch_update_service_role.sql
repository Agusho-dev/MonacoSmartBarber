-- Fix: batch_update_queue_entries fallaba cuando se llamaba desde service role
-- porque get_user_org_id() retorna NULL sin un JWT de usuario autenticado.
-- La validación de org ya se hace en la server action (validateBranchAccess),
-- así que la verificación dentro del RPC es redundante para service role.
CREATE OR REPLACE FUNCTION public.batch_update_queue_entries(p_updates jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  item JSONB;
  v_caller_org UUID;
  v_entry_id UUID;
  v_is_service_role BOOLEAN;
BEGIN
  v_is_service_role := (current_setting('request.jwt.claim.role', true) = 'service_role');

  IF NOT v_is_service_role THEN
    v_caller_org := get_user_org_id();

    IF v_caller_org IS NULL THEN
      RAISE EXCEPTION 'Acceso denegado: no se pudo determinar la organización del usuario';
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
    LOOP
      v_entry_id := (item->>'id')::uuid;

      IF NOT EXISTS (
        SELECT 1 FROM queue_entries qe
        JOIN branches b ON b.id = qe.branch_id
        WHERE qe.id = v_entry_id
          AND b.organization_id = v_caller_org
      ) THEN
        RAISE EXCEPTION 'Acceso denegado: queue_entry % no pertenece a tu organización', v_entry_id;
      END IF;
    END LOOP;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE queue_entries
    SET
      position   = (item->>'position')::int,
      priority_order = CASE
                         WHEN item ? 'priority_order' THEN
                           (item->>'priority_order')::timestamptz
                         ELSE priority_order
                       END,
      barber_id  = CASE
                     WHEN item ? 'barber_id' THEN
                       NULLIF(item->>'barber_id', '')::uuid
                     ELSE barber_id
                   END,
      is_dynamic = CASE
                     WHEN item ? 'is_dynamic' THEN
                       (item->>'is_dynamic')::boolean
                     ELSE is_dynamic
                   END
    WHERE id = (item->>'id')::uuid
      AND status = 'waiting';
  END LOOP;
END;
$function$;

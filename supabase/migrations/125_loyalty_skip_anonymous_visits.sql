-- 125_loyalty_skip_anonymous_visits.sql
-- Fix: update_client_loyalty_state() reventaba con NOT NULL violation en
-- client_loyalty_state.client_id cuando la visita no tenía cliente asociado
-- (ej: venta directa de productos desde el dashboard, que crea una visita
-- fantasma sin client_id para trackear revenue).
--
-- El trigger trg_update_loyalty_after_visit corre AFTER INSERT en visits.
-- Para visitas anónimas (client_id IS NULL) no hay loyalty state que actualizar,
-- así que retornamos NEW sin hacer nada.

CREATE OR REPLACE FUNCTION public.update_client_loyalty_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
BEGIN
  -- Visitas sin cliente (ventas directas de productos, etc) no afectan loyalty
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT organization_id INTO v_org_id FROM clients WHERE id = NEW.client_id;

  IF v_org_id IS NULL AND NEW.branch_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id FROM branches WHERE id = NEW.branch_id;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'update_client_loyalty_state: cliente % sin organization_id resolvible', NEW.client_id;
  END IF;

  INSERT INTO client_loyalty_state (client_id, organization_id, total_visits, current_streak, last_visit_at)
  VALUES (NEW.client_id, v_org_id, 1, 1, NEW.completed_at)
  ON CONFLICT (client_id) DO UPDATE SET
    total_visits = client_loyalty_state.total_visits + 1,
    current_streak = client_loyalty_state.current_streak + 1,
    last_visit_at = GREATEST(client_loyalty_state.last_visit_at, NEW.completed_at),
    updated_at = now();

  RETURN NEW;
END;
$function$;

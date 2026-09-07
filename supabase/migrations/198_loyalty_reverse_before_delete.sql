-- ============================================================================
-- 198 — Fidelización: la reversión por borrado de visita va en BEFORE DELETE
-- ============================================================================
-- Verificado en prod (transacción revertida, 30/ago/2026): con el trigger en
-- AFTER DELETE, las FK `referrals.visit_id` y `point_transactions.visit_id`
-- (ON DELETE SET NULL) ya estaban en NULL cuando corría la reversión y el
-- referido quedaba `completed` con los dos bonos vivos. El lote sí se
-- encontraba por meta->>'visit_id', pero el referido no tiene ese respaldo.
--
-- Solución: revertir ANTES de borrar (la fila y sus FKs están intactas) y
-- recalcular la categoría DESPUÉS (la visita ya no cuenta).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_loyalty_before_visit_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.client_id IS NULL THEN RETURN OLD; END IF;
  BEGIN
    PERFORM loyalty_reverse_visit(OLD.id, 'visita borrada');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO loyalty_events (organization_id, client_id, kind, visit_id, data)
    VALUES (OLD.organization_id, OLD.client_id, 'error', OLD.id,
            jsonb_build_object('what', 'reverse_visit', 'sqlstate', SQLSTATE, 'message', SQLERRM));
    RAISE WARNING '[loyalty] reverse_visit % falló: % (%)', OLD.id, SQLERRM, SQLSTATE;
  END;
  RETURN OLD;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_loyalty_on_visit_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.client_id IS NULL THEN RETURN OLD; END IF;
  BEGIN
    PERFORM loyalty_recalc_tier(OLD.client_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO loyalty_events (organization_id, client_id, kind, visit_id, data)
    VALUES (OLD.organization_id, OLD.client_id, 'error', OLD.id,
            jsonb_build_object('what', 'recalc_after_delete', 'sqlstate', SQLSTATE, 'message', SQLERRM));
    RAISE WARNING '[loyalty] recalc tras borrar % falló: % (%)', OLD.id, SQLERRM, SQLSTATE;
  END;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_loyalty_before_visit_delete ON public.visits;
CREATE TRIGGER trg_loyalty_before_visit_delete
  BEFORE DELETE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.fn_loyalty_before_visit_delete();

DROP TRIGGER IF EXISTS trg_loyalty_on_visit_delete ON public.visits;
CREATE TRIGGER trg_loyalty_on_visit_delete
  AFTER DELETE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.fn_loyalty_on_visit_delete();

REVOKE ALL ON FUNCTION public.fn_loyalty_before_visit_delete() FROM public, anon, authenticated;

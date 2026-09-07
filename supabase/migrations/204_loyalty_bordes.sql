-- ============================================================================
-- 204 — Fidelización: bordes que dejó la segunda revisión adversarial
-- ============================================================================
-- Autosuficiente: cada función va con el cuerpo COMPLETO copiado del cuerpo
-- VIVO en prod (pg_get_functiondef, 30/ago/2026), no diffs. Siete hallazgos:
--
-- 1. `point_transactions.remaining` ES el saldo del programa (mig 196), pero
--    la policy de escritura viva seguía siendo la de la mig 001
--    (`point_tx_insert_staff`, sin scope de org ni de rol): cualquier staff
--    activo con cuenta de Supabase Auth —de CUALQUIER org— podía acuñar lotes
--    por REST con la anon key (la 058 que la reemplazaba nunca se aplicó).
--    → point_transactions queda SOLO lectura para anon/authenticated; toda
--    escritura va por RPC SECURITY DEFINER (loyalty_*) o por service_role
--    (queue.ts usa createAdminClient).
-- 2. `client_rewards` ídem (`staff_manage_client_rewards`, FOR ALL sin org,
--    venida de prod sin migración): se podía fabricar un beneficio 'available'
--    o revivir uno usado, y `redeem_coupon_for_visit` lo cobraba al 100 %.
--    → sólo lectura; las escrituras legítimas ya son service_role o RPC
--    DEFINER de la app (mig 192).
-- 3. `client_loyalty_state` tenía `staff_read_loyalty` FOR ALL sin org:
--    `preview_until` / `tier_code` / `welcome_bonus_tx_id` —que las RPC leen
--    como AUTORIDAD (mig 201)— eran escribibles por cualquier staff de
--    cualquier org. → staff sólo LEE, y sólo su org; escrituras únicamente
--    service_role. El único escritor que corría con los permisos del caller
--    era el trigger `update_client_loyalty_state`: pasa a SECURITY DEFINER.
-- 4. `on_queue_completed` conservaba el bloque de puntos LEGACY
--    (rewards_config / services.points_per_service) y su INSERT chocaba con
--    `idx_point_tx_one_earned_per_visit` (mig 196): con el programa prendido y
--    una fila activa de rewards_config, NINGÚN cobro podía cerrarse (23505), y
--    aun con el programa apagado dejaba lotes 'earned' con remaining = 0 que
--    después caían en `lot_consumed_cannot_recalc`. Desde la 196 los puntos
--    los acredita SOLO `loyalty_process_visit` vía `trg_loyalty_on_visit`.
--    `rewards_config` y `client_points` quedan como tablas muertas (no se
--    dropean todavía: overview.ts y app-movil/page.tsx las leen).
-- 5. La visita placeholder de la fase 1 del cobro (amount = 0, sin service_id)
--    subía de categoría y mandaba el push ANTES de conocer el servicio real;
--    si el servicio cobrado no contaba como visita, el cliente quedaba con la
--    categoría regalada en gracia 14 días y recibía dos pushes contradictorios
--    en el mismo segundo. → `fn_loyalty_on_visit` saltea ese INSERT: la
--    primera evaluación ocurre con servicio e importe definitivos (fase 2 o
--    `loyalty_finalize_visit`, que reprocesa igual).
-- 6. Cancelar un canje con devolución restauraba puntos dentro de un lote ya
--    REVERTIDO (visita anulada): plata del programa creada de la nada y un
--    lote con reversed_by seteado y remaining > 0. → los consumos que vienen
--    de lotes revertidos se pierden (`points_forfeited`), el mismo resultado
--    que si el canje se hubiera cancelado antes de anular la visita.
-- 7. Con `grace_days = 0` cada llamada a `loyalty_recalc_tier` bajaba UN
--    escalón sin freno temporal —y la llama cada apertura de la app, cada fase
--    del cobro y el cron—: Platinum → Bronce en tres toques. → sin gracia se
--    baja un escalón en el acto y como mucho uno por día (gate por
--    `tier_reached_at`), la cadencia que el diseño ya documenta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. point_transactions: sólo lectura por REST; escrituras por RPC/service_role
-- ----------------------------------------------------------------------------
-- La 058 (org-scoped) nunca se aplicó: se dropean también sus nombres por si
-- algún entorno la tuviera.
DROP POLICY IF EXISTS "point_tx_insert_staff"  ON public.point_transactions;
DROP POLICY IF EXISTS "point_tx_insert_by_org" ON public.point_transactions;
DROP POLICY IF EXISTS "point_tx_manage_by_org" ON public.point_transactions;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.point_transactions FROM PUBLIC, anon, authenticated;
-- Las tres policies SELECT (client_read_own_points, point_transactions_org_read,
-- point_tx_read_by_org) se dejan: el historial del cliente y el dashboard las usan.

-- ----------------------------------------------------------------------------
-- 2. client_rewards: ídem
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_manage_client_rewards" ON public.client_rewards;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.client_rewards FROM PUBLIC, anon, authenticated;
-- SELECT se mantiene: client_rewards_org_read (staff por org) y
-- client_read_own_rewards (cliente de la app).

-- ----------------------------------------------------------------------------
-- 3. client_loyalty_state: staff sólo LEE, y sólo su org
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_read_loyalty" ON public.client_loyalty_state;
DROP POLICY IF EXISTS "client_loyalty_state_select_by_org" ON public.client_loyalty_state;
DROP POLICY IF EXISTS "client_loyalty_state_insert_by_org" ON public.client_loyalty_state;
DROP POLICY IF EXISTS "client_loyalty_state_update_by_org" ON public.client_loyalty_state;
DROP POLICY IF EXISTS "client_loyalty_state_delete_by_org" ON public.client_loyalty_state;

CREATE POLICY client_loyalty_state_staff_read ON public.client_loyalty_state
  FOR SELECT USING (organization_id = public.get_user_org_id());
-- client_read_own_loyalty (app) y client_loyalty_anon_read (panel del barbero,
-- clientes con entrada activa en la fila) se mantienen: son SELECT.

-- No se recrea una policy de UPDATE org-scoped estilo 058: seguiría dejando que
-- cualquier barbero de la org se fije preview/tier sin pasar por rewards.manage.
-- Todo write va por service_role (server actions, RPC DEFINER, SQL del dueño).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.client_loyalty_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_loyalty_state TO anon, authenticated;

-- El único escritor que corría con los permisos del caller era este trigger de
-- visits (AFTER INSERT): DEFINER con owner postgres, como fn_loyalty_on_visit y
-- compañía, para que un futuro INSERT en visits con un cliente RLS no reviente
-- en el trigger ahora que authenticated perdió el UPDATE de la tabla.
ALTER FUNCTION public.update_client_loyalty_state()
  SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- 4. on_queue_completed sin el bloque de puntos legacy
-- ----------------------------------------------------------------------------
-- El INSERT de visits queda IDÉNTICO al vivo (misma lista de columnas: el
-- placeholder sigue naciendo con amount = 0 y SIN service_id; el definitivo lo
-- escribe completeService en la fase 2). Desaparecen los INSERT a client_points
-- y point_transactions y los DECLARE que quedaban sin uso (v_visit_id,
-- v_points, v_reward_active, v_service_points).
CREATE OR REPLACE FUNCTION public.on_queue_completed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_commission NUMERIC(5,2);
  v_org_id UUID;
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' THEN
    SELECT organization_id INTO v_org_id FROM branches WHERE id = NEW.branch_id;
    SELECT commission_pct INTO v_commission FROM staff WHERE id = NEW.barber_id;
    v_commission := COALESCE(v_commission, 0);

    INSERT INTO visits (branch_id, client_id, barber_id, queue_entry_id, amount, commission_pct, commission_amount, started_at, completed_at, organization_id, appointment_id)
    VALUES (NEW.branch_id, NEW.client_id, NEW.barber_id, NEW.id, 0, v_commission, 0, NEW.started_at, NEW.completed_at, v_org_id, NEW.appointment_id);
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. fn_loyalty_on_visit: el placeholder de la fase 1 no se procesa
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_loyalty_on_visit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND NEW.service_id IS NOT DISTINCT FROM OLD.service_id AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.discount_amount IS NOT DISTINCT FROM OLD.discount_amount AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN
    RETURN NEW;
  END IF;
  -- La fila que inserta on_queue_completed es un placeholder (amount = 0, sin
  -- servicio definitivo): la categoría y los puntos se resuelven en la fase 2
  -- (UPDATE OF service_id/amount de completeService) o en loyalty_finalize_visit,
  -- que reprocesa igual. Recalcular acá subía de categoría por una visita cuyo
  -- servicio todavía no se conocía y, si después no contaba como visita, el
  -- cliente quedaba en gracia con una categoría no ganada y dos pushes
  -- contradictorios. El guard NO mira service_id a propósito: el servicio del
  -- check-in no es necesariamente el que se cobra, y éste es el ÚNICO camino de
  -- INSERT con queue_entry_id no nulo (createManualVisit y directProductSale lo
  -- escriben NULL).
  IF TG_OP = 'INSERT' AND NEW.queue_entry_id IS NOT NULL AND NEW.amount = 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM loyalty_settings WHERE organization_id = NEW.organization_id AND is_enabled) THEN RETURN NEW; END IF;
  BEGIN
    PERFORM loyalty_process_visit(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO loyalty_events (organization_id, client_id, kind, visit_id, data)
    VALUES (NEW.organization_id, NEW.client_id, 'error', NEW.id,
            jsonb_build_object('what', 'process_visit', 'sqlstate', SQLSTATE, 'message', SQLERRM));
    RAISE WARNING '[loyalty] process_visit % falló: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END; $$;

-- ----------------------------------------------------------------------------
-- 6. loyalty_cancel_client_reward: los lotes revertidos no devuelven puntos
-- ----------------------------------------------------------------------------
-- Misma firma que la 203 (los grants se conservan con CREATE OR REPLACE).
-- Cambios: el loop corre ANTES de la fila cabecera y trae l.reversed_by; los
-- consumos de lotes revertidos se acumulan en points_forfeited y NO se
-- devuelven; la cabecera 'reversal' sólo se inserta si hubo devolución y con
-- points = v_restored (no points_spent); el canje cancelado queda marcado
-- reversed_by = COALESCE(v_tx, id), igual que hace loyalty_reverse_lot cuando
-- no hay fila de reversión.
CREATE OR REPLACE FUNCTION public.loyalty_cancel_client_reward(
  p_client_reward_id uuid, p_reason text, p_refund boolean DEFAULT true,
  p_staff_id uuid DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cr client_rewards%ROWTYPE; v_s loyalty_settings%ROWTYPE; r record;
  v_restored integer := 0; v_forfeited integer := 0; v_tx uuid;
BEGIN
  SELECT * INTO v_cr FROM client_rewards WHERE id = p_client_reward_id FOR UPDATE;
  IF v_cr.id IS NULL THEN RETURN json_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_cr.status <> 'available' THEN RETURN json_build_object('success', false, 'error', 'not_available'); END IF;
  UPDATE client_rewards SET status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason WHERE id = v_cr.id;
  UPDATE reward_catalog SET stock = stock + 1 WHERE id = v_cr.reward_id AND stock IS NOT NULL;

  IF p_refund AND v_cr.redemption_tx_id IS NOT NULL THEN
    SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_cr.organization_id;
    FOR r IN SELECT c.lot_tx_id, c.points, l.expires_at, l.reversed_by
               FROM point_lot_consumptions c JOIN point_transactions l ON l.id = c.lot_tx_id
              WHERE c.redemption_tx_id = v_cr.redemption_tx_id LOOP
      IF r.reversed_by IS NOT NULL THEN
        -- El lote de origen fue revertido (p. ej. se anuló la visita que lo
        -- generó): esos puntos NO vuelven. Devolverlos creaba saldo de una
        -- visita inexistente y dejaba un lote con reversed_by y remaining > 0.
        v_forfeited := v_forfeited + r.points;
        CONTINUE;
      END IF;
      IF r.expires_at IS NULL OR r.expires_at > now() THEN
        UPDATE point_transactions SET remaining = remaining + r.points WHERE id = r.lot_tx_id;
      ELSE
        INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, expires_at, meta)
        VALUES (v_cr.client_id, v_cr.organization_id, r.points, r.points, 'reversal', 'Devolución de canje',
                now() + make_interval(days => COALESCE(v_s.points_expiry_days, 120)), jsonb_build_object('client_reward_id', v_cr.id));
      END IF;
      v_restored := v_restored + r.points;
    END LOOP;

    IF v_restored > 0 THEN
      INSERT INTO point_transactions (client_id, organization_id, points, remaining, type, description, reverses, meta)
      VALUES (v_cr.client_id, v_cr.organization_id, v_restored, 0, 'reversal', 'Devolución: ' || COALESCE(p_reason, 'canje cancelado'),
              v_cr.redemption_tx_id, jsonb_build_object('client_reward_id', v_cr.id, 'staff_id', p_staff_id,
                                                        'actor_user_id', p_actor_user_id, 'points_forfeited', v_forfeited))
      RETURNING id INTO v_tx;
    END IF;
    UPDATE point_transactions SET reversed_by = COALESCE(v_tx, id) WHERE id = v_cr.redemption_tx_id;
  END IF;

  PERFORM loyalty_log_event(v_cr.organization_id, v_cr.client_id, 'reward_cancelled', NULL,
    jsonb_build_object('client_reward_id', v_cr.id, 'reason', p_reason, 'points_restored', v_restored,
                       'points_forfeited', v_forfeited, 'staff_id', p_staff_id, 'actor_user_id', p_actor_user_id));
  RETURN json_build_object('success', true, 'points_restored', v_restored, 'points_forfeited', v_forfeited);
END; $$;

-- ----------------------------------------------------------------------------
-- 7. loyalty_recalc_tier: sin gracia, un escalón por día como mucho
-- ----------------------------------------------------------------------------
-- Único cambio respecto del cuerpo vivo: la condición del ELSIF de bajada.
-- Con grace_days > 0 la rama nueva es inalcanzable con grace_until NULL (la
-- rama anterior abre la gracia primero), así que su comportamiento es idéntico;
-- con grace_days = 0 el gate por tier_reached_at limita la bajada a un escalón
-- por día (tier_reached_at se escribe en enrolled/tier_up/tier_down, por eso
-- sirve de marca de "última bajada"; el COALESCE cubre estados legacy sin fecha).
CREATE OR REPLACE FUNCTION public.loyalty_recalc_tier(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client clients%ROWTYPE; v_s loyalty_settings%ROWTYPE; v_state client_loyalty_state%ROWTYPE;
  v_target loyalty_tiers%ROWTYPE; v_lower loyalty_tiers%ROWTYPE; v_next loyalty_tiers%ROWTYPE;
  v_n integer; v_now timestamptz := now(); v_change text := NULL; v_prev text; v_tz text;
BEGIN
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF v_client.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_s FROM loyalty_settings WHERE organization_id = v_client.organization_id;
  IF v_s.organization_id IS NULL OR NOT v_s.is_enabled THEN RETURN NULL; END IF;

  v_n := loyalty_visits_in_window(p_client_id, v_now, v_s.window_weeks);

  SELECT * INTO v_target FROM loyalty_tiers
   WHERE organization_id = v_client.organization_id AND is_active
     AND min_visits <= v_n AND (max_visits IS NULL OR v_n <= max_visits)
   ORDER BY sort_order DESC LIMIT 1;
  IF v_target.id IS NULL THEN
    SELECT * INTO v_target FROM loyalty_tiers
     WHERE organization_id = v_client.organization_id AND is_active AND min_visits <= v_n
     ORDER BY sort_order DESC LIMIT 1;
  END IF;
  IF v_target.id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO client_loyalty_state (client_id, organization_id)
  VALUES (p_client_id, v_client.organization_id) ON CONFLICT (client_id) DO NOTHING;
  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id FOR UPDATE;
  v_prev := v_state.tier_code;

  IF v_state.tier_code IS NULL THEN
    UPDATE client_loyalty_state SET tier_code = v_target.code, tier_sort = v_target.sort_order,
      visits_in_window = v_n, tier_reached_at = v_now, enrolled_at = COALESCE(enrolled_at, v_now),
      grace_until = NULL, last_recalc_at = v_now, updated_at = v_now WHERE client_id = p_client_id;
    PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'enrolled', NULL,
      jsonb_build_object('tier', v_target.code, 'visits', v_n));
    v_change := 'enrolled';

  ELSIF v_target.sort_order > v_state.tier_sort THEN
    UPDATE client_loyalty_state SET tier_code = v_target.code, tier_sort = v_target.sort_order,
      visits_in_window = v_n, tier_reached_at = v_now, grace_until = NULL, last_recalc_at = v_now, updated_at = v_now
     WHERE client_id = p_client_id;
    PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'tier_up', NULL,
      jsonb_build_object('from', v_prev, 'to', v_target.code, 'visits', v_n));
    PERFORM loyalty_notify(v_client.organization_id, p_client_id, 'tier_up',
      jsonb_build_object('categoria', v_target.name, 'multiplicador', v_target.multiplier_pct::text, 'visitas', v_n::text),
      'tier_up:' || v_target.code || ':' || to_char(v_now, 'YYYY-MM-DD'));
    v_change := 'up';

  ELSIF v_target.sort_order = v_state.tier_sort THEN
    IF v_state.grace_until IS NOT NULL THEN
      PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'grace_recovered', NULL,
        jsonb_build_object('tier', v_state.tier_code, 'visits', v_n));
      v_change := 'recovered';
    END IF;
    UPDATE client_loyalty_state SET visits_in_window = v_n, grace_until = NULL, last_recalc_at = v_now, updated_at = v_now
     WHERE client_id = p_client_id;

  ELSE
    IF v_state.grace_until IS NULL AND v_s.grace_days > 0 THEN
      UPDATE client_loyalty_state SET grace_until = v_now + make_interval(days => v_s.grace_days),
        visits_in_window = v_n, last_recalc_at = v_now, updated_at = v_now WHERE client_id = p_client_id;
      PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'grace_started', NULL,
        jsonb_build_object('tier', v_state.tier_code, 'target', v_target.code, 'until', v_now + make_interval(days => v_s.grace_days), 'visits', v_n));
      v_tz := loyalty_tz_of_branch((SELECT branch_id FROM visits WHERE client_id = p_client_id ORDER BY completed_at DESC LIMIT 1));
      PERFORM loyalty_notify(v_client.organization_id, p_client_id, 'tier_grace_warning',
        jsonb_build_object('categoria', (SELECT name FROM loyalty_tiers WHERE organization_id = v_client.organization_id AND code = v_state.tier_code),
                           'dias', v_s.grace_days::text,
                           'fecha', to_char((v_now + make_interval(days => v_s.grace_days)) AT TIME ZONE v_tz, 'DD/MM')),
        'grace:' || v_state.tier_code || ':' || to_char(v_now, 'YYYY-MM-DD'));
      v_change := 'grace';
    -- Antes: `v_state.grace_until IS NULL OR v_state.grace_until <= v_now`.
    -- Con grace_days = 0 eso bajaba un escalón en CADA llamada (app, cobro,
    -- cron) sin freno: la escalera entera en segundos. El gate nuevo sólo es
    -- alcanzable con grace_until NULL cuando grace_days = 0 (si no, la rama de
    -- arriba abre gracia primero) y limita la bajada a una por día.
    ELSIF (v_state.grace_until IS NOT NULL AND v_state.grace_until <= v_now)
       OR (v_state.grace_until IS NULL
           AND COALESCE(v_state.tier_reached_at, '-infinity'::timestamptz) <= v_now - interval '1 day') THEN
      SELECT * INTO v_lower FROM loyalty_tiers
       WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort - 1;
      IF v_lower.id IS NOT NULL THEN
        UPDATE client_loyalty_state SET tier_code = v_lower.code, tier_sort = v_lower.sort_order,
          visits_in_window = v_n, tier_reached_at = v_now, grace_until = NULL, last_recalc_at = v_now, updated_at = v_now
         WHERE client_id = p_client_id;
        PERFORM loyalty_log_event(v_client.organization_id, p_client_id, 'tier_down', NULL,
          jsonb_build_object('from', v_prev, 'to', v_lower.code, 'visits', v_n));
        PERFORM loyalty_notify(v_client.organization_id, p_client_id, 'tier_down',
          jsonb_build_object('categoria', v_lower.name, 'visitas', v_n::text),
          'tier_down:' || v_lower.code || ':' || to_char(v_now, 'YYYY-MM-DD'));
        v_change := 'down';
      ELSE
        UPDATE client_loyalty_state SET visits_in_window = v_n, last_recalc_at = v_now, updated_at = v_now WHERE client_id = p_client_id;
      END IF;
    ELSE
      UPDATE client_loyalty_state SET visits_in_window = v_n, last_recalc_at = v_now, updated_at = v_now WHERE client_id = p_client_id;
    END IF;
  END IF;

  SELECT * INTO v_state FROM client_loyalty_state WHERE client_id = p_client_id;
  SELECT * INTO v_next FROM loyalty_tiers
   WHERE organization_id = v_client.organization_id AND is_active AND sort_order = v_state.tier_sort + 1;

  RETURN jsonb_build_object(
    'tier_code', v_state.tier_code, 'previous_tier_code', v_prev, 'change', v_change,
    'visits_in_window', v_n, 'grace_until', v_state.grace_until,
    'next_tier_code', v_next.code, 'next_tier_name', v_next.name,
    'visits_to_next', CASE WHEN v_next.id IS NULL THEN NULL ELSE GREATEST(v_next.min_visits - v_n, 0) END);
END; $$;

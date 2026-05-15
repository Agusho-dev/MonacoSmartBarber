-- 136_drop_dead_queue_functions.sql
-- ---------------------------------------------------------------------------
-- LIMPIEZA: eliminar funciones muertas del path de fila tras el modelo pool
-- (mig 134) y la baja de la pre-asignación server-side en el check-in.
--
-- Verificado antes de dropear:
--   * Sin callers en TS (MonacoSmartBarber/src) ni en mobile (Monaco-mobile).
--   * Sin views / materialized views / policies / cron jobs que las usen.
--   * Únicas referencias internas en DB: get_fair_barber -> compute_fair_barber
--     (ambas se dropean acá) y claim_next_for_barber -> is_barber_present_now
--     (ya removida en mig 134).
--
-- Seguridad de orden de deploy: el código actualmente desplegado llama a
-- compute_fair_barber vía supabase.rpc() y solo usa el resultado con
-- `if (predicted)`, sin lanzar ante error -> degrada con gracia a
-- barber_id = NULL (que es justamente el comportamiento pool deseado). Por
-- eso es seguro dropear incluso antes del redeploy del dashboard.
--
--   - assign_next_client      : legacy mig 074/128, sin callers desde mig 131.
--   - assign_dynamic_barber   : creada en mig 132, nunca se usó (el check-in
--                               terminó usando compute_fair_barber).
--   - get_fair_barber         : wrapper público de compute_fair_barber (mig 130).
--   - compute_fair_barber     : ranking de pre-asignación (mig 129); el modelo
--                               pool ya no pre-asigna server-side.
--   - is_barber_present_now   : soporte del binding sticky (mig 133), muerto
--                               tras mig 134.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.assign_next_client(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.assign_dynamic_barber(uuid);
DROP FUNCTION IF EXISTS public.get_fair_barber(uuid);
DROP FUNCTION IF EXISTS public.compute_fair_barber(uuid, text);
DROP FUNCTION IF EXISTS public.is_barber_present_now(uuid, uuid, text);

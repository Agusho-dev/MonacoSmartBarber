-- =============================================================================
-- 181_drop_cron_process_appointments.sql
-- Corrige la migración 180: el cron `process_appointments` no había que
-- repararlo, había que BORRARLO.
--
-- QUÉ ME FALTÓ MIRAR EN LA 180
-- ----------------------------
-- Al ver que el job apuntaba a un dominio muerto, asumí que el arreglo era
-- apuntarlo al dominio bueno. Pero la ruta `/api/cron/process-appointments`
-- **tampoco existe en el dominio bueno**: se borró a propósito en el commit
-- b05541f ("remove legacy turnos.ts and related types; migrate to RPCs for
-- appointment management"), cuando el manejo de turnos pasó a RPCs.
--
-- O sea que el job quedó huérfano: viene pegándole cada minuto a una ruta que
-- nadie va a volver a escribir. Lo que hace hoy el trabajo que ese endpoint
-- hacía es el cron `mark_no_show_overdue`, que es SQL puro dentro de Postgres
-- (mig 168) y funciona.
--
-- Desprogramarlo NO saca ninguna funcionalidad: saca 1.440 requests 404 por día
-- y el ruido que tapaba a los crons que sí importaban.
--
-- Lección, y va al Known Risk #26: un 404 puede ser "la URL está mal" o "la ruta
-- ya no existe". Antes de arreglar la URL hay que preguntarse si el endpoint
-- todavía debería existir — `curl` a la ruta y `git log --diff-filter=D` sobre
-- su carpeta contestan las dos cosas en un minuto.
-- =============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('process_appointments');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- La función de la 180 apuntaba a esa misma ruta inexistente: no sirve para nada.
DROP FUNCTION IF EXISTS public.trigger_process_appointments();

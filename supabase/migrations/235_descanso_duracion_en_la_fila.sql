-- =============================================================================
-- 235 — Cuánto dura cada descanso, guardado en la fila (3/nov/2026)
-- =============================================================================
--
-- QUÉ PASABA
-- Un descanso nace por dos caminos y sólo uno guardaba de cuánto era:
--   · pedido por el barbero y aprobado (`approveBreak`): la entrada apunta a
--     `break_requests`, que apunta a `break_configs.duration_minutes`.
--   · arrastrado desde la fila del dashboard (`createBreakEntry`): recibía el
--     nombre de la configuración ("20 min", "Almuerzo") y lo IGNORABA. La
--     entrada quedaba sin `break_request_id` y sin ninguna duración. Es el camino
--     más usado: 66 cierres por esa vía desde septiembre contra 5 solicitudes
--     completadas en el último mes.
--
-- Consecuencias de no saberlo:
--   · el kiosko no puede decirle al cliente cuándo vuelve el barbero, y ahora se
--     puede elegir a un barbero en descanso (ver `operacion-local.md`).
--   · «Tiempos de descanso excedidos» tomaba la duración como 0 y mostraba como
--     exceso TODO el descanso: el 3/nov decía «+18m 15s» a los 18 minutos de un
--     descanso que duró alrededor de 20.
--   · el panel del barbero no dibujaba la regla ni avisaba «Se pasó el descanso».
--
-- QUÉ HACE
-- `queue_entries.break_duration_minutes`: los minutos que le dieron a ese descanso.
-- Lo escriben `createBreakEntry` y `approveBreak` al crear la entrada.
--
-- DECISIONES
-- 1. Vive en la entrada, no en una consulta aparte: el kiosko y el panel ya leen
--    `queue_entries` con `*`, también en cada evento de Realtime. No hace falta
--    otra consulta ni otro permiso para anon, y anon no tiene que leer
--    `break_requests`.
-- 2. Es una FOTO del momento de crearlo: cambiar la configuración después no le
--    cambia la duración a un descanso que ya está corriendo.
-- 3. NULLABLE y sin backfill. Las entradas de cliente no lo usan, y un descanso de
--    antes (o creado por un bundle viejo, Known Risk #38) queda en NULL, que
--    significa "no se sabe". Las pantallas lo dicen así y no inventan un número.
-- 4. Sin FK (Known Risk #15) y sin índice: se lee siempre junto con la fila.
-- 5. `lock_timeout`: ADD COLUMN sin default no reescribe la tabla, pero pide un
--    lock exclusivo un instante. Si hubiera una transacción larga agarrada de
--    `queue_entries`, esperar acá frenaría a todos los que vienen atrás (las
--    tablets incluidas). Mejor fallar y reintentar.
--
-- Orden de deploy: esta migración ANTES que el código. Al revés, `createBreakEntry`
-- insertaría una columna que no existe y no se podría asignar ningún descanso.
-- =============================================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS break_duration_minutes integer;

COMMENT ON COLUMN public.queue_entries.break_duration_minutes IS
  'Minutos asignados a este descanso (sólo is_break). Foto de break_configs.duration_minutes al crearlo. NULL = no se sabe.';

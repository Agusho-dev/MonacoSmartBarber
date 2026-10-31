-- =============================================================================
-- 234 — «Corte Final»: clave de idempotencia de cada partida (31/oct/2026)
-- =============================================================================
--
-- QUÉ PASABA
-- `juego_partidas` sólo tenía la PK `id` (que arma la base): nada identificaba
-- la PELEA. Si el guardado fallaba sin decir si había llegado —el celular se
-- quedaba sin red con el pedido en vuelo, o el cliente de Supabase cortaba a
-- los 8 s (Known Risk #12: el timeout corta la RESPUESTA, no la escritura)—,
-- «Reintentar» volvía a insertar la misma pelea y quedaba dos veces en el %
-- de victorias de ese barbero (juego_estadisticas_personajes cuenta filas; el
-- ranking y el puesto no cambian porque agrupan por apodo). Por eso la cola de
-- pendientes del celular (src/lib/juego/pendientes.ts) no reintentaba nunca
-- esas fallas: la partida se perdía.
--
-- QUÉ HACE
-- `id_partida`: el id de la pelea, un UUID que arma el celular
-- (crypto.randomUUID en src/components/juego/pantalla-pelea.tsx) y que viaja
-- igual en cada intento. Con el índice ÚNICO, la server action
-- (src/lib/actions/juego.ts) inserta con
--   INSERT … ON CONFLICT (id_partida) DO NOTHING
-- (upsert de PostgREST con ignoreDuplicates): el segundo intento de la misma
-- pelea no inserta nada y contesta lo mismo que el primero. Así el celular puede
-- reintentar también después de una falla de red o de un timeout.
--
-- DECISIONES
-- 1. NULLABLE. Las filas de antes (42 el 31/oct) y las de la página vieja (que no
--    manda el id; Known Risk #38) quedan en NULL, y un índice único admite
--    muchos NULL (NULLS DISTINCT, el default).
-- 2. Índice único sobre la columna sola y SIN WHERE: ON CONFLICT (id_partida)
--    necesita un índice que le corresponda exacto; con uno parcial, PostgREST
--    no lo infiere y la sentencia da 42P10.
-- 3. Sin CONCURRENTLY: la tabla es chica (42 filas el 31/oct) y CREATE INDEX
--    CONCURRENTLY no corre dentro de la transacción de la migración.
-- 4. Nada más lee la tabla con `*`: las cuatro funciones de la mig 232
--    (juego_inicio_periodo, juego_ranking, juego_puesto y
--    juego_estadisticas_personajes) nombran sus columnas; no hay vistas,
--    triggers, policies, publicación de Realtime ni funciones con el tipo de
--    fila (leído vivo con pg_get_functiondef, pg_depend, pg_trigger y
--    pg_publication_tables el 31/oct). La columna nueva no cambia ninguna.
-- 5. El código tolera la base SIN esta migración: si la columna o el índice no
--    están (42703, PGRST204 del caché de PostgREST o 42P10), cae a un insert
--    común. Aplicarla ANTES del deploy es lo que activa la deduplicación.
--
-- Aditiva e idempotente: se puede correr de nuevo sin efecto.
-- =============================================================================

ALTER TABLE public.juego_partidas
  ADD COLUMN IF NOT EXISTS id_partida uuid;

COMMENT ON COLUMN public.juego_partidas.id_partida IS
  'Id de la pelea que arma el celular (crypto.randomUUID): clave de idempotencia del guardado. UNIQUE; NULL en las partidas de antes del 31/oct y de la página vieja (mig 234).';

CREATE UNIQUE INDEX IF NOT EXISTS juego_partidas_id_partida_key
  ON public.juego_partidas (id_partida);

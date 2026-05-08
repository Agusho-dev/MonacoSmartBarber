-- =====================================================================
-- 124 — Limpieza de la publication de Supabase Realtime.
--
-- attendance_logs y break_requests están dentro de supabase_realtime y
-- generan altísima carga sobre el WAL replication slot (22% del tiempo de
-- DB venía de WAL queries, según pg_stat_statements). El barber-panel
-- escucha esos eventos sin filtro de branch, así que un clock_in en
-- cualquier sucursal hace fan-out a TODOS los tablets, cada uno disparando
-- 5 queries en paralelo.
--
-- La app no necesita streaming para esos datos: ya tiene visibility refresh
-- y refetch al expandir el panel. La migración 124 saca esas tablas de la
-- publication; la PR de frontend que viene después remueve los listeners
-- correspondientes.
--
-- Es seguro correr esto en caliente: clientes ya conectados simplemente
-- dejan de recibir esos eventos (no hay error). Los próximos refetch
-- (visibility / Realtime sobre queue_entries) traen los datos frescos.
-- =====================================================================

-- DROP TABLE FROM PUBLICATION es idempotente con IF EXISTS (Postgres 15+).
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.attendance_logs;
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.break_requests;

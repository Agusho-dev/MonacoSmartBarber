-- =====================================================================
-- 123 — Índices de emergencia: la DB está al 100% por queries del barber
--      panel y del check-in que no tenían soporte de índice.
--
-- Diagnóstico (pg_stat_statements del 30/abr/2026):
--   * visits:           288k+25k calls/día, 9.3% + 4.1% del tiempo total
--   * staff_schedules:  331k calls/día, 4.6% del tiempo total
--   * attendance_logs:  347k calls/día (lectura del clock-in del día)
--
-- Todos los índices se crean CONCURRENTLY para no bloquear writes en
-- producción (pero esto significa que NO pueden ir dentro de una sola
-- transacción — Supabase los corre uno por uno).
-- =====================================================================

-- 1) Mata el query de visits.amount (per-barber today)
--    Patrón: WHERE barber_id=$ AND branch_id=$ AND completed_at>=$
--    INCLUDE (amount) habilita index-only scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_branch_barber_completed
  ON public.visits (branch_id, barber_id, completed_at DESC)
  INCLUDE (amount)
  WHERE barber_id IS NOT NULL;

-- 2) Mata el query de visits para overview (sin filtro de barber)
--    Patrón: WHERE branch_id=$ AND barber_id IS NOT NULL ORDER BY completed_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visits_branch_completed
  ON public.visits (branch_id, completed_at DESC)
  WHERE barber_id IS NOT NULL;

-- 3) Mata el query de staff_schedules del día actual
--    Patrón: WHERE day_of_week=$ AND is_active=true
--    Partial index sobre is_active para minimizar tamaño.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_schedules_dow_active
  ON public.staff_schedules (day_of_week)
  WHERE is_active = true;

-- 4) Mata el query de attendance_logs del día (clock-in/out check)
--    Patrón: WHERE branch_id=$ AND recorded_at>=hoy ORDER BY recorded_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_logs_branch_recorded
  ON public.attendance_logs (branch_id, recorded_at DESC);

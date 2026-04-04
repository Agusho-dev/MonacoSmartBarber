-- ============================================
-- Cron para descansos programados (multi-tenant)
-- Función SQL ejecutada por pg_cron cada minuto.
-- Crea solicitudes de descanso automáticas para todos los break_configs
-- que tengan scheduled_time y coincidan con el minuto actual (hora Argentina).
-- Multi-tenant: recorre todas las orgs/sucursales, no depende de sesión.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Función que crea break_requests automáticas
CREATE OR REPLACE FUNCTION process_scheduled_breaks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_ar TIMESTAMPTZ;
  v_current_hhmm TEXT;
  v_today_start TIMESTAMPTZ;
  v_config RECORD;
  v_rows_inserted INT;
  v_total_created INT := 0;
BEGIN
  -- Hora actual en Argentina (UTC-3)
  v_now_ar := now() AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_current_hhmm := to_char(v_now_ar, 'HH24:MI');
  v_today_start := date_trunc('day', v_now_ar);

  -- Iterar configs activas cuya hora programada coincida con el minuto actual
  FOR v_config IN
    SELECT bc.id, bc.branch_id, bc.name
    FROM break_configs bc
    WHERE bc.is_active = true
      AND bc.scheduled_time IS NOT NULL
      AND abs(
            EXTRACT(EPOCH FROM (bc.scheduled_time - v_current_hhmm::time))
          ) <= 150  -- ventana de ±2.5 minutos para cubrir el intervalo de 5 min
  LOOP
    -- Insertar solicitudes para barberos activos que NO tengan ya una
    -- solicitud pendiente/aprobada hoy para este config
    INSERT INTO break_requests (staff_id, branch_id, break_config_id)
    SELECT s.id, v_config.branch_id, v_config.id
    FROM staff s
    WHERE s.branch_id = v_config.branch_id
      AND s.role = 'barber'
      AND s.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM break_requests br
        WHERE br.staff_id = s.id
          AND br.break_config_id = v_config.id
          AND br.status IN ('pending', 'approved')
          AND br.requested_at >= v_today_start
      );

    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    v_total_created := v_total_created + v_rows_inserted;
  END LOOP;

  RETURN jsonb_build_object('created', v_total_created, 'checked_at', v_current_hhmm);
END;
$$;

-- Programar ejecución cada minuto
SELECT cron.schedule(
  'process-scheduled-breaks',
  '*/5 * * * *',
  'SELECT process_scheduled_breaks()'
);

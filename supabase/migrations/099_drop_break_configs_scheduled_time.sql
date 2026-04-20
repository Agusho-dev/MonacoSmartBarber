-- F3: Elimina funcionalidad de descansos programados
ALTER TABLE break_configs DROP COLUMN IF EXISTS scheduled_time;

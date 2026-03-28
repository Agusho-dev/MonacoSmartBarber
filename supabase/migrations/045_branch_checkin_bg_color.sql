-- Color de fondo del kiosk de check-in configurable por sucursal
-- Null significa "usar el color global de app_settings"
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS checkin_bg_color TEXT DEFAULT NULL
    CHECK (checkin_bg_color IS NULL OR checkin_bg_color IN ('white', 'black', 'graphite'));

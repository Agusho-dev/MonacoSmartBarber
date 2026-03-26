-- Agrega opción de color de fondo para la terminal de check-in
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS checkin_bg_color TEXT NOT NULL DEFAULT 'graphite'
    CHECK (checkin_bg_color IN ('white', 'black', 'graphite'));

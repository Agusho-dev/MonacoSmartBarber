-- Add configurable shift-end margin (minutes before shift end where barber stops receiving new clients)
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS shift_end_margin_minutes INTEGER NOT NULL DEFAULT 35;
